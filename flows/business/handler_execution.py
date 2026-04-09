"""HandlerExecution -- generic conversational flow for executing any registered handler.

Multi-turn: resolve handler name -> read handler source -> collect params -> confirm -> execute.

Tools available to the agent:
  - DPNameResolveTool   (fuzzy-match handler name against cached catalog)
  - ListHandlerFilesTool (list all registered handler files)
  - DPFileReadTool      (read handler source to understand parameters)
  - DPHandlerTool       (execute a handler -- only after user confirms)
"""

import json
import logging
import re
from typing import Any

from crewai import Agent

from config import OPENAI_MODEL
from models.ops_models import ChatResponse, ConfirmAction
from tools.admin import DPFileReadTool, DPNameResolveTool, ListHandlerFilesTool
from tools.data_platform import DPHandlerTool

logger = logging.getLogger(__name__)


def handle_execution(
    message: str,
    history: list[dict[str, Any]],
    context: dict[str, Any],
) -> ChatResponse:
    history_text = ""
    recent = history[-10:]
    if len(recent) > 1:
        history_text = "\n".join(
            f"{m['role']}: {m['content'][:300]}" for m in recent[:-1]
        )

    agent = Agent(
        role="Handler Execution Assistant",
        goal=(
            "Help the user execute a business handler on the data platform by "
            "identifying the correct handler, understanding its parameters, "
            "collecting the required input, and executing it after confirmation"
        ),
        backstory=(
            "You help users execute business handlers (workflows) on the CRM data platform. "
            "Handlers are multi-table transactional operations registered on the platform.\n\n"
            "WORKFLOW:\n"
            "1. IDENTIFY the handler:\n"
            "   - If the user mentions a handler name, use dp_name_resolve "
            "     (entity_type='handler') to confirm it exists.\n"
            "   - If no match or the user is unsure, use list_handler_files "
            "     to show all available handlers and let the user choose.\n"
            "2. UNDERSTAND the handler:\n"
            "   - Once the handler is identified, use dp_file_read "
            "     (category='handlers', filename='{handler_name}.py') to read "
            "     the handler source code and understand what parameters it needs.\n"
            "   - Summarize the required and optional fields for the user.\n"
            "3. COLLECT input:\n"
            "   - Ask the user for any missing required fields.\n"
            "   - Be helpful: explain what each field means based on the source code.\n"
            "4. CONFIRM before executing:\n"
            "   - Once all required fields are collected, present a summary.\n"
            "   - Output a JSON block with key 'confirm_payload' containing:\n"
            '     {"confirm_payload": {"handler_name": "<name>", "payload": {<fields>}}}\n'
            "   - Do NOT call dp_handler directly until the user explicitly confirms.\n\n"
            "RULES:\n"
            "- Only use the four tools provided. No other tools.\n"
            "- Always confirm with the user before executing.\n"
            "- Never guess parameter values -- ask the user.\n"
            "- If the handler source reveals validation rules or constraints, "
            "  mention them to the user.\n"
        ),
        tools=[
            DPNameResolveTool(),
            ListHandlerFilesTool(),
            DPFileReadTool(),
            DPHandlerTool(),
        ],
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
        details = action.details
        handler_name = details.get("handler_name", "")
        payload = details.get("payload", {})

        if not handler_name:
            return ChatResponse(
                response_type="error",
                message="Missing handler_name in confirmation details. Please try again.",
            )
        if not isinstance(payload, dict):
            return ChatResponse(
                response_type="error",
                message="Invalid payload format. Please try again.",
            )

        tool = DPHandlerTool()
        result_raw = tool._run(handler_name=handler_name, payload=payload)
        try:
            result = json.loads(result_raw)
        except (json.JSONDecodeError, TypeError):
            result = {"raw": result_raw}

        success = result.get("success", False)
        result_json = json.dumps(result, indent=2)
        if success:
            msg = f"Handler `{handler_name}` executed successfully!\n\n```\n{result_json}\n```"
        else:
            msg = f"Handler `{handler_name}` failed:\n\n```\n{result_json}\n```"

        return ChatResponse(response_type="result", message=msg)
    except Exception as e:
        return ChatResponse(
            response_type="error",
            message=f"Failed to execute handler: {e}",
        )


def _strip_json_block(raw: str) -> str:
    """Remove the confirm_payload JSON block (and surrounding code fences)."""
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
                    blob = json.loads(raw[start : i + 1])
                    inner = blob.get("confirm_payload", blob)
                    if isinstance(inner, dict) and "handler_name" in inner:
                        handler_name = inner["handler_name"]
                        payload = inner.get("payload", {})
                    elif isinstance(inner, dict) and "payload" in inner:
                        handler_name = inner.get("handler_name", "")
                        payload = inner["payload"]
                    else:
                        return None

                    details = {"handler_name": handler_name, "payload": payload}
                    return ConfirmAction(
                        flow="handler_execution",
                        action_type="handler",
                        description=(
                            f"Execute handler '{handler_name}' with: "
                            f"{json.dumps(payload, indent=2)}"
                        ),
                        details=details,
                    )
                except json.JSONDecodeError:
                    return None
    return None


def _looks_like_execution_result(raw: str) -> bool:
    indicators = ['"success":', "executed successfully", "successfully created"]
    lower = raw.lower()
    return any(ind in lower for ind in indicators) and "confirm" not in lower
