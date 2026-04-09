"""API routes for Scenario B: conversational operations.

POST /api/ops/chat     -- send a message, get a structured response
POST /api/ops/confirm  -- confirm or cancel a pending action
GET  /api/ops/flows    -- list available sub-flows
"""

import asyncio
import uuid

from fastapi import APIRouter
from pydantic import BaseModel, Field

from flows.ops_flow import AVAILABLE_FLOWS, OpsSession

router = APIRouter()

_active_sessions: dict[str, OpsSession] = {}


class ChatRequest(BaseModel):
    session_id: str = Field(default="", description="Existing session to resume")
    message: str = Field(description="User message")


class ConfirmRequest(BaseModel):
    session_id: str = Field(description="Session with a pending action")
    confirmed: bool = Field(description="True to proceed, False to cancel")


def _get_or_create_session(session_id: str) -> tuple[str, OpsSession]:
    if session_id and session_id in _active_sessions:
        return session_id, _active_sessions[session_id]
    session = OpsSession()
    sid = session_id or str(uuid.uuid4())
    _active_sessions[sid] = session
    return sid, session


@router.post("/chat")
async def chat(req: ChatRequest):
    sid, session = _get_or_create_session(req.session_id)

    try:
        resp = await asyncio.to_thread(session.handle_message, req.message)
    except Exception as e:
        return {
            "session_id": sid,
            "current_flow": session.state.current_flow,
            "response_type": "error",
            "message": f"Processing failed: {e}",
        }

    result = resp.model_dump(exclude_none=True)
    result["session_id"] = sid
    return result


@router.post("/confirm")
async def confirm(req: ConfirmRequest):
    session = _active_sessions.get(req.session_id)
    if not session:
        return {
            "session_id": req.session_id,
            "response_type": "error",
            "message": "Session not found.",
        }

    try:
        resp = await asyncio.to_thread(session.handle_confirm, req.confirmed)
    except Exception as e:
        return {
            "session_id": req.session_id,
            "current_flow": session.state.current_flow,
            "response_type": "error",
            "message": f"Confirmation failed: {e}",
        }

    result = resp.model_dump(exclude_none=True)
    result["session_id"] = req.session_id
    return result


@router.get("/flows")
async def list_flows():
    return {"flows": AVAILABLE_FLOWS}
