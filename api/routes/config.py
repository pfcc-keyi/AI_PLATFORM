"""API routes for Scenario A: configuration generation.

POST /api/config/analyze        -- submit requirement -> analysis + questions or confirm_needed
POST /api/config/answer         -- answer clarification questions -> updated analysis
POST /api/config/confirm        -- confirm/modify design -> codegen + validation -> review_needed
POST /api/config/review         -- human approval/rejection
POST /api/config/deploy         -- deploy approved code
POST /api/config/new-operation  -- reset session for another operation (same session_id)
GET  /api/config/sessions       -- past sessions from Memory
"""

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel, Field

from flows.config_flow import ConfigFlow
from setup.memory_setup import get_memory

router = APIRouter()

_active_sessions: dict[str, ConfigFlow] = {}


class AnalyzeRequest(BaseModel):
    requirement: str = Field(description="Natural language requirement")
    session_id: str = Field(default="", description="Resume an existing session")


class AnswerRequest(BaseModel):
    session_id: str
    answers: list[dict[str, str]] = Field(
        description="List of {'question': '...', 'answer': '...'}"
    )


class ReviewRequest(BaseModel):
    session_id: str
    approved: bool = True
    feedback: str = ""


class NewOperationRequest(BaseModel):
    session_id: str
    requirement: str = Field(default="", description="New requirement for the next operation")


class ConfirmRequest(BaseModel):
    session_id: str
    confirmed: bool = Field(default=True, description="True to proceed with codegen, False to just revise design")
    feedback: str = Field(default="", description="Natural language feedback to revise the design")


def _state_response(session_id: str, flow: ConfigFlow) -> dict:
    """Build a standardized response from flow state."""
    state = flow.state
    resp = {
        "session_id": session_id,
        "phase": state.phase,
        "operation_type": state.operation_type,
        "sub_flow": state.sub_flow,
        "analysis": state.analysis.model_dump() if state.analysis else None,
        "review_summary": state.review_summary,
        "validation_result": state.validation_result,
        "generated_code": state.generated_code.model_dump() if state.generated_code else None,
        "deployed": state.deployed,
        "operation_history": state.operation_history,
    }
    return resp


@router.post("/analyze")
async def analyze(req: AnalyzeRequest):
    if req.session_id and req.session_id in _active_sessions:
        flow = _active_sessions[req.session_id]
        flow.state.requirement = req.requirement
    else:
        flow = ConfigFlow(memory=get_memory())
        flow.state.requirement = req.requirement

    session_id = req.session_id or str(id(flow))
    _active_sessions[session_id] = flow

    try:
        result = await asyncio.to_thread(flow.kickoff)
    except Exception as e:
        return {
            **_state_response(session_id, flow),
            "error": f"Analysis failed: {e}",
        }

    resp = _state_response(session_id, flow)
    if isinstance(result, dict) and "error" in result:
        resp["error"] = result["error"]
    return resp


@router.post("/answer")
async def answer(req: AnswerRequest):
    flow = _active_sessions.get(req.session_id)
    if not flow:
        return {"error": "Session not found", "session_id": req.session_id}

    flow.state.clarifications.extend(req.answers)

    try:
        result = await asyncio.to_thread(flow.kickoff)
    except Exception as e:
        return {
            **_state_response(req.session_id, flow),
            "error": f"Answer processing failed: {e}",
        }

    resp = _state_response(req.session_id, flow)
    if isinstance(result, dict) and "error" in result:
        resp["error"] = result["error"]
    return resp


@router.post("/confirm")
async def confirm(req: ConfirmRequest):
    flow = _active_sessions.get(req.session_id)
    if not flow:
        return {"error": "Session not found", "session_id": req.session_id}

    try:
        if req.confirmed and req.feedback:
            result = await asyncio.to_thread(flow.revise_and_generate, req.feedback)
        elif req.confirmed:
            result = await asyncio.to_thread(flow.confirm_and_generate)
        else:
            if not req.feedback:
                return {"error": "Provide feedback when confirmed=false"}
            result = await asyncio.to_thread(flow.revise_design, req.feedback)
    except Exception as e:
        return {
            **_state_response(req.session_id, flow),
            "error": f"Operation failed: {e}",
        }

    return {**_state_response(req.session_id, flow), **result}


@router.post("/review")
async def review(req: ReviewRequest):
    flow = _active_sessions.get(req.session_id)
    if not flow:
        return {"error": "Session not found"}

    if req.approved:
        flow.state.review_status = "approved"
        flow.state.review_feedback = ""
        return {
            "session_id": req.session_id,
            "status": "approved",
            "message": "Code approved. Call POST /api/config/deploy to deploy.",
        }
    else:
        if not req.feedback:
            return {"error": "Provide feedback describing what to change"}
        flow.state.review_status = "revision_requested"
        flow.state.review_feedback = req.feedback
        try:
            result = await asyncio.to_thread(flow.revise_code, req.feedback)
        except Exception as e:
            return {
                **_state_response(req.session_id, flow),
                "error": f"Code revision failed: {e}",
            }
        return {**_state_response(req.session_id, flow), **result}


@router.post("/deploy")
async def deploy(req: ReviewRequest):
    flow = _active_sessions.get(req.session_id)
    if not flow:
        return {"error": "Session not found"}

    if not flow.state.generated_code:
        return {"error": "No code to deploy. Run /analyze first."}

    try:
        result = await flow.deploy()
    except Exception as e:
        return {
            "session_id": req.session_id,
            "status": "failed",
            "error": f"Deploy error: {e}",
            "deployed": flow.state.deployed,
        }

    resp = {
        "session_id": req.session_id,
        "status": "deployed" if flow.state.deployed else "failed",
        "deployed": flow.state.deployed,
        "deploy_result": flow.state.deploy_result,
    }
    if isinstance(result, dict) and "error" in result:
        resp["error"] = result["error"]
    return resp


@router.post("/new-operation")
async def new_operation(req: NewOperationRequest):
    flow = _active_sessions.get(req.session_id)
    if not flow:
        return {"error": "Session not found", "session_id": req.session_id}

    flow.reset_for_new_operation()

    if req.requirement:
        flow.state.requirement = req.requirement
        try:
            await asyncio.to_thread(flow.kickoff)
        except Exception as e:
            return {
                **_state_response(req.session_id, flow),
                "error": f"New operation analysis failed: {e}",
            }

    return _state_response(req.session_id, flow)


@router.get("/sessions")
async def list_sessions():
    memory = get_memory()
    matches = memory.recall("config session", scope="/config/sessions", limit=20, depth="shallow")
    sessions = []
    for m in matches:
        sessions.append({
            "content": m.record.content,
            "score": m.score,
        })
    return {"sessions": sessions}
