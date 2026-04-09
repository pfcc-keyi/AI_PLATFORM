"""Data Platform business tools -- actions, queries, handlers.

These use API_TOKEN and call the business endpoints on the Data Platform.
"""

from typing import Any, Optional

import httpx
from crewai.tools import BaseTool
from pydantic import BaseModel, Field

from config import DATA_PLATFORM_URL, DATA_PLATFORM_API_TOKEN


def _api_headers() -> dict[str, str]:
    h: dict[str, str] = {"Content-Type": "application/json"}
    if DATA_PLATFORM_API_TOKEN:
        h["Authorization"] = f"Bearer {DATA_PLATFORM_API_TOKEN}"
    return h


# ---------------------------------------------------------------------------
# Action Tool
# ---------------------------------------------------------------------------

class DPActionInput(BaseModel):
    table_name: str = Field(description="Target table name (e.g. 'party')")
    action_name: str = Field(description="Action to execute (e.g. 'create_party_active')")
    payload: dict[str, Any] = Field(
        description=(
            "JSON body for the action. "
            "For insert: {'data': {...}}. "
            "For update: {'pk': '...', 'data': {...}}. "
            "For delete: {'pk': '...'}. "
            "For bulk_insert: {'rows': [...]}. "
            "For bulk_update/delete: {'conditions': [...], 'data': {...}}."
        )
    )


class DPActionTool(BaseTool):
    name: str = "dp_action"
    description: str = (
        "Execute a write action (insert/update/delete/bulk) on a data platform table. "
        "Returns the created/updated row or {count, pks} for bulk operations. "
        "State transitions are enforced automatically -- wrong state yields STATE_MISMATCH."
    )
    args_schema: type[BaseModel] = DPActionInput

    def _run(self, table_name: str, action_name: str, payload: dict[str, Any]) -> str:
        url = f"{DATA_PLATFORM_URL}/api/actions/{table_name}/{action_name}"
        resp = httpx.post(url, json=payload, headers=_api_headers(), timeout=30)
        return resp.text


# ---------------------------------------------------------------------------
# Query Tool
# ---------------------------------------------------------------------------

class DPQueryInput(BaseModel):
    table_name: str = Field(description="Table to query (e.g. 'party')")
    method: str = Field(
        description="Query method: 'get_by_pk', 'list', 'count', or 'exists'"
    )
    params: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Query parameters. "
            "get_by_pk: {'pk': '...'} or {'pk': '...', 'select': [...]}. "
            "list: {'select': [...], 'conditions': [...], 'order_by': [...], 'limit': N, 'offset': N}. "
            "count: {'conditions': [...]}. "
            "exists: {'conditions': [...]}. "
            "Condition format: [field, operator, value]. "
            "Operators: =, !=, <, <=, >, >=, IN, NOT IN, LIKE, ILIKE, IS NULL, IS NOT NULL."
        ),
    )


class DPQueryTool(BaseTool):
    name: str = "dp_query"
    description: str = (
        "Query data from a data platform table. "
        "Supports get_by_pk, list (with filtering/sorting/pagination), count, and exists."
    )
    args_schema: type[BaseModel] = DPQueryInput

    def _run(self, table_name: str, method: str, params: Optional[dict[str, Any]] = None) -> str:
        url = f"{DATA_PLATFORM_URL}/api/queries/{table_name}/{method}"
        resp = httpx.post(url, json=params or {}, headers=_api_headers(), timeout=30)
        return resp.text


# ---------------------------------------------------------------------------
# Handler Tool
# ---------------------------------------------------------------------------

class DPHandlerInput(BaseModel):
    handler_name: str = Field(description="Handler name (e.g. 'create_party')")
    payload: dict[str, Any] = Field(
        description="JSON payload for the handler"
    )


class DPHandlerTool(BaseTool):
    name: str = "dp_handler"
    description: str = (
        "Execute a multi-table transactional handler on the data platform. "
        "Handlers orchestrate multiple actions in a single database transaction. "
        "Example: 'create_party' creates a party row + party_corp or party_person in one tx."
    )
    args_schema: type[BaseModel] = DPHandlerInput

    def _run(self, handler_name: str, payload: dict[str, Any]) -> str:
        url = f"{DATA_PLATFORM_URL}/api/handlers/{handler_name}"
        resp = httpx.post(url, json=payload, headers=_api_headers(), timeout=60)
        return resp.text
