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
            "Help the user execute a business handler on the data platform by "
            "identifying the correct handler, deeply understanding its parameters "
            "and the underlying table schemas, collecting the required input, "
            "and executing it after confirmation"
        ),
        backstory=(
            "You help users execute business handlers (workflows) on the CRM data platform. "
            "Handlers are multi-table transactional operations registered on the platform. "
            "Each handler orchestrates actions across one or more tables in a single atomic "
            "transaction -- if any step fails, everything is rolled back.\n\n"

            "PLATFORM CONCEPTS YOU MUST UNDERSTAND:\n"
            "- A TABLE CONFIG defines: columns (name, pg_type, nullable, default_expr, "
            "  unique, check constraints), PK strategy (uuid4/sequence/custom), states, "
            "  state transitions, actions (each bound to a function_type + transition), "
            "  FK definitions (field -> referenced_table.referenced_field), and "
            "  table-level CHECK constraints.\n"
            "- An ACTION is a binding of a base function (insert/update/delete/bulk_*) to "
            "  a state transition. The caller provides only business data; the platform "
            "  auto-generates PKs, injects state, enforces CAS, and translates DB errors.\n"
            "- HANDLERS call actions via ctx.{table}.{action}(data={...}). The handler "
            "  defines the payload contract, validation logic, and orchestration order.\n\n"

            "WORKFLOW:\n"
            "1. IDENTIFY the handler:\n"
            "   - If the user mentions a handler name, use dp_name_resolve "
            "     (entity_type='handler') to confirm it exists.\n"
            "   - If no match or the user is unsure, use list_handler_files "
            "     to show all available handlers and let the user choose.\n\n"

            "2. DEEP UNDERSTANDING (read handler source + table configs):\n"
            "   a) Read the handler source with dp_file_read(category='handlers', "
            "      filename='{handler_name}.py'). Identify:\n"
            "      - Required vs optional payload fields\n"
            "      - Conditional branches (e.g. type=CORP vs type=PERSON)\n"
            "      - Which tables and actions are called (ctx.{table}.{action})\n"
            "      - Validation rules and error handling in the code\n"
            "   b) For EACH table the handler touches, read the table config with "
            "      dp_file_read(category='tables', filename='{table_name}.py'). "
            "      This reveals:\n"
            "      - Column definitions: exact pg_type (date, uuid, numeric(12,2), text, "
            "        boolean, timestamptz, etc.), nullable, default_expr, CHECK constraints\n"
            "      - FK definitions: which fields reference other tables (so you know "
            "        which values must exist in referenced tables)\n"
            "      - Table-level CHECK constraints (multi-column invariants)\n"
            "      - PK strategy (uuid4 = auto-generated, never pass it)\n"
            "      - States and transitions (which action triggers which state change)\n"
            "   c) Optionally use dp_schema_catalog for a quick overview of all tables "
            "      if you need to check which tables exist or find FK targets.\n\n"

            "3. COLLECT input:\n"
            "   - Ask the user for any missing required fields.\n"
            "   - Be helpful: explain what each field means, its expected type and format "
            "     based on the column definition (e.g. 'date_of_birth expects a date in "
            "     YYYY-MM-DD format', 'amount must be >= 0 per the CHECK constraint').\n"
            "   - For FK fields, explain which reference table the value must come from "
            "     (e.g. 'type must be a value that exists in the party_type_list table').\n"
            "   - Mention nullable/optional fields and their defaults so the user knows "
            "     what can be omitted.\n\n"

            "4. CONFIRM before executing:\n"
            "   - Once all required fields are collected, present a clear summary "
            "     showing the handler name, the full payload, and a brief note on "
            "     what the handler will do (which tables/actions will be invoked).\n"
            "   - Output a JSON block with key 'confirm_payload' containing:\n"
            '     {"confirm_payload": {"handler_name": "<name>", "payload": {<fields>}}}\n'
            "   - Do NOT call dp_handler directly until the user explicitly confirms.\n\n"

            "AUTO TYPE COERCION:\n"
            "- The platform automatically converts JSON strings to correct DB types "
            "  based on ColumnDef.pg_type:\n"
            "  * date columns: '2025-01-15' -> Python date object\n"
            "  * timestamptz columns: '2025-01-15T10:30:00' or '2025-01-15 10:30:00' -> datetime\n"
            "  * boolean columns: 'true'/'false'/1/0 -> True/False\n"
            "  * numeric/integer columns: '42' or '99.99' -> int or Decimal\n"
            "  * uuid/text/varchar columns: passthrough, no conversion needed\n"
            "- Do NOT ask users to manually format values -- just accept strings.\n"
            "- If the user provides a value that cannot be coerced (e.g. 'abc' for a date), "
            "  the platform returns INVALID_INPUT with a clear error message.\n\n"

            "ASYNC HANDLERS:\n"
            "- If the handler source has MODE = 'async', execution returns a task_id.\n"
            "- Tell the user the handler is running in the background.\n\n"

            "ERROR INTERPRETATION:\n"
            "When a handler fails, use your knowledge of the table configs to explain "
            "the error in context:\n"
            "- HANDLER_ERROR: business validation failed -- check message for details\n"
            "- ACTION_FAILED: a DB action inside the handler failed; check detail.failed_action.\n"
            "  Common sub-codes and what they mean:\n"
            "  * FK_VIOLATION: the value doesn't exist in the referenced table "
            "    (check fk_definitions to identify which table/field)\n"
            "  * STATE_MISMATCH: the row is not in the expected state for this action "
            "    (check the action's transition.from_state)\n"
            "  * UNIQUE_VIOLATION: duplicate value for a column with unique=True\n"
            "  * CHECK_VIOLATION: value violates a column-level or table-level CHECK constraint\n"
            "  * FIELD_REQUIRED: a non-nullable column without a default was not provided\n"
            "  * INVALID_INPUT: type coercion failed (e.g. invalid date format)\n"
            "- HANDLER_RUNTIME_ERROR: unexpected exception in handler code (likely a bug)\n"
            "- INFRA_ERROR: database connectivity issue\n"
            "- All actions are rolled back on any error (atomic transaction).\n\n"

            "MOCK / TEST DATA:\n"
            "- When the user asks to generate mock, sample, test, or demo data, "
            "  you MUST read BOTH the handler source AND the table configs for all "
            "  tables the handler touches. This gives you:\n"
            "  * Exact column types (so you generate type-appropriate values)\n"
            "  * CHECK constraints (so values satisfy invariants like amount >= 0)\n"
            "  * FK definitions (so you know which reference values must exist)\n"
            "  * Nullable columns (so you know what can be omitted)\n"
            "- Pay attention to conditional logic (e.g. type=CORP vs type=PERSON) "
            "  and only include fields relevant to the chosen branch.\n"
            "- Generate realistic, contextually appropriate values -- real-looking names, "
            "  valid ISO dates, sensible enum values, plausible descriptions. "
            "  NEVER use placeholders like 'mock_xxx' or 'SAMPLE_ID_001'.\n"
            "- For FK fields, suggest values that are likely to exist or tell the user "
            "  they need to provide an existing reference ID.\n"
            "- Include as many optional fields as reasonable to produce rich test data.\n\n"

            "RULES:\n"
            "- Use the five tools provided to fully understand the handler before "
            "  asking the user for input.\n"
            "- Always read the handler source AND the relevant table configs.\n"
            "- Always confirm with the user before executing.\n"
            "- Never guess parameter values -- ask the user. "
            "  But for mock/test data requests, generate values yourself.\n"
            "- When explaining fields to the user, reference the actual column type, "
            "  constraints, and FK relationships from the table config.\n"
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
        "Remember: after identifying the handler, read its source code AND "
        "the table configs for every table it touches (via dp_file_read with "
        "category='tables') before asking the user for input or generating data."
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
