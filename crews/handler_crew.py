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
                "- Access tables via ctx.{table_name}; action call shape depends on function_type\n"
                "- Single-row actions return {\"data\": row}; bulk actions return {\"data\": {\"count\": N, \"pks\": [...]}}\n"
                "- All ctx calls share one BEGIN/COMMIT transaction -- atomicity is automatic\n\n"
                "HANDLER CONTRACT:\n"
                "- File name determines handler name; no decorators/registration needed\n"
                "- Signature must remain exactly async def handle(ctx, payload)\n"
                "- MODE must be exactly \"sync\" or \"async\"\n"
                "- Use \"async\" only for long-running / batch operations that may exceed HTTP timeout\n\n"
                "═══════════════════════════════════════════════════════════════\n"
                "  EXHAUSTIVE ctx API — this is EVERYTHING ctx can do.\n"
                "  There are NO other methods. Do NOT invent any.\n"
                "═══════════════════════════════════════════════════════════════\n\n"
                "1) ACTIONS (write — mutate rows):\n"
                "   await ctx.{table}.{action_name}(data={...})            # insert (new row)\n"
                "   await ctx.{table}.{action_name}(pk=..., data={...})    # update (existing row)\n"
                "   await ctx.{table}.{action_name}(pk=...)                # delete\n"
                "   await ctx.{table}.{bulk_action}(rows=[{...}, ...])     # bulk insert\n"
                "   await ctx.{table}.{bulk_action}(data={...}, conditions=[...])  # bulk update\n"
                "   await ctx.{table}.{bulk_action}(conditions=[...])      # bulk delete\n"
                "   • {action_name} and {bulk_action} are defined in the table config — use ONLY\n"
                "     actions that actually exist in the table's configuration.\n"
                "   • Single-row actions return result['data'] = full row.\n"
                "   • Bulk actions return result['data'] = {'count': N, 'pks': [...]}.\n\n"
                "2) QUERIES (read — no side effects):\n"
                "   await ctx.{table}.get_by_pk(pk)                        # single row by PK\n"
                "   await ctx.{table}.get_by_pk(pk, select=[...])          # single row, selected columns\n"
                "   await ctx.{table}.list(conditions=[...], order_by=[...], limit=N)\n"
                "   await ctx.{table}.count(conditions=[...])              # {\"data\": {\"count\": N}}\n"
                "   await ctx.{table}.exists(conditions=[...])             # {\"data\": {\"exists\": bool}}\n"
                "   • get_by_pk, list, count, exists — these are the ONLY built-in read methods.\n"
                "     No find(), no search(), no filter(), no query(), no select(), no get(),\n"
                "     no first(), no all(). They do NOT exist.\n\n"
                "3) RAW SQL (read-only):\n"
                "   await ctx.raw_query(sql, params)  # params use $1,$2 syntax, returns list[dict]\n\n"
                "NOTHING ELSE EXISTS on ctx. If you need an operation not listed above,\n"
                "use raw_query.\n\n"
                "═══════════════════════════════════════════════════════════════\n"
                "  FORBIDDEN — NEVER do any of these\n"
                "═══════════════════════════════════════════════════════════════\n\n"
                "• NEVER pass 'state' in data={...} — the platform injects state automatically\n"
                "  via StateTransition. Setting data[\"state\"] causes duplicate-column errors.\n"
                "• NEVER validate or check state in handler logic — the action name encodes the\n"
                "  full transition (e.g. set_X_approved_from_pending = verify pending, atomically\n"
                "  transition to approved). CAS validates state. The handler just calls the action;\n"
                "  it never inspects row state or conditionally branches on state.\n"
                "• PK handling depends on the table's PKConfig strategy:\n"
                "  - uuid4 / sequence: PK is auto-generated. Do NOT include PK in data={} for inserts.\n"
                "  - custom with generator that creates PK independently (e.g., derives from name):\n"
                "    Do NOT include PK in data={}. The generator produces it; it appears in the result.\n"
                "  - custom with generator=lambda data: data[\"pk_field\"]: the PK comes FROM data,\n"
                "    so you MUST include the PK field in data={} (e.g., child table FK = parent PK).\n"
                "  → Always read the table config to determine which case applies.\n"
                "• NEVER call ctx.{table}.update(...), ctx.{table}.delete(...),\n"
                "  ctx.{table}.insert(...), ctx.{table}.create(...), ctx.{table}.save(...),\n"
                "  ctx.{table}.find(...), ctx.{table}.filter(...), ctx.{table}.query(...),\n"
                "  ctx.{table}.all(), ctx.{table}.first() — these DO NOT EXIST.\n"
                "• NEVER call date.fromisoformat() or any manual type conversion for action inputs —\n"
                "  TypeCoercer handles all date/datetime/numeric/boolean coercion automatically.\n"
                "• NEVER call BEGIN, COMMIT, ROLLBACK — transaction management is automatic.\n\n"
                "IMPORTS FOR VALUE GENERATION (allowed and expected):\n"
                "When a handler needs to GENERATE a value (timestamp, computed field, reference code),\n"
                "import the necessary standard library and produce the value as a STRING:\n"
                "  from datetime import datetime\n"
                "  def _current_timestamp() -> str:\n"
                "      return datetime.now().strftime(\"%Y-%m-%dT%H:%M:%S.%f\")\n"
                "Then pass the string in data={...}. TypeCoercer converts it to the correct DB type.\n"
                "This avoids timezone-naive vs offset-aware errors.\n"
                "Other valid imports: uuid, hashlib, math, re — anything for computing/generating values.\n"
                "Rule: import for VALUE GENERATION = correct. Import for TYPE CONVERSION = forbidden.\n\n"
                "HANDLER CORE PATTERN — DATA MAPPING PIPELINE:\n"
                "A handler's primary job is to MAP data between payload, query results, and action\n"
                "inputs. For each step, identify both the call shape and the data sources.\n"
                "Call shape = data / pk+data / pk / rows / data+conditions / conditions.\n"
                "Each field or argument comes from one of these sources:\n"
                "  (a) payload fields — direct mapping from user input (most common)\n"
                "  (b) previous action results — e.g. PK from a parent insert passed to child action\n"
                "  (c) generated values — ONLY when needed: timestamps, computed fields via helpers\n"
                "Not every step needs all three. Many steps simply map payload → action input, or\n"
                "chain one action's output → next action's input, with no computation at all.\n"
                "Pattern: validate → choose action → map args → action → extract output → map → next action\n"
                "The handler does NOT manage state, does NOT do type conversion.\n\n"
                "PAYLOAD CONTRACT:\n"
                "- Unless the user explicitly requests nesting, keep payload FLAT.\n"
                "- Preserve user-provided payload field names exactly. Do NOT rename or invent aliases.\n"
                "- Derive payload field names only when the user did not provide one.\n\n"
                "VALIDATION PHILOSOPHY:\n"
                "- The handler is an orchestration/mapping layer, not a schema-validation layer.\n"
                "- Validate payload/business rules only when the flow actually needs it.\n"
                "- Do NOT add scattered checks for every mapped DB/source field just because the schema says\n"
                "  a column is NOT NULL. Let actions / DB constraints enforce schema validity unless the user\n"
                "  explicitly wants a custom business validation error.\n\n"
                "READING TABLE CONFIGS (to select and chain correct actions):\n"
                "Before writing code, read each involved table's config (via dp_file_read) to discover:\n"
                "- Available action names and their state transitions. Select the actions that match\n"
                "  the user's required business flow. Action names encode transitions\n"
                "  (e.g. create_X_active = insert→active, set_X_approved_from_pending = pending→approved).\n"
                "  Use ONLY action names that exist in the config. Do NOT invent action names.\n"
                "- Action function_type / call shape: tells you whether the actual call needs data,\n"
                "  pk+data, pk, rows, data+conditions, or conditions.\n"
                "- PK field + PKConfig strategy:\n"
                "  * uuid4/sequence → PK auto-generated, do NOT include in data={}\n"
                "  * custom with independent generator → PK auto-generated, do NOT include in data={}\n"
                "  * custom with generator=lambda data: data[\"pk_field\"] → caller MUST supply PK in data={}\n"
                "    (typical for child tables where PK = FK from parent, e.g. party_corp.party_id)\n"
                "- Column definitions: pg_type, nullable, constraints — tells you what fields each action likely needs\n"
                "  and which caller inputs are likely required for mapping\n"
                "- FK relationships: determines step order (parent table actions before child table actions)\n"
                "- Return shape: single-row actions return full row; bulk actions return count+pks only\n"
                "The goal: discover what actions exist, select the right ones, chain them with correct\n"
                "data mapping between steps.\n\n"
                "ERROR HANDLING:\n"
                "- from lib.handler.errors import HandlerError  (always import)\n"
                "- from lib.handler.errors import ActionError    (import only if catching specific action errors)\n"
                "- raise HandlerError(message=..., code=..., http_status=...) for payload/business-rule validation errors\n"
                "- Option A (recommended): let ActionError propagate — executor auto-wraps as HandlerError(code=\"ACTION_FAILED\")\n"
                "- Option B (custom messages): catch ActionError, re-raise as HandlerError with context\n\n"
                "RETURN VALUE:\n"
                "- Best practice: return the 'data' dicts from action results (already serializable)\n"
                "- The platform's _make_json_safe converts date/UUID/Decimal automatically before commit\n"
                "- raw_query results are NOT auto-coerced; handle manually if they contain special types\n\n"
                "CODE RULES:\n"
                "- Output ONLY raw Python code, NO markdown fences, NO explanations\n"
                "- Use ONLY ASCII straight quotes (' and \"), NEVER curly/smart quotes\n"
                "- Use dp_name_resolve tool to verify table and action names from user input\n"
                "- Use dp_file_read to read each table config to learn exact action names, columns, PKs, FKs\n"
                "- Use dp_schema_catalog to browse the full registry when needed"
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
                "- Await ctx.{table}.{action}(...) in sequence using the correct call shape per action\n"
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
                "6. Import standard libraries (datetime, uuid, etc.) ONLY for GENERATING values\n"
                "   (e.g. timestamps via datetime.now().strftime()). Generate values as STRINGS —\n"
                "   TypeCoercer converts to DB types. NEVER import for type conversion.\n"
                "7. MODE = \"sync\" (use \"async\" only for long-running / batch operations)\n"
                "8. async def handle(ctx, payload: dict) -> dict:\n"
                "9. Validate only payload/business rules the flow actually needs; raise HandlerError for bad input.\n"
                "   Do NOT add scattered schema-style checks for every mapped DB/source field.\n"
                "10. Use ONLY ctx.{table}.get_by_pk / .list / .count / .exists for reads\n"
                "11. Use ONLY the correct mutation call shape for the selected action:\n"
                "    data / pk+data / pk / rows / data+conditions / conditions.\n"
                "    action_name must come from the table config. Do NOT invent action names or ctx methods.\n"
                "12. NEVER include 'state' in data={...} AND NEVER validate/check state in handler\n"
                "    logic — action names encode transitions, CAS validates atomically\n"
                "13. For insert steps, PK in data={} depends on PKConfig: for uuid4/sequence, omit it;\n"
                "    for custom generators that read PK from data (lambda data: data[\"pk_field\"]),\n"
                "    you MUST include it. Read the table config to determine which case applies.\n"
                "14. Pass date/datetime strings directly in data dicts -- TypeCoercer handles coercion\n"
                "15. Remember return shapes: single-row actions give full row; bulk actions give count+pks only\n"
                "16. Preserve user-provided payload field names exactly. Do NOT rename or invent aliases.\n"
                "17. Unless the user explicitly requests nesting, keep payload flat.\n"
                "18. Return a dict combining action results, extracted IDs, counts, or mapped fields as needed\n"
                "19. Data mapping is the core pattern: each field or argument comes from payload,\n"
                "    previous action results, or generated values (only when needed, e.g. timestamps)\n"
                "20. Read table configs via dp_file_read to discover available actions and select the\n"
                "    correct ones matching the user's required business flow. Chain them in order.\n"
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
