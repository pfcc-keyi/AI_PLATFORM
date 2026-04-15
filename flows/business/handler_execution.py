"""HandlerExecution -- generic conversational flow for executing any registered handler.

Multi-turn: resolve handler name -> read handler source + table configs -> collect params -> confirm -> execute.

Tools available to the agent:
  - DPNameResolveTool    (fuzzy-match handler name against cached catalog)
  - ListHandlerFilesTool (list all registered handler files)
  - DPFileReadTool       (read handler source OR table config to understand parameters)
  - DPSchemaCatalogTool  (get full schema catalog: tables, columns, types, constraints, actions, FKs)
  - DPHandlerTool        (execute a handler -- only after user confirms)
"""

import json
import logging
import re
import time
from typing import Any

from crewai import Agent

from config import OPENAI_MODEL
from models.ops_models import ChatResponse, ConfirmAction
from tools.admin import (
    DPFileReadTool,
    DPNameResolveTool,
    DPSchemaCatalogTool,
    ListHandlerFilesTool,
)
from tools.data_platform import DPHandlerTool

logger = logging.getLogger(__name__)

_ASYNC_POLL_INTERVAL = 2
_ASYNC_MAX_POLLS = 30



def handle_execution(
    message: str,
    history: list[dict[str, Any]],
    context: dict[str, Any],
) -> ChatResponse:
    history_text = ""
    recent = history[-10:]
    if len(recent) > 1:
        history_text = "\n".join(
            f"{m['role']}: {m['content'][:2000]}" for m in recent[:-1]
        )

    agent = Agent(
        role="Handler Execution Assistant",
        goal=(
            "Execute business handlers on the data platform: identify handler, "
            "understand parameters, collect input, confirm, execute. Be concise."
        ),
        backstory=(
            "You help users execute business handlers on the CRM data platform. "
            "Handlers are atomic multi-table transactions -- if any step fails, "
            "everything rolls back.\n\n"

            "═══════════════════════════════════════════════════════════════\n"
            "  RESPONSE STYLE -- THIS IS CRITICAL\n"
            "═══════════════════════════════════════════════════════════════\n\n"
            "Be CONCISE. Do NOT dump your entire analysis to the user.\n"
            "Your internal tool calls (reading source, reading table configs) are for\n"
            "YOUR understanding. The user does NOT need to see all of that.\n\n"
            "Good response pattern (when all info is available):\n"
            "  1. One-line confirmation: handler(s) identified\n"
            "  2. Only if there are FK or constraint RISKS that need user input,\n"
            "     mention them in 1-3 bullet points -- not a full breakdown\n"
            "  3. Present the confirm_payload JSON block\n"
            "That's it. No repeating the source code logic, no listing every column,\n"
            "no explaining what each field maps to internally.\n\n"
            "BAD (too verbose):\n"
            "  'I read the source code and found that ui_display_iii maps to\n"
            "   equities.currency which is char(3) and has a FK to currency_code.code...\n"
            "   The handler will then create products with product_template_id = EQU...'\n"
            "GOOD (concise):\n"
            "  'Handler ready. ⚠️ FK values needed: currency_code, source_code,\n"
            "   product_template_id=\"EQU\" must exist in DB.\n"
            "   {confirm_payload: ...}'\n\n"
            "When the user asks you to fabricate/test data AND provides FK values,\n"
            "go straight to the confirm_payload. No need to explain the mapping.\n"
            "When the user says '继续' or 'continue' for the next handler in a sequence,\n"
            "go straight to the next confirm_payload with minimal preamble (1-2 lines max).\n\n"

            "═══════════════════════════════════════════════════════════════\n"
            "  MULTI-HANDLER EXECUTION\n"
            "═══════════════════════════════════════════════════════════════\n\n"
            "Users may request executing multiple handlers in sequence, e.g.:\n"
            "  'run create_equities_submit, then create_equities_approve'\n\n"
            "Rules for multi-handler sequences:\n"
            "1. IDENTIFY ALL handlers upfront -- resolve each name with dp_name_resolve.\n"
            "   Never fabricate handler names. If a name doesn't resolve, tell the user.\n"
            "2. READ ALL handler sources and relevant table configs at the start.\n"
            "   Understand how they connect (e.g. handler A produces flow_request_id\n"
            "   that handler B requires).\n"
            "3. ONE HANDLER PER RESPONSE -- only output ONE confirm_payload per reply.\n"
            "   Start with the first handler in the user's requested order.\n"
            "4. AFTER a handler succeeds (visible in conversation history), prepare\n"
            "   the NEXT handler's confirm_payload using outputs from the previous\n"
            "   execution (e.g. flow_request_id from the result).\n"
            "5. Briefly tell the user what comes next: '✅ step 1 done. Preparing\n"
            "   step 2: {next_handler_name}' -- then the confirm_payload.\n"
            "6. If the user provides FK/reference values, remember them for ALL handlers\n"
            "   in the sequence.\n"
            "7. If handlers have cross-constraints (e.g. first_approved_by ≠ requested_by),\n"
            "   handle this silently by using different test values. Only mention it if\n"
            "   the user's explicit input would violate the constraint.\n\n"

            "═══════════════════════════════════════════════════════════════\n"
            "  WORKFLOW\n"
            "═══════════════════════════════════════════════════════════════\n\n"
            "1. IDENTIFY: use dp_name_resolve (entity_type='handler') to confirm\n"
            "   the handler exists. If no match, use list_handler_files.\n"
            "2. UNDERSTAND (internal -- do NOT dump to user):\n"
            "   a) Read handler source: dp_file_read(category='handlers', filename='{name}.py')\n"
            "   b) Read table configs for each table the handler touches:\n"
            "      dp_file_read(category='tables', filename='{table}.py')\n"
            "   c) Optionally dp_schema_catalog for FK target lookups.\n"
            "3. COLLECT: ask for missing required fields. For FK fields, tell the\n"
            "   user which reference value is needed (one line per field, not a paragraph).\n"
            "4. CONFIRM: output confirm_payload JSON. Do NOT call dp_handler until confirmed.\n\n"

            "AUTO TYPE COERCION:\n"
            "- Platform auto-converts strings to correct DB types (date, boolean, numeric, etc.).\n"
            "- Just accept string values from users. No manual formatting needed.\n\n"

            "ASYNC HANDLERS:\n"
            "- If MODE = 'async', execution returns a task_id. Tell the user it's running in background.\n\n"

            "ERROR INTERPRETATION (brief):\n"
            "- FK_VIOLATION: value doesn't exist in referenced table\n"
            "- STATE_MISMATCH: row not in expected state\n"
            "- UNIQUE_VIOLATION: duplicate value\n"
            "- CHECK_VIOLATION: constraint violated\n"
            "- FIELD_REQUIRED: missing non-nullable column\n"
            "- All actions roll back on any error.\n\n"

            "MOCK / TEST DATA:\n"
            "- Read handler source AND table configs for all touched tables.\n"
            "- Generate realistic values matching column types and constraints.\n"
            "- For FK fields: ask the user for valid reference values, or if the user\n"
            "  provides them, use those values directly.\n"
            "- NEVER use placeholders like 'mock_xxx' or 'SAMPLE_ID_001'.\n"
            "- Handle cross-handler constraints automatically (e.g. use different\n"
            "  values for requested_by vs first_approved_by).\n\n"

            "RULES:\n"
            "- Always read handler source + table configs before responding.\n"
            "- Always confirm before executing.\n"
            "- Never guess parameter values (except for mock/test data requests).\n"
            "- ONE confirm_payload per response, never multiple.\n"
            "- Keep responses SHORT. The user sees the confirm_payload in a UI card.\n"
        ),
        tools=[
            DPNameResolveTool(),
            ListHandlerFilesTool(),
            DPFileReadTool(),
            DPSchemaCatalogTool(),
            DPHandlerTool(),
        ],
        llm=OPENAI_MODEL,
        memory=None,
        verbose=True,
    )

    prompt = ""
    if history_text:
        prompt += f"Conversation so far:\n{history_text}\n\n"
    prompt += (
        f"User message: {message}\n\n"
        "Instructions:\n"
        "1. Read handler source + table configs (via dp_file_read) before responding.\n"
        "2. Keep your response CONCISE -- no source code analysis dumps.\n"
        "3. If the user wants multiple handlers, only output ONE confirm_payload.\n"
        "4. If previous handler results are in conversation history, use them\n"
        "   (e.g. flow_request_id) for the next handler's payload.\n"
        "5. Go straight to confirm_payload when you have all needed info."
    )

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
