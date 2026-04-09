"""PartyOnboardingHandler -- conversational flow for creating parties.

Multi-turn: explain required params -> collect data -> confirm -> execute.

Allowed tools:
  - DPHandlerTool   (restricted to create_party handler only)
  - DPFileReadTool  (restricted to handlers/create_party.py only)

All other tools are forbidden.
"""

import json
import logging
from typing import Any

from crewai import Agent
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from config import OPENAI_MODEL
from models.ops_models import ChatResponse, ConfirmAction
from setup.schema_sync import get_schema_catalog
from tools.data_platform import DPHandlerTool

logger = logging.getLogger(__name__)


class _CreatePartyHandlerInput(BaseModel):
    payload: dict[str, Any] = Field(description="JSON payload for create_party handler")


class CreatePartyHandlerTool(BaseTool):
    """Wrapper around DPHandlerTool locked to create_party only."""

    name: str = "create_party_handler"
    description: str = (
        "Execute the create_party handler on the data platform. "
        "This creates a party record (CORP or PERSON) with related sub-records "
        "in a single transaction."
    )
    args_schema: type[BaseModel] = _CreatePartyHandlerInput

    def _run(self, payload: dict[str, Any]) -> str:
        tool = DPHandlerTool()
        return tool._run(handler_name="create_party", payload=payload)


class _ReadCreatePartyInput(BaseModel):
    pass


class ReadCreatePartyFileTool(BaseTool):
    """Read the create_party.py handler source to understand required parameters."""

    name: str = "read_create_party_definition"
    description: str = (
        "Read the source code of the create_party handler to understand "
        "what parameters are required and how the handler works."
    )
    args_schema: type[BaseModel] = _ReadCreatePartyInput

    def _run(self) -> str:
        from tools.admin import DPFileReadTool

        tool = DPFileReadTool()
        return tool._run(category="handlers", filename="create_party.py")


def _party_schema_context() -> str:
    catalog = get_schema_catalog()
    if not catalog:
        return ""

    tables = catalog.get("tables", {})
    relevant = ["party", "party_corp", "party_person"]
    lines: list[str] = []
    for tname in relevant:
        tinfo = tables.get(tname)
        if not tinfo:
            continue
        cols = [
            f"{c.get('name','')}({c.get('pg_type','')}, "
            f"{'nullable' if c.get('nullable') else 'required'})"
            for c in tinfo.get("columns", [])
        ]
        lines.append(f"Table {tname}: {', '.join(cols)}")

    return "\n".join(lines)


def handle_onboarding(
    message: str,
    history: list[dict[str, Any]],
    context: dict[str, Any],
) -> ChatResponse:
    schema_context = _party_schema_context()

    history_text = ""
    recent = history[-10:]
    if len(recent) > 1:
        history_text = "\n".join(
            f"{m['role']}: {m['content'][:300]}" for m in recent[:-1]
        )

    agent = Agent(
        role="Party Onboarding Assistant",
        goal=(
            "Help the user create a new party (CORP or PERSON) by collecting "
            "all required information and executing the create_party handler"
        ),
        backstory=(
            "You help users onboard new parties to the CRM platform. "
            "The create_party handler creates a party record and its "
            "sub-record (party_corp or party_person) in one transaction.\n\n"
            "WORKFLOW:\n"
            "1. If the user hasn't provided enough info, use "
            "   read_create_party_definition to check what parameters are "
            "   needed, then ask the user for the missing information.\n"
            "2. Once you have all required fields, present a summary and "
            "   ask the user to CONFIRM before executing.\n"
            "3. DO NOT execute create_party_handler until the user explicitly "
            "   confirms. Instead, output a JSON block with key "
            "   'confirm_payload' containing the exact payload.\n"
            "   REQUIRED SHAPE: {\"confirm_payload\": {\"type\": \"PERSON|CORP\", ...}}\n"
            "   Do NOT wrap it as {\"confirm_payload\": {\"payload\": {...}}}.\n\n"
            "RULES:\n"
            "- Only use the two tools provided. No other tools.\n"
            "- Always confirm with the user before executing.\n"
            "- Be helpful: if the user is unsure what fields are needed, "
            "  read the handler definition and explain.\n\n"
            f"PARTY SCHEMA:\n{schema_context}"
        ),
        tools=[ReadCreatePartyFileTool(), CreatePartyHandlerTool()],
        llm=OPENAI_MODEL,
        memory=None,
        verbose=True,
    )

    prompt = ""
    if history_text:
        prompt += f"Conversation so far:\n{history_text}\n\n"
    prompt += f"User message: {message}"

    result = agent.kickoff(prompt)
    raw = result.raw if result else ""

    confirm_data = _try_extract_confirmation(raw)
    if confirm_data:
        return ChatResponse(
            response_type="confirm",
            message=_strip_json_block(raw),
            confirm_data=confirm_data,
        )

    if _looks_like_execution_result(raw):
        return ChatResponse(response_type="result", message=raw)

    return ChatResponse(response_type="message", message=raw)


def execute_confirmed(action: ConfirmAction) -> ChatResponse:
    try:
        payload = _normalize_create_party_payload(action.details)
        if not payload:
            return ChatResponse(
                response_type="error",
                message=(
                    "Missing create_party payload in confirmation details. "
                    "Please re-confirm with a valid payload."
                ),
            )
        tool = DPHandlerTool()
        result_raw = tool._run(handler_name="create_party", payload=payload)
        try:
            result = json.loads(result_raw)
        except (json.JSONDecodeError, TypeError):
            result = {"raw": result_raw}

        success = result.get("success", False)
        return ChatResponse(
            response_type="result",
            message=(
                f"Party created successfully!\n\n"
                f"```\n{json.dumps(result, indent=2)}\n```"
                if success
                else f"Party creation failed:\n\n"
                f"```\n{json.dumps(result, indent=2)}\n```"
            ),
        )
    except Exception as e:
        return ChatResponse(
            response_type="error",
            message=f"Failed to execute create_party: {e}",
        )


def _strip_json_block(raw: str) -> str:
    """Remove the confirm_payload JSON block (and surrounding code fences)."""
    import re
    cleaned = re.sub(
        r"```(?:json)?\s*\{[\s\S]*?\"confirm_payload\"[\s\S]*?\}\s*```",
        "", raw,
    )
    cleaned = re.sub(
        r"\{[\s\S]*?\"confirm_payload\"[\s\S]*?\}",
        "", cleaned,
    )
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned


def _try_extract_confirmation(raw: str) -> ConfirmAction | None:
    if "confirm_payload" not in raw:
        return None

    start = raw.find("{", raw.find("confirm_payload"))
    if start == -1:
        return None

    depth = 0
    for i in range(start, len(raw)):
        if raw[i] == "{":
            depth += 1
        elif raw[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    payload = json.loads(raw[start : i + 1])
                    actual = _normalize_create_party_payload(payload.get("confirm_payload", payload))
                    return ConfirmAction(
                        flow="party_onboarding",
                        action_type="handler",
                        description=(
                            f"Execute create_party handler with: "
                            f"{json.dumps(actual, indent=2)}"
                        ),
                        details=actual,
                    )
                except json.JSONDecodeError:
                    return None
    return None


def _normalize_create_party_payload(details: dict[str, Any]) -> dict[str, Any]:
    """Normalize agent confirmation details into the exact handler payload shape.

    Accepts either:
      1) {"type": "...", ...}
      2) {"payload": {"type": "...", ...}}
      3) {"confirm_payload": {"type": "...", ...}} (defensive)
    """
    current: Any = details
    for _ in range(3):
        if not isinstance(current, dict):
            return {}
        if "confirm_payload" in current and isinstance(current["confirm_payload"], dict):
            current = current["confirm_payload"]
            continue
        if "payload" in current and isinstance(current["payload"], dict):
            # Legacy/LLM variant: wrapper object around the true handler payload.
            if "type" not in current and "first_name" not in current and "last_name" not in current:
                current = current["payload"]
                continue
        break
    return current if isinstance(current, dict) else {}


def _looks_like_execution_result(raw: str) -> bool:
    indicators = ['"success":', "party created", "successfully created"]
    lower = raw.lower()
    return any(ind in lower for ind in indicators) and "confirm" not in lower
