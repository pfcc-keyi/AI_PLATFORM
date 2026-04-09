"""Knowledge source initialization.

K1: Platform Docs   (static, from knowledge/*.md)
K2: Table Examples   (static, from knowledge/examples/tables/*.py)
K3: Schema Catalog  (dynamic, from Data Platform API)
K4: Handler Examples (static, from knowledge/examples/handlers/*.py)

All knowledge sources use the centralized EMBEDDER_CONFIG from config.py
so that vector dimensions are consistent with Memory.
"""

import logging
import os
from pathlib import Path

from crewai.knowledge.source.text_file_knowledge_source import TextFileKnowledgeSource
from crewai.knowledge.source.string_knowledge_source import StringKnowledgeSource

from config import EMBEDDER_CONFIG
from setup.schema_sync import get_schema_catalog_text

logger = logging.getLogger(__name__)

_KNOWLEDGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "knowledge")

docs_knowledge: TextFileKnowledgeSource | None = None
example_knowledge: TextFileKnowledgeSource | None = None
schema_knowledge: StringKnowledgeSource | None = None
handler_knowledge: TextFileKnowledgeSource | None = None


def _find_files(directory: str, ext: str) -> list[Path]:
    """Return Path objects for all files with given extension in directory."""
    result = []
    if not os.path.isdir(directory):
        return result
    for fname in os.listdir(directory):
        if fname.endswith(ext):
            result.append(Path(os.path.join(directory, fname)))
    return sorted(result)


def load_knowledge_sources() -> None:
    global docs_knowledge, example_knowledge, schema_knowledge, handler_knowledge

    doc_files = _find_files(_KNOWLEDGE_DIR, ".md")
    if doc_files:
        docs_knowledge = TextFileKnowledgeSource(file_paths=doc_files)
        logger.info("K1 loaded: %d doc files", len(doc_files))

    tables_dir = os.path.join(_KNOWLEDGE_DIR, "examples", "tables")
    table_files = _find_files(tables_dir, ".py")
    if table_files:
        example_knowledge = TextFileKnowledgeSource(file_paths=table_files)
        logger.info("K2 loaded: %d table example files", len(table_files))

    handlers_dir = os.path.join(_KNOWLEDGE_DIR, "examples", "handlers")
    handler_files = _find_files(handlers_dir, ".py")
    if handler_files:
        handler_knowledge = TextFileKnowledgeSource(file_paths=handler_files)
        logger.info("K4 loaded: %d handler example files", len(handler_files))

    refresh_schema_knowledge()


def refresh_schema_knowledge() -> None:
    """Rebuild K3 from the cached schema catalog text."""
    global schema_knowledge
    catalog_text = get_schema_catalog_text()
    if catalog_text:
        schema_knowledge = StringKnowledgeSource(
            content=f"Current Data Platform Schema Catalog:\n{catalog_text}"
        )
        logger.info("K3 loaded: schema catalog")
    else:
        schema_knowledge = StringKnowledgeSource(
            content="Schema catalog not available yet."
        )
        logger.warning("K3: schema catalog empty -- Data Platform may not be reachable")


def get_docs_knowledge():
    return docs_knowledge


def get_example_knowledge():
    return example_knowledge


def get_schema_knowledge():
    return schema_knowledge


def get_handler_knowledge():
    return handler_knowledge
