"""DesignCrew -- Scenario A phase 1: design new table/action/handler structures.

Single agent designs based on requirement + existing table context (if provided).
No need to fetch the full schema catalog -- FK references are pre-resolved by ConfigFlow.

Output: Pydantic SchemaDesign.
"""

from crewai import Agent, Crew, Process, Task

from config import EMBEDDER_CONFIG, OPENAI_MODEL
from models.config_models import SchemaDesign
from setup.knowledge_setup import get_example_knowledge


class DesignCrew:
    """Single-agent crew that designs new table/action/handler structures."""

    def crew(
        self,
        requirement: str,
        clarifications: list[dict] | None = None,
        table_context: str | None = None,
    ) -> Crew:
        example_knowledge = get_example_knowledge()
        knowledge_sources = [example_knowledge] if example_knowledge else []

        designer = Agent(
            role="Data Platform Schema Designer",
            goal="Design table schemas that fit the data platform conventions",
            backstory=(
                "You design TableConfig structures for a data platform. Rules:\n"
                "- Every table needs a 'state' column (TEXT, NOT NULL)\n"
                "- States go in 'states' list (e.g. ['draft', 'active', 'disabled'])\n"
                "- Transitions start from 'init' for inserts, end at 'deleted' for deletes\n"
                "- PK strategy is 'custom' with a generator lambda\n"
                "- Actions bind function_type (insert/update/delete/bulk_*) to transitions\n"
                "- FK references must point to real, existing tables\n"
                "- Lookup tables: states=['active','disabled'], include bulk_insert\n"
                "- Business tables: may include draft/active/disabled states\n"
                "- PK fields already imply NOT NULL + UNIQUE; never add these as constraints on a PK column\n"
                "- Follow snake_case naming: PartyContact -> party_contact"
            ),
            llm=OPENAI_MODEL,
            knowledge_sources=knowledge_sources,
            memory=None,
            verbose=True,
        )

        clarification_text = ""
        if clarifications:
            clarification_text = "\nClarifications:\n" + "\n".join(
                f"Q: {c.get('question', '')} A: {c.get('answer', '')}"
                for c in clarifications
            )

        existing_context = ""
        if table_context:
            existing_context = (
                f"\n\nEXISTING TABLE CONTEXT (from Data Platform):\n"
                f"{table_context}\n"
                f"New additions must be append-only compatible."
            )

        design_task = Task(
            description=(
                f"Design a complete SchemaDesign for the data platform.\n\n"
                f"Requirement: {requirement}\n"
                f"{clarification_text}\n"
                f"{existing_context}\n\n"
                "Include ALL fields:\n"
                "- table_name (snake_case)\n"
                "- table_category ('lookup' or 'business')\n"
                "- pk_field and pk_strategy\n"
                "- states list\n"
                "- transitions list (from_state -> to_state)\n"
                "- columns list (name, pg_type, nullable; MUST include 'state' column)\n"
                "- actions list (name, function_type, transition)\n"
                "- fk_definitions (if FK references exist)\n"
                "- table_constraints (if needed; do NOT add NOT NULL or UNIQUE constraints on PK fields -- PK already enforces both)\n"
            ),
            expected_output="A complete SchemaDesign with all fields.",
            agent=designer,
            output_pydantic=SchemaDesign,
        )

        return Crew(
            agents=[designer],
            tasks=[design_task],
            process=Process.sequential,
            embedder=EMBEDDER_CONFIG,
            verbose=True,
        )
