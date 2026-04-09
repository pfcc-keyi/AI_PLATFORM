"""AddActionCrew -- append actions/transitions to an existing table.

Single agent reads the existing table config and produces a modified SchemaDesign
that preserves all existing definitions and only appends new items.

Output: Pydantic SchemaDesign (the full table including existing + new items).
"""

from crewai import Agent, Crew, Process, Task

from config import EMBEDDER_CONFIG, OPENAI_MODEL
from models.config_models import SchemaDesign
from setup.knowledge_setup import get_example_knowledge


class AddActionCrew:
    """Single-agent crew that appends actions to an existing table."""

    def crew(
        self,
        requirement: str,
        existing_table_code: str,
    ) -> Crew:
        example_knowledge = get_example_knowledge()
        knowledge_sources = [example_knowledge] if example_knowledge else []

        appender = Agent(
            role="Data Platform Action Appender",
            goal="Produce a SchemaDesign that preserves ALL existing definitions and appends new actions/transitions",
            backstory=(
                "You modify existing TableConfig structures by APPENDING new definitions.\n"
                "The Data Platform uses hot-reload with APPEND-ONLY semantics:\n"
                "- ALL existing transitions, actions, columns, states, and FK definitions MUST be preserved EXACTLY\n"
                "- You may only ADD new items; NEVER remove or modify existing ones\n"
                "- If the reload diff detects any removal or modification, the entire reload is rejected (HTTP 409)\n\n"
                "PLATFORM RULES (absolute, never violate):\n"
                "1. 'init' and 'deleted' are VIRTUAL states -- NEVER put them in the states list.\n"
                "   states list = only REAL states stored in DB (e.g. ['active','disabled']).\n"
                "2. function_type MUST be one of: insert, update, delete, bulk_insert, bulk_update, bulk_delete.\n"
                "3. insert/bulk_insert: from_state MUST be 'init'\n"
                "4. update/bulk_update: from_state CANNOT be 'init', to_state CANNOT be 'deleted'\n"
                "5. delete/bulk_delete: to_state MUST be 'deleted'\n"
                "6. Exactly ONE action per transition. Bulk actions are added separately.\n"
                "7. Each (function_type, from_state->to_state) pair must be unique.\n"
                "8. New transitions must reference valid states (existing or newly added real states).\n"
                "9. If a new transition introduces a new real state, add it to the states list.\n"
                "10. Naming: snake_case for everything. Bulk actions: bulk_{verb}_{table}.\n\n"
                "IMPORTANT: The output SchemaDesign must be the COMPLETE table -- all existing "
                "definitions plus the new ones. Do NOT output only the delta."
            ),
            llm=OPENAI_MODEL,
            knowledge_sources=knowledge_sources,
            memory=None,
            verbose=True,
        )

        task = Task(
            description=(
                f"Modify an existing table by APPENDING new actions/transitions.\n\n"
                f"User requirement: {requirement}\n\n"
                f"EXISTING TABLE CODE (preserve ALL definitions from this file):\n"
                f"{existing_table_code}\n\n"
                "Steps:\n"
                "1. Parse the existing table code to identify current: table_name, pk, states, "
                "transitions, columns, actions, fk_definitions\n"
                "2. Determine what the user wants to add (new actions, transitions, bulk operations, etc.)\n"
                "3. Produce a COMPLETE SchemaDesign that includes:\n"
                "   - ALL existing definitions unchanged\n"
                "   - The requested new additions appended\n"
                "4. Ensure all new additions follow the platform rules above\n"
                "5. If adding a bulk variant of an existing action, use the same transition "
                "and the corresponding bulk_ function_type\n\n"
                "Output the full SchemaDesign with all fields populated."
            ),
            expected_output="A complete SchemaDesign preserving all existing definitions plus new additions.",
            agent=appender,
            output_pydantic=SchemaDesign,
        )

        return Crew(
            agents=[appender],
            tasks=[task],
            process=Process.sequential,
            embedder=EMBEDDER_CONFIG,
            verbose=True,
        )
