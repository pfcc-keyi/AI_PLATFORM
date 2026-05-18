"""Thin crew factory functions for the Schema Design Cockpit.

Mirrors the small/focused pattern of `ai_platform/crews/design_crew.py`:
each factory builds a single-agent / single-task `Crew` with
`output_pydantic` and reuses the existing K1 / K2 / K4 knowledge sources.

Agents:

- ``DomainAnalystAgent`` -> :class:`DomainAnalysis`
- ``ClusterDesignerAgent`` -> :class:`ClusterDesign` (one cluster per call;
  use ``Crew.kickoff_for_each`` for parallel per-cluster batches).
- ``DesignCriticAgent`` -> :class:`DesignCritique`
- ``RefinementAgent`` -> :class:`DesignRevision`

No memory, no tools, no new knowledge files. All four agents attach the
shared ``schema_design_cockpit`` Skill (see
``ai_platform/skills/schema_design_cockpit/SKILL.md``) for prompt governance.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from crewai import Agent, Crew, Process, Task

from config import EMBEDDER_CONFIG, OPENAI_MODEL
from models.design_models import (
    ClusterDesign,
    DesignCritique,
    DesignRevision,
    DomainAnalysis,
    HandlerSketch,
)
from setup.knowledge_setup import (
    get_docs_knowledge,
    get_example_knowledge,
    get_handler_knowledge,
)

logger = logging.getLogger(__name__)

# ai_platform/skills lives one level up from ai_platform/crews/, two parents
# from this file. Resolve at import time so the Dockerfile COPY-ed copy works
# the same as a local checkout.
_SKILLS_ROOT = Path(__file__).resolve().parent.parent / "skills"
_SCHEMA_DESIGN_SKILL = _SKILLS_ROOT / "schema_design_cockpit"


def _design_cockpit_skills() -> list[Path] | None:
    """Return a single-entry skill list if the skill exists, else None.

    Returning ``None`` (instead of an empty list) keeps the agent valid -- the
    `skills` field has `min_length=1` when present.
    """
    skill_md = _SCHEMA_DESIGN_SKILL / "SKILL.md"
    if not skill_md.is_file():
        logger.warning(
            "design crews: schema_design_cockpit SKILL.md not found at %s -- "
            "agents will run without the cockpit skill",
            skill_md,
        )
        return None
    return [_SCHEMA_DESIGN_SKILL]


def _knowledge(*sources: Any) -> list[Any]:
    return [src for src in sources if src is not None]


# ---------------------------------------------------------------------------
# DomainAnalystAgent
# ---------------------------------------------------------------------------


def make_domain_analyst_crew(
    parsed_schema_summary: str,
    seed_clusters_summary: str,
    user_clarifications: dict[str, str] | None = None,
) -> Crew:
    """Build a single-agent crew producing a :class:`DomainAnalysis`."""
    skills = _design_cockpit_skills()
    knowledge = _knowledge(get_docs_knowledge(), get_example_knowledge())

    analyst = Agent(
        role="Schema Domain Analyst",
        goal=(
            "Identify the business domain, sub-domains, refine cluster names, "
            "and surface clarification questions for an Excel-uploaded schema."
        ),
        backstory=(
            "You bridge raw Excel data dictionaries and the Data Platform's "
            "schema/handler vocabulary. You read parsed tables + their FK "
            "graph clusters, and you produce a concise DomainAnalysis: a "
            "domain guess, sub-domains, refined cluster names, and any "
            "clarification questions the user must answer before per-cluster "
            "design begins."
        ),
        llm=OPENAI_MODEL,
        skills=skills,
        knowledge_sources=knowledge,
        memory=None,
        verbose=True,
    )

    clarifications_block = ""
    if user_clarifications:
        clarifications_block = "\n\nUser clarifications so far:\n" + "\n".join(
            f"- Q: {q}\n  A: {a}" for q, a in user_clarifications.items()
        )

    description = (
        "You have parsed an Excel data dictionary. Use the parsed-schema "
        "summary and the seed cluster partition below to produce a "
        "DomainAnalysis.\n\n"
        f"PARSED SCHEMA SUMMARY:\n{parsed_schema_summary}\n\n"
        f"SEED CLUSTERS (Louvain over the FK graph):\n{seed_clusters_summary}\n"
        f"{clarifications_block}\n\n"
        "Rules:\n"
        "- Keep the same cluster membership; only rename and add a rationale.\n"
        "- Only populate `questions` for genuinely ambiguous business "
        "knowledge that the Excel cannot answer.\n"
        "- Keep `assumptions` short and verifiable.\n"
        "- Reasoning: 2-4 sentences max."
    )

    task = Task(
        description=description,
        expected_output="A DomainAnalysis instance with all fields populated.",
        agent=analyst,
        output_pydantic=DomainAnalysis,
    )

    return Crew(
        agents=[analyst],
        tasks=[task],
        process=Process.sequential,
        embedder=EMBEDDER_CONFIG,
        verbose=True,
    )


# ---------------------------------------------------------------------------
# ClusterDesignerAgent
# ---------------------------------------------------------------------------


def make_cluster_designer_crew() -> Crew:
    """Build a reusable per-cluster designer crew.

    Use ``crew.kickoff_for_each(inputs=[...])`` with one input dict per
    cluster. Each input must provide the placeholders referenced in the
    task description: ``cluster_id``, ``cluster_name``, ``cluster_rationale``,
    ``domain_context``, and ``table_specs``.
    """
    skills = _design_cockpit_skills()
    knowledge = _knowledge(get_example_knowledge(), get_handler_knowledge())

    designer = Agent(
        role="Per-Cluster Schema & Handler Designer",
        goal=(
            "For one cluster of tables, produce full SchemaDesigns and "
            "HandlerSketches that follow Data Platform conventions."
        ),
        backstory=(
            "You design TableConfig-shaped SchemaDesigns plus orchestration "
            "HandlerSketches for a single cluster of tables at a time. You "
            "must follow the Data Platform conventions (state column, "
            "states list, transitions, action function_types). You consult "
            "the attached table and handler examples for the exact shape."
        ),
        llm=OPENAI_MODEL,
        skills=skills,
        knowledge_sources=knowledge,
        memory=None,
        verbose=True,
    )

    description = (
        "Design the cluster below.\n\n"
        "Cluster: {cluster_id} -- {cluster_name}\n"
        "Rationale: {cluster_rationale}\n\n"
        "Domain context (from prior DomainAnalyst step):\n"
        "{domain_context}\n\n"
        "Tables in this cluster (parsed Excel rows):\n"
        "{table_specs}\n\n"
        "For each table produce a `SchemaDesign` with: table_name, "
        "table_category ('lookup' or 'business'), pk_field, pk_strategy "
        "('custom' unless trivial), states (must include a 'state' value "
        "column), transitions (init -> active, active -> deleted, etc.), "
        "columns (MUST include 'state' as TEXT NOT NULL), actions "
        "(name + function_type + transition), fk_definitions for in-cluster "
        "FKs, and table_constraints only for cross-column checks.\n\n"
        "For orchestrated multi-step operations, propose `HandlerSketch` "
        "entries with handler_name, mode (sync/async), description, "
        "tables_used, payload_fields, steps (step_number + description + "
        "table_name + action_name), trigger_state, target_state, and "
        "fields_touched.\n\n"
        "Set `reasoning` to a brief note explaining why these states / "
        "transitions / handlers fit the cluster."
    )

    task = Task(
        description=description,
        expected_output="A ClusterDesign instance with schema_designs and handler_sketches.",
        agent=designer,
        output_pydantic=ClusterDesign,
    )

    return Crew(
        agents=[designer],
        tasks=[task],
        process=Process.sequential,
        embedder=EMBEDDER_CONFIG,
        verbose=True,
    )


# ---------------------------------------------------------------------------
# DesignCriticAgent
# ---------------------------------------------------------------------------


def make_critic_crew(
    full_design_summary: str,
    deterministic_issues_summary: str,
) -> Crew:
    """Build a critique crew for the merged FullDesign."""
    skills = _design_cockpit_skills()
    knowledge = _knowledge(get_docs_knowledge())

    critic = Agent(
        role="Data Platform Design Critic",
        goal=(
            "Audit the merged design for semantic issues the deterministic "
            "validator cannot catch (naming, duplication, missing common "
            "states, suspicious patterns)."
        ),
        backstory=(
            "You are a meticulous reviewer who knows the Data Platform "
            "conventions cold. You read the merged FullDesign and the list "
            "of deterministic issues already raised, then add only the "
            "*semantic* issues a human reviewer would notice."
        ),
        llm=OPENAI_MODEL,
        skills=skills,
        knowledge_sources=knowledge,
        memory=None,
        verbose=True,
    )

    description = (
        "Review the merged FullDesign below and the deterministic issue "
        "list, then output a DesignCritique.\n\n"
        f"FULL DESIGN SUMMARY:\n{full_design_summary}\n\n"
        f"DETERMINISTIC ISSUES (already raised, do NOT repeat):\n"
        f"{deterministic_issues_summary}\n\n"
        "Add only semantic issues: naming inconsistency, duplicated concepts, "
        "missing audit / disabled states, suspicious cycles, missing common "
        "columns (created_at, updated_at, soft_delete fields), unclear "
        "handler grouping, etc. For each issue set severity, target (e.g. "
        "'table:Party' or 'field:Party.party_id'), message, and suggested_fix."
    )

    task = Task(
        description=description,
        expected_output="A DesignCritique with summary + issues + open_questions.",
        agent=critic,
        output_pydantic=DesignCritique,
    )

    return Crew(
        agents=[critic],
        tasks=[task],
        process=Process.sequential,
        embedder=EMBEDDER_CONFIG,
        verbose=True,
    )


# ---------------------------------------------------------------------------
# RefinementAgent
# ---------------------------------------------------------------------------


def make_refinement_crew(
    user_request: str,
    scope: str,
    target: str,
    current_design_json: str,
) -> Crew:
    """Build a refinement crew that produces a snapshot-based DesignRevision.

    The agent receives the full current FullDesign as JSON plus the user's
    natural-language change request, and emits a `DesignRevision` whose
    ``after`` field is a complete updated `FullDesign`. The caller fills in
    ``before`` from the canonical snapshot before persisting.
    """
    skills = _design_cockpit_skills()
    knowledge = _knowledge(get_example_knowledge(), get_handler_knowledge())

    reviser = Agent(
        role="Schema Design Refinement Agent",
        goal=(
            "Apply a focused user request to the current design and produce "
            "a new full design snapshot with a clear change summary."
        ),
        backstory=(
            "You make minimal, justified changes to a FullDesign in response "
            "to natural-language user requests. You never change anything "
            "outside the requested scope. You always emit a complete `after` "
            "snapshot so the FE can diff it against the canonical `before` "
            "snapshot."
        ),
        llm=OPENAI_MODEL,
        skills=skills,
        knowledge_sources=knowledge,
        memory=None,
        verbose=True,
    )

    description = (
        "Apply the user's refinement to the current design.\n\n"
        f"User request: {user_request}\n"
        f"Scope: {scope}\n"
        f"Target: {target or '(no specific target -- infer from request)'}\n\n"
        f"Current FullDesign JSON:\n{current_design_json}\n\n"
        "Rules:\n"
        "- Output a DesignRevision with `after` = a complete updated "
        "  FullDesign. Set `revision_id` to a short unique string.\n"
        "- Leave `before` empty (the caller fills it).\n"
        "- Set `actor` = 'agent', `request` = the original user request.\n"
        "- `change_summary` MUST be one short sentence describing the diff.\n"
        "- `reasoning` MUST be a short paragraph explaining the change.\n"
        "- DO NOT modify tables, states, fk_definitions, or handler_sketches "
        "  that are outside the requested scope.\n"
        "- If the request is ambiguous, set `change_summary` to a clarifying "
        "  question and copy `after` = current design unchanged."
    )

    task = Task(
        description=description,
        expected_output="A DesignRevision with after = full updated FullDesign.",
        agent=reviser,
        output_pydantic=DesignRevision,
    )

    return Crew(
        agents=[reviser],
        tasks=[task],
        process=Process.sequential,
        embedder=EMBEDDER_CONFIG,
        verbose=True,
    )


# ---------------------------------------------------------------------------
# Field-level handler suggestion (fast on-demand call)
# ---------------------------------------------------------------------------


def make_field_handler_crew(
    table_name: str,
    field_name: str,
    state_name: str,
    table_context_json: str,
) -> Crew:
    """Build a tiny crew that suggests handlers touching a specific field+state.

    Reuses the cluster designer agent's expertise but scopes the task to a
    single (table, field, state) tuple so the prompt and the response stay
    small. The agent output is parsed as `list[HandlerSketch]` via a wrapper
    Pydantic field. We return a Crew so callers can `kickoff()` synchronously.
    """
    skills = _design_cockpit_skills()
    knowledge = _knowledge(get_example_knowledge(), get_handler_knowledge())

    suggester = Agent(
        role="Field-Level Handler Suggester",
        goal=(
            "Propose a small list of HandlerSketches that would touch the "
            "given field in the given state."
        ),
        backstory=(
            "You answer 'which handlers would use this field at this state?' "
            "as a focused suggestion. Output 1-5 small HandlerSketches."
        ),
        llm=OPENAI_MODEL,
        skills=skills,
        knowledge_sources=knowledge,
        memory=None,
        verbose=True,
    )

    description = (
        "Suggest a small list of HandlerSketches that would plausibly read "
        "or write the field below at the given state.\n\n"
        f"Table: {table_name}\n"
        f"Field: {field_name}\n"
        f"State: {state_name}\n\n"
        f"Table context (current SchemaDesign and related tables):\n"
        f"{table_context_json}\n\n"
        "Rules:\n"
        "- Return a single HandlerSketch ONLY when the field would clearly "
        "  be touched. If there is no plausible handler, return one sketch "
        "  with `handler_name = 'no_handler_suggested'` and reasoning "
        "  explaining why.\n"
        "- Include trigger_state, target_state, and fields_touched.\n"
        "- Keep `description` to one sentence.\n"
    )

    task = Task(
        description=description,
        expected_output="A HandlerSketch (or a no_handler_suggested placeholder).",
        agent=suggester,
        output_pydantic=HandlerSketch,
    )

    return Crew(
        agents=[suggester],
        tasks=[task],
        process=Process.sequential,
        embedder=EMBEDDER_CONFIG,
        verbose=True,
    )
