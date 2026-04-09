"""DataQueryHandler -- queries data from platform tables.

Single agent replaces the 3-agent QueryCrew.

Allowed tools:
  - DPQueryTool only (list, get_by_pk, count, exists)

All other tools are forbidden.
Response includes structured table data for frontend rendering.
"""

import json
import logging
import re
from typing import Any

from crewai import Agent
from crewai.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr

from config import OPENAI_MODEL
from models.ops_models import ChatResponse
from setup.schema_sync import get_schema_catalog
from tools.data_platform import DPQueryTool

logger = logging.getLogger(__name__)


class QueryInputError(Exception):
    """Raised when the query call is structurally invalid."""


class _SafeQueryInput(BaseModel):
    table_name: str = Field(description="Target table name, e.g. 'party'")
    method: str = Field(description="One of: get_by_pk, list, count, exists")
    params: dict[str, Any] = Field(default_factory=dict, description="Query params")


class SafeDPQueryTool(BaseTool):
    """Guarded wrapper for dp_query to block malformed calls."""

    name: str = "dp_query"
    description: str = (
        "Query data from a data platform table. Supports get_by_pk, list, "
        "count, and exists. get_by_pk requires params.pk."
    )
    args_schema: type[BaseModel] = _SafeQueryInput
    _pk_hints: dict[str, str] = PrivateAttr(default_factory=dict)
    _table_pk_map: dict[str, str] = PrivateAttr(default_factory=dict)

    def set_context(
        self,
        *,
        pk_hints: dict[str, str],
        table_pk_map: dict[str, str],
    ) -> "SafeDPQueryTool":
        self._pk_hints = {k.lower(): v for k, v in (pk_hints or {}).items() if v}
        self._table_pk_map = {k.lower(): v for k, v in (table_pk_map or {}).items() if v}
        return self

    def _pick_pk_hint(self, table_name: str, table_pk: str) -> str:
        t = (table_name or "").lower()
        pk = (table_pk or "").lower()
        candidates = [
            pk,
            f"{t}_{pk}",
            f"{t}.pk",
            "pk",
        ]
        if pk.endswith("_id"):
            candidates.append("id")
        if f"{t}_id" not in candidates:
            candidates.append(f"{t}_id")

        for key in candidates:
            v = self._pk_hints.get(key)
            if v and str(v).strip():
                return str(v).strip()
        return self._pk_hints.get("_single_candidate", "").strip()

    def _run(self, table_name: str, method: str, params: dict[str, Any] | None = None) -> str:
        m = (method or "").strip()
        p = dict(params or {})

        if m not in {"get_by_pk", "list", "count", "exists"}:
            raise QueryInputError(
                f"INVALID_METHOD: Unsupported query method '{m}'. "
                "Use one of get_by_pk/list/count/exists."
            )

        if m == "get_by_pk":
            pk = p.get("pk")
            table_pk = self._table_pk_map.get((table_name or "").lower(), "pk")
            if (pk is None or (isinstance(pk, str) and not pk.strip())) and table_pk in p:
                pk = p.get(table_pk)
            if pk is None or (isinstance(pk, str) and not pk.strip()):
                hint_pk = self._pick_pk_hint(table_name, table_pk)
                if hint_pk:
                    p["pk"] = hint_pk
                    pk = hint_pk
            if pk is None or (isinstance(pk, str) and not pk.strip()):
                raise QueryInputError(
                    "MISSING_PK: get_by_pk requires params.pk. "
                    "Example: {'pk': 'BR612843'}."
                )

        tool = DPQueryTool()
        return tool._run(table_name=table_name, method=m, params=p)


def _build_schema_context() -> str:
    catalog = get_schema_catalog()
    if not catalog:
        return "Schema catalog not loaded."

    lines: list[str] = []
    tables = catalog.get("tables", {})
    for tname, tinfo in tables.items():
        cols = [
            f"{c.get('name','')}({c.get('pg_type','')})"
            for c in tinfo.get("columns", [])
        ]
        pk = tinfo.get("pk_field", "id")
        states = tinfo.get("states", [])
        fks = [
            f"{fk.get('field','')} -> {fk.get('references_table','')}"
            for fk in tinfo.get("fk_definitions", [])
        ]
        lines.append(
            f"Table: {tname}  pk={pk}\n"
            f"  columns: {', '.join(cols)}\n"
            f"  states: {', '.join(states)}\n"
            f"  fks: {', '.join(fks) if fks else 'none'}"
        )
    return "\n".join(lines)


def _table_pk_map() -> dict[str, str]:
    catalog = get_schema_catalog() or {}
    tables = catalog.get("tables", {})
    return {
        str(tname).lower(): str(tinfo.get("pk_field", "pk")).lower()
        for tname, tinfo in tables.items()
        if isinstance(tinfo, dict)
    }


def _extract_pk_hints(message: str, history: list[dict[str, Any]]) -> dict[str, str]:
    hints: dict[str, str] = {}
    chunks = [message or ""]
    for m in reversed(history):
        if m.get("role") == "user" and isinstance(m.get("content"), str):
            chunks.append(m["content"])
        if len(chunks) >= 5:
            break
    text = "\n".join(chunks)

    # key=value / key: value patterns (supports spaces in key, e.g. "party id=...")
    for raw_key, raw_val in re.findall(
        r"([A-Za-z_][A-Za-z0-9_ ]{0,40}?)\s*[:=]\s*['\"]?([A-Za-z0-9_-]{2,})['\"]?",
        text,
    ):
        key = re.sub(r"\s+", "_", raw_key.strip().lower())
        val = raw_val.strip()
        if key and val:
            hints[key] = val

    # Fallback candidate IDs like BR612843
    id_candidates: list[str] = []
    for token in re.findall(r"\b[A-Z]{2,}\d{3,}\b", text):
        if token not in id_candidates:
            id_candidates.append(token)
    if len(id_candidates) == 1:
        hints["_single_candidate"] = id_candidates[0]

    return hints


def _strip_code_fences(text: str) -> str:
    """Remove markdown code fences (```json ... ```) to expose raw JSON."""
    return re.sub(r"```(?:json)?\s*\n?", "", text)


def _one_result_to_table(obj: dict) -> dict[str, Any] | None:
    """Convert a single {"success":true,"data":...} into {columns, rows}."""
    if not obj.get("success"):
        return None
    data = obj.get("data")
    if data is None:
        return None
    if isinstance(data, list) and data:
        columns = list(data[0].keys())
        rows = [list(row.values()) for row in data]
        return {"columns": columns, "rows": rows}
    if isinstance(data, dict):
        if "count" in data:
            return {"columns": ["count"], "rows": [[data["count"]]]}
        if "exists" in data:
            return {"columns": ["exists"], "rows": [[data["exists"]]]}
        columns = list(data.keys())
        rows = [list(data.values())]
        return {"columns": columns, "rows": rows}
    return None


def _left_join(left: dict, right: dict) -> dict[str, Any] | None:
    """LEFT JOIN two table dicts on shared columns. Returns merged table."""
    l_cols, l_rows = left["columns"], left["rows"]
    r_cols, r_rows = right["columns"], right["rows"]

    shared = [c for c in l_cols if c in r_cols]
    if not shared:
        return None

    join_key = shared[0]
    l_key_idx = l_cols.index(join_key)

    r_key_idx = r_cols.index(join_key)
    r_extra_idxs = [i for i, c in enumerate(r_cols) if c not in shared]
    r_extra_cols = [r_cols[i] for i in r_extra_idxs]

    r_name = right.get("name", "")
    out_extra_cols = [
        f"{r_name}.{c}" if r_name else c for c in r_extra_cols
    ]

    r_index: dict[str, list] = {}
    for row in r_rows:
        k = row[r_key_idx]
        r_index.setdefault(k, []).append(row)

    merged_cols = l_cols + out_extra_cols
    merged_rows: list[list] = []
    null_fill = [None] * len(r_extra_idxs)

    for l_row in l_rows:
        k = l_row[l_key_idx]
        matches = r_index.get(k)
        if matches:
            for r_row in matches:
                extras = [r_row[i] for i in r_extra_idxs]
                merged_rows.append(l_row + extras)
        else:
            merged_rows.append(l_row + null_fill)

    return {"columns": merged_cols, "rows": merged_rows}


def _extract_table_data(raw: str) -> dict[str, Any] | None:
    """Find and parse JSON result blocks embedded in agent text.

    Handles single-table and multi-table responses.
    For multi-table, attempts a LEFT JOIN on shared columns.
    """
    cleaned = _strip_code_fences(raw)
    candidates = _find_json_objects(cleaned)

    for obj in candidates:
        if obj.get("success") is not None:
            t = _one_result_to_table(obj)
            if t:
                return t

        nested_tables: list[dict[str, Any]] = []
        for key, val in obj.items():
            if isinstance(val, dict) and "success" in val:
                t = _one_result_to_table(val)
                if t:
                    t["name"] = key
                    nested_tables.append(t)

        if len(nested_tables) >= 2:
            merged = _left_join(nested_tables[0], nested_tables[1])
            for extra in nested_tables[2:]:
                if merged:
                    merged = _left_join(merged, extra)
            if merged:
                return merged
            return {"tables": nested_tables}

        if len(nested_tables) == 1:
            return nested_tables[0]

    return None


def _find_json_objects(text: str) -> list[dict]:
    """Extract all top-level JSON objects from text."""
    results: list[dict] = []
    i = 0
    while i < len(text):
        if text[i] == "{":
            depth = 0
            for j in range(i, len(text)):
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            obj = json.loads(text[i : j + 1])
                            if isinstance(obj, dict):
                                results.append(obj)
                        except json.JSONDecodeError:
                            pass
                        i = j + 1
                        break
            else:
                i += 1
        else:
            i += 1
    return results


def _strip_json_from_message(raw: str) -> str:
    """Remove large JSON blocks from the message, keep only the summary text."""
    stripped = re.sub(
        r"```(?:json)?\s*[\s\S]*?```",
        "",
        raw,
        flags=re.DOTALL | re.IGNORECASE,
    )
    cleaned = re.sub(r"\n{3,}", "\n\n", stripped).strip()
    if cleaned and cleaned[0] in {"{", "["}:
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, (dict, list)):
                return ""
        except json.JSONDecodeError:
            pass
    return cleaned


def _build_table_summary(table_data: dict[str, Any] | None) -> str:
    """Build a short user-facing summary for table responses."""
    if not table_data:
        return ""

    if isinstance(table_data.get("tables"), list):
        parts: list[str] = []
        for t in table_data["tables"]:
            name = str(t.get("name") or "table")
            rows = t.get("rows") if isinstance(t, dict) else []
            row_count = len(rows) if isinstance(rows, list) else 0
            parts.append(f"{name}: {row_count} row(s)")
        if parts:
            return "Query completed. " + "; ".join(parts) + "."
        return "Query completed."

    rows = table_data.get("rows")
    if isinstance(rows, list):
        if not rows:
            return "No rows found."
        return f"Found {len(rows)} row(s)."

    return "Query completed."


def handle_query(
    message: str,
    history: list[dict[str, Any]],
    context: dict[str, Any],
) -> ChatResponse:
    schema_context = _build_schema_context()

    history_text = ""
    recent = history[-8:]
    if len(recent) > 1:
        history_text = "\n".join(
            f"{m['role']}: {m['content'][:300]}" for m in recent[:-1]
        )

    safe_query_tool = SafeDPQueryTool().set_context(
        pk_hints=_extract_pk_hints(message, history),
        table_pk_map=_table_pk_map(),
    )

    agent = Agent(
        role="Data Query Specialist",
        goal=(
            "Translate user questions into data platform queries, execute "
            "them, and present results clearly"
        ),
        backstory=(
            "You query data from the platform using dp_query. "
            "You know the query API:\n"
            "  - list: {select, conditions, order_by, limit, offset}\n"
            "  - get_by_pk: {pk} or {pk, select}\n"
            "  - count: {conditions}\n"
            "  - exists: {conditions}\n\n"
            "Condition format: [field, operator, value].\n"
            "Operators: =, !=, <, <=, >, >=, IN, NOT IN, LIKE, ILIKE, "
            "IS NULL, IS NOT NULL.\n\n"
            "RULES:\n"
            "1. Use ONLY dp_query. No other tools.\n"
            "2. For multi-table queries, execute SEPARATE per-table queries.\n"
            "3. ALWAYS include the raw JSON response from dp_query in your "
            "   output inside a ```json code block.\n"
            "4. After the JSON block, add a brief summary.\n"
            "5. If the query returns no results, say so clearly.\n"
            "6. For get_by_pk, ALWAYS include params.pk. Never call get_by_pk "
            "   with empty params.\n"
            "7. If a call fails due to missing/invalid params, DO NOT retry "
            "   the same call repeatedly. Ask the user for the missing value.\n\n"
            f"PLATFORM SCHEMA:\n{schema_context}"
        ),
        tools=[safe_query_tool],
        llm=OPENAI_MODEL,
        memory=None,
        verbose=False,
        max_iter=6,
    )

    prompt = ""
    if history_text:
        prompt += f"Conversation so far:\n{history_text}\n\n"
    prompt += f"User request: {message}"

    try:
        result = agent.kickoff(prompt)
        raw_text = result.raw if result else ""
    except Exception as e:
        err = str(e)
        if "MISSING_PK" in err:
            return ChatResponse(
                response_type="message",
                message=(
                    "I need the primary key value to run get_by_pk. "
                    "Please provide it explicitly, e.g. `pk=BR612843` "
                    "or `party_id=BR612843`."
                ),
            )
        if "INVALID_METHOD" in err:
            return ChatResponse(
                response_type="error",
                message="Invalid query method requested. Please use list/get_by_pk/count/exists.",
            )
        raise

    table_data = _extract_table_data(raw_text)
    display_msg = _strip_json_from_message(raw_text)
    if table_data and not display_msg:
        display_msg = _build_table_summary(table_data)
    if not table_data and not display_msg:
        display_msg = "Query completed."

    return ChatResponse(
        response_type="table" if table_data else "message",
        message=display_msg,
        table_data=table_data,
    )
