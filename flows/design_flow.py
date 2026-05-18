"""SchemaDesignFlow -- the AI core of the Schema Design Cockpit.

Mirrors the phase-based pattern from `ai_platform/flows/config_flow.py`:
phase-based state, explicit FastAPI resume endpoints, agents with
``memory=None``, knowledge wired through ``setup/knowledge_setup.py``,
Pydantic outputs via ``Task.output_pydantic``.

Net-new CrewAI features versus ``ConfigFlow``:

* ``Flow(stream=True)`` so ``kickoff_async`` returns a ``FlowStreamingOutput``
  the route handler can multiplex into SSE.
* ``Crew.kickoff_for_each`` for parallel per-cluster design.
* The ``schema_design_cockpit`` Skill is attached to every agent via the
  crew factories in ``crews/design_design_crews.py``.

We do **not** add ``@persist`` for V1 -- session state lives in
``_active_designs`` in the route file just like ``ConfigFlow``, and
canonical ``FullDesign`` snapshots are persisted via
``storage/design_store.py``.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from crewai.flow.flow import Flow, listen, router, start
from pydantic import ValidationError

from crews.design_design_crews import (
    make_cluster_designer_crew,
    make_critic_crew,
    make_domain_analyst_crew,
    make_field_handler_crew,
    make_refinement_crew,
)
from flows.design_excel import build_fk_edges, compute_layout, parse_and_cluster
from models.design_models import (
    ClusterDesign,
    ClusterSpec,
    DesignCritique,
    DesignIssue,
    DesignRevision,
    DesignState,
    DomainAnalysis,
    ERDLayout,
    FullDesign,
    HandlerSketch,
    ParsedSchema,
    SchemaDesign,
    TableLayout3D,
)
from storage import design_store

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module-level cache for the uploaded workbook bytes.
#
# The flow state is Pydantic and gets serialized for events. Stuffing 100+
# table .xlsx bytes into the state would balloon every event payload.
# Instead we keep the bytes in this dict keyed by design_id and refer to it
# via state.excel_blob_id. Cleared on completion / delete.
# ---------------------------------------------------------------------------
_UPLOADED_BYTES: dict[str, bytes] = {}


def register_upload(design_id: str, content: bytes, filename: str = "schema.xlsx") -> None:
    _UPLOADED_BYTES[design_id] = content


def clear_upload(design_id: str) -> None:
    _UPLOADED_BYTES.pop(design_id, None)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _short_id(prefix: str = "") -> str:
    raw = uuid.uuid4().hex[:8]
    return f"{prefix}{raw}" if prefix else raw


# ---------------------------------------------------------------------------
# Helpers: compact summaries for prompt context
# ---------------------------------------------------------------------------


def _parsed_schema_summary(parsed: ParsedSchema, limit: int = 200) -> str:
    """Build a compact textual summary the analyst agent can chew on."""
    lines: list[str] = [
        f"Total tables: {len(parsed.tables)}",
        f"Total FK fields: {parsed.fk_count}",
        f"Source sheets: {parsed.sheet_count}",
        "",
        "Tables:",
    ]
    for table in parsed.tables[:limit]:
        pk = next((f.name for f in table.fields if f.primary_key), "?")
        fks = [
            f"{f.name}->{f.foreign_key}" for f in table.fields if f.foreign_key
        ]
        lines.append(
            f"- {table.entity_name} (sheet={table.source_sheet}, pk={pk}, "
            f"fields={len(table.fields)}, fks=[{', '.join(fks)}])"
        )
    if len(parsed.tables) > limit:
        lines.append(f"... and {len(parsed.tables) - limit} more tables")
    return "\n".join(lines)


def _clusters_summary(clusters: list[ClusterSpec]) -> str:
    lines = [f"Total clusters: {len(clusters)}"]
    for cluster in clusters:
        members = ", ".join(cluster.table_names[:12])
        if len(cluster.table_names) > 12:
            members += f", ... (+{len(cluster.table_names) - 12} more)"
        lines.append(
            f"- {cluster.cluster_id} '{cluster.name}' ({len(cluster.table_names)} tables): {members}"
        )
    return "\n".join(lines)


def _cluster_table_specs(parsed: ParsedSchema, table_names: list[str]) -> str:
    """Dump just the parsed-table fields for one cluster."""
    name_set = set(table_names)
    blocks: list[str] = []
    for table in parsed.tables:
        if table.entity_name not in name_set:
            continue
        field_lines = []
        for field in table.fields:
            tag = []
            if field.primary_key:
                tag.append("PK")
            if field.foreign_key:
                tag.append(f"FK->{field.foreign_key}")
            tag_str = f" [{', '.join(tag)}]" if tag else ""
            field_lines.append(
                f"    - {field.name}: {field.data_type or '?'}"
                f"{tag_str} -- {field.definition or ''}".rstrip()
            )
        blocks.append(
            f"- {table.entity_name} (sheet={table.source_sheet}):\n"
            + "\n".join(field_lines)
        )
    return "\n".join(blocks) if blocks else "(no tables in cluster)"


def _full_design_summary(design: FullDesign) -> str:
    lines = [
        f"design_id={design.design_id}",
        f"domain_guess={design.domain_analysis.domain_guess}",
        f"sub_domains={', '.join(design.domain_analysis.sub_domains)}",
        f"tables={len(design.schema_designs)}",
        f"handlers={len(design.handler_sketches)}",
        "",
        "Tables:",
    ]
    for sd in design.schema_designs:
        states = ",".join(sd.states)
        actions = ",".join(a.name for a in sd.actions)
        fks = ",".join(f"{fk.field}->{fk.references_table}.{fk.references_field}" for fk in sd.fk_definitions)
        lines.append(
            f"- {sd.table_name} [{sd.table_category}] states=[{states}] "
            f"actions=[{actions}] fks=[{fks}]"
        )
    lines.append("")
    lines.append("Handlers:")
    for h in design.handler_sketches:
        lines.append(
            f"- {h.handler_name} ({h.mode}) tables=[{','.join(h.tables_used)}] "
            f"{h.trigger_state}->{h.target_state}"
        )
    return "\n".join(lines)


def _issues_summary(issues: list[DesignIssue]) -> str:
    if not issues:
        return "(no deterministic issues)"
    return "\n".join(
        f"- [{i.severity}] {i.target}: {i.message}" for i in issues
    )


# ---------------------------------------------------------------------------
# Deterministic validators (no LLM)
# ---------------------------------------------------------------------------


def _deterministic_validate(design: FullDesign) -> list[DesignIssue]:
    issues: list[DesignIssue] = []
    table_index = {sd.table_name: sd for sd in design.schema_designs}

    for sd in design.schema_designs:
        # PK
        if not sd.pk_field:
            issues.append(
                DesignIssue(
                    severity="error",
                    target=f"table:{sd.table_name}",
                    message="Missing pk_field",
                    suggested_fix="Choose a primary key column.",
                )
            )
        else:
            cols = {c.name for c in sd.columns}
            if sd.pk_field not in cols:
                issues.append(
                    DesignIssue(
                        severity="error",
                        target=f"table:{sd.table_name}",
                        message=f"PK field '{sd.pk_field}' is not in columns",
                        suggested_fix="Add the PK column or pick an existing one.",
                    )
                )

        # state column
        if not any(c.name == "state" for c in sd.columns):
            issues.append(
                DesignIssue(
                    severity="warning",
                    target=f"table:{sd.table_name}",
                    message="Missing 'state' column",
                    suggested_fix="Add ColumnDesign(name='state', pg_type='text', nullable=False).",
                )
            )

        # transitions reference declared states (plus virtual init/deleted)
        declared = set(sd.states) | {"init", "deleted"}
        for t in sd.transitions:
            if t.from_state not in declared:
                issues.append(
                    DesignIssue(
                        severity="warning",
                        target=f"table:{sd.table_name}",
                        message=f"Transition from_state '{t.from_state}' not in states",
                        suggested_fix=f"Add '{t.from_state}' to states list or fix the transition.",
                    )
                )
            if t.to_state not in declared:
                issues.append(
                    DesignIssue(
                        severity="warning",
                        target=f"table:{sd.table_name}",
                        message=f"Transition to_state '{t.to_state}' not in states",
                        suggested_fix=f"Add '{t.to_state}' to states list or fix the transition.",
                    )
                )

        # FK targets exist
        for fk in sd.fk_definitions:
            if fk.references_table not in table_index:
                issues.append(
                    DesignIssue(
                        severity="warning",
                        target=f"field:{sd.table_name}.{fk.field}",
                        message=f"FK target table '{fk.references_table}' not found in design",
                        suggested_fix="Rename to the correct table or remove the FK.",
                    )
                )

    # Handlers reference real tables
    for h in design.handler_sketches:
        for t in h.tables_used:
            if t not in table_index:
                issues.append(
                    DesignIssue(
                        severity="warning",
                        target=f"handler:{h.handler_name}",
                        message=f"Handler references unknown table '{t}'",
                        suggested_fix=f"Use a real table name or add '{t}'.",
                    )
                )

    return issues


# ---------------------------------------------------------------------------
# SchemaDesignFlow
# ---------------------------------------------------------------------------


class SchemaDesignFlow(Flow[DesignState]):
    """The cockpit's CrewAI Flow. See module docstring."""

    def __init__(self, design_id: str, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        # Initialize state with the provided design_id and enable streaming
        # so the API can iterate over LLM/task chunks.
        self.state.design_id = design_id
        self.stream = True

    # ------------------------------------------------------------------
    # Phase 1 -- deterministic parse + Louvain clustering
    # ------------------------------------------------------------------

    @start("retry_analyze")
    def parse_and_cluster(self) -> str:
        """Phase 1: pure Python parse of the uploaded workbook."""
        # If we already parsed this upload and are looping back from
        # clarification round, skip re-parsing.
        if self.state.parsed_schema is not None:
            self.state.phase = "analyzing"
            return "analyzing"

        blob = _UPLOADED_BYTES.get(self.state.design_id)
        if blob is None:
            logger.error(
                "design_flow: no uploaded bytes registered for %s",
                self.state.design_id,
            )
            self.state.phase = "rejected"
            return "rejected"

        parsed, clusters, _edges = parse_and_cluster(
            blob, filename=self.state.uploaded_filename or "schema.xlsx"
        )
        self.state.parsed_schema = parsed
        self.state.clusters_raw = clusters
        self.state.phase = "analyzing"
        logger.info(
            "design_flow[%s]: phase 1 done, %d tables / %d clusters",
            self.state.design_id,
            len(parsed.tables),
            len(clusters),
        )
        return "analyzing"

    # ------------------------------------------------------------------
    # Phase 2 -- DomainAnalystAgent
    # ------------------------------------------------------------------

    @listen("analyzing")
    def analyze(self) -> str:
        """Phase 2: refine cluster names + raise clarifying questions."""
        if self.state.parsed_schema is None:
            return "rejected"

        parsed_summary = _parsed_schema_summary(self.state.parsed_schema)
        clusters_summary = _clusters_summary(self.state.clusters_raw)

        crew = make_domain_analyst_crew(
            parsed_schema_summary=parsed_summary,
            seed_clusters_summary=clusters_summary,
            user_clarifications=self.state.clarifications or None,
        )

        try:
            result = crew.kickoff()
        except Exception as exc:  # noqa: BLE001 -- propagate as a phase
            logger.exception("design_flow: analyze crew failed (%s)", exc)
            self.state.phase = "rejected"
            return "rejected"

        analysis = _coerce_pydantic(result, DomainAnalysis)
        if analysis is None:
            analysis = DomainAnalysis(
                domain_guess="(unknown)",
                clusters=self.state.clusters_raw,
                questions=["Could not parse domain analysis output."],
            )
        # Preserve the deterministic cluster membership; only the
        # human-readable name/rationale may change.
        analysis.clusters = _merge_cluster_membership(
            self.state.clusters_raw, analysis.clusters
        )
        self.state.domain_analysis = analysis
        return "questions_check"

    @router(analyze)
    def check_questions(self) -> str:
        """Phase 2 router."""
        if (
            self.state.domain_analysis is not None
            and self.state.domain_analysis.questions
        ):
            return "need_answers"
        return "ready"

    @listen("need_answers")
    def emit_questions(self) -> dict[str, Any]:
        """Phase 3: pause and wait for /answer to resume."""
        self.state.phase = "awaiting_clarification"
        self.state.clarification_round += 1
        questions = (
            self.state.domain_analysis.questions
            if self.state.domain_analysis
            else []
        )
        logger.info(
            "design_flow[%s]: awaiting %d clarification(s) (round %d)",
            self.state.design_id,
            len(questions),
            self.state.clarification_round,
        )
        return {"phase": self.state.phase, "questions": questions}

    # ------------------------------------------------------------------
    # Phase 4 -- per-cluster design (parallel via kickoff_for_each)
    # ------------------------------------------------------------------

    @listen("ready")
    def design_clusters(self) -> str:
        """Phase 4: fan out to one ClusterDesignerCrew per cluster."""
        if self.state.parsed_schema is None or self.state.domain_analysis is None:
            self.state.phase = "rejected"
            return "rejected"

        self.state.phase = "designing"
        domain = self.state.domain_analysis
        domain_context = (
            f"Domain guess: {domain.domain_guess}\n"
            f"Sub-domains: {', '.join(domain.sub_domains)}\n"
            f"Reasoning: {domain.reasoning}"
        )

        cluster_inputs: list[dict[str, Any]] = []
        for cluster in domain.clusters:
            table_specs = _cluster_table_specs(
                self.state.parsed_schema, cluster.table_names
            )
            cluster_inputs.append(
                {
                    "cluster_id": cluster.cluster_id,
                    "cluster_name": cluster.name or cluster.cluster_id,
                    "cluster_rationale": cluster.rationale or "",
                    "domain_context": domain_context,
                    "table_specs": table_specs,
                }
            )

        if not cluster_inputs:
            self.state.cluster_designs = []
            self.state.phase = "synthesizing"
            return "synthesizing"

        crew = make_cluster_designer_crew()
        cluster_designs: list[ClusterDesign] = []
        try:
            results = crew.kickoff_for_each(inputs=cluster_inputs)
        except Exception as exc:  # noqa: BLE001
            logger.exception("design_flow: cluster crew failed (%s)", exc)
            results = []

        for cluster_input, result in zip(cluster_inputs, results):
            design = _coerce_pydantic(result, ClusterDesign)
            if design is None:
                # Surface a recoverable issue, but keep going.
                design = ClusterDesign(
                    cluster_id=cluster_input["cluster_id"],
                    reasoning=(
                        "ClusterDesignerAgent failed to produce a structured "
                        "ClusterDesign for this cluster."
                    ),
                )
            design.cluster_id = cluster_input["cluster_id"]
            cluster_designs.append(design)

        self.state.cluster_designs = cluster_designs
        self.state.phase = "synthesizing"
        return "synthesizing"

    # ------------------------------------------------------------------
    # Phase 5 -- merge + deterministic validate + critic
    # ------------------------------------------------------------------

    @listen("synthesizing")
    def synthesize_and_validate(self) -> str:
        """Phase 5: merge cluster outputs, build layout, validate, critique."""
        if self.state.parsed_schema is None or self.state.domain_analysis is None:
            self.state.phase = "rejected"
            return "rejected"

        schema_designs: list[SchemaDesign] = []
        handler_sketches: list[HandlerSketch] = []
        for cluster_design in self.state.cluster_designs:
            schema_designs.extend(cluster_design.schema_designs)
            handler_sketches.extend(cluster_design.handler_sketches)

        # Layout (deterministic): cluster ring + intra-cluster ring
        table_names = [sd.table_name for sd in schema_designs] or [
            t.entity_name for t in self.state.parsed_schema.tables
        ]
        edges = build_fk_edges(self.state.parsed_schema)
        layout_dicts = compute_layout(
            table_names=table_names,
            edges=edges,
            clusters=self.state.domain_analysis.clusters,
        )
        layout = ERDLayout(
            tables=[TableLayout3D(**d) for d in layout_dicts],
            edges=edges,
        )

        full = FullDesign(
            design_id=self.state.design_id,
            created_at=_now_iso(),
            parsed_schema=self.state.parsed_schema,
            domain_analysis=self.state.domain_analysis,
            schema_designs=schema_designs,
            handler_sketches=handler_sketches,
            layout=layout,
        )

        deterministic_issues = _deterministic_validate(full)

        # Critic adds semantic issues; deterministic ones are passed in
        # to avoid duplication.
        critique = _run_critic(full, deterministic_issues)

        # Merge deterministic issues into the critique up front.
        final_issues = list(deterministic_issues)
        if critique:
            final_issues.extend(critique.issues)
            full.critique = DesignCritique(
                summary=critique.summary,
                issues=final_issues,
                open_questions=critique.open_questions,
            )
        else:
            full.critique = DesignCritique(
                summary="No critique produced.",
                issues=final_issues,
            )

        self.state.full_design = full
        design_store.save_design(full)
        self.state.phase = "awaiting_review"
        logger.info(
            "design_flow[%s]: phase 5 done; awaiting review",
            self.state.design_id,
        )
        return "awaiting_review"

    # ------------------------------------------------------------------
    # Refinement / on-demand methods (called directly by the API)
    # ------------------------------------------------------------------

    def resume_with_answers(self, answers: dict[str, str]) -> dict[str, Any]:
        """Phase 3 resume: store answers and re-enter Phase 2."""
        if not answers:
            return {"phase": self.state.phase, "error": "no answers provided"}
        self.state.clarifications.update(answers)
        self.state.phase = "analyzing"
        # Re-run from Phase 2; parse step skips because parsed_schema is set.
        try:
            self.kickoff()
        except Exception as exc:  # noqa: BLE001
            logger.exception("design_flow: resume_with_answers failed (%s)", exc)
            return {"phase": self.state.phase, "error": str(exc)}
        result: dict[str, Any] = {"phase": self.state.phase}
        if self.state.domain_analysis:
            result["questions"] = self.state.domain_analysis.questions
        return result

    def resume_with_review(
        self,
        action: Literal["approved", "revise", "reject"],
        feedback: str = "",
    ) -> dict[str, Any]:
        """Phase 7 resume: handle approve / revise / reject."""
        if action == "approved":
            self.state.phase = "ready"
            if self.state.full_design is not None:
                design_store.save_design(self.state.full_design)
            return {"phase": "ready"}
        if action == "reject":
            self.state.phase = "rejected"
            return {"phase": "rejected", "feedback": feedback}
        if action == "revise":
            self.state.phase = "refining"
            return {"phase": "refining", "feedback": feedback}
        return {"phase": self.state.phase, "error": f"unknown action '{action}'"}

    def refine(
        self,
        scope: str,
        target: str,
        request: str,
    ) -> Optional[DesignRevision]:
        """Run RefinementAgent on the current design; return a pending revision.

        The result is written to ``state.pending_revisions`` and persisted via
        ``storage/design_store.append_revision``. The canonical design is NOT
        mutated -- the API ``/revisions/{id}/apply`` endpoint does that.
        """
        if self.state.full_design is None:
            return None
        before = self.state.full_design.model_copy(deep=True)
        current_json = self.state.full_design.model_dump_json(indent=2)

        crew = make_refinement_crew(
            user_request=request,
            scope=scope,
            target=target,
            current_design_json=current_json,
        )
        try:
            result = crew.kickoff()
        except Exception as exc:  # noqa: BLE001
            logger.exception("design_flow: refine failed (%s)", exc)
            return None

        revision = _coerce_pydantic(result, DesignRevision)
        if revision is None:
            return None
        revision.revision_id = revision.revision_id or _short_id("rev-")
        revision.parent_revision_id = (
            self.state.full_design.revisions[-1].revision_id
            if hasattr(self.state.full_design, "revisions")
            and getattr(self.state.full_design, "revisions", None)
            else None
        )
        revision.actor = "agent"
        revision.request = request
        revision.before = before
        if revision.after is None:
            revision.after = before
        revision.after.design_id = self.state.design_id
        revision.applied = False
        revision.created_at = _now_iso()

        self.state.pending_revisions.append(revision)
        design_store.append_revision(self.state.design_id, revision)
        return revision

    def apply_revision(self, revision_id: str) -> Optional[FullDesign]:
        new_design = design_store.apply_revision(self.state.design_id, revision_id)
        if new_design is None:
            return None
        # Remove from pending and add to history.
        applied = None
        remaining = []
        for rev in self.state.pending_revisions:
            if rev.revision_id == revision_id:
                rev.applied = True
                applied = rev
            else:
                remaining.append(rev)
        self.state.pending_revisions = remaining
        if applied is not None:
            self.state.revision_history.append(applied)
        self.state.full_design = new_design
        self.state.phase = "ready"
        # Invalidate handler cache so subsequent /suggest-handlers calls
        # reflect the new design.
        self.state.handler_cache.clear()
        return new_design

    def drop_revision(self, revision_id: str) -> bool:
        ok = design_store.drop_revision(self.state.design_id, revision_id)
        if ok:
            self.state.pending_revisions = [
                r for r in self.state.pending_revisions if r.revision_id != revision_id
            ]
        return ok

    def restore_revision(self, revision_id: str) -> Optional[FullDesign]:
        new_design = design_store.restore_revision(self.state.design_id, revision_id)
        if new_design is None:
            return None
        self.state.full_design = new_design
        self.state.phase = "ready"
        self.state.handler_cache.clear()
        return new_design

    def apply_user_edit(
        self,
        after: FullDesign,
        change_summary: str,
    ) -> DesignRevision:
        """Manual UI edit path -- no LLM. Same revision pipeline."""
        if self.state.full_design is None:
            raise RuntimeError("no canonical design to edit")
        before = self.state.full_design.model_copy(deep=True)
        after.design_id = self.state.design_id
        revision = DesignRevision(
            revision_id=_short_id("usr-"),
            actor="user",
            request="manual UI edit",
            change_summary=change_summary or "manual edit",
            before=before,
            after=after,
            reasoning="User-applied edit via the design canvas.",
            applied=True,
            created_at=_now_iso(),
        )
        design_store.append_revision(self.state.design_id, revision)
        self.state.revision_history.append(revision)
        self.state.full_design = after
        design_store.save_design(after)
        self.state.handler_cache.clear()
        return revision

    def suggest_handlers_for_field(
        self,
        table: str,
        field: str,
        state_name: str,
    ) -> list[HandlerSketch]:
        """On-demand: HandlerSketches for a specific (table, field, state).

        Cached per (table, field, state) in ``state.handler_cache``.
        """
        cache_key = f"{table}|{field}|{state_name}"
        if cache_key in self.state.handler_cache:
            return self.state.handler_cache[cache_key]

        table_context_json = "{}"
        if self.state.full_design is not None:
            target = next(
                (sd for sd in self.state.full_design.schema_designs if sd.table_name == table),
                None,
            )
            if target is not None:
                table_context_json = target.model_dump_json(indent=2)

        crew = make_field_handler_crew(
            table_name=table,
            field_name=field,
            state_name=state_name,
            table_context_json=table_context_json,
        )
        try:
            result = crew.kickoff()
        except Exception as exc:  # noqa: BLE001
            logger.exception("design_flow: suggest_handlers failed (%s)", exc)
            return []

        sketch = _coerce_pydantic(result, HandlerSketch)
        sketches = [sketch] if sketch is not None else []
        self.state.handler_cache[cache_key] = sketches
        return sketches

    def critique(self, scope: str = "global") -> Optional[DesignCritique]:
        """Re-run the deterministic validator + DesignCriticAgent."""
        if self.state.full_design is None:
            return None
        issues = _deterministic_validate(self.state.full_design)
        critique = _run_critic(self.state.full_design, issues)
        if critique is None:
            critique = DesignCritique(summary="No semantic issues found.", issues=issues)
        else:
            critique.issues = list(issues) + list(critique.issues)
        self.state.full_design.critique = critique
        design_store.save_design(self.state.full_design)
        return critique


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _coerce_pydantic(crew_result: Any, model_cls):
    """Extract a Pydantic model instance from a CrewAI result."""
    if crew_result is None:
        return None
    # CrewAI may return CrewOutput-like object with .pydantic
    pyd = getattr(crew_result, "pydantic", None)
    if isinstance(pyd, model_cls):
        return pyd
    # Or a `.json_dict` attribute
    data = getattr(crew_result, "json_dict", None)
    if isinstance(data, dict):
        try:
            return model_cls(**data)
        except ValidationError:
            pass
    # Or raw text
    raw = getattr(crew_result, "raw", None) or str(crew_result)
    if isinstance(raw, str):
        try:
            return model_cls(**json.loads(raw))
        except (json.JSONDecodeError, ValidationError, TypeError):
            return None
    return None


def _merge_cluster_membership(
    seed: list[ClusterSpec],
    agent: list[ClusterSpec],
) -> list[ClusterSpec]:
    """Preserve deterministic cluster membership while keeping agent-provided
    names and rationales. Falls back to seed when the agent omits a cluster.
    """
    by_id = {c.cluster_id: c for c in agent}
    merged: list[ClusterSpec] = []
    for seed_cluster in seed:
        agent_cluster = by_id.get(seed_cluster.cluster_id)
        if agent_cluster is None:
            merged.append(seed_cluster)
            continue
        merged.append(
            ClusterSpec(
                cluster_id=seed_cluster.cluster_id,
                name=agent_cluster.name or seed_cluster.name,
                table_names=seed_cluster.table_names,  # deterministic
                rationale=agent_cluster.rationale or seed_cluster.rationale,
            )
        )
    return merged


def _run_critic(
    full: FullDesign, deterministic_issues: list[DesignIssue]
) -> Optional[DesignCritique]:
    summary = _full_design_summary(full)
    det_summary = _issues_summary(deterministic_issues)
    crew = make_critic_crew(
        full_design_summary=summary,
        deterministic_issues_summary=det_summary,
    )
    try:
        result = crew.kickoff()
    except Exception as exc:  # noqa: BLE001
        logger.exception("design_flow: critic crew failed (%s)", exc)
        return None
    return _coerce_pydantic(result, DesignCritique)


# ---------------------------------------------------------------------------
# Convenience: build a fresh DesignState/Flow per upload
# ---------------------------------------------------------------------------


def new_flow(design_id: Optional[str] = None, filename: str = "schema.xlsx") -> SchemaDesignFlow:
    """Construct a SchemaDesignFlow and seed minimal state."""
    design_id = design_id or _short_id("d-")
    flow = SchemaDesignFlow(design_id=design_id)
    flow.state.design_id = design_id
    flow.state.uploaded_filename = filename
    flow.state.excel_blob_id = design_id
    flow.state.phase = "parsing"
    return flow
