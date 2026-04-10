"""HandlerCrew -- generate handler code that combines actions across tables.

Single agent reads table configs and produces handler Python code directly.
Uses K4 (handler examples) and injects the full create_party.py reference handler
into the task prompt to guarantee visibility.

Output: raw Python code string.
"""

import ast
import os
import re
from typing import Any

from crewai import Agent, Crew, Process, Task, TaskOutput

from config import EMBEDDER_CONFIG, OPENAI_MODEL
from setup.knowledge_setup import get_docs_knowledge, get_handler_knowledge
from tools.admin import DPFileReadTool, DPNameResolveTool, DPSchemaCatalogTool

_HANDLER_EXAMPLE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "knowledge", "examples", "handlers", "create_party.py",
)


def _load_handler_example() -> str:
    try:
        with open(_HANDLER_EXAMPLE_PATH, "r") as f:
            return f.read()
    except FileNotFoundError:
        return ""


def _extract_python(text: str) -> str:
    match = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()


def _fix_smart_quotes(text: str) -> str:
    return (
        text.replace("\u2018", "'").replace("\u2019", "'")
        .replace("\u201c", '"').replace("\u201d", '"')
    )


def validate_python_syntax(result: TaskOutput) -> tuple[bool, Any]:
    code = _fix_smart_quotes(_extract_python(result.raw))
    try:
        ast.parse(code)
        return (True, code)
    except SyntaxError as e:
        return (False, f"Python syntax error at line {e.lineno}: {e.msg}")


class HandlerCrew:
    """Single-agent crew that generates Data Platform handler code."""

    def crew(
        self,
        requirement: str,
        table_contexts: str,
        handler_name: str = "",
        handler_design=None,
    ) -> Crew:
        docs_k = get_docs_knowledge()
        handler_k = get_handler_knowledge()
        knowledge_sources = []
        if docs_k:
            knowledge_sources.append(docs_k)
        if handler_k:
            knowledge_sources.append(handler_k)

        generator = Agent(
            role="Data Platform Handler Generator",
            goal="Generate valid, production-ready handler code for the Data Platform",
            backstory=(
                "You write Python handler files for a Data Platform. "
                "Handlers orchestrate actions across one or more registered tables "
                "in a single atomic transaction.\n\n"
                "HANDLER FILE CONVENTION:\n"
                "- Top-level: MODE = \"sync\" (or \"async\"), then async def handle(ctx, payload: dict) -> dict:\n"
                "- Access tables via ctx.{table_name}, call actions via ctx.{table_name}.{action_name}(data={...})\n"
                "- Each action returns {\"data\": {...}} with the row including the PK\n"
                "- All ctx calls share one BEGIN/COMMIT transaction -- atomicity is automatic\n\n"
                "HANDLER CONTRACT (from handler guide):\n"
                "- File name determines handler name; no decorators/registration needed\n"
                "- Signature must remain exactly async def handle(ctx, payload)\n"
                "- MODE must be exactly \"sync\" or \"async\"\n"
                "- Use \"async\" only for long-running / batch operations that may exceed HTTP timeout\n\n"
                "CTX CAPABILITIES:\n"
                "- Actions (write): ctx.{table}.{action}(data={...}), ctx.{table}.{action}(pk=..., data={...})\n"
                "  Bulk: ctx.{table}.{bulk_action}(rows=[...]), ctx.{table}.{bulk_action}(data={...}, conditions=[...])\n"
                "- Queries (read): ctx.{table}.get_by_pk(pk), ctx.{table}.get_by_pk(pk, select=[...])\n"
                "  ctx.{table}.list(conditions=[...], order_by=[...], limit=N)\n"
                "  ctx.{table}.count(conditions=[...]), ctx.{table}.exists(conditions=[...])\n"
                "- Raw SQL: ctx.raw_query(sql, params) -- params use PostgreSQL $1,$2 syntax, returns list[dict]\n\n"
                "WHAT THE PLATFORM HANDLES AUTOMATICALLY (do NOT do these manually):\n"
                "- PK generation (ActionExecutor + PKConfig)\n"
                "- State injection (ActionExecutor + StateTransition) -- never set data[\"state\"] manually\n"
                "- Type coercion: date/datetime/numeric/boolean strings are auto-converted by TypeCoercer.\n"
                "  Do NOT call date.fromisoformat() or similar -- just pass JSON strings directly.\n"
                "- CAS (compare-and-swap) for state transitions\n"
                "- Transaction management (BEGIN/COMMIT/ROLLBACK)\n"
                "- Step tracking for error audit trail\n"
                "- Output serialization: _make_json_safe converts date/UUID/Decimal before commit\n"
                "- DB error translation: asyncpg errors become structured ActionError responses\n\n"
                "ERROR HANDLING:\n"
                "- from lib.handler.errors import HandlerError  (always import)\n"
                "- from lib.handler.errors import ActionError    (import only if catching specific action errors)\n"
                "- raise HandlerError(message=..., code=..., http_status=...) for business validation errors\n"
                "- Option A (recommended): let ActionError propagate -- executor auto-wraps as HandlerError(code=\"ACTION_FAILED\")\n"
                "- Option B (custom messages): catch ActionError, re-raise as HandlerError with context\n\n"
                "RETURN VALUE:\n"
                "- Best practice: return the 'data' dicts from action results (already serializable)\n"
                "- The platform's _make_json_safe converts date/UUID/Decimal automatically before commit\n"
                "- raw_query results are NOT auto-coerced; handle manually if they contain special types\n\n"
                "CODE RULES:\n"
                "- Output ONLY raw Python code, NO markdown fences, NO explanations\n"
                "- Use ONLY ASCII straight quotes (' and \"), NEVER curly/smart quotes\n"
                "- Use dp_name_resolve tool to verify table and action names from user input\n"
                "- Use dp_file_read to read table configs for column/action details if needed\n"
                "- Use dp_schema_catalog to browse the full registry"
            ),
            tools=[DPNameResolveTool(), DPFileReadTool(), DPSchemaCatalogTool()],
            llm=OPENAI_MODEL,
            knowledge_sources=knowledge_sources,
            memory=None,
            verbose=True,
        )

        handler_example = _load_handler_example()
        example_section = ""
        if handler_example:
            example_section = (
                "\n\nREFERENCE HANDLER (create_party.py) -- follow this pattern:\n"
                "```\n"
                f"{handler_example}\n"
                "```\n"
                "Key patterns from this example:\n"
                "- Validate payload type at the top, raise HandlerError for invalid input\n"
                "- Build data dicts with a _pick helper for optional fields\n"
                "- Await ctx.{table}.{action}(data=...) in sequence\n"
                "- Extract PK from first action's result to pass to dependent actions\n"
                "- Pass date strings directly (no manual conversion -- auto type coercion handles it)\n"
                "- Return combined results as a dict\n"
            )

        handler_label = f"Handler name: {handler_name}\n" if handler_name else ""

        design_section = ""
        if handler_design is not None:
            try:
                design_json = handler_design.model_dump_json(indent=2)
            except AttributeError:
                design_json = str(handler_design)
            design_section = (
                f"\n\nCONFIRMED HANDLER DESIGN (follow this plan exactly):\n"
                f"{design_json}\n"
                "Implement every step listed in the design. Use the exact table names, "
                "action names, and payload fields specified. Follow the step order.\n"
            )

        task = Task(
            description=(
                f"Generate a complete Python handler file for the Data Platform.\n\n"
                f"{handler_label}"
                f"User requirement: {requirement}\n\n"
                f"TABLE CONFIGS (tables this handler will use):\n{table_contexts}\n"
                f"{design_section}"
                f"{example_section}\n"
                "RULES:\n"
                "1. Output ONLY raw Python code -- no markdown, no explanations, no ```\n"
                "2. Use ONLY ASCII quotes (' and \")\n"
                "3. Start with a docstring describing the handler's payload and endpoint\n"
                "4. Import: from lib.handler.errors import HandlerError (always)\n"
                "5. Import: from lib.handler.errors import ActionError (only if catching specific action errors)\n"
                "6. Do NOT import datetime for type conversion -- the platform auto-coerces date strings\n"
                "7. MODE = \"sync\" (use \"async\" only for long-running / batch operations)\n"
                "8. async def handle(ctx, payload: dict) -> dict:\n"
                "9. Validate payload at the top, raise HandlerError for bad input (input-validation-first pattern)\n"
                "10. Use ctx.{table}.get_by_pk / .list / .count / .exists for reads before mutations when needed\n"
                "11. Use ctx.{table_name}.{action_name}(data={...}) for every mutation\n"
                "12. Pass date/datetime strings directly in data dicts -- TypeCoercer converts them automatically\n"
                "13. Return a dict combining action results\n"
            ),
            expected_output="Raw Python handler source code only, no markdown fences",
            agent=generator,
            guardrails=[validate_python_syntax],
            guardrail_max_retries=3,
        )

        return Crew(
            agents=[generator],
            tasks=[task],
            process=Process.sequential,
            embedder=EMBEDDER_CONFIG,
            verbose=True,
        )
