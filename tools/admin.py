"""Data Platform admin tools -- schema catalog, API catalog, file management,
name resolution, validation, and reload.

These use ADMIN_TOKEN and call the admin endpoints on the Data Platform.
DPNameResolveTool uses the locally cached schema catalog (no API call).
"""

import json
import re
from difflib import SequenceMatcher
from typing import Any, Optional

import httpx
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from config import DATA_PLATFORM_URL, DATA_PLATFORM_ADMIN_TOKEN


def _admin_headers() -> dict[str, str]:
    h: dict[str, str] = {"Content-Type": "application/json"}
    if DATA_PLATFORM_ADMIN_TOKEN:
        h["Authorization"] = f"Bearer {DATA_PLATFORM_ADMIN_TOKEN}"
    return h


# ---------------------------------------------------------------------------
# Schema Catalog
# ---------------------------------------------------------------------------

class DPSchemaCatalogTool(BaseTool):
    name: str = "dp_schema_catalog"
    description: str = (
        "Get the full schema catalog from the data platform: "
        "all registered tables with their columns, types, nullable, states, "
        "transitions, actions, FK definitions, and all registered handlers."
    )

    def _run(self) -> str:
        url = f"{DATA_PLATFORM_URL}/api/admin/schema-catalog"
        resp = httpx.get(url, headers=_admin_headers(), timeout=30)
        return resp.text


# ---------------------------------------------------------------------------
# Name Resolve (uses cached catalog, no API call)
# ---------------------------------------------------------------------------

def _normalize_name(name: str) -> str:
    """Lowercase, replace spaces/hyphens/camelCase with underscores."""
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", name)
    s = s.lower().replace(" ", "_").replace("-", "_")
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def _fuzzy_score(query: str, candidate: str) -> float:
    """Combined similarity: SequenceMatcher + substring bonus."""
    nq = _normalize_name(query)
    nc = candidate.lower()
    ratio = SequenceMatcher(None, nq, nc).ratio()
    if nq in nc or nc in nq:
        ratio = max(ratio, 0.85)
    if nq == nc:
        ratio = 1.0
    return round(ratio, 3)


class DPNameResolveInput(BaseModel):
    name: str = Field(description="User-provided entity name to resolve (may have typos, wrong case, etc.)")
    entity_type: str = Field(
        description=(
            "'table' to match against registered table names, "
            "'action' to match action names on a specific table, "
            "'handler' to match registered handler names"
        )
    )
    context_table: str = Field(
        default="",
        description="Required when entity_type='action': the table whose actions to search",
    )


class DPNameResolveTool(BaseTool):
    name: str = "dp_name_resolve"
    description: str = (
        "Fuzzy-match a user-provided name against registered tables, actions, or handlers "
        "using the cached schema catalog (no API call). Returns top 3 matches with scores. "
        "Use this BEFORE referencing any table/action/handler name from user input to confirm "
        "the correct identifier exists."
    )
    args_schema: type[BaseModel] = DPNameResolveInput

    def _run(
        self,
        name: str,
        entity_type: str,
        context_table: str = "",
    ) -> str:
        from setup.schema_sync import get_schema_catalog

        catalog = get_schema_catalog()
        if not catalog:
            return json.dumps({"match": "error", "message": "Schema catalog not loaded"})

        candidates: list[str] = []
        tables_dict = catalog.get("tables", {})

        if entity_type == "table":
            candidates = list(tables_dict.keys())
        elif entity_type == "action":
            resolved_table = context_table or ""
            if resolved_table not in tables_dict:
                norm = _normalize_name(resolved_table)
                for t in tables_dict:
                    if _normalize_name(t) == norm:
                        resolved_table = t
                        break
            table_info = tables_dict.get(resolved_table, {})
            candidates = [a.get("name", "") for a in table_info.get("actions", []) if a.get("name")]
        elif entity_type == "handler":
            candidates = catalog.get("handlers", [])
        else:
            return json.dumps({"match": "error", "message": f"Unknown entity_type: {entity_type}"})

        if not candidates:
            return json.dumps({
                "match": "none",
                "results": [],
                "message": f"No {entity_type}s registered" + (f" on table '{context_table}'" if context_table else ""),
            })

        scored = [{"name": c, "score": _fuzzy_score(name, c)} for c in candidates]
        scored.sort(key=lambda x: x["score"], reverse=True)
        top3 = scored[:3]

        exact = [m for m in top3 if m["score"] >= 0.95]
        if exact:
            return json.dumps({"match": "exact", "resolved": exact[0]["name"], "results": exact})

        close = [m for m in top3 if m["score"] >= 0.6]
        if close:
            return json.dumps({
                "match": "similar",
                "results": close,
                "suggestion": f"Did you mean one of these {entity_type}s? Please confirm.",
            })

        return json.dumps({
            "match": "none",
            "results": top3,
            "suggestion": f"No close match found for '{name}'. Available {entity_type}s: {candidates[:10]}",
        })


# ---------------------------------------------------------------------------
# API Catalog
# ---------------------------------------------------------------------------

class DPAPICatalogInput(BaseModel):
    table_name: Optional[str] = Field(
        default=None,
        description=(
            "Optional table scope. "
            "Set table_name to get per-table APIs (actions + queries for that table). "
            "Leave empty to get the global API catalog (all tables + handlers)."
        ),
    )


class DPAPICatalogTool(BaseTool):
    name: str = "dp_api_catalog"
    description: str = (
        "Get callable API endpoints from the data platform with full URLs. "
        "Use table_name for per-table details (actions + queries for one table); "
        "use no table_name for platform-wide catalog including handlers. "
        "Returns endpoints with method/path/url metadata."
    )
    args_schema: type[BaseModel] = DPAPICatalogInput

    def _run(self, table_name: Optional[str] = None) -> str:
        if table_name:
            url = f"{DATA_PLATFORM_URL}/api/admin/api-catalog/{table_name}"
        else:
            url = f"{DATA_PLATFORM_URL}/api/admin/api-catalog"
        resp = httpx.get(url, headers=_admin_headers(), timeout=30)
        return resp.text


# ---------------------------------------------------------------------------
# List Handler Files
# ---------------------------------------------------------------------------

class ListHandlerFilesTool(BaseTool):
    name: str = "list_handler_files"
    description: str = (
        "List all available handler files on the data platform. "
        "Returns {success: true, files: ['create_party.py', ...]}. "
        "Use this to show the user which business handlers are available for execution."
    )

    def _run(self) -> str:
        url = f"{DATA_PLATFORM_URL}/api/admin/files/handlers"
        resp = httpx.get(url, headers=_admin_headers(), timeout=30)
        return resp.text


# ---------------------------------------------------------------------------
# File Write
# ---------------------------------------------------------------------------

class DPFileWriteInput(BaseModel):
    category: str = Field(description="'tables' or 'handlers'")
    filename: str = Field(description="Python filename, e.g. 'order.py'")
    content: str = Field(description="Complete Python source code content")


class DPFileWriteTool(BaseTool):
    name: str = "dp_file_write"
    description: str = (
        "Write a Python file to the data platform's workspace volume. "
        "Category must be 'tables' or 'handlers'. "
        "The file will be available for hot-reload after writing."
    )
    args_schema: type[BaseModel] = DPFileWriteInput

    def _run(self, category: str, filename: str, content: str) -> str:
        url = f"{DATA_PLATFORM_URL}/api/admin/files/{category}/{filename}"
        resp = httpx.put(
            url,
            json={"content": content},
            headers=_admin_headers(),
            timeout=30,
        )
        if resp.status_code >= 400:
            return json.dumps({"success": False, "status_code": resp.status_code, "body": resp.text})
        try:
            data = resp.json()
            data["success"] = True
            return json.dumps(data)
        except Exception:
            return json.dumps({"success": True, "body": resp.text})


# ---------------------------------------------------------------------------
# File Read
# ---------------------------------------------------------------------------

class DPFileReadInput(BaseModel):
    category: str = Field(
        description=(
            "'tables' for table definition files (columns/PK/FK/states/transitions/actions) "
            "or 'handlers' for handler source files (workflow/parameters/signature)."
        )
    )
    filename: str = Field(
        description=(
            "Python filename to read, e.g. 'party.py' or 'create_party.py'. "
            "Reads from /api/admin/files/{category}/{filename}."
        )
    )


class DPFileReadTool(BaseTool):
    name: str = "dp_file_read"
    description: str = (
        "Read a Python file from the data platform workspace. "
        "Use category='tables' to inspect table definitions (columns/PK/FK/states/actions), "
        "or category='handlers' to inspect handler logic and required parameters. "
        "Returns file content from /api/admin/files/{category}/{filename}."
    )
    args_schema: type[BaseModel] = DPFileReadInput

    def _run(self, category: str, filename: str) -> str:
        url = f"{DATA_PLATFORM_URL}/api/admin/files/{category}/{filename}"
        resp = httpx.get(url, headers=_admin_headers(), timeout=30)
        return resp.text


# ---------------------------------------------------------------------------
# Validate Table
# ---------------------------------------------------------------------------

class DPValidateTableInput(BaseModel):
    content: str = Field(description="Complete Python source code of a table config file")


class DPValidateTableTool(BaseTool):
    name: str = "dp_validate_table"
    description: str = (
        "Validate generated table config source code against the live Data Platform registry. "
        "Checks FK references, action/transition consistency, state/pk columns. "
        "Returns {valid: bool, errors: [...], warnings: [...]}."
    )
    args_schema: type[BaseModel] = DPValidateTableInput

    def _run(self, content: str) -> str:
        url = f"{DATA_PLATFORM_URL}/api/admin/validate-table"
        resp = httpx.post(
            url,
            json={"content": content},
            headers=_admin_headers(),
            timeout=30,
        )
        return resp.text


# ---------------------------------------------------------------------------
# Validate Handler
# ---------------------------------------------------------------------------

class DPValidateHandlerInput(BaseModel):
    content: str = Field(description="Complete Python source code of a handler file")


class DPValidateHandlerTool(BaseTool):
    name: str = "dp_validate_handler"
    description: str = (
        "Validate generated handler source code against the live Data Platform registry. "
        "Checks handle signature, MODE, ctx table/action references. "
        "Returns {valid: bool, errors: [...], warnings: [...]}."
    )
    args_schema: type[BaseModel] = DPValidateHandlerInput

    def _run(self, content: str) -> str:
        url = f"{DATA_PLATFORM_URL}/api/admin/validate-handler"
        resp = httpx.post(
            url,
            json={"content": content},
            headers=_admin_headers(),
            timeout=30,
        )
        return resp.text


# ---------------------------------------------------------------------------
# Reload
# ---------------------------------------------------------------------------

class DPReloadTool(BaseTool):
    name: str = "dp_reload"
    description: str = (
        "Trigger a hot-reload on the data platform. "
        "Scans tables/ and handlers/ directories, diffs against in-memory registry, "
        "and applies append-only changes. "
        "Returns a report of what was added/updated/rejected. "
        "409 means an append-only rule was violated (e.g. removing an existing action)."
    )

    def _run(self) -> str:
        url = f"{DATA_PLATFORM_URL}/api/admin/reload"
        resp = httpx.post(url, headers=_admin_headers(), timeout=60)
        if resp.status_code >= 400:
            return json.dumps({"success": False, "status_code": resp.status_code, "body": resp.text})
        try:
            data = resp.json()
            data["success"] = True
            return json.dumps(data)
        except Exception:
            return json.dumps({"success": True, "body": resp.text})
