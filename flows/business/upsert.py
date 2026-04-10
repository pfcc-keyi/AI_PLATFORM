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
            f"{'nullable' if c.get('nullable') else 'required'})"
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
        lines.append(
            f"Table: {tname}  pk={pk}\n"
            f"  columns (excluding state): {', '.join(cols)}\n"
            f"  states: {', '.join(states)}\n"
            f"  allowed actions: {', '.join(actions)}"
        )

    return "\n".join(lines)


def _normalize_token(text: str) -> str:
    return (text or "").lower().replace("-", "_").replace(" ", "_")


def _is_mock_request(message: str) -> bool:
    lower = (message or "").lower()
    if any(k in lower for k in ("mock", "sample", "dummy", "fake", "test data")):
        return True
    return any(k in (message or "") for k in ("模拟", "样例", "示例", "测试数据", "mock数据", "假数据"))


def _safe_columns(table_info: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        c for c in table_info.get("columns", [])
        if c.get("name") and c.get("name") != "state"
    ]


def _insert_required_fields(table_info: dict[str, Any]) -> list[str]:
    cols = _safe_columns(table_info)
    pk = table_info.get("pk_field", "")
    pk_strategy = str(table_info.get("pk_strategy", "")).lower()
    required: list[str] = []
    for c in cols:
        name = c.get("name", "")
        if not name:
            continue
        if c.get("nullable"):
            continue
        if c.get("identity") is True:
            continue
        if c.get("default_expr"):
            continue
        if name == pk and pk_strategy in ("uuid4", "sequence"):
            continue
        required.append(name)
    return required


def _action_transition_text(action_def: dict[str, Any]) -> str:
    transition = action_def.get("transition", "")
    if isinstance(transition, dict):
        return f"{transition.get('from_state', '?')}->{transition.get('to_state', '?')}"
    return str(transition)


def _allowed_actions(table_info: dict[str, Any]) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for action in table_info.get("actions", []):
        ft = str(action.get("function_type", "")).lower()
        if ft in _BLOCKED_FUNCTION_TYPES:
            continue
        actions.append(action)
    return actions


def _candidate_tables(message: str, context: dict[str, Any], catalog: dict[str, Any]) -> list[str]:
    tables = catalog.get("tables", {})
    if not tables:
        return []

    candidates: list[str] = []
    ctx_table = context.get("table", "")
    if ctx_table in tables:
        candidates.append(ctx_table)

    normalized = _normalize_token(message)
    for tname in tables.keys():
        if tname in normalized and tname not in candidates:
            candidates.append(tname)

    action_hint = _normalize_token(context.get("action_hint", ""))
    if action_hint and not candidates:
        for tname, tinfo in tables.items():
            if any(_normalize_token(a.get("name", "")) == action_hint for a in tinfo.get("actions", [])):
                candidates.append(tname)
                break

    return candidates[:3]


def _build_upsert_mock_scaffold(message: str, context: dict[str, Any]) -> str:
    if not _is_mock_request(message):
        return ""
    catalog = get_schema_catalog()
    if not catalog or not catalog.get("tables"):
        return ""

    selected_tables = _candidate_tables(message, context, catalog)
    if not selected_tables:
        return (
            "Mock request detected, but target table is not clear.\n"
            "- Ask the user to pick one table first.\n"
            "- After table selection, build mock payload with minimum required fields + optional enrichments."
        )

    sections: list[str] = []
    for tname in selected_tables:
        tinfo = catalog["tables"].get(tname, {})
        cols = _safe_columns(tinfo)
        required_insert = _insert_required_fields(tinfo)
        optional_fields = [c.get("name", "") for c in cols if c.get("name") not in required_insert]
        action_lines: list[str] = []
        for action in _allowed_actions(tinfo):
            action_name = action.get("name", "")
            ft = str(action.get("function_type", "")).lower()
            transition = _action_transition_text(action)
            if ft == "insert":
                action_lines.append(
                    f"- {action_name} ({ft}, {transition}): minimum payload {{data: {{{', '.join(required_insert)}}}}}"
                )
            elif ft == "bulk_insert":
                action_lines.append(
                    f"- {action_name} ({ft}, {transition}): minimum payload {{rows: [{{{', '.join(required_insert)}}}]}}"
                )
            elif ft == "update":
                action_lines.append(
                    f"- {action_name} ({ft}, {transition}): minimum payload {{pk: <{tinfo.get('pk_field','pk')}>, data: {{...}}}}"
                )
            elif ft == "bulk_update":
                action_lines.append(
                    f"- {action_name} ({ft}, {transition}): minimum payload {{conditions: [[field, op, value]], data: {{...}}}}"
                )
        table_constraints = tinfo.get("table_constraints", []) or []
        check_constraints = [
            f"{c.get('name')}: {c.get('check')}"
            for c in cols if c.get("check")
        ]
        sections.append(
            "\n".join([
                f"Table `{tname}` mock scaffold:",
                f"- Required for insert-like actions: {required_insert if required_insert else 'none'}",
                f"- Optional enrichments (include as many as possible): {optional_fields if optional_fields else 'none'}",
                f"- Column checks to satisfy: {check_constraints if check_constraints else 'none'}",
                f"- Table constraints to satisfy: {table_constraints if table_constraints else 'none'}",
                "- Action minimum payloads:",
                *action_lines,
            ])
        )

    return "\n\n".join(sections)


def _validate_minimum_payload(table_name: str, action_name: str, payload: dict[str, Any]) -> tuple[bool, str]:
    catalog = get_schema_catalog()
    if not catalog:
        return True, ""
    tables = catalog.get("tables", {})
    tinfo = tables.get(table_name, {})
    if not tinfo:
        return True, ""

    action_def = None
    for action in tinfo.get("actions", []):
        if action.get("name") == action_name:
            action_def = action
            break
    if not action_def:
        return True, ""

    ft = str(action_def.get("function_type", "")).lower()
    missing: list[str] = []
    if ft == "insert":
        data = payload.get("data", {})
        if not isinstance(data, dict):
            return False, "For insert, payload must include an object at key `data`."
        for field in _insert_required_fields(tinfo):
            if field not in data:
                missing.append(f"data.{field}")
    elif ft == "bulk_insert":
        rows = payload.get("rows", [])
        if not isinstance(rows, list) or not rows:
            return False, "For bulk_insert, payload must include a non-empty `rows` array."
        for field in _insert_required_fields(tinfo):
            if field not in rows[0]:
                missing.append(f"rows[0].{field}")
    elif ft == "update":
        if payload.get("pk") in (None, ""):
            missing.append("pk")
        if "data" not in payload or not isinstance(payload.get("data"), dict):
            missing.append("data")
    elif ft == "bulk_update":
        if not isinstance(payload.get("conditions"), list) or not payload.get("conditions"):
            missing.append("conditions")
        if "data" not in payload or not isinstance(payload.get("data"), dict):
            missing.append("data")

    if missing:
        return False, (
            "Payload is missing minimum required keys for this action: "
            + ", ".join(missing)
            + ". Please补全这些字段后再确认执行。"
        )
    return True, ""


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
            f"{m['role']}: {m['content'][:300]}" for m in recent[:-1]
        )

    agent = Agent(
        role="Data Upsert Specialist",
        goal="Help the user insert or update records in platform tables by executing the correct actions",
        backstory=(
            "You help users create (insert) or update records in the CRM "
            "data platform using per-table actions.\n\n"
            "IMPORTANT: If the user just says they want to insert/update "
            "records without specifying a table, briefly ask which table "
            "they want to work with and what data they want to write. "
            "Keep it short and friendly.\n\n"
            "WORKFLOW:\n"
            "1. Identify which table(s) the user wants to modify.\n"
            "2. Use dp_api_catalog with the table_name to see available actions.\n"
            "3. Use dp_file_read with the table's .py filename (e.g. party.py) "
            "   to read /api/admin/files/tables/... ONLY. Never read handlers/.\n"
            "4. Collect required field values from the user.\n"
            "5. Before executing, present a summary and ask the user to "
            "   CONFIRM. Output a JSON block with key 'confirm_action' "
            "   containing {table_name, action_name, payload}.\n"
            "6. DO NOT execute dp_safe_action until the user confirms.\n\n"
            "ABSOLUTE RULES:\n"
            "- NEVER execute delete or bulk_delete actions.\n"
            "- NEVER include 'state' in the payload.\n"
            "- ONLY use insert, update, bulk_insert, bulk_update actions.\n"
            "- Confirm with the user before EVERY execution.\n"
            "- You can only execute actions, NOT handlers or queries.\n\n"
            "ACTION PAYLOAD FORMATS:\n"
            "- insert: {\"data\": {field: value, ...}}\n"
            "- update: {\"pk\": \"...\", \"data\": {field: value, ...}}\n"
            "- bulk_insert: {\"rows\": [{field: value}, ...]}\n"
            "- bulk_update: {\"conditions\": [[field, op, value]], \"data\": {field: value}}\n\n"
            f"PLATFORM SCHEMA:\n{schema_context}"
        ),
        tools=[SafeActionTool(), DPAPICatalogTool(), UpsertTableFileReadTool()],
        llm=OPENAI_MODEL,
        memory=None,
        verbose=True,
    )

    prompt = ""
    if history_text:
        prompt += f"Conversation so far:\n{history_text}\n\n"
    prompt += f"User message: {message}"
    mock_scaffold = _build_upsert_mock_scaffold(message, context)
    if mock_scaffold:
        prompt += (
            "\n\nMOCK-DATA REQUIREMENT DETECTED.\n"
            "Use the deterministic scaffold below as hard minimums for confirm_action payloads.\n"
            "When mocking: include all minimum required fields first, then enrich with optional fields as many as possible.\n"
            "Also ensure check/table constraints are satisfied.\n\n"
            f"{mock_scaffold}"
        )

    result = agent.kickoff(prompt)
    raw = result.raw if result else ""

    confirm_data = _try_extract_confirmation(raw)
    if confirm_data:
        details = confirm_data.details
        ok, err = _validate_minimum_payload(
            table_name=details.get("table_name", ""),
            action_name=details.get("action_name", ""),
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
