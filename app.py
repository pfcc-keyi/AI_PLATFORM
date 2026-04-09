from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes.config import router as config_router
from api.routes.ops import router as ops_router
from api.routes.health import router as health_router
from setup.knowledge_setup import load_knowledge_sources
from setup.schema_sync import sync_schema_catalog


@asynccontextmanager
async def lifespan(application: FastAPI):
    await sync_schema_catalog()
    load_knowledge_sources()
    yield


app = FastAPI(title="AI Platform", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(config_router, prefix="/api/config", tags=["config"])
app.include_router(ops_router, prefix="/api/ops", tags=["ops"])
