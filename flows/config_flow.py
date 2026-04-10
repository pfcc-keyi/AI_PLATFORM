"""ConfigFlow V2 -- Scenario A: AI-assisted configuration generation.

Architecture: API-orchestrated Flow with sub-flow dispatch.
  - Flow owns business state and step execution.
  - API routes drive progression between steps.
  - Frontend triggers human input (clarifications, review, deploy).
  - Human gate: all generated code requires approval before deploy.

Flow steps (driven by API):
  1. @start: analyze user requirement (lookup detection, bulk clarification, FK verification)
  2. @router: complete? -> need_more (ask questions) or ready (proceed)
  3. @listen 'ready': dispatch to sub-flow based on operation_type
  4. new_table sub-flow (two-phase):
     a. Phase A (/analyze): extract structured design + read FK context -> return confirm_needed
     b. Phase B (/confirm): user confirms design -> codegen -> DP validation -> review_needed
  5. Other sub-flows: design -> codegen -> DP validation -> build review summary
  6. API /review: record human approval/rejection
  7. API /deploy: explicitly call flow.deploy() to write files + hot-reload
"""

import json
import logging
from typing import Any, Optional

from crewai import Agent
from crewai.flow.flow import Flow, listen, router, start
from pydantic import BaseModel, Field

from config import OPENAI_MODEL
from crews.add_action_crew import AddActionCrew
from crews.codegen_crew import CodeGenCrew
from crews.handler_crew import HandlerCrew
from models.config_models import (
    GeneratedCode,
    HandlerDesign,
    RequirementAnalysis,
    SchemaDesign,
    _FK_ACTION_NORMALIZE,
)
from setup.knowledge_setup import (
    get_docs_knowledge,
    get_handler_knowledge,
    get_schema_knowledge,
    refresh_schema_knowledge,
)
from setup.schema_sync import sync_schema_catalog
from tools.admin import (
    DPFileReadTool,
    DPFileWriteTool,
    DPNameResolveTool,
    DPReloadTool,
    DPSchemaCatalogTool,
    DPValidateHandlerTool,
    DPValidateTableTool,
)

logger = logging.getLogger(__name__)

MAX_VALIDATION_RETRIES = 2


def _to_snake_case(name: str) -> str:
    """Convert PascalCase/camelCase/mixed to snake_case."""
    import re
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name)
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", s)
    s = s.lower().replace(" ", "_").replace("-", "_")
    return re.sub(r"_+", "_", s).strip("_")


def _normalize_design(design: "SchemaDesign") -> "SchemaDesign":
    """Deterministic post-processing: snake_case all identifiers, resolve FK tables, deduplicate transitions."""
    design.table_name = _to_snake_case(design.table_name)
    design.pk_field = _to_snake_case(design.pk_field)

    original_to_snake: dict[str, str] = {}
    for col in design.columns:
        original = col.name
        col.name = _to_snake_case(original)
        if original != col.name:
            original_to_snake[original] = col.name

    for col in design.columns:
        if col.check and original_to_snake:
            for original, snake in original_to_snake.items():
                if original in col.check:
                    col.check = col.check.replace(original, snake)

    resolver = DPNameResolveTool()
    for fk in design.fk_definitions:
        fk.field = _to_snake_case(fk.field)
        fk.references_field = _to_snake_case(fk.references_field)
        try:
            raw = resolver._run(name=fk.references_table, entity_type="table", context_table="")
            result = json.loads(raw)
            if result.get("match") in ("exact", "similar") and result.get("resolved"):
                fk.references_table = result["resolved"]
            else:
                fk.references_table = _to_snake_case(fk.references_table)
        except Exception:
            fk.references_table = _to_snake_case(fk.references_table)

    for fk in design.fk_definitions:
        if fk.on_delete:
            fk.on_delete = _FK_ACTION_NORMALIZE.get(
                fk.on_delete.lower().strip(), fk.on_delete.upper()
            )
        if fk.on_update:
            fk.on_update = _FK_ACTION_NORMALIZE.get(
                fk.on_update.lower().strip(), fk.on_update.upper()
            )

    state_col_found = False
    for col in design.columns:
        if col.name == "state":
            state_col_found = True
            break
    if not state_col_found:
        to_rename = None
        for col in design.columns:
            if col.name.endswith("_state") and col.pg_type.lower() == "text" and not col.nullable:
                to_rename = col
                break
        if to_rename:
            to_rename.name = "state"
        else:
            from models.config_models import ColumnDesign
            design.columns.append(
                ColumnDesign(name="state", pg_type="text", nullable=False)
            )

    for action in design.actions:
        action.name = _to_snake_case(action.name)

    seen = set()
    unique_transitions = []
    for t in design.transitions:
        key = (t.from_state, t.to_state)
        if key not in seen:
            seen.add(key)
            unique_transitions.append(t)
    design.transitions = unique_transitions

    return design


class ConfigState(BaseModel):
    requirement: str = ""
    clarifications: list[dict] = Field(default_factory=list)
    operation_type: str = ""
    sub_flow: str = ""
    phase: str = ""
    handler_name: str = ""
    analysis: Optional[RequirementAnalysis] = None
    design: Optional[SchemaDesign] = None
    handler_design: Optional[HandlerDesign] = None
    fk_context: Optional[str] = None
    generated_code: Optional[GeneratedCode] = None
    validation_result: Optional[dict] = None
    review_summary: Optional[dict] = None
    review_status: str = ""
    review_feedback: str = ""
    deployed: bool = False
    deploy_result: Optional[dict] = None
    operation_history: list[dict] = Field(default_factory=list)


class ConfigFlow(Flow[ConfigState]):
    """Orchestrates the full config generation pipeline with sub-flow dispatch."""

    # ------------------------------------------------------------------
    # Phase 0: Intent Classification
    # ------------------------------------------------------------------

    def _classify_intent(self):
        """Lightweight LLM call to classify the user requirement."""
        from setup.schema_sync import get_schema_catalog_text

        catalog_text = get_schema_catalog_text()
        catalog_section = (
            f"\n\nExisting tables in the Data Platform:\n{catalog_text}"
            if catalog_text else ""
        )

        messages = [
            {
                "role": "system",
                "content": (
                    "You classify user requirements for a Data Platform into exactly one of three categories.\n"
                    "Output a JSON object with two fields:\n"
                    '  "operation_type": one of "new_table", "add_action", "new_handler"\n'
                    '  "handler_name": suggested snake_case name (only when operation_type is "new_handler", else "")\n\n'
                    "Rules:\n"
                    "- new_table: user wants to create a brand-new table (describes columns, structure, new entity)\n"
                    "- add_action: user wants to add new actions/transitions/bulk operations to an EXISTING table\n"
                    "- new_handler: user wants to create a handler that combines actions across one or more EXISTING tables\n\n"
                    "Output ONLY the JSON object, nothing else."
                ),
            },
            {
                "role": "user",
                "content": f"Requirement:\n{self.state.requirement}{catalog_section}",
            },
        ]

        try:
            raw = OPENAI_MODEL.call(messages)
            parsed = json.loads(raw if isinstance(raw, str) else str(raw))
            op = parsed.get("operation_type", "new_table")
            if op not in ("new_table", "add_action", "new_handler"):
                op = "new_table"
            self.state.operation_type = op
            if op == "new_handler":
                self.state.handler_name = parsed.get("handler_name", "")
        except (json.JSONDecodeError, TypeError, AttributeError):
            raw_lower = str(raw).lower() if raw else ""
            if "add_action" in raw_lower:
                self.state.operation_type = "add_action"
            elif "new_handler" in raw_lower:
                self.state.operation_type = "new_handler"
            else:
                self.state.operation_type = "new_table"

        logger.info("Intent classified as: %s", self.state.operation_type)

    # ------------------------------------------------------------------
    # Handler Requirement Analysis
    # ------------------------------------------------------------------

    def _analyze_handler_requirement(self):
        """Run handler-specific analysis agent producing RequirementAnalysis with HandlerDesign."""
        knowledge_sources = []
        docs = get_docs_knowledge()
        schema = get_schema_knowledge()
        handler_k = get_handler_knowledge()
        if docs:
            knowledge_sources.append(docs)
        if schema:
            knowledge_sources.append(schema)
        if handler_k:
            knowledge_sources.append(handler_k)

        architect = Agent(
            role="Data Platform Handler Architect",
            goal=(
                "Analyze the handler requirement: resolve which tables and actions to use, "
                "determine payload shape, ask about missing design decisions, "
                "or produce a complete HandlerDesign"
            ),
            backstory=(
                "You design handlers for the Data Platform. A handler orchestrates actions "
                "across one or more registered tables in a single atomic transaction.\n\n"
                "HANDLER CONVENTIONS:\n"
                "- File: handlers/{name}.py with MODE = 'sync' or 'async'\n"
                "- Entry: async def handle(ctx, payload: dict) -> dict\n"
                "- ctx.{table_name}.{action_name}(data={...}) for mutations\n"
                "- ctx.raw_query(sql, params) for read-only SQL (JOINs, aggregations)\n"
                "- All ctx calls share one BEGIN/COMMIT transaction\n\n"
                "DATE HANDLING:\n"
                "- JSON payloads carry dates as strings\n"
                "- If a column has pg_type='date' or 'timestamp', convert with "
                "date.fromisoformat() before passing to the action\n\n"
                "ERROR HANDLING:\n"
                "- raise HandlerError(message=..., code=..., http_status=...) for business errors\n"
                "- ActionError from table actions is auto-translated\n\n"
                "EXTRACT vs ASK:\n"
                "- User mentioned specific tables/actions → use dp_name_resolve to verify, extract directly\n"
                "- User gave payload fields → extract directly\n"
                "- If user ALREADY ANSWERED in 'Previous clarifications' → extract, do NOT re-ask\n"
                "- Design decisions NOT provided and NOT already answered → set missing_info=true and ASK:\n"
                "  * Which tables and which actions to call (if ambiguous)\n"
                "  * Payload structure: required vs optional fields\n"
                "  * Whether raw_query is needed for reads (JOINs/aggregations)\n"
                "  * Sync or async mode (default sync if not asked)\n"
                "  * Error handling preferences\n\n"
                "DESIGN OUTPUT:\n"
                "- handler_name: snake_case (e.g. create_party, place_order)\n"
                "- mode: 'sync' (default) or 'async'\n"
                "- tables_used: list of registered table names (verify with dp_name_resolve)\n"
                "- steps: ordered list of HandlerStep, each with table_name + action_name "
                "OR is_raw_query=true + raw_query_description\n"
                "- payload_fields: what the caller sends (name, type, required, date_conversion)\n"
                "- error_handling: description of error strategy\n"
                "- return_description: what the handler returns"
            ),
            tools=[DPNameResolveTool(), DPFileReadTool(), DPSchemaCatalogTool()],
            knowledge_sources=knowledge_sources,
            llm=OPENAI_MODEL,
            memory=None,
            verbose=True,
        )

        prompt = f"Requirement:\n{self.state.requirement}\n\n"
        if self.state.clarifications:
            answers = "\n".join(
                f"Q: {c.get('question', '')} A: {c.get('answer', '')}"
                for c in self.state.clarifications
            )
            prompt += f"Previous clarifications:\n{answers}\n\n"

        prompt += (
            "Produce a RequirementAnalysis with operation_type='new_handler'.\n\n"
            "STEP 1 — EXTRACT what user provided:\n"
            "  - Handler name (or derive from the purpose)\n"
            "  - Tables and actions mentioned → use dp_name_resolve to verify they exist\n"
            "  - Use dp_file_read to read table configs for column/action details\n"
            "  - Payload fields the user described\n"
            "  - Any date fields that need conversion\n\n"
            "STEP 2 — CHECK what is MISSING:\n"
            "  Check 'Previous clarifications' first. Do NOT re-ask answered questions.\n"
            "  If ANY of these are still unclear:\n"
            "  - Which tables and actions to use (if user was vague)\n"
            "  - Payload structure: required fields, optional fields, data types\n"
            "  - Whether any read queries (raw_query / list / get_by_pk) are needed\n"
            "  - Sync or async mode\n"
            "  → Set missing_info=true, list questions, handler_design=null. STOP.\n\n"
            "STEP 3 — When ALL decisions are available, produce handler_design:\n"
            "  - handler_name: snake_case\n"
            "  - mode: 'sync' unless user specified async\n"
            "  - description: one-line summary of what the handler does\n"
            "  - tables_used: verified table names\n"
            "  - payload_fields: each with name, field_type, required, date_conversion\n"
            "  - steps: ordered list (step_number, description, table_name, action_name, "
            "is_raw_query, raw_query_description, input_mapping, output_key)\n"
            "  - error_handling: describe validation and error strategy\n"
            "  - return_description: what the response contains\n\n"
            "CRITICAL: handler_design MUST be populated when missing_info=false. "
            "handler_design MUST be null when missing_info=true. "
            "design (SchemaDesign) should always be null for handlers."
        )

        result = architect.kickoff(prompt, response_format=RequirementAnalysis)
        if result.pydantic:
            self.state.analysis = result.pydantic
            if result.pydantic.handler_design:
                self.state.handler_name = result.pydantic.handler_design.handler_name
        return self.state.analysis

    # ------------------------------------------------------------------
    # Phase 1: Requirement Analysis
    # ------------------------------------------------------------------

    @start()
    def analyze_requirement(self):
        if not self.state.operation_type:
            self._classify_intent()

        if self.state.operation_type == "new_handler":
            return self._analyze_handler_requirement()

        if self.state.operation_type not in ("new_table",):
            return

        knowledge_sources = []
        schema = get_schema_knowledge()
        if schema:
            knowledge_sources.append(schema)

        architect = Agent(
            role="Data Platform Schema Architect",
            goal="Analyze the requirement: extract what's given, ask about missing design decisions, or produce a complete SchemaDesign",
            backstory=(
                "You produce SchemaDesign objects for the Data Platform's TableConfig system.\n"
                "A TableConfig has 8 elements: table_name, pk, states, transitions, columns, fk_definitions, actions, table_constraints.\n\n"
                "PLATFORM RULES (absolute, never violate):\n"
                "1. 'init' and 'deleted' are VIRTUAL states — NEVER put them in the states list.\n"
                "   states list = only REAL states stored in DB (e.g. ['active','disabled']).\n"
                "2. function_type MUST be one of: insert, update, delete, bulk_insert, bulk_update, bulk_delete.\n"
                "   NO other values ever (no 'state_transition', no 'upsert', no 'transition').\n"
                "3. insert/bulk_insert: from_state MUST be 'init'\n"
                "4. update/bulk_update: from_state CANNOT be 'init', to_state CANNOT be 'deleted'\n"
                "5. delete/bulk_delete: to_state MUST be 'deleted'\n"
                "6. Exactly ONE single action per transition. Bulk actions added separately only if user requests.\n\n"
                "NAMING RULE: ALL identifiers in the design MUST be snake_case.\n"
                "  Convert user input: PartyContact→party_contact, ContactId→contact_id, PartyId→party_id, "
                "Name→name, ContractType→contract_type.\n"
                "  FK references_table MUST match the registered table name (always snake_case, e.g. 'party' not 'Party').\n\n"
                "STATE COLUMN (absolute — never ask about this):\n"
                "- Every table MUST have exactly one column named 'state' (pg_type='text', nullable=false).\n"
                "- The name is ALWAYS 'state' — NEVER '{table_name}_state', NEVER 'status', NEVER anything else.\n"
                "- This is a platform constant. NEVER include it in questions. NEVER ask the user about the state column.\n\n"
                "FK on_delete / on_update VALUES:\n"
                "- MUST be PostgreSQL keywords WITH SPACES: 'CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'NO ACTION'.\n"
                "- NEVER use underscores: 'NO_ACTION' is WRONG → 'NO ACTION' is CORRECT.\n\n"
                "EXTRACT vs ASK:\n"
                "- User PROVIDED (columns, types, FK target, PK field, any explicitly mentioned constraints) → extract directly, never re-ask.\n"
                "- User MENTIONED a validation rule → apply as PostgreSQL check= constraint in ColumnDef.\n"
                "  Examples: 'name > 2 chars' → check='char_length(name) > 2', 'amount >= 0' → check='amount >= 0'\n"
                "- User MENTIONED cross-column constraints → use table_constraints (e.g. "
                "'start_date <= end_date' or 'approver_a <> approver_b').\n"
                "  For nullable fields prefer safe SQL patterns like "
                "'start_date IS NULL OR end_date IS NULL OR start_date <= end_date'.\n"
                "- User did NOT mention constraints for a column → leave check=None, default_expr=None, unique=False.\n"
                "- If user ALREADY ANSWERED in 'Previous clarifications' → extract the answer, do NOT re-ask.\n"
                "- Design decisions NOT provided AND NOT already answered → set missing_info=true and ASK:\n"
                "  * State transitions: ask user to specify transitions (e.g. init->active, active->disabled, disabled->deleted)\n"
                "  * PK strategy: uuid4 / sequence / custom\n"
                "  * Bulk operations: which bulk ops needed? (bulk_insert, bulk_update, bulk_delete) or none\n\n"
                "PK CONSTRAINT RULE:\n"
                "- PK fields already imply NOT NULL + UNIQUE. NEVER add NOT NULL or UNIQUE as constraints on a PK column.\n\n"
                "NAME RESOLUTION:\n"
                "- new_table: do NOT resolve the new table name via dp_name_resolve. ONLY resolve FK target tables.\n"
                "- Lookup tables (simple code+name pattern): is_lookup=true, states=['active','disabled'], include bulk_insert."
            ),
            tools=[DPNameResolveTool()],
            knowledge_sources=knowledge_sources,
            llm=OPENAI_MODEL,
            memory=None,
            verbose=True,
        )

        prompt = f"Requirement:\n{self.state.requirement}\n\n"
        if self.state.clarifications:
            answers = "\n".join(
                f"Q: {c.get('question', '')} A: {c.get('answer', '')}"
                for c in self.state.clarifications
            )
            prompt += f"Previous clarifications:\n{answers}\n\n"

        prompt += (
            "Produce a RequirementAnalysis following these steps:\n\n"
            "STEP 1 — EXTRACT what user provided:\n"
            "  - Table name, columns, types, FK target table, PK field\n"
            "  - Any validation rules user explicitly mentioned → apply as PostgreSQL check= in ColumnDef\n"
            "    Example: 'name > 2 chars' → check='char_length(name) > 2' (NOT <= 2!)\n"
            "  - Any cross-column invariants user explicitly mentioned → put them in table_constraints\n"
            "    Example: start_date <= end_date → "
            "'start_date IS NULL OR end_date IS NULL OR start_date <= end_date'\n"
            "  - FK target: if user says 'FK from party table' → references_table='party'. "
            "Use dp_name_resolve ONLY for FK target tables to verify they exist.\n\n"
            "STEP 2 — CHECK what design decisions are MISSING:\n"
            "  First, check 'Previous clarifications' above. If a question was already answered there, "
            "extract the answer — do NOT re-ask.\n"
            "  If ANY of these are STILL not answered (not in requirement AND not in clarifications):\n"
            "  - State transitions not specified → ASK: 'What state transitions should this table have? "
            "Example: init->active, active->active, active->disabled, disabled->deleted'\n"
            "  - PK strategy not specified → ASK: 'PK generation: uuid4 (auto), sequence (auto-increment), or custom?'\n"
            "  - Bulk operations not specified → ASK: 'Do you need bulk operations? (bulk_insert, bulk_update, bulk_delete, or none)'\n"
            "  NEVER ask about the state column — it is always named 'state' (text, not null).\n"
            "  → Set missing_info=true, list questions, design=null. STOP here.\n\n"
            "STEP 3 — When ALL design decisions are available, produce the design:\n"
            "  NAMING RULE: ALL identifiers MUST be snake_case — table_name, pk_field, column names, "
            "FK field/references_table/references_field, action names. "
            "Convert user input: PartyContact→party_contact, ContactId→contact_id, PartyId→party_id, "
            "Name→name, ContractType→contract_type, etc.\n"
            "  Follow these sub-steps EXACTLY:\n\n"
            "  A) table_name: snake_case\n"
            "  B) pk_field (snake_case), pk_strategy, pk_generator_description\n"
            "  C) transitions: use EXACTLY the transitions the user specified. Do NOT add extra ones.\n"
            "  D) states: collect all unique states from transitions, REMOVE 'init' and 'deleted'.\n"
            "     Example: transitions=[init->active, active->disabled, disabled->deleted] → states=['active','disabled']\n"
            "  E) columns (ALL column names in snake_case):\n"
            "     - All user-specified columns with their types (default 'text')\n"
            "     - PK column: nullable=false\n"
            "     - FK columns: nullable=false\n"
            "     - Key fields (name, code): nullable=false\n"
            "     - Descriptive/optional fields: nullable=true\n"
            "     - 'state' column: name MUST be exactly 'state' (NEVER '{table}_state'), pg_type='text', nullable=false\n"
            "     - User mentioned a rule → check='...' (e.g. 'name > 2' → check='char_length(name) > 2')\n"
            "     - User did NOT mention → check=None\n"
            "  F) fk_definitions: field (snake_case), references_table (must match registered name from dp_name_resolve, "
            "always snake_case e.g. 'party' not 'Party'), references_field (snake_case).\n"
            "     on_delete/on_update: use PostgreSQL keywords WITH SPACES — 'NO ACTION' not 'NO_ACTION'\n"
            "  G) actions: create EXACTLY one action per transition:\n"
            "     - from_state='init' → function_type='insert'\n"
            "     - to_state='deleted' → function_type='delete'\n"
            "     - otherwise → function_type='update'\n"
            "     Naming: create_{table}_{to_state} (insert), {table}_update (update self-loop),\n"
            "     activate_{table} (→active), disable_{table} (→disabled), delete_{table} (delete)\n"
            "     Then add bulk actions ONLY for transitions the user requested bulk ops on:\n"
            "     - bulk_insert: bulk_create_{table}\n"
            "     - bulk_update: same transition as its single counterpart\n"
            "     - bulk_delete: bulk_delete_{table}\n\n"
            "  H) table_constraints: list SQL boolean expressions ONLY for cross-column constraints.\n"
            "     - Single-column rules belong in ColumnDef.check\n"
            "     - Preserve user intent exactly; do NOT invent extra constraints\n"
            "     - For nullable columns, prefer safe patterns with IS NULL OR ...\n"
            "     - Leave empty only when no cross-column constraints were requested\n\n"
            "CRITICAL: design MUST be populated when missing_info=false. design MUST be null when missing_info=true."
        )

        result = architect.kickoff(prompt, response_format=RequirementAnalysis)
        if result.pydantic:
            self.state.analysis = result.pydantic
        return self.state.analysis

    # ------------------------------------------------------------------
    # Phase 2: Router
    # ------------------------------------------------------------------

    @router(analyze_requirement)
    def check_completeness(self):
        if self.state.operation_type == "add_action":
            return "ready"
        if self.state.analysis and self.state.analysis.missing_info:
            return "need_more"
        return "ready"

    @listen("need_more")
    def return_questions(self):
        return {
            "status": "need_clarification",
            "questions": self.state.analysis.questions if self.state.analysis else [],
            "summary": self.state.analysis.summary if self.state.analysis else "",
        }

    # ------------------------------------------------------------------
    # Phase 3: Sub-flow Dispatch
    # ------------------------------------------------------------------

    @listen("ready")
    def dispatch_sub_flow(self):
        op = self.state.operation_type
        if op == "new_table":
            self.state.sub_flow = "new_table"
            return self._analyze_new_table()
        elif op in ("add_action", "new_action", "update_table"):
            self.state.sub_flow = "add_action"
            return self._run_add_action()
        elif op == "new_handler":
            self.state.sub_flow = "new_handler"
            return self._run_new_handler()
        return {"error": f"Unknown operation_type: {op}"}

    # ------------------------------------------------------------------
    # Sub-flow: New Table -- Phase A (analysis only, stops for confirmation)
    # ------------------------------------------------------------------

    def _analyze_new_table(self):
        """Phase A: read FK context, use design from analysis agent, return for user confirmation."""
        fk_context = self._read_fk_tables()
        self.state.fk_context = fk_context

        design = self.state.analysis.design if self.state.analysis else None

        if not design:
            logger.info("Analysis had no design, attempting focused design generation")
            design = self._generate_design_fallback()

        if not design:
            self.state.phase = "error"
            return {
                "error": "Could not produce a design. Please re-submit your requirement.",
            }

        self.state.design = _normalize_design(design)
        self.state.review_summary = self._build_review_summary()
        self.state.phase = "confirm_needed"
        return {
            "status": "confirm_needed",
            "review_summary": self.state.review_summary,
        }

    def _generate_design_fallback(self) -> SchemaDesign | None:
        """Fallback: produce SchemaDesign directly when analysis agent didn't embed it."""
        if not self.state.analysis:
            return None

        builder = Agent(
            role="Schema Design Builder",
            goal="Produce a complete SchemaDesign from the analyzed requirement",
            backstory=(
                "Build a SchemaDesign for the Data Platform.\n\n"
                "PLATFORM RULES:\n"
                "1. 'init'/'deleted' are VIRTUAL — NEVER in states list\n"
                "2. function_type: insert, update, delete, bulk_insert, bulk_update, bulk_delete ONLY\n"
                "3. insert/bulk_insert: from_state='init'\n"
                "4. update/bulk_update: from_state≠'init', to_state≠'deleted'\n"
                "5. delete/bulk_delete: to_state='deleted'\n"
                "6. ONE action per transition. Bulk actions only if user requested.\n"
                "7. states = unique real states from transitions (exclude init/deleted)\n"
                "8. Do NOT invent check/default_expr/unique/table_constraints unless user explicitly asked\n"
                "9. If user says 'name > 2 chars' → check='char_length(name) > 2' (greater than, NOT less than)\n"
                "10. Use table_constraints only for cross-column invariants; keep empty if none were requested\n"
                "11. PK fields already imply NOT NULL + UNIQUE — NEVER add these as constraints on a PK column"
            ),
            tools=[],
            llm=OPENAI_MODEL,
            memory=None,
            verbose=True,
        )

        prompt = f"Original requirement:\n{self.state.requirement}\n\n"
        prompt += f"Analysis summary:\n{self.state.analysis.summary}\n\n"
        if self.state.clarifications:
            answers = "\n".join(
                f"Q: {c.get('question', '')} A: {c.get('answer', '')}"
                for c in self.state.clarifications
            )
            prompt += f"User clarifications:\n{answers}\n\n"
        prompt += (
            "Produce a complete SchemaDesign.\n"
            "ALL identifiers MUST be snake_case: table_name, pk_field, column names, "
            "FK field/references_table/references_field, action names. "
            "Example: PartyContact→party_contact, ContactId→contact_id, Party→party.\n"
            "Use transitions EXACTLY as user specified. Derive states by removing init/deleted.\n"
            "ONE action per transition with correct function_type. Bulk actions only if requested."
        )

        result = builder.kickoff(prompt, response_format=SchemaDesign)
        if result.pydantic and isinstance(result.pydantic, SchemaDesign):
            return result.pydantic
        return None

    # ------------------------------------------------------------------
    # Sub-flow: New Table -- Phase B (after user confirmation)
    # ------------------------------------------------------------------

    def confirm_and_generate(self):
        """Phase B: run codegen + validation on the confirmed design."""
        if self.state.sub_flow == "add_action":
            return self._run_add_action()
        if self.state.sub_flow == "new_handler":
            return self._generate_handler_code()

        if not self.state.design:
            return {"error": "No design to generate code from"}

        code_content = self._run_codegen_crew(
            file_type="table", table_context=self.state.fk_context
        )
        if not code_content:
            return {"error": "Code generation failed"}

        validation = self._validate_code(code_content, "table")
        if not validation:
            self.state.phase = "review_needed"
            return self._build_validation_failure_response()

        self.state.phase = "review_needed"
        return self._build_review_response()

    def revise_design(self, feedback: str) -> dict[str, Any]:
        """Use LLM to revise the current design based on natural language feedback."""
        if self.state.sub_flow == "new_handler":
            return self._revise_handler_design(feedback)

        if not self.state.design:
            return {"error": "No design to revise"}

        current_json = self.state.design.model_dump_json(indent=2)

        reviser = Agent(
            role="Schema Design Reviser",
            goal="Apply user feedback to revise a SchemaDesign while maintaining internal consistency",
            backstory=(
                "You revise SchemaDesign objects based on user feedback.\n\n"
                "PLATFORM RULES (absolute):\n"
                "1. 'init' and 'deleted' are VIRTUAL — NEVER in states list\n"
                "2. function_type ∈ {insert, update, delete, bulk_insert, bulk_update, bulk_delete} ONLY\n"
                "3. insert/bulk_insert: from_state='init'\n"
                "4. update/bulk_update: from_state≠'init', to_state≠'deleted'\n"
                "5. delete/bulk_delete: to_state='deleted'\n"
                "6. Exactly ONE action per transition. Bulk actions separate.\n\n"
                "CONSISTENCY RULES:\n"
                "- If a state is removed: remove ALL transitions and actions referencing it\n"
                "- If a transition is removed: remove the action for that transition\n"
                "- If a transition is added: add exactly one action with correct function_type\n"
                "- states list = unique real states from transitions (exclude init/deleted)\n"
                "- NEVER add check, default_expr, unique, or table_constraints unless user explicitly requests\n"
                "- PK fields already imply NOT NULL + UNIQUE — NEVER add these as constraints on a PK column\n"
                "- Only change what user asks; keep everything else identical"
            ),
            tools=[],
            llm=OPENAI_MODEL,
            memory=None,
            verbose=True,
        )

        prompt = (
            f"Current design:\n{current_json}\n\n"
            f"User feedback:\n{feedback}\n\n"
            "Output the revised SchemaDesign. Follow these rules:\n"
            "0. ALL identifiers MUST be snake_case: table_name, pk_field, column names, FK fields, action names\n"
            "1. Apply ONLY the changes user requested\n"
            "2. After changes, verify: states = unique real states from transitions (no init/deleted)\n"
            "3. Every transition must have exactly one action with correct function_type:\n"
            "   from_state='init' → insert, to_state='deleted' → delete, else → update\n"
            "4. Do NOT add check/default_expr/unique/table_constraints unless user explicitly asks\n"
            "5. For constraints: single-column rules in ColumnDef.check; table_constraints only for cross-column rules"
        )

        result = reviser.kickoff(prompt, response_format=SchemaDesign)
        if result.pydantic and isinstance(result.pydantic, SchemaDesign):
            self.state.design = _normalize_design(result.pydantic)

        self.state.review_summary = self._build_review_summary()
        return {
            "status": "confirm_needed",
            "review_summary": self.state.review_summary,
        }

    def revise_and_generate(self, feedback: str) -> dict[str, Any]:
        """Revise design with feedback, then run codegen + validation."""
        revise_result = self.revise_design(feedback)
        if "error" in revise_result:
            return revise_result
        return self.confirm_and_generate()

    def revise_code(self, feedback: str) -> dict[str, Any]:
        """Re-run codegen with user feedback about the generated code."""
        if self.state.sub_flow == "new_handler":
            return self._revise_handler_code(feedback)

        if not self.state.design:
            return {"error": "No design available for code regeneration"}

        file_type = "table"

        augmented_requirement = (
            f"{self.state.requirement}\n\n"
            f"USER FEEDBACK ON GENERATED CODE — apply these changes:\n{feedback}"
        )
        original_req = self.state.requirement
        self.state.requirement = augmented_requirement

        code_content = self._run_codegen_crew(
            file_type=file_type, table_context=self.state.fk_context
        )
        self.state.requirement = original_req

        if not code_content:
            return {"error": "Code regeneration failed"}

        validation = self._validate_code(code_content, file_type)
        if not validation:
            self.state.phase = "review_needed"
            return self._build_validation_failure_response()

        self.state.phase = "review_needed"
        return self._build_review_response()

    def _revise_handler_design(self, feedback: str) -> dict[str, Any]:
        """Revise the HandlerDesign based on user feedback."""
        hd = self.state.handler_design
        if not hd:
            return {"error": "No handler design to revise"}

        current_json = hd.model_dump_json(indent=2)

        reviser = Agent(
            role="Handler Design Reviser",
            goal="Apply user feedback to revise a HandlerDesign",
            backstory=(
                "You revise HandlerDesign objects based on user feedback.\n\n"
                "RULES:\n"
                "- Only change what user asks; keep everything else identical\n"
                "- handler_name must be snake_case\n"
                "- mode must be 'sync' or 'async'\n"
                "- steps must have correct step_numbers (sequential from 1)\n"
                "- table_name and action_name must reference real registered tables/actions\n"
                "- If adding a raw_query step, set is_raw_query=true and provide raw_query_description\n"
                "- If removing a step, renumber remaining steps\n"
                "- Update tables_used to match the tables referenced in steps"
            ),
            tools=[DPNameResolveTool()],
            llm=OPENAI_MODEL,
            memory=None,
            verbose=True,
        )

        prompt = (
            f"Current handler design:\n{current_json}\n\n"
            f"User feedback:\n{feedback}\n\n"
            "Output the revised HandlerDesign. Apply ONLY the requested changes."
        )

        result = reviser.kickoff(prompt, response_format=HandlerDesign)
        if result.pydantic and isinstance(result.pydantic, HandlerDesign):
            self.state.handler_design = result.pydantic
            self.state.handler_name = result.pydantic.handler_name

        self.state.review_summary = self._build_handler_design_summary()
        return {
            "status": "confirm_needed",
            "review_summary": self.state.review_summary,
        }

    def _revise_handler_code(self, feedback: str) -> dict[str, Any]:
        """Re-run HandlerCrew with user feedback for handler code revision."""
        augmented_req = (
            f"{self.state.requirement}\n\n"
            f"USER FEEDBACK ON GENERATED CODE — apply these changes:\n{feedback}"
        )

        crew = HandlerCrew().crew(
            requirement=augmented_req,
            table_contexts=self.state.fk_context or "",
            handler_name=self.state.handler_name,
            handler_design=self.state.handler_design,
        )
        result = crew.kickoff()
        code_content = result.raw
        if not code_content:
            return {"error": "Handler code regeneration failed"}

        if self.state.generated_code:
            self.state.generated_code.content = code_content

        validation = self._validate_code(code_content, "handler")
        if not validation:
            self.state.phase = "review_needed"
            return self._build_validation_failure_response()

        self.state.phase = "review_needed"
        self.state.review_summary = self._build_handler_design_summary()
        code = self.state.generated_code
        return {
            "status": "review_needed",
            "review_summary": self.state.review_summary,
            "filename": code.filename if code else "",
            "file_type": code.file_type if code else "",
            "validation": self.state.validation_result,
        }

    # ------------------------------------------------------------------
    # Sub-flow: New Handler -- Phase B (after user confirmation)
    # ------------------------------------------------------------------

    def _generate_handler_code(self) -> dict[str, Any]:
        """Phase B: generate handler code from confirmed HandlerDesign."""
        hd = self.state.handler_design
        if not hd:
            return {"error": "No handler design to generate code from"}

        handler_name = hd.handler_name
        table_contexts = self.state.fk_context or ""

        crew = HandlerCrew().crew(
            requirement=self.state.requirement,
            table_contexts=table_contexts,
            handler_name=handler_name,
            handler_design=hd,
        )
        result = crew.kickoff()

        code_content = result.raw
        if not code_content:
            return {"error": "Handler code generation failed"}

        self.state.generated_code = GeneratedCode(
            filename=f"{handler_name}.py",
            file_type="handler",
            content=code_content,
        )

        validation = self._validate_code(code_content, "handler")
        if not validation:
            self.state.phase = "review_needed"
            return self._build_validation_failure_response()

        self.state.phase = "review_needed"
        self.state.review_summary = self._build_handler_design_summary()
        code = self.state.generated_code
        return {
            "status": "review_needed",
            "review_summary": self.state.review_summary,
            "filename": code.filename if code else "",
            "file_type": code.file_type if code else "",
            "validation": self.state.validation_result,
        }

    # ------------------------------------------------------------------
    # Sub-flow: Add Action to Existing Table
    # ------------------------------------------------------------------

    def _run_add_action(self):
        table_name, table_code = self._resolve_target_table()
        if not table_code:
            return {"error": f"Could not read table '{table_name}' from Data Platform."}

        self.state.fk_context = table_code

        crew = AddActionCrew().crew(
            requirement=self.state.requirement,
            existing_table_code=table_code,
        )
        result = crew.kickoff()
        if result.pydantic and isinstance(result.pydantic, SchemaDesign):
            self.state.design = _normalize_design(result.pydantic)
        if not self.state.design:
            return {"error": "Failed to produce modified table design"}

        code_content = self._run_codegen_crew(
            file_type="table", table_context=table_code
        )
        if not code_content:
            return {"error": "Code generation failed"}

        validation = self._validate_code(code_content, "table")
        if not validation:
            self.state.phase = "review_needed"
            return self._build_validation_failure_response()

        self.state.phase = "review_needed"
        return self._build_review_response()

    # ------------------------------------------------------------------
    # Sub-flow: New Handler -- Phase A (design, stops for confirmation)
    # ------------------------------------------------------------------

    def _run_new_handler(self):
        """Phase A: resolve tables, extract handler design, return for user confirmation."""
        table_contexts = self._resolve_mentioned_tables()
        self.state.fk_context = table_contexts or ""

        hd = self.state.analysis.handler_design if self.state.analysis else None

        if not hd:
            logger.info("Analysis had no handler_design, attempting fallback generation")
            hd = self._generate_handler_design_fallback()

        if not hd:
            self.state.phase = "error"
            return {
                "error": "Could not produce a handler design. Please re-submit your requirement.",
            }

        self.state.handler_design = hd
        self.state.handler_name = hd.handler_name
        self.state.review_summary = self._build_handler_design_summary()
        self.state.phase = "confirm_needed"
        return {
            "status": "confirm_needed",
            "review_summary": self.state.review_summary,
        }

    def _generate_handler_design_fallback(self) -> HandlerDesign | None:
        """Fallback: produce HandlerDesign when analysis agent didn't embed it."""
        if not self.state.analysis:
            return None

        knowledge_sources = []
        docs = get_docs_knowledge()
        handler_k = get_handler_knowledge()
        if docs:
            knowledge_sources.append(docs)
        if handler_k:
            knowledge_sources.append(handler_k)

        builder = Agent(
            role="Handler Design Builder",
            goal="Produce a complete HandlerDesign from the analyzed requirement",
            backstory=(
                "Build a HandlerDesign for the Data Platform.\n\n"
                "RULES:\n"
                "- handler_name: snake_case\n"
                "- mode: 'sync' (default) or 'async'\n"
                "- tables_used: list of registered table names\n"
                "- steps: ordered list with table_name + action_name or raw_query\n"
                "- payload_fields: name, field_type, required, date_conversion\n"
                "- error_handling: describe validation strategy\n"
                "- return_description: what the handler returns"
            ),
            tools=[DPNameResolveTool(), DPFileReadTool(), DPSchemaCatalogTool()],
            llm=OPENAI_MODEL,
            knowledge_sources=knowledge_sources,
            memory=None,
            verbose=True,
        )

        prompt = f"Original requirement:\n{self.state.requirement}\n\n"
        prompt += f"Analysis summary:\n{self.state.analysis.summary}\n\n"
        if self.state.clarifications:
            answers = "\n".join(
                f"Q: {c.get('question', '')} A: {c.get('answer', '')}"
                for c in self.state.clarifications
            )
            prompt += f"User clarifications:\n{answers}\n\n"
        prompt += "Produce a complete HandlerDesign with all fields populated."

        result = builder.kickoff(prompt, response_format=HandlerDesign)
        if result.pydantic and isinstance(result.pydantic, HandlerDesign):
            return result.pydantic
        return None

    # ------------------------------------------------------------------
    # Shared: CodeGen Crew
    # ------------------------------------------------------------------

    def _run_codegen_crew(
        self, file_type: str, table_context: str | None = None
    ) -> str | None:
        if not self.state.design:
            return None

        crew = CodeGenCrew().crew(
            design=self.state.design,
            requirement=self.state.requirement,
            file_type=file_type,
            table_context=table_context,
        )
        result = crew.kickoff()

        table_name = self.state.design.table_name
        filename = f"{table_name}.py"

        self.state.generated_code = GeneratedCode(
            filename=filename,
            file_type=file_type,
            content=result.raw,
        )
        return result.raw

    # ------------------------------------------------------------------
    # Shared: Validation via Data Platform
    # ------------------------------------------------------------------

    def _validate_code(self, code_content: str, file_type: str) -> bool:
        validate_tool = (
            DPValidateTableTool() if file_type == "table" else DPValidateHandlerTool()
        )

        for attempt in range(1 + MAX_VALIDATION_RETRIES):
            try:
                raw = validate_tool._run(content=code_content)
            except Exception as exc:
                self.state.validation_result = {
                    "valid": False,
                    "errors": [{"code": "CONNECTION_ERROR", "message": f"Data Platform unreachable: {exc}"}],
                }
                return False
            try:
                result = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                result = {"valid": False, "errors": [{"code": "PARSE_ERROR", "message": raw}]}

            self.state.validation_result = result

            if result.get("valid"):
                return True

            can_retry = attempt < MAX_VALIDATION_RETRIES and (
                self.state.design or self.state.handler_design
            )
            if can_retry:
                error_feedback = "\n".join(
                    f"- [{e.get('code', '?')}] {e.get('message', '')}"
                    for e in result.get("errors", [])
                )
                logger.info("Validation attempt %d failed, retrying codegen", attempt + 1)
                try:
                    if file_type == "handler" and self.state.handler_design:
                        retry_crew = HandlerCrew().crew(
                            requirement=(
                                f"{self.state.requirement}\n\n"
                                f"PREVIOUS CODE HAD VALIDATION ERRORS - FIX THESE:\n{error_feedback}"
                            ),
                            table_contexts=self.state.fk_context or "",
                            handler_name=self.state.handler_name,
                            handler_design=self.state.handler_design,
                        )
                    else:
                        retry_crew = CodeGenCrew().crew(
                            design=self.state.design,
                            requirement=(
                                f"{self.state.requirement}\n\n"
                                f"PREVIOUS CODE HAD VALIDATION ERRORS - FIX THESE:\n{error_feedback}"
                            ),
                            file_type=file_type,
                        )
                    retry_result = retry_crew.kickoff()
                    code_content = retry_result.raw
                    if self.state.generated_code:
                        self.state.generated_code.content = code_content
                except Exception as exc:
                    logger.warning("Codegen retry %d failed: %s", attempt + 1, exc)
                    self.state.validation_result = {
                        "valid": False,
                        "errors": [
                            *result.get("errors", []),
                            {"code": "CODEGEN_RETRY_ERROR", "message": f"Code regeneration failed: {exc}"},
                        ],
                    }
                    return False

        return False

    # ------------------------------------------------------------------
    # Shared: Read table configs from Data Platform
    # ------------------------------------------------------------------

    def _read_fk_tables(self) -> str | None:
        """Read FK-referenced table configs. Uses requirement text + analysis to find table names."""
        from setup.schema_sync import get_schema_catalog

        catalog = get_schema_catalog()
        if not catalog:
            return None

        known_tables = set(catalog.get("tables", {}).keys())
        reader = DPFileReadTool()
        contexts = []

        requirement_lower = self.state.requirement.lower().replace("-", "_").replace(" ", "_")
        for tname in known_tables:
            if tname in requirement_lower:
                try:
                    content = reader._run(category="tables", filename=f"{tname}.py")
                    contexts.append(f"# --- {tname}.py ---\n{content}")
                except Exception:
                    logger.warning("Could not read table file for %s", tname)

        return "\n\n".join(contexts) if contexts else None

    def _resolve_target_table(self) -> tuple[str, str | None]:
        """Find the single target table for add_action and read its code."""
        from setup.schema_sync import get_schema_catalog

        catalog = get_schema_catalog()
        if not catalog:
            return ("", None)

        known_tables = set(catalog.get("tables", {}).keys())
        req_lower = self.state.requirement.lower().replace("-", "_").replace(" ", "_")

        best_match = ""
        for tname in sorted(known_tables, key=len, reverse=True):
            if tname in req_lower:
                best_match = tname
                break

        if not best_match:
            resolver = DPNameResolveTool()
            for word in self.state.requirement.split():
                normalized = _to_snake_case(word)
                if len(normalized) < 3:
                    continue
                try:
                    raw = resolver._run(name=normalized, entity_type="table", context_table="")
                    result = json.loads(raw)
                    if result.get("match") in ("exact", "similar") and result.get("resolved"):
                        best_match = result["resolved"]
                        break
                except Exception:
                    continue

        if not best_match:
            return ("", None)

        try:
            reader = DPFileReadTool()
            code = reader._run(category="tables", filename=f"{best_match}.py")
            return (best_match, code)
        except Exception:
            logger.warning("Could not read table file for %s", best_match)
            return (best_match, None)

    def _resolve_mentioned_tables(self) -> str | None:
        """Find all table names mentioned in the requirement and read their configs."""
        from setup.schema_sync import get_schema_catalog

        catalog = get_schema_catalog()
        if not catalog:
            return None

        known_tables = set(catalog.get("tables", {}).keys())
        reader = DPFileReadTool()
        contexts = []

        req_lower = self.state.requirement.lower().replace("-", "_").replace(" ", "_")
        for tname in known_tables:
            if tname in req_lower:
                try:
                    content = reader._run(category="tables", filename=f"{tname}.py")
                    contexts.append(f"# --- {tname}.py ---\n{content}")
                except Exception:
                    logger.warning("Could not read table file for %s", tname)

        if not contexts:
            resolver = DPNameResolveTool()
            for word in self.state.requirement.split():
                normalized = _to_snake_case(word)
                if len(normalized) < 3:
                    continue
                try:
                    raw = resolver._run(name=normalized, entity_type="table", context_table="")
                    result = json.loads(raw)
                    if result.get("match") in ("exact", "similar") and result.get("resolved"):
                        tname = result["resolved"]
                        content = reader._run(category="tables", filename=f"{tname}.py")
                        contexts.append(f"# --- {tname}.py ---\n{content}")
                except Exception:
                    continue

        return "\n\n".join(contexts) if contexts else None

    # ------------------------------------------------------------------
    # Shared: Build review summary from SchemaDesign
    # ------------------------------------------------------------------

    def _build_review_summary(self) -> dict[str, Any]:
        design = self.state.design
        if not design:
            return {}
        return {
            "table_name": design.table_name,
            "table_category": design.table_category,
            "pk_field": design.pk_field,
            "pk_strategy": design.pk_strategy,
            "pk_generator_description": design.pk_generator_description,
            "states": design.states,
            "transitions": [
                {"from": t.from_state, "to": t.to_state}
                for t in design.transitions
            ],
            "columns": [
                {
                    "name": c.name,
                    "type": c.pg_type,
                    "nullable": c.nullable,
                    "check": c.check,
                    "default_expr": c.default_expr,
                    "unique": c.unique,
                }
                for c in design.columns
            ],
            "actions": [
                {
                    "name": a.name,
                    "type": a.function_type,
                    "transition": f"{a.transition.from_state} -> {a.transition.to_state}",
                }
                for a in design.actions
            ],
            "fk_definitions": [
                {
                    "field": fk.field,
                    "references_table": fk.references_table,
                    "references_field": fk.references_field,
                }
                for fk in design.fk_definitions
            ],
            "table_constraints": design.table_constraints,
        }

    def _build_handler_design_summary(self) -> dict[str, Any]:
        """Build a frontend-compatible review_summary from HandlerDesign."""
        hd = self.state.handler_design
        if not hd:
            return {
                "table_name": self.state.handler_name or "handler",
                "table_category": "handler",
                "pk_field": "sync", "pk_strategy": "sync",
                "pk_generator_description": "",
                "states": [], "transitions": [],
                "columns": [], "actions": [], "fk_definitions": [], "table_constraints": [],
            }

        return {
            "table_name": hd.handler_name,
            "table_category": "handler",
            "pk_field": hd.mode,
            "pk_strategy": hd.mode,
            "pk_generator_description": hd.description,
            "states": [],
            "transitions": [],
            "columns": [
                {
                    "name": f.name,
                    "type": f.field_type,
                    "nullable": not f.required,
                    "check": "date conversion" if f.date_conversion else None,
                    "default_expr": None,
                    "unique": False,
                }
                for f in hd.payload_fields
            ],
            "actions": [
                {
                    "name": f"Step {s.step_number}: {s.description}",
                    "type": (
                        f"ctx.{s.table_name}.{s.action_name}"
                        if not s.is_raw_query
                        else "raw_query"
                    ),
                    "transition": s.output_key or "",
                }
                for s in hd.steps
            ],
            "fk_definitions": [
                {"field": "uses", "references_table": t, "references_field": ""}
                for t in hd.tables_used
            ],
            "table_constraints": [],
        }

    def _build_review_response(self) -> dict[str, Any]:
        self.state.review_summary = self._build_review_summary()
        code = self.state.generated_code
        return {
            "status": "review_needed",
            "review_summary": self.state.review_summary,
            "filename": code.filename if code else "",
            "file_type": code.file_type if code else "",
            "validation": self.state.validation_result,
        }

    def _build_validation_failure_response(self) -> dict[str, Any]:
        return {
            "status": "validation_failed",
            "validation": self.state.validation_result,
            "message": "Code failed Data Platform validation after retries.",
        }

    # ------------------------------------------------------------------
    # Deploy (API-driven, requires human approval)
    # ------------------------------------------------------------------

    async def deploy(self):
        if not self.state.generated_code:
            return {"error": "No code to deploy"}

        code = self.state.generated_code
        category = "handlers" if code.file_type == "handler" else "tables"

        write_tool = DPFileWriteTool()
        write_result_raw = write_tool._run(
            category=category,
            filename=code.filename,
            content=code.content,
        )

        try:
            write_parsed = json.loads(write_result_raw)
        except Exception:
            write_parsed = {"success": False, "body": write_result_raw}

        if not write_parsed.get("success"):
            self.state.deployed = False
            self.state.deploy_result = {"write": write_result_raw, "reload": None}
            return {
                "status": "failed",
                "error": f"File write failed: {write_parsed.get('body', write_result_raw)}",
            }

        reload_tool = DPReloadTool()
        reload_result_raw = reload_tool._run()

        try:
            reload_parsed = json.loads(reload_result_raw)
        except Exception:
            reload_parsed = {"success": False, "body": reload_result_raw}

        self.state.deploy_result = {
            "write": write_result_raw,
            "reload": reload_result_raw,
        }

        reload_truly_ok = (
            reload_parsed.get("success") is True
            and not reload_parsed.get("scan_errors")
            and not reload_parsed.get("rejections")
            and not reload_parsed.get("error")
        )

        if not reload_truly_ok:
            self.state.deployed = False
            details: list[str] = []
            if reload_parsed.get("status_code"):
                details.append(f"HTTP {reload_parsed['status_code']}")
            if reload_parsed.get("error"):
                details.append(str(reload_parsed["error"]))
            if reload_parsed.get("scan_errors"):
                details.append(f"scan_errors: {json.dumps(reload_parsed['scan_errors'], ensure_ascii=False)}")
            if reload_parsed.get("rejections"):
                details.append(f"rejections: {json.dumps(reload_parsed['rejections'], ensure_ascii=False)}")
            if reload_parsed.get("body"):
                body = reload_parsed["body"]
                if isinstance(body, str) and body.strip().startswith("{"):
                    try:
                        body_obj = json.loads(body)
                        details.append(json.dumps(body_obj, ensure_ascii=False, indent=2))
                    except Exception:
                        details.append(body)
                else:
                    details.append(str(body))
            error_msg = "Hot reload failed: " + "\n".join(details) if details else "Hot reload failed (unknown reason)"
            return {
                "status": "failed",
                "error": error_msg,
                "filename": code.filename,
                "file_type": code.file_type,
                "reload_detail": reload_parsed,
            }

        await sync_schema_catalog()
        refresh_schema_knowledge()

        self.state.deployed = True

        self.state.operation_history.append({
            "sub_flow": self.state.sub_flow,
            "filename": code.filename,
            "file_type": code.file_type,
            "table_name": self.state.design.table_name if self.state.design else "",
        })

        return {
            "status": "deployed",
            "filename": code.filename,
            "file_type": code.file_type,
            "reload_result": reload_result_raw,
        }

    # ------------------------------------------------------------------
    # Session reset (for multi-operation sessions)
    # ------------------------------------------------------------------

    def reset_for_new_operation(self):
        """Keep session identity and history, clear transient state."""
        self.state.requirement = ""
        self.state.clarifications = []
        self.state.operation_type = ""
        self.state.sub_flow = ""
        self.state.phase = ""
        self.state.handler_name = ""
        self.state.analysis = None
        self.state.design = None
        self.state.handler_design = None
        self.state.fk_context = None
        self.state.generated_code = None
        self.state.validation_result = None
        self.state.review_summary = None
        self.state.review_status = ""
        self.state.review_feedback = ""
        self.state.deployed = False
        self.state.deploy_result = None
