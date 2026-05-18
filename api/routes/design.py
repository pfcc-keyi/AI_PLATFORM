"""FastAPI routes for the Schema Design Cockpit.

Endpoints (all mounted under ``/api/design``):

* ``POST   /upload``                            -- multipart xlsx upload
* ``POST   /{design_id}/answer``                -- resume after clarification
* ``POST   /{design_id}/review``                -- approve / revise / reject
* ``POST   /{design_id}/refine``                -- propose a DesignRevision
* ``POST   /{design_id}/revisions/{rev}/apply`` -- apply a pending revision
* ``POST   /{design_id}/revisions/{rev}/drop``  -- drop a pending revision
* ``POST   /{design_id}/revisions/{rev}/restore`` -- restore an applied revision
* ``POST   /{design_id}/suggest-handlers``      -- (table, field, state) sketch
* ``POST   /{design_id}/edit``                  -- manual UI edit (no LLM)
* ``POST   /{design_id}/critique``              -- re-run critic
* ``GET    /{design_id}``                       -- full design + phase
* ``GET    /{design_id}/revisions``             -- list revisions
* ``GET    /{design_id}/events``                -- SSE: live flow / LLM stream
* ``GET    /``                                  -- list designs
* ``DELETE /{design_id}``                       -- delete design + revisions

Includes an inline SSE event bridge that consumes ``crewai_event_bus`` and
forwards key events to a per-design ``asyncio.Queue`` for SSE consumers.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
from collections import deque
from typing import Any, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from flows.design_flow import (
    SchemaDesignFlow,
    clear_upload,
    new_flow,
    register_upload,
)
from models.design_models import FullDesign
from storage import design_store

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Module-level session + SSE state
# ---------------------------------------------------------------------------

_active_designs: dict[str, SchemaDesignFlow] = {}

# Per-design SSE queue + rolling history for late subscribers.
_design_queues: dict[str, asyncio.Queue] = {}
_design_history: dict[str, deque] = {}
_HISTORY_PER_DESIGN = 200

# ContextVar so the event bridge can attribute LLM/task events to the
# active design while a flow runs on a worker thread.
_active_design_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "design_id", default=None
)

# Lazy event-loop holder so emit_from_thread can push from a worker thread
# into the main asyncio loop.
_main_loop: Optional[asyncio.AbstractEventLoop] = None


def _get_queue(design_id: str) -> asyncio.Queue:
    q = _design_queues.get(design_id)
    if q is None:
        q = asyncio.Queue(maxsize=2048)
        _design_queues[design_id] = q
        _design_history[design_id] = deque(maxlen=_HISTORY_PER_DESIGN)
    return q


def _emit(design_id: str, payload: dict[str, Any]) -> None:
    """Push a design-domain event onto the per-design queue + history."""
    if not design_id:
        return
    q = _get_queue(design_id)
    history = _design_history.setdefault(design_id, deque(maxlen=_HISTORY_PER_DESIGN))
    history.append(payload)
    try:
        q.put_nowait(payload)
    except asyncio.QueueFull:
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            logger.warning("design SSE queue still full for %s", design_id)


def _emit_threadsafe(design_id: str, payload: dict[str, Any]) -> None:
    """Push from a worker thread back into the asyncio loop's queue."""
    if not design_id:
        return
    loop = _main_loop
    if loop is None or loop.is_closed():
        # Fall back to direct enqueue (best-effort; may run on the wrong loop)
        try:
            _emit(design_id, payload)
        except RuntimeError:
            pass
        return
    loop.call_soon_threadsafe(_emit, design_id, payload)


# ---------------------------------------------------------------------------
# Inline event-bus bridge (replaces a dedicated module)
# ---------------------------------------------------------------------------


_listeners_registered = False


def register_design_listeners() -> None:
    """Wire crewai_event_bus -> per-design SSE queues."""
    global _listeners_registered, _main_loop
    if _listeners_registered:
        return

    try:
        _main_loop = asyncio.get_running_loop()
    except RuntimeError:
        _main_loop = None  # We may be called outside a running loop.

    from crewai.events import (  # local import to keep startup light
        CrewKickoffCompletedEvent,
        CrewKickoffStartedEvent,
        FlowFinishedEvent,
        FlowStartedEvent,
        LLMStreamChunkEvent,
        MethodExecutionFinishedEvent,
        MethodExecutionStartedEvent,
        TaskCompletedEvent,
        TaskStartedEvent,
        ToolUsageFinishedEvent,
        ToolUsageStartedEvent,
        crewai_event_bus,
    )

    def _current_design_id() -> Optional[str]:
        return _active_design_var.get()

    @crewai_event_bus.on(LLMStreamChunkEvent)
    def _on_llm_chunk(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {
                "type": "llm_chunk",
                "content": getattr(event, "chunk", ""),
                "agent_role": getattr(event, "agent_role", None),
                "task_name": getattr(event, "task_name", None),
            },
        )

    @crewai_event_bus.on(TaskStartedEvent)
    def _on_task_started(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {
                "type": "task_started",
                "agent_role": getattr(event, "agent_role", None),
                "task_name": getattr(event, "task_name", None) or getattr(event, "name", None),
            },
        )

    @crewai_event_bus.on(TaskCompletedEvent)
    def _on_task_completed(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {
                "type": "task_completed",
                "agent_role": getattr(event, "agent_role", None),
                "task_name": getattr(event, "task_name", None) or getattr(event, "name", None),
            },
        )

    @crewai_event_bus.on(CrewKickoffStartedEvent)
    def _on_crew_started(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {"type": "crew_started", "crew_name": getattr(event, "crew_name", None)},
        )

    @crewai_event_bus.on(CrewKickoffCompletedEvent)
    def _on_crew_completed(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {"type": "crew_completed", "crew_name": getattr(event, "crew_name", None)},
        )

    @crewai_event_bus.on(MethodExecutionStartedEvent)
    def _on_method_started(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {
                "type": "method_started",
                "flow_name": getattr(event, "flow_name", None),
                "method": getattr(event, "method_name", None),
            },
        )

    @crewai_event_bus.on(MethodExecutionFinishedEvent)
    def _on_method_finished(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {
                "type": "method_finished",
                "flow_name": getattr(event, "flow_name", None),
                "method": getattr(event, "method_name", None),
            },
        )

    @crewai_event_bus.on(FlowStartedEvent)
    def _on_flow_started(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {"type": "flow_started", "flow_name": getattr(event, "flow_name", None)},
        )

    @crewai_event_bus.on(FlowFinishedEvent)
    def _on_flow_finished(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {"type": "flow_finished", "flow_name": getattr(event, "flow_name", None)},
        )

    @crewai_event_bus.on(ToolUsageStartedEvent)
    def _on_tool_started(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {"type": "tool_started", "tool": getattr(event, "tool_name", None)},
        )

    @crewai_event_bus.on(ToolUsageFinishedEvent)
    def _on_tool_finished(_source, event: Any) -> None:
        design_id = _current_design_id()
        if not design_id:
            return
        _emit_threadsafe(
            design_id,
            {"type": "tool_finished", "tool": getattr(event, "tool_name", None)},
        )

    _listeners_registered = True
    logger.info("design routes: crewai_event_bus listeners registered")


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class AnswerRequest(BaseModel):
    answers: dict[str, str] = Field(
        default_factory=dict,
        description="{question: answer} pairs for the clarification round.",
    )


class ReviewRequest(BaseModel):
    action: str = Field(description="'approved' | 'revise' | 'reject'")
    feedback: str = ""


class RefineRequest(BaseModel):
    scope: str = "global"
    target: str = ""
    request: str


class SuggestHandlersRequest(BaseModel):
    table: str
    field: str
    state: str


class EditRequest(BaseModel):
    after: dict[str, Any]
    change_summary: str = ""


class CritiqueRequest(BaseModel):
    scope: str = "global"


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------


def _state_response(flow: SchemaDesignFlow) -> dict[str, Any]:
    state = flow.state
    return {
        "design_id": state.design_id,
        "phase": state.phase,
        "clarification_round": state.clarification_round,
        "questions": (
            state.domain_analysis.questions if state.domain_analysis else []
        ),
        "pending_revisions": [
            {
                "revision_id": r.revision_id,
                "actor": r.actor,
                "change_summary": r.change_summary,
                "created_at": r.created_at,
            }
            for r in state.pending_revisions
        ],
    }


async def _run_flow_in_thread(flow: SchemaDesignFlow, design_id: str) -> Any:
    """Run a flow.kickoff in a worker thread with the design_id contextvar set."""
    token = _active_design_var.set(design_id)
    try:
        return await asyncio.to_thread(flow.kickoff)
    finally:
        _active_design_var.reset(token)


async def _run_in_thread(design_id: str, fn, *args, **kwargs) -> Any:
    """Run any callable in a worker thread with the design_id contextvar set."""
    token = _active_design_var.set(design_id)
    try:
        return await asyncio.to_thread(fn, *args, **kwargs)
    finally:
        _active_design_var.reset(token)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    filename: str = Form(default=""),
) -> dict[str, Any]:
    if not file.filename and not filename:
        raise HTTPException(status_code=400, detail="missing filename")
    actual_name = filename or file.filename or "schema.xlsx"
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="empty upload")

    flow = new_flow(filename=actual_name)
    design_id = flow.state.design_id
    register_upload(design_id, content, filename=actual_name)
    _active_designs[design_id] = flow
    _get_queue(design_id)

    _emit(design_id, {"type": "design_created", "design_id": design_id})

    try:
        await _run_flow_in_thread(flow, design_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("design upload kickoff failed (%s)", exc)
        return {**_state_response(flow), "error": str(exc)}

    _emit(design_id, {"type": "phase", "phase": flow.state.phase})
    return _state_response(flow)


@router.post("/{design_id}/answer")
async def answer(design_id: str, req: AnswerRequest) -> dict[str, Any]:
    flow = _active_designs.get(design_id)
    if not flow:
        raise HTTPException(status_code=404, detail="design session not found")

    result = await _run_in_thread(
        design_id, flow.resume_with_answers, req.answers
    )
    _emit(design_id, {"type": "phase", "phase": flow.state.phase})
    response = _state_response(flow)
    if isinstance(result, dict) and "error" in result:
        response["error"] = result["error"]
    return response


@router.post("/{design_id}/review")
async def review(design_id: str, req: ReviewRequest) -> dict[str, Any]:
    flow = _active_designs.get(design_id)
    if not flow:
        raise HTTPException(status_code=404, detail="design session not found")
    action = req.action.lower().strip()
    if action not in ("approved", "revise", "reject"):
        raise HTTPException(
            status_code=400, detail="action must be one of: approved, revise, reject"
        )
    result = await _run_in_thread(
        design_id, flow.resume_with_review, action, req.feedback or ""
    )
    _emit(design_id, {"type": "review", "action": action, "phase": flow.state.phase})
    return {**_state_response(flow), **(result or {})}


@router.post("/{design_id}/refine")
async def refine(design_id: str, req: RefineRequest) -> dict[str, Any]:
    flow = _active_designs.get(design_id)
    if not flow:
        raise HTTPException(status_code=404, detail="design session not found")
    if not req.request.strip():
        raise HTTPException(status_code=400, detail="empty request")

    revision = await _run_in_thread(
        design_id, flow.refine, req.scope, req.target, req.request
    )
    if revision is None:
        return {**_state_response(flow), "error": "refinement failed"}
    _emit(
        design_id,
        {
            "type": "revision_proposed",
            "revision_id": revision.revision_id,
            "change_summary": revision.change_summary,
        },
    )
    return {
        **_state_response(flow),
        "revision": revision.model_dump(),
    }


@router.post("/{design_id}/revisions/{revision_id}/apply")
async def apply_rev(design_id: str, revision_id: str) -> dict[str, Any]:
    flow = _active_designs.get(design_id)
    if not flow:
        raise HTTPException(status_code=404, detail="design session not found")
    new_design = await _run_in_thread(design_id, flow.apply_revision, revision_id)
    if new_design is None:
        raise HTTPException(status_code=404, detail="revision not found or missing 'after'")
    _emit(design_id, {"type": "revision_applied", "revision_id": revision_id})
    return {**_state_response(flow), "design": new_design.model_dump()}


@router.post("/{design_id}/revisions/{revision_id}/drop")
async def drop_rev(design_id: str, revision_id: str) -> dict[str, Any]:
    flow = _active_designs.get(design_id)
    if not flow:
        raise HTTPException(status_code=404, detail="design session not found")
    ok = await _run_in_thread(design_id, flow.drop_revision, revision_id)
    _emit(design_id, {"type": "revision_dropped", "revision_id": revision_id})
    return {**_state_response(flow), "dropped": ok}


@router.post("/{design_id}/revisions/{revision_id}/restore")
async def restore_rev(design_id: str, revision_id: str) -> dict[str, Any]:
    flow = _active_designs.get(design_id)
    if not flow:
        raise HTTPException(status_code=404, detail="design session not found")
    new_design = await _run_in_thread(design_id, flow.restore_revision, revision_id)
    if new_design is None:
        raise HTTPException(status_code=404, detail="revision not found or missing 'after'")
    _emit(design_id, {"type": "revision_restored", "revision_id": revision_id})
    return {**_state_response(flow), "design": new_design.model_dump()}


@router.post("/{design_id}/suggest-handlers")
async def suggest_handlers(
    design_id: str, req: SuggestHandlersRequest
) -> dict[str, Any]:
    flow = _active_designs.get(design_id)
    if not flow:
        raise HTTPException(status_code=404, detail="design session not found")
    sketches = await _run_in_thread(
        design_id,
        flow.suggest_handlers_for_field,
        req.table,
        req.field,
        req.state,
    )
    return {
        "design_id": design_id,
        "table": req.table,
        "field": req.field,
        "state": req.state,
        "handlers": [s.model_dump() for s in sketches],
    }


@router.post("/{design_id}/edit")
async def edit(design_id: str, req: EditRequest) -> dict[str, Any]:
    flow = _active_designs.get(design_id)
    if not flow:
        raise HTTPException(status_code=404, detail="design session not found")
    try:
        after = FullDesign(**req.after)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"invalid FullDesign: {exc}")
    revision = await _run_in_thread(
        design_id, flow.apply_user_edit, after, req.change_summary
    )
    _emit(
        design_id,
        {
            "type": "user_edit_applied",
            "revision_id": revision.revision_id,
            "change_summary": revision.change_summary,
        },
    )
    return {**_state_response(flow), "revision": revision.model_dump()}


@router.post("/{design_id}/critique")
async def critique(design_id: str, req: CritiqueRequest) -> dict[str, Any]:
    flow = _active_designs.get(design_id)
    if not flow:
        raise HTTPException(status_code=404, detail="design session not found")
    critique = await _run_in_thread(design_id, flow.critique, req.scope or "global")
    if critique is None:
        return {**_state_response(flow), "critique": None}
    _emit(design_id, {"type": "critique_updated", "issue_count": len(critique.issues)})
    return {**_state_response(flow), "critique": critique.model_dump()}


@router.get("/{design_id}")
async def get_design(design_id: str) -> dict[str, Any]:
    flow = _active_designs.get(design_id)
    full = None
    if flow and flow.state.full_design:
        full = flow.state.full_design
    else:
        full = design_store.load_design(design_id)
        if full is None:
            raise HTTPException(status_code=404, detail="design not found")
    response: dict[str, Any] = {
        "design_id": design_id,
        "design": full.model_dump(),
    }
    if flow:
        response.update(_state_response(flow))
    else:
        response.update({"phase": "ready", "questions": [], "pending_revisions": []})
    return response


@router.get("/{design_id}/revisions")
async def list_revs(design_id: str) -> dict[str, Any]:
    revisions = design_store.list_revisions(design_id)
    return {
        "design_id": design_id,
        "revisions": [r.model_dump() for r in revisions],
    }


@router.get("/")
async def list_designs() -> dict[str, Any]:
    return {"designs": design_store.list_designs()}


@router.delete("/{design_id}")
async def delete_design(design_id: str) -> dict[str, Any]:
    deleted = design_store.delete_design(design_id)
    _active_designs.pop(design_id, None)
    clear_upload(design_id)
    _design_queues.pop(design_id, None)
    _design_history.pop(design_id, None)
    return {"design_id": design_id, "deleted": deleted}


# ---------------------------------------------------------------------------
# SSE endpoint
# ---------------------------------------------------------------------------


def _sse_format(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, default=str)}\n\n"


async def _sse_stream(design_id: str):
    history = list(_design_history.get(design_id, ()))
    for ev in history:
        yield _sse_format(ev)
    queue = _get_queue(design_id)
    while True:
        try:
            payload = await asyncio.wait_for(queue.get(), timeout=15.0)
        except asyncio.TimeoutError:
            # keepalive comment so proxies don't close the connection
            yield ": keepalive\n\n"
            continue
        yield _sse_format(payload)


@router.get("/{design_id}/events")
async def events(design_id: str) -> StreamingResponse:
    return StreamingResponse(
        _sse_stream(design_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
