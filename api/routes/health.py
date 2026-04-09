from fastapi import APIRouter

from setup.schema_sync import get_schema_catalog

router = APIRouter()


@router.get("/api/health")
async def health():
    catalog = get_schema_catalog()
    return {
        "status": "ok",
        "schema_loaded": catalog is not None,
        "tables_count": len(catalog.get("tables", [])) if catalog else 0,
    }


@router.get("/api/schema")
async def schema_proxy():
    """Convenience proxy to the cached Data Platform schema catalog."""
    catalog = get_schema_catalog()
    if catalog is None:
        return {"success": False, "error": "Schema catalog not loaded"}
    return {"success": True, "data": catalog}
