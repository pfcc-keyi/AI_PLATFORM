"""GeneralEnquiryHandler -- answers conceptual questions about the data platform.

Knowledge sources:
  - K1 docs (architecture.md, concepts.md, usage.md)
  - Cached schema catalog injected in prompt

Allowed tools:
  - DPAPICatalogTool  (global + per-table)
  - DPFileReadTool    (handlers and tables — /api/admin/files/handlers/*.py or tables/*.py)

All other tools are forbidden.
"""

import json
import re
from typing import Any

from crewai import Agent

from config import OPENAI_MODEL
from models.ops_models import ChatResponse
from setup.knowledge_setup import get_docs_knowledge
from setup.schema_sync import get_schema_catalog
from tools.admin import DPAPICatalogTool, DPFileReadTool

_TABLE_DETAIL_KEYWORDS = {
    "state",
    "states",
    "action",
    "actions",
    "transition",
    "transitions",
    "column",
    "columns",
    "field",
    "fields",
    "definition",
    "schema",
}

_API_KEYWORDS = {
    "api",
    "apis",
    "endpoint",
    "endpoints",
    "url",
    "method",
    "callable",
    "available",
}


def _build_schema_context() -> str:
    catalog = get_schema_catalog()
    if not catalog:
        return "Schema catalog not loaded."

    lines: list[str] = []
    tables = catalog.get("tables", {})
    for tname, tinfo in tables.items():
        cols = [c.get("name", "") for c in tinfo.get("columns", [])]
        actions = [
            f"{a['name']}({a.get('function_type','')}:{a.get('transition','')})"
            for a in tinfo.get("actions", [])
        ]
        states = tinfo.get("states", [])
        fks = [
            f"{fk.get('field','')} -> {fk.get('references_table','')}.{fk.get('references_field','')}"
            for fk in tinfo.get("fk_definitions", [])
        ]
        lines.append(
            f"Table: {tname}\n"
            f"  columns: {', '.join(cols)}\n"
            f"  states: {', '.join(states)}\n"
            f"  actions: {', '.join(actions)}\n"
            f"  fks: {', '.join(fks) if fks else 'none'}"
        )

    handlers = catalog.get("handlers", [])
    if handlers:
        lines.append(f"\nRegistered handlers: {', '.join(handlers)}")

    return "\n".join(lines)


def _looks_like_table_detail_question(message: str) -> bool:
    lower = message.lower()
    return any(k in lower for k in _TABLE_DETAIL_KEYWORDS)


def _looks_like_api_question(message: str) -> bool:
    lower = message.lower()
    return any(k in lower for k in _API_KEYWORDS)


def _mentioned_tables(message: str) -> list[str]:
    catalog = get_schema_catalog() or {}
    tables = list((catalog.get("tables") or {}).keys())
    if not tables:
        # Fallback when cache is not loaded: infer table-like tokens from message.
        # If user is explicitly asking about handlers, avoid guessing handler names
        # (e.g. create_party) as table names.
        if "handler" in message.lower():
            return []
        guessed: list[str] = []
        for token in re.findall(r"[a-z][a-z0-9_]{2,}", message.lower()):
            if "_" in token and token not in guessed:
                guessed.append(token)
        return guessed[:3]

    lower = message.lower()
    matched: list[str] = []
    for tname in tables:
        token = re.escape(tname.lower())
        token_spaces = re.escape(tname.lower().replace("_", " "))
        patterns = [
            rf"\b{token}\b",
            rf"\b{token_spaces}\b",
        ]
        if any(re.search(pat, lower) for pat in patterns):
            matched.append(tname)

    return matched[:3]


def _mentioned_handlers(message: str) -> list[str]:
    catalog = get_schema_catalog() or {}
    handlers = [h for h in (catalog.get("handlers") or []) if isinstance(h, str)]
    lower = message.lower()
    matched: list[str] = []

    for hname in handlers:
        token = re.escape(hname.lower())
        token_spaces = re.escape(hname.lower().replace("_", " "))
        patterns = [
            rf"\b{token}\b",
            rf"\b{token_spaces}\b",
        ]
        if any(re.search(pat, lower) for pat in patterns):
            matched.append(hname)

    if matched:
        return matched[:3]

    # Fallback when cache is not loaded: infer likely handler names only if user
    # explicitly asks about handlers.
    if "handler" in lower:
        guessed: list[str] = []
        for token in re.findall(r"[a-z][a-z0-9_]{2,}", lower):
            if "_" in token and token not in guessed:
                guessed.append(token)
        return guessed[:3]

    return []


def _pretty_json(raw: str) -> str:
    try:
        return json.dumps(json.loads(raw), indent=2)
    except Exception:
        return raw


def _prefetch_tool_context(message: str) -> str:
    table_detail_question = _looks_like_table_detail_question(message)
    api_question = _looks_like_api_question(message)
    tables = _mentioned_tables(message) if (table_detail_question or api_question) else []
    handlers = _mentioned_handlers(message)

    if not table_detail_question and not api_question and not handlers:
        return ""

    file_tool = DPFileReadTool()
    api_tool = DPAPICatalogTool()
    blocks: list[str] = []
    global_api_added = False

    # For generic API availability questions with no table scope, use global catalog.
    if api_question and not tables:
        global_api_raw = api_tool._run()
        blocks.append(
            "GLOBAL API CATALOG EVIDENCE\n"
            f"dp_api_catalog():\n{_pretty_json(global_api_raw)}"
        )
        global_api_added = True

    for table in tables:
        table_file = f"{table}.py"
        if table_detail_question:
            file_raw = file_tool._run(category="tables", filename=table_file)
            blocks.append(
                f"TABLE FILE EVIDENCE -- {table}\n"
                f"dp_file_read(category='tables', filename='{table_file}'):\n"
                f"{_pretty_json(file_raw)}"
            )
        # For table-scoped API or structure questions, prefer per-table API catalog.
        if api_question or table_detail_question:
            api_raw = api_tool._run(table_name=table)
            blocks.append(
                f"TABLE API CATALOG EVIDENCE -- {table}\n"
                f"dp_api_catalog(table_name='{table}'):\n{_pretty_json(api_raw)}"
            )

    for handler in handlers:
        handler_file = handler if handler.endswith(".py") else f"{handler}.py"
        file_raw = file_tool._run(category="handlers", filename=handler_file)
        blocks.append(
            f"HANDLER FILE EVIDENCE -- {handler_file}\n"
            f"dp_file_read(category='handlers', filename='{handler_file}'):\n"
            f"{_pretty_json(file_raw)}"
        )

    # Handler endpoint details live in global API catalog, not per-table catalog.
    if handlers and api_question and not global_api_added:
        global_api_raw = api_tool._run()
        blocks.append(
            "GLOBAL API CATALOG EVIDENCE (for handler endpoints)\n"
            f"dp_api_catalog():\n{_pretty_json(global_api_raw)}"
        )

    return "\n\n".join(blocks)


def handle_enquiry(
    message: str,
    history: list[dict[str, Any]],
) -> ChatResponse:
    knowledge_sources = []
    docs = get_docs_knowledge()
    if docs:
        knowledge_sources.append(docs)

    schema_context = _build_schema_context()
    prefetched_tool_context = _prefetch_tool_context(message)

    history_text = ""
    recent = history[-8:]
    if len(recent) > 1:
        history_text = "\n".join(
            f"{m['role']}: {m['content'][:300]}" for m in recent[:-1]
        )

    agent = Agent(
        role="Data Platform Knowledge Assistant",
        goal=(
            "Answer user questions about the data platform accurately, "
            "based ONLY on the knowledge and schema provided"
        ),
        backstory=(
            "You are a knowledgeable assistant for the Data Platform. "
            "You answer questions about tables, actions, handlers, states, "
            "transitions, columns, FK relationships, query methods, error codes, "
            "and platform concepts.\n\n"
            "KEY PLATFORM FACTS (always true):\n"
            "- Every registered table automatically gets 4 read-only QUERY "
            "  methods: get_by_pk, list, count, exists. These are separate "
            "  from the state-transition 'actions' shown in the schema.\n"
            "- Actions (insert/update/delete/bulk_*) are write operations "
            "  bound to state transitions. Queries are read-only with no "
            "  state transition.\n"
            "- The 'state' column is managed by CAS (compare-and-swap). "
            "  Callers never pass 'state' in payloads.\n"
            "- 'init' and 'deleted' are virtual states never stored in DB.\n"
            "- Handlers orchestrate multiple actions in a shared transaction.\n\n"
            "RULES:\n"
            "1. Answer ONLY based on the knowledge documents and schema catalog "
            "   provided. NEVER fabricate information.\n"
            "2. For API availability questions: use dp_api_catalog(table_name=...) "
            "   when a specific table is mentioned; use global dp_api_catalog() "
            "   only when the user asks platform-wide APIs or handler endpoints.\n"
            "3. If the user asks about a specific table's columns, states, "
            "   actions, transitions, PK/FK, or definitions, you MUST call "
            "   dp_file_read with category='tables' and filename='<table>.py' "
            "   before answering. Also use per-table dp_api_catalog for "
            "   endpoint details.\n"
            "4. Use dp_file_read with category='handlers' to read handler "
            "   source code when the user asks about specific handler logic, "
            "   parameters, or workflow. For handler endpoint URLs/methods, "
            "   use global dp_api_catalog and filter to that handler.\n"
            "5. Do NOT discuss deployment details.\n"
            "6. If you don't know the answer, say so.\n\n"
            f"CURRENT PLATFORM SCHEMA:\n{schema_context}"
        ),
        tools=[DPAPICatalogTool(), DPFileReadTool()],
        knowledge_sources=knowledge_sources,
        llm=OPENAI_MODEL,
        memory=None,
        verbose=True,
    )

    prompt = ""
    if history_text:
        prompt += f"Conversation so far:\n{history_text}\n\n"
    if prefetched_tool_context:
        prompt += (
            "Server-fetched tool evidence for this question "
            "(treat as authoritative source):\n"
            f"{prefetched_tool_context}\n\n"
        )
    prompt += f"User question: {message}"

    result = agent.kickoff(prompt)

    return ChatResponse(
        response_type="message",
        message=result.raw if result else "I couldn't find an answer.",
    )
