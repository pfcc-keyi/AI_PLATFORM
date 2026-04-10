"""CodeGenCrew -- Scenario A phase 2: generate Python code.

Single agent generates code with a syntax guardrail.
Structural validation is delegated to Data Platform validate-table/validate-handler endpoints.
"""

import ast
import re
from typing import Any

from crewai import Agent, Crew, Process, Task, TaskOutput

from config import EMBEDDER_CONFIG, OPENAI_MODEL
from models.config_models import SchemaDesign
from setup.knowledge_setup import get_example_knowledge
from tools.admin import DPFileReadTool, DPSchemaCatalogTool


def _extract_python(text: str) -> str:
    """Extract Python code from markdown fences or return raw text."""
    match = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()


def _fix_smart_quotes(text: str) -> str:
    """Replace unicode curly quotes with ASCII quotes."""
    return text.replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')


def validate_python_syntax(result: TaskOutput) -> tuple[bool, Any]:
    """Guardrail: extract code from markdown, fix quotes, then parse."""
    code = _fix_smart_quotes(_extract_python(result.raw))
    try:
        ast.parse(code)
        return (True, code)
    except SyntaxError as e:
        return (False, f"Python syntax error at line {e.lineno}: {e.msg}")


class CodeGenCrew:
    """Single-agent crew that generates data platform Python code."""

    def crew(
        self,
        design: SchemaDesign,
        requirement: str,
        file_type: str = "table",
        table_context: str | None = None,
    ) -> Crew:
        example_knowledge = get_example_knowledge()
        gen_knowledge = [example_knowledge] if example_knowledge else []

        generator_tools = []
        if file_type == "handler":
            generator_tools = [DPFileReadTool(), DPSchemaCatalogTool()]

        generator = Agent(
            role="Data Platform Code Generator",
            goal="Generate valid, production-ready Python code for the data platform",
            backstory=(
                "You are an expert Python developer who writes TableConfig and handler code "
                "for the data platform. You follow the exact patterns from existing example code.\n\n"
                "CRITICAL RULES:\n"
                "- Output ONLY raw Python code, NO markdown fences, NO explanations\n"
                "- Use ONLY ASCII straight quotes (' and \"), NEVER curly/smart quotes\n"
                "- Always include: from lib import ... at the top\n"
                "- The state column MUST be named exactly 'state': ColumnDef(name='state', pg_type='TEXT', nullable=False)\n"
                "  If the design has a column like '{table}_state', rename it to 'state'. There must be exactly ONE state column.\n"
                "- Emit table_constraints exactly from the design when present.\n"
                "- Use ColumnDef.check for single-column constraints; use table_constraints for cross-column rules.\n"
                "- FKDefinition on_delete/on_update MUST use PostgreSQL keywords WITH SPACES:\n"
                "  'NO ACTION' (correct), 'CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT'\n"
                "  NEVER use underscores: 'NO_ACTION' is WRONG.\n"
                "- Follow the EXACT schema design provided, do not invent different tables\n"
                "- For HANDLERS: use dp_file_read and dp_schema_catalog tools"
            ),
            tools=generator_tools,
            llm=OPENAI_MODEL,
            knowledge_sources=gen_knowledge,
            memory=None,
            verbose=True,
        )

        design_json = design.model_dump_json(indent=2)

        table_context_section = ""
        if table_context:
            table_context_section = (
                f"\n\nEXISTING TABLE CONTEXT:\n{table_context}\n"
                f"Use this to understand existing structure."
            )

        generate_task = Task(
            description=(
                f"Generate a complete Python file for the data platform.\n\n"
                f"File type: {file_type}\n"
                f"Requirement: {requirement}\n"
                f"Schema design:\n{design_json}\n"
                f"{table_context_section}\n\n"
                "RULES:\n"
                "1. Output ONLY Python code - no markdown, no explanations, no ```\n"
                "2. Use ONLY ASCII quotes (' and \")\n"
                "3. Import from lib: TableConfig, ColumnDef, PKConfig, StateTransition, ActionDef, FKDefinition\n"
                "4. Define config = TableConfig(...) matching the schema design exactly\n"
                "5. State column: exactly ONE ColumnDef(name='state', pg_type='TEXT', nullable=False). "
                "If design has '{table}_state', output it as 'state' instead. Never have two state columns.\n"
                "6. Include PKConfig with strategy and generator lambda\n"
                "7. FKDefinition on_delete/on_update: use PostgreSQL keywords WITH SPACES — "
                "'NO ACTION' (not 'NO_ACTION'), 'CASCADE', 'SET NULL', etc.\n"
                "8. If design.table_constraints is non-empty, emit table_constraints=[...] exactly as provided.\n"
            ),
            expected_output="Raw Python source code only, no markdown fences",
            agent=generator,
            guardrails=[validate_python_syntax],
            guardrail_max_retries=3,
        )

        return Crew(
            agents=[generator],
            tasks=[generate_task],
            process=Process.sequential,
            embedder=EMBEDDER_CONFIG,
            verbose=True,
        )
