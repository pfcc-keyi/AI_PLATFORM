import json
import os

from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Data Platform connection
# ---------------------------------------------------------------------------
DATA_PLATFORM_URL = os.environ.get(
    "DATA_PLATFORM_URL", "http://localhost:8000"
)
DATA_PLATFORM_ADMIN_TOKEN = os.environ.get("DATA_PLATFORM_ADMIN_TOKEN", "")
DATA_PLATFORM_API_TOKEN = os.environ.get("DATA_PLATFORM_API_TOKEN", "")

# ---------------------------------------------------------------------------
# LLM -- agent reasoning, tool calling, code generation
#
# Requesty requires "provider/model" format (e.g. "openai/gpt-4o-mini").
# CrewAI strips the provider prefix in LLM.__new__ before passing to the
# native provider. We patch __new__ to preserve the original model string
# when a custom base_url is set (proxy scenario).
# ---------------------------------------------------------------------------
from crewai import LLM
from crewai.llms.providers.openai.completion import OpenAICompletion

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_API_BASE = os.environ.get("OPENAI_API_BASE", "")
_OPENAI_MODEL_NAME = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

# ---------------------------------------------------------------------------
# Monkey-patch: CrewAI strips "openai/" from model names when routing to its
# native OpenAI provider. Proxies like Requesty require the full
# "provider/model" format. We patch _prepare_completion_params (the method
# that builds the dict sent to the OpenAI API) to restore the full model name
# when the client points to a non-default base URL.
# This is the most downstream patch point -- works regardless of how the LLM
# instance was constructed, copied, or passed around internally.
# ---------------------------------------------------------------------------
_OPENAI_DEFAULT_BASES = {"https://api.openai.com/v1", "https://api.openai.com/v1/"}

_original_prepare = OpenAICompletion._prepare_completion_params

def _patched_prepare(self, messages, tools=None):
    params = _original_prepare(self, messages, tools)
    base = str(getattr(self, "client", None) and self.client.base_url or "")
    if base.rstrip("/") not in _OPENAI_DEFAULT_BASES and "/" in _OPENAI_MODEL_NAME:
        params["model"] = _OPENAI_MODEL_NAME
    return params

OpenAICompletion._prepare_completion_params = _patched_prepare

OPENAI_MODEL = LLM(
    model=_OPENAI_MODEL_NAME,
    api_key=OPENAI_API_KEY,
    base_url=OPENAI_API_BASE or None,
)

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
CREWAI_STORAGE_DIR = os.environ.get("CREWAI_STORAGE_DIR", "./.crewai_storage")
MEMORY_STORAGE_PATH = os.path.join(CREWAI_STORAGE_DIR, "memory")

# ---------------------------------------------------------------------------
# Embedder -- single source of truth for Memory, Knowledge, and all Crews.
#
# IMPORTANT: LLM calls and Embedding calls may go through DIFFERENT endpoints.
#
#   LLM (agent reasoning)  -->  Requesty proxy  -->  gpt-4o-mini / claude / etc
#   Embedding (vectors)     -->  OpenAI direct   -->  text-embedding-3-small
#
# Why separate? Requesty routes LLM completions, but embedding models may
# not be available through the proxy. Even if they are, embedding calls are
# high-volume (every remember/recall/knowledge chunk) so a direct connection
# avoids proxy overhead.
#
# The OpenAI embedder supports api_base + api_key overrides. If your proxy
# DOES support embeddings, set EMBEDDER_API_BASE to point to it.
#
# Used by: setup/memory_setup.py, setup/knowledge_setup.py, all crews/*.py
# ---------------------------------------------------------------------------
EMBEDDER_PROVIDER = os.environ.get("EMBEDDER_PROVIDER", "openai")
EMBEDDER_MODEL = os.environ.get("EMBEDDER_MODEL", "text-embedding-3-small")
EMBEDDER_API_KEY = os.environ.get("EMBEDDER_API_KEY", OPENAI_API_KEY)
EMBEDDER_API_BASE = os.environ.get("EMBEDDER_API_BASE", "")

_embedder_inner: dict = {"model_name": EMBEDDER_MODEL}
if EMBEDDER_API_KEY:
    _embedder_inner["api_key"] = EMBEDDER_API_KEY
if EMBEDDER_API_BASE:
    _embedder_inner["api_base"] = EMBEDDER_API_BASE

EMBEDDER_CONFIG: dict = {
    "provider": EMBEDDER_PROVIDER,
    "config": _embedder_inner,
}

_override = os.environ.get("EMBEDDER_CONFIG_JSON")
if _override:
    EMBEDDER_CONFIG = json.loads(_override)
