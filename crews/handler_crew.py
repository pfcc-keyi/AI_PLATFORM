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
                "- Keep output JSON-serializable and rely on action/handler conventions from docs\n\n"
                "DATE HANDLING (critical):\n"
                "- JSON payloads carry dates as strings. If a column has pg_type='date' or 'timestamp',\n"
                "  you MUST convert with date.fromisoformat() / datetime.fromisoformat() before passing to the action.\n"
                "- Import: from datetime import date (and datetime if needed)\n\n"
                "ERROR HANDLING:\n"
                "- raise HandlerError(message=..., code=..., http_status=...) for business errors\n"
                "- ActionError from table actions is auto-translated to structured error responses\n"
                "- Import: from lib.handler.errors import HandlerError\n\n"
                "RETURN VALUE:\n"
                "- Must be JSON-serializable: no raw date/datetime/UUID/Decimal objects\n"
                "- The platform calls _make_json_safe before commit, but best practice is to return\n"
                "  only the 'data' dicts from action results (which are already serializable)\n\n"
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
                "- Validate payload type at the top\n"
                "- Build data dicts with a _pick helper for optional fields\n"
                "- Await ctx.{table}.{action}(data=...) in sequence\n"
                "- Extract PK from first action's result to pass to dependent actions\n"
                "- Convert str dates with date.fromisoformat() before action calls\n"
                "- Return combined results as a dict\n"
                "- Raise HandlerError for invalid input\n"
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
                "4. Import: from datetime import date (if date columns involved)\n"
                "5. Import: from lib.handler.errors import HandlerError\n"
                "6. MODE = \"sync\" (use \"async\" only if user explicitly requests it)\n"
                "7. async def handle(ctx, payload: dict) -> dict:\n"
                "8. Validate payload at the top, raise HandlerError for bad input\n"
                "9. Use ctx.{table_name}.{action_name}(data={...}) for every mutation\n"
                "10. Convert string dates to date objects before passing to actions\n"
                "11. Return a dict combining action results\n"
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
