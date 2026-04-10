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
import time
from typing import Any

from crewai import Agent

from config import OPENAI_MODEL
from models.ops_models import ChatResponse, ConfirmAction
from setup.schema_sync import get_schema_catalog
from tools.admin import DPFileReadTool, DPNameResolveTool, ListHandlerFilesTool
from tools.data_platform import DPHandlerTool

logger = logging.getLogger(__name__)

_ASYNC_POLL_INTERVAL = 2
_ASYNC_MAX_POLLS = 30


def _is_mock_request(message: str) -> bool:
    lower = (message or "").lower()
    if any(k in lower for k in ("mock", "sample", "dummy", "fake", "test data")):
        return True
    return any(k in (message or "") for k in ("模拟", "样例", "示例", "测试数据", "mock数据", "假数据"))


def _extract_literal_set(content: str, var_name: str) -> set[str]:
    pattern = rf"{re.escape(var_name)}\s*=\s*\{{(.*?)\}}"
    m = re.search(pattern, content, re.DOTALL)
    if not m:
        return set()
    block = m.group(1)
    return set(re.findall(r"['\"]([A-Za-z0-9_]+)['\"]", block))


def _extract_pick_fields(content: str) -> set[str]:
    picks = set()
    for m in re.finditer(r"_pick\(\s*payload\s*,\s*\{(.*?)\}\s*\)", content, re.DOTALL):
        picks.update(re.findall(r"['\"]([A-Za-z0-9_]+)['\"]", m.group(1)))
    for m in re.finditer(r"_pick\(\s*payload\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)", content):
        picks.update(_extract_literal_set(content, m.group(1)))
    return picks


def _extract_required_fields(content: str) -> set[str]:
    required = set(re.findall(r"payload\[['\"]([A-Za-z0-9_]+)['\"]\]", content))
    required.update(re.findall(r'payload\.get\(\s*["\']type["\']\s*\)', content))
    required.discard("state")
    return required


def _extract_optional_fields(content: str, required: set[str]) -> set[str]:
    optional = _extract_pick_fields(content)
    optional.update(re.findall(r"payload\.get\(\s*['\"]([A-Za-z0-9_]+)['\"]\s*\)", content))
    optional -= required
    optional.discard("state")
    return optional


def _example_value_for_field(name: str) -> Any:
    n = name.lower()
    if "date" in n:
        return "2025-01-15"
    if n.endswith("_id"):
        return "SAMPLE_ID_001"
    if n.startswith("is_") or n.endswith("_ind") or "flag" in n:
        return True
    if "count" in n or "amount" in n or "price" in n or "rate" in n:
        return 1
    if n in ("type", "mode"):
        return "CORP"
    return f"mock_{name}"


def _registered_handlers() -> list[str]:
    catalog = get_schema_catalog()
    if not catalog:
        return []
    return list(catalog.get("handlers", []))


def _infer_handler_name(message: str, context: dict[str, Any]) -> str:
    for key in ("handler_name", "action_hint"):
        hint = context.get(key, "")
        if hint:
            return hint

    registered = _registered_handlers()
    if not registered:
        return ""
    normalized = (message or "").lower().replace("-", "_").replace(" ", "_")
    for name in sorted(registered, key=len, reverse=True):
        if name in normalized:
            return name
    return ""


def _build_handler_mock_scaffold(message: str, context: dict[str, Any]) -> tuple[str, str]:
    if not _is_mock_request(message):
        return ("", "")

    handler_name = _infer_handler_name(message, context)
    if not handler_name:
        return ("", "")

    file_tool = DPFileReadTool()
    raw = file_tool._run(category="handlers", filename=f"{handler_name}.py")
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = {}
    if not parsed.get("success") or not parsed.get("content"):
        return ("", handler_name)

    content = parsed["content"]
    required = sorted(_extract_required_fields(content))
    optional = sorted(_extract_optional_fields(content, set(required)))
    payload_example = {k: _example_value_for_field(k) for k in required}
    for key in optional:
        payload_example[key] = _example_value_for_field(key)

    scaffold = (
        f"Handler `{handler_name}` mock scaffold:\n"
        f"- Required fields (must be present): {required if required else 'none detected'}\n"
        f"- Optional enrichments (include as many as possible): {optional if optional else 'none detected'}\n"
        f"- Example mock payload (required + optional):\n"
        f"{json.dumps(payload_example, ensure_ascii=False, indent=2)}\n"
        "- When preparing confirm_payload, keep required fields complete, then enrich optional fields."
    )
    return (scaffold, handler_name)


def _validate_handler_minimum_payload(handler_name: str, payload: dict[str, Any]) -> tuple[bool, str]:
    if not handler_name or not isinstance(payload, dict):
        return True, ""
    file_tool = DPFileReadTool()
    raw = file_tool._run(category="handlers", filename=f"{handler_name}.py")
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = {}
    content = parsed.get("content", "")
    if not content:
        return True, ""
    required = sorted(_extract_required_fields(content))
    missing = [k for k in required if k not in payload]
    if missing:
        return False, (
            "Payload is missing minimum required handler fields: "
            + ", ".join(missing)
            + ". 请先补全这些字段再执行。"
        )
    return True, ""


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
            "AUTO TYPE COERCION:\n"
            "- The platform automatically converts JSON strings to correct DB types.\n"
            "- Date strings like '2025-01-15' are auto-coerced to date objects.\n"
            "- Boolean strings ('true'/'false'), numeric strings are also auto-converted.\n"
            "- Do NOT ask users to manually format values -- just accept strings.\n\n"
            "ASYNC HANDLERS:\n"
            "- If the handler source has MODE = 'async', execution returns a task_id.\n"
            "- Tell the user the handler is running in the background.\n\n"
            "ERROR INTERPRETATION:\n"
            "When a handler fails, explain the error code to the user:\n"
            "- HANDLER_ERROR: business validation failed -- check message for details\n"
            "- ACTION_FAILED: a DB action inside the handler failed; check detail.failed_action\n"
            "  Common sub-codes: FK_VIOLATION (referenced record doesn't exist), "
            "STATE_MISMATCH (row not in expected state), UNIQUE_VIOLATION (duplicate value), "
            "CHECK_VIOLATION (constraint failed), FIELD_REQUIRED (missing NOT NULL field)\n"
            "- HANDLER_RUNTIME_ERROR: bug in handler code\n"
            "- All actions are rolled back on any error (atomic transaction).\n\n"
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
    scaffold, mock_handler_name = _build_handler_mock_scaffold(message, context)
    if scaffold:
        prompt += (
            "\n\nMOCK-DATA REQUIREMENT DETECTED.\n"
            "Use the deterministic scaffold below as the minimum baseline for confirm_payload.\n"
            "Required fields must be complete, optional fields should be included as many as possible.\n\n"
            f"{scaffold}"
        )
        if mock_handler_name and not context.get("handler_name"):
            context["handler_name"] = mock_handler_name

    result = agent.kickoff(prompt)
    raw = result.raw if result else ""

    confirm_data = _try_extract_confirmation(raw)
    if confirm_data:
        details = confirm_data.details
        ok, err = _validate_handler_minimum_payload(
            handler_name=details.get("handler_name", ""),
            payload=details.get("payload", {}) if isinstance(details.get("payload", {}), dict) else {},
        )
        if not ok:
            return ChatResponse(response_type="message", message=err)
        return ChatResponse(
            response_type="confirm",
            message=_strip_json_block(raw),
            confirm_data=confirm_data,
        )

    if _looks_like_execution_result(raw):
        return ChatResponse(response_type="result", message=raw)

    return ChatResponse(response_type="message", message=raw)


def _poll_async_task(task_id: str) -> dict[str, Any]:
    """Poll an async handler task until completion or timeout."""
    import httpx
    from config import DATA_PLATFORM_URL
    from tools.data_platform import _api_headers

    for _ in range(_ASYNC_MAX_POLLS):
        time.sleep(_ASYNC_POLL_INTERVAL)
        try:
            resp = httpx.get(
                f"{DATA_PLATFORM_URL}/api/tasks/{task_id}",
                headers=_api_headers(),
                timeout=10,
            )
            data = resp.json()
            status = data.get("status", "")
            if status in ("completed", "failed"):
                return data
        except Exception as exc:
            logger.warning("Task poll error: %s", exc)
    return {"status": "timeout", "task_id": task_id, "message": "Polling timed out"}


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

        task_id = result.get("task_id")
        if task_id and result.get("status") == "accepted":
            result = _poll_async_task(task_id)

        success = result.get("success", False) or result.get("status") == "completed"
        result_json = json.dumps(result, indent=2)
        if success:
            msg = f"Handler `{handler_name}` executed successfully!\n\n```\n{result_json}\n```"
        else:
            msg = f"Handler `{handler_name}` failed:\n\n```\n{result_json}\n```"
            error = result.get("error", {})
            if isinstance(error, dict) and error.get("code"):
                msg += f"\n\nError code: **{error['code']}** — {error.get('message', '')}"

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
