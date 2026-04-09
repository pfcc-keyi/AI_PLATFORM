"""Memory initialization with hierarchical scopes.

Scope hierarchy:
    /config/sessions      -- past config generation sessions (Scenario A, legacy)
    /config/new_table     -- deployed new table patterns
    /config/new_action    -- deployed action additions
    /config/new_handler   -- deployed handler patterns
    /config/conventions   -- learned naming/PK/state conventions
    /config/failures      -- rejected attempts
    /schema               -- cached schema knowledge
"""

from crewai import Memory

from config import EMBEDDER_CONFIG, MEMORY_STORAGE_PATH, OPENAI_MODEL

_memory: Memory | None = None


def get_memory() -> Memory:
    global _memory
    if _memory is None:
        _memory = Memory(
            llm=OPENAI_MODEL,
            storage=MEMORY_STORAGE_PATH,
            embedder=EMBEDDER_CONFIG,
            recency_weight=0.3,
            semantic_weight=0.5,
            importance_weight=0.2,
            recency_half_life_days=30,
        )
    return _memory


def config_memory():
    """Memory scoped to /config -- for Scenario A agents."""
    return get_memory().scope("/config")


class _ReadOnlyMemoryScope:
    """Thin wrapper that delegates recall to a MemoryScope but blocks all writes."""

    read_only = True

    def __init__(self, scope):
        self._scope = scope

    def recall(self, *args, **kwargs):
        return self._scope.recall(*args, **kwargs)

    def remember(self, *args, **kwargs):
        return None

    def remember_many(self, *args, **kwargs):
        return []

    def extract_memories(self, *args, **kwargs):
        return []


def config_memory_readonly():
    """Read-only memory scoped to /config -- reads deploy history, never writes."""
    return _ReadOnlyMemoryScope(get_memory().scope("/config"))
