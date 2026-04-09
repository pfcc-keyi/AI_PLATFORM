"""Fetch and cache the Data Platform schema catalog.

K3 (dynamic knowledge) -- refreshed at startup and after each hot-reload.
"""

import json
import logging

import httpx

from config import DATA_PLATFORM_URL, DATA_PLATFORM_ADMIN_TOKEN

logger = logging.getLogger(__name__)

_cached_catalog: dict | None = None
_cached_catalog_text: str = ""


def _admin_headers() -> dict[str, str]:
    h: dict[str, str] = {}
    if DATA_PLATFORM_ADMIN_TOKEN:
        h["Authorization"] = f"Bearer {DATA_PLATFORM_ADMIN_TOKEN}"
    return h


async def sync_schema_catalog() -> None:
    """Fetch schema catalog from the Data Platform and cache it."""
    global _cached_catalog, _cached_catalog_text
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{DATA_PLATFORM_URL}/api/admin/schema-catalog",
                headers=_admin_headers(),
                timeout=15,
            )
            if resp.status_code == 200:
                _cached_catalog = resp.json()
                _cached_catalog_text = json.dumps(_cached_catalog, indent=2)
                logger.info(
                    "Schema catalog synced: %d tables",
                    len(_cached_catalog.get("tables", [])),
                )
            else:
                logger.warning(
                    "Failed to sync schema catalog: HTTP %d", resp.status_code
                )
    except Exception as exc:
        logger.warning(
            "Data Platform not reachable at %s -- schema catalog not loaded (%s: %s)",
            DATA_PLATFORM_URL,
            type(exc).__name__,
            exc,
        )


def get_schema_catalog() -> dict | None:
    return _cached_catalog


def get_schema_catalog_text() -> str:
    return _cached_catalog_text
