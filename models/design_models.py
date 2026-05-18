"""Pydantic models for the Schema Design Cockpit.

Extends the existing vocabulary in `models.config_models` so a finished design
is forward-compatible with the existing `ConfigFlow`. Snapshot-based revisions
(no JSON Patch grammar) keep the storage layer trivially diffable on the FE.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from models.config_models import HandlerDesign, SchemaDesign, TransitionDesign

__all__ = [
    "ParsedField",
    "ParsedTable",
    "ParsedSchema",
    "ClusterSpec",
    "DomainAnalysis",
    "HandlerSketch",
    "ClusterDesign",
    "TableLayout3D",
    "ERDLayout",
    "DesignIssue",
    "DesignCritique",
    "FullDesign",
    "DesignRevision",
    "DesignState",
    "TransitionDesign",
    "SchemaDesign",
    "HandlerDesign",
]


class ParsedField(BaseModel):
    """A single field/column row parsed from the Excel schema definition."""

    name: str
    full_name: str = ""
    definition: str = ""
    data_type: str = ""
    primary_key: bool = False
    foreign_key: Optional[str] = Field(
        default=None,
        description="Raw 'Table.Field' reference string from the Excel cell, or None.",
    )


class ParsedTable(BaseModel):
    """A single Entity grouping from the parsed Excel."""

    entity_name: str
    fields: list[ParsedField] = Field(default_factory=list)
    source_sheet: str = ""


class ParsedSchema(BaseModel):
    """Deterministic parse output of the uploaded workbook."""

    tables: list[ParsedTable] = Field(default_factory=list)
    sheet_count: int = 0
    fk_count: int = 0


class ClusterSpec(BaseModel):
    """A grouping of related tables. Initial partition is deterministic (Louvain),
    name and rationale are added by the `DomainAnalystAgent`."""

    cluster_id: str
    name: str = ""
    table_names: list[str] = Field(default_factory=list)
    rationale: str = ""


class DomainAnalysis(BaseModel):
    """Output of Phase 2 analyze step."""

    domain_guess: str = ""
    sub_domains: list[str] = Field(default_factory=list)
    clusters: list[ClusterSpec] = Field(default_factory=list)
    questions: list[str] = Field(
        default_factory=list,
        description="Clarifying questions for the user. Empty when the agent is ready to proceed.",
    )
    assumptions: list[str] = Field(default_factory=list)
    reasoning: str = ""


class HandlerSketch(HandlerDesign):
    """Handler suggestion enriched with state-machine context.

    Inherits the full `HandlerDesign` shape so the output is forward-compatible
    with the existing ConfigFlow's handler codegen.
    """

    trigger_state: str = ""
    target_state: str = ""
    fields_touched: list[str] = Field(default_factory=list)
    reasoning: str = ""


class ClusterDesign(BaseModel):
    """Per-cluster output of `ClusterDesignerAgent`."""

    cluster_id: str
    schema_designs: list[SchemaDesign] = Field(default_factory=list)
    handler_sketches: list[HandlerSketch] = Field(default_factory=list)
    reasoning: str = ""


class TableLayout3D(BaseModel):
    table_name: str
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    cluster_id: str = ""


class ERDLayout(BaseModel):
    tables: list[TableLayout3D] = Field(default_factory=list)
    edges: list[dict] = Field(
        default_factory=list,
        description="[{from_table, to_table, from_field, to_field}]",
    )


class DesignIssue(BaseModel):
    severity: Literal["info", "warning", "error"] = "info"
    target: str = Field(
        default="",
        description="Dotted target reference, e.g. 'table:Party' or 'field:Party.party_id'.",
    )
    message: str
    suggested_fix: str = ""


class DesignCritique(BaseModel):
    summary: str = ""
    issues: list[DesignIssue] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class FullDesign(BaseModel):
    """Canonical design artefact, persisted to the design store."""

    design_id: str
    created_at: str = ""
    parsed_schema: ParsedSchema = Field(default_factory=ParsedSchema)
    domain_analysis: DomainAnalysis = Field(default_factory=DomainAnalysis)
    schema_designs: list[SchemaDesign] = Field(default_factory=list)
    handler_sketches: list[HandlerSketch] = Field(default_factory=list)
    layout: ERDLayout = Field(default_factory=ERDLayout)
    critique: Optional[DesignCritique] = None
    user_notes: str = ""


class DesignRevision(BaseModel):
    """Snapshot-based revision -- the FE diffs `before` vs `after` client-side."""

    revision_id: str
    parent_revision_id: Optional[str] = None
    actor: Literal["user", "agent"] = "agent"
    request: str = ""
    change_summary: str = ""
    before: Optional[FullDesign] = None
    after: Optional[FullDesign] = None
    reasoning: str = ""
    created_at: str = ""
    applied: bool = False


# Allowed phase values for state.phase. Kept as a Literal-like string for
# forward compatibility -- flow methods set these strings directly.
DesignPhase = Literal[
    "parsing",
    "analyzing",
    "awaiting_clarification",
    "designing",
    "synthesizing",
    "awaiting_review",
    "refining",
    "ready",
    "rejected",
]


class DesignState(BaseModel):
    """CrewAI Flow state for `SchemaDesignFlow`.

    Mirrors the phase-based pattern in `ConfigFlow` so FastAPI resume endpoints
    can drive the flow forward by setting state + re-kickoff.
    """

    id: str = ""  # CrewAI flow state id (set by Flow framework)
    design_id: str = ""
    phase: str = "parsing"

    parsed_schema: Optional[ParsedSchema] = None
    clusters_raw: list[ClusterSpec] = Field(default_factory=list)
    domain_analysis: Optional[DomainAnalysis] = None

    clarifications: dict[str, str] = Field(default_factory=dict)
    clarification_round: int = 0

    cluster_designs: list[ClusterDesign] = Field(default_factory=list)
    full_design: Optional[FullDesign] = None

    pending_revisions: list[DesignRevision] = Field(default_factory=list)
    revision_history: list[DesignRevision] = Field(default_factory=list)

    # Key = "table|field|state" -- caches small per-field handler suggestions
    handler_cache: dict[str, list[HandlerSketch]] = Field(default_factory=dict)

    # Filename of the uploaded workbook (for display only).
    uploaded_filename: str = ""

    # Raw bytes are kept in module-level memory; not serialized in state.
    excel_blob_id: str = ""
