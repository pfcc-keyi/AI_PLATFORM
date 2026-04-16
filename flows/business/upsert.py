"""UpsertHandler -- insert or update records via actions.

Allowed tools:
  - DPActionTool              (insert/update/bulk_insert/bulk_update ONLY)
  - DPAPICatalogTool          (per-table)
  - UpsertTableFileReadTool   (/api/admin/files/tables/*.py ONLY — never handlers)

Guardrails:
  - CANNOT execute delete/bulk_delete actions
  - CANNOT execute actions with from_state=deleted
  - State is CAS -- never include 'state' in payload
  - Must confirm with user before every execution
"""

import json
import logging
import re
from typing import Any

from crewai import Agent
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from config import OPENAI_MODEL
from models.ops_models import ChatResponse, ConfirmAction
from setup.schema_sync import get_schema_catalog
from tools.admin import DPAPICatalogTool, DPFileReadTool
from tools.data_platform import DPActionTool

logger = logging.getLogger(__name__)


class _TablesOnlyFileInput(BaseModel):
    filename: str = Field(
        description=(
            "Table definition filename only, e.g. 'party.py'. "
            "Maps to /api/admin/files/tables/<filename>."
        )
    )


class UpsertTableFileReadTool(BaseTool):
    """dp_file_read restricted to tables/ — handlers are forbidden for upsert."""

    name: str = "dp_file_read"
    description: str = (
        "Read a table definition Python file from the data platform "
        "(/api/admin/files/tables/<filename>). Use to inspect columns, "
        "actions, and transitions for executing insert/update. "
        "Do NOT use this for handler files (handlers/); those are not allowed in upsert."
    )
    args_schema: type[BaseModel] = _TablesOnlyFileInput

    def _run(self, filename: str) -> str:
        fn = (filename or "").strip()
        if not fn or ".." in fn or "/" in fn or "\\" in fn:
            return json.dumps({
                "success": False,
                "error": "Invalid filename; use a bare table file name like 'party.py'.",
            })
        tool = DPFileReadTool()
        return tool._run(category="tables", filename=fn)


_BLOCKED_FUNCTION_TYPES = {"delete", "bulk_delete"}


class _SafeActionInput(BaseModel):
    table_name: str = Field(description="Target table name")
    action_name: str = Field(description="Action to execute")
    payload: dict[str, Any] = Field(
        description=(
            "JSON body. insert: {'data': {...}}. update: {'pk': '...', 'data': {...}}. "
            "bulk_insert: {'rows': [...]}. bulk_update: {'conditions': [...], 'data': {...}}. "
            "NEVER include 'state'."
        )
    )


class SafeActionTool(BaseTool):
    """DPActionTool wrapper that blocks delete actions and strips state."""

    name: str = "dp_safe_action"
    description: str = (
        "Execute a write action (insert/update/bulk_insert/bulk_update) on a "
        "data platform table. Delete and bulk_delete actions are BLOCKED. "
        "Do NOT include 'state' in the payload."
    )
    args_schema: type[BaseModel] = _SafeActionInput

    def _run(self, table_name: str, action_name: str, payload: dict[str, Any]) -> str:
        catalog = get_schema_catalog()
        if catalog:
            tables = catalog.get("tables", {})
            tinfo = tables.get(table_name, {})
            for action_def in tinfo.get("actions", []):
                if action_def.get("name") == action_name:
                    ft = action_def.get("function_type", "")
                    if ft in _BLOCKED_FUNCTION_TYPES:
                        return json.dumps({
                            "success": False,
                            "error": f"Action '{action_name}' is a {ft} operation which is not allowed.",
                        })
                    transition = action_def.get("transition", "")
                    if "deleted" in str(transition).lower().split("->")[0]:
                        return json.dumps({
                            "success": False,
                            "error": f"Action '{action_name}' has from_state involving 'deleted' which is not allowed.",
                        })
                    break

        if "data" in payload and isinstance(payload["data"], dict):
            payload["data"].pop("state", None)
        if "rows" in payload and isinstance(payload["rows"], list):
            for row in payload["rows"]:
                if isinstance(row, dict):
                    row.pop("state", None)

        tool = DPActionTool()
        return tool._run(table_name=table_name, action_name=action_name, payload=payload)


def _build_schema_context() -> str:
    catalog = get_schema_catalog()
    if not catalog:
        return "Schema catalog not loaded."

    lines: list[str] = []
    tables = catalog.get("tables", {})
    for tname, tinfo in tables.items():
        cols = [
            f"{c.get('name','')}({c.get('pg_type','')}, "
            f"{'nullable' if c.get('nullable') else 'required'}"
            f"{', check: ' + c['check'] if c.get('check') else ''})"
            for c in tinfo.get("columns", [])
            if c.get("name") != "state"
        ]
        actions = []
        for a in tinfo.get("actions", []):
            ft = a.get("function_type", "")
            if ft in _BLOCKED_FUNCTION_TYPES:
                continue
            transition = a.get("transition", "")
            actions.append(f"{a['name']}({ft}: {transition})")

        states = tinfo.get("states", [])
        pk = tinfo.get("pk_field", "id")

        fk_lines: list[str] = []
        for fk in tinfo.get("fk_definitions", []):
            fk_lines.append(
                f"{fk.get('field', '?')} -> {fk.get('references_table', '?')}.{fk.get('references_field', '?')}"
            )

        table_block = (
            f"Table: {tname}  pk={pk}\n"
            f"  columns (excluding state): {', '.join(cols)}\n"
            f"  states: {', '.join(states)}\n"
            f"  allowed actions: {', '.join(actions)}"
        )
        if fk_lines:
            table_block += f"\n  foreign keys: {'; '.join(fk_lines)}"
        lines.append(table_block)

    return "\n".join(lines)


def handle_upsert(
    message: str,
    history: list[dict[str, Any]],
    context: dict[str, Any],
) -> ChatResponse:
    schema_context = _build_schema_context()

    history_text = ""
    recent = history[-10:]
    if len(recent) > 1:
        history_text = "\n".join(
            f"{m['role']}: {m['content'][:2000]}" for m in recent[:-1]
        )

    agent = Agent(
        role="Data Upsert Specialist",
        goal="Execute single-table actions (insert/update) on the data platform. Be concise.",
        backstory=(
            "You help users execute ACTIONS on CRM data platform tables.\n\n"

            "═══════════════════════════════════════════════════════════════\n"
            "  CRITICAL CONSTRAINT\n"
            "═══════════════════════════════════════════════════════════════\n\n"
            "You can ONLY execute actions. You CANNOT execute handlers.\n"
            "Actions are per-table operations bound to state transitions.\n"
            "Handlers are multi-table business workflows -- NOT your scope.\n"
            "If a user asks to run a handler, tell them to switch to the\n"
            "handler execution flow.\n\n"

            "═══════════════════════════════════════════════════════════════\n"
            "  ACTION-CENTRIC WORKFLOW\n"
            "═══════════════════════════════════════════════════════════════\n\n"
            "Every table has NAMED ACTIONS. Each action binds a function type\n"
            "(insert/update/bulk_*) to a specific state transition.\n"
            "Example: create_party_draft (insert: init -> draft)\n"
            "         activate_party (update: draft -> active)\n\n"
            "You MUST identify the correct ACTION NAME before building a payload.\n\n"
            "CASE 1 -- User names a specific action (e.g. 'run create_party_draft'):\n"
            "  → Use dp_api_catalog to verify it exists on the table.\n"
            "  → Read table config via dp_file_read for columns/constraints.\n"
            "  → Collect missing fields, then confirm_action.\n\n"
            "CASE 2 -- User says 'insert into X' or 'update X' without an action name:\n"
            "  → Use dp_api_catalog to list that table's actions.\n"
            "  → If exactly one matching action, use it directly.\n"
            "  → If multiple actions match (e.g. two insert actions with different\n"
            "    target states), briefly present options with one-line descriptions:\n"
            "      'create_party_draft (insert: init → draft)'\n"
            "      'create_party_active (insert: init → active)'\n"
            "    Ask user to choose.\n\n"
            "CASE 3 -- User doesn't specify a table:\n"
            "  → Ask which table (one line).\n\n"

            "═══════════════════════════════════════════════════════════════\n"
            "  RESPONSE STYLE\n"
            "═══════════════════════════════════════════════════════════════\n\n"
            "Be CONCISE. Tool calls are for YOUR understanding only.\n"
            "Do NOT dump column definitions, type details, or schema analysis.\n\n"
            "Good pattern:\n"
            "  1. One line: confirm action identified\n"
            "  2. If FK/constraint values needed from user, 1-3 bullet points\n"
            "  3. Present the confirm_action JSON block\n"
            "That's it. When user asks to fabricate/test data and you have all\n"
            "info, go straight to confirm_action.\n\n"

            "ABSOLUTE RULES:\n"
            "- NEVER delete/bulk_delete. NEVER include 'state' in payload.\n"
            "- Confirm before EVERY execution.\n\n"

            "PAYLOAD FORMAT (by function type of the action):\n"
            "- insert: {\"data\": {field: value}} -- no PK, no state\n"
            "- update: {\"pk\": \"...\", \"data\": {field: value}} -- partial\n"
            "- bulk_insert: {\"rows\": [{field: value}, ...]}\n"
            "- bulk_update: {\"conditions\": [[field, op, value]], \"data\": {...}}\n\n"

            "CONDITION OPERATORS (bulk_update):\n"
            "=, !=, >, <, >=, <=, IN, NOT IN, LIKE, ILIKE, IS NULL, IS NOT NULL\n\n"

            "AUTO TYPE COERCION: Platform auto-converts strings to DB types.\n\n"

            "MOCK / TEST DATA:\n"
            "- Read table config via dp_file_read first.\n"
            "- Generate realistic values (not 'mock_xxx' or 'SAMPLE_ID_001').\n"
            "- Respect CHECK + FK constraints. For FK fields, ask user or\n"
            "  note which references must exist.\n\n"

            "ERROR INTERPRETATION (brief):\n"
            "- FK_VIOLATION: referenced record doesn't exist\n"
            "- STATE_MISMATCH: row not in expected state for this action\n"
            "- UNIQUE_VIOLATION: duplicate value\n"
            "- CHECK_VIOLATION: constraint failed\n"
            "- FIELD_REQUIRED: missing NOT NULL column\n\n"

            f"PLATFORM SCHEMA:\n{schema_context}"
        ),
        tools=[SafeActionTool(), DPAPICatalogTool(), UpsertTableFileReadTool()],
        llm=OPENAI_MODEL,
        memory=None,
        verbose=True,
    )

    action_hint = context.get("action_hint", "")
    table_hint = context.get("table", "")

    prompt = ""
    if history_text:
        prompt += f"Conversation so far:\n{history_text}\n\n"
    if action_hint or table_hint:
        hints = []
        if table_hint:
            hints.append(f"table={table_hint}")
        if action_hint:
            hints.append(f"action={action_hint}")
        prompt += f"Context: {', '.join(hints)}\n\n"
    prompt += (
        f"User message: {message}\n\n"
        "Instructions:\n"
        "1. If user named a specific action, verify it exists via dp_api_catalog.\n"
        "2. If user wants insert/update without naming an action, list matching\n"
        "   actions from the table and pick one or ask user to choose.\n"
        "3. Read table config (dp_file_read) for columns/constraints.\n"
        "4. Keep response CONCISE -- no schema dumps.\n"
        "5. Go straight to confirm_action when you have all needed info."
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


def execute_confirmed(action: ConfirmAction) -> ChatResponse:
    details = action.details
    table_name = details.get("table_name", "")
    action_name = details.get("action_name", "")
    payload = details.get("payload", {})

    if not table_name or not action_name:
        return ChatResponse(
            response_type="error",
            message="Missing table_name or action_name in confirmed action.",
        )

    try:
        tool = SafeActionTool()
        result_raw = tool._run(table_name=table_name, action_name=action_name, payload=payload)
        try:
            result = json.loads(result_raw)
        except (json.JSONDecodeError, TypeError):
            result = {"raw": result_raw}

        success = result.get("success", False)
        return ChatResponse(
            response_type="result",
            message=(
                f"Action executed successfully!\n\n"
                f"```\n{json.dumps(result, indent=2)}\n```"
                if success
                else f"Action failed:\n\n"
                f"```\n{json.dumps(result, indent=2)}\n```"
            ),
        )
    except Exception as e:
        return ChatResponse(
            response_type="error",
            message=f"Failed to execute action: {e}",
        )


def _strip_json_block(raw: str) -> str:
    """Remove the confirm_action JSON block (and surrounding code fences) from
    the agent's raw output, leaving only the natural-language summary."""
    import re
    cleaned = re.sub(
        r"```(?:json)?\s*\{[\s\S]*?\"confirm_action\"[\s\S]*?\}\s*```",
        "", raw,
    )
    cleaned = re.sub(
        r"\{[\s\S]*?\"confirm_action\"[\s\S]*?\}",
        "", cleaned,
    )
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned


def _try_extract_confirmation(raw: str) -> ConfirmAction | None:
    if "confirm_action" not in raw:
        return None

    start = raw.find("{", raw.find("confirm_action"))
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
                    obj = json.loads(raw[start : i + 1])
                    action_info = obj.get("confirm_action", obj)
                    return ConfirmAction(
                        flow="upsert",
                        action_type="action",
                        description=(
                            f"Execute {action_info.get('action_name', '?')} "
                            f"on table {action_info.get('table_name', '?')}"
                        ),
                        details=action_info,
                    )
                except json.JSONDecodeError:
                    return None
    return None


def _looks_like_execution_result(raw: str) -> bool:
    indicators = ['"success":', "executed successfully", "action completed"]
    lower = raw.lower()
    return any(ind in lower for ind in indicators) and "confirm" not in lower
