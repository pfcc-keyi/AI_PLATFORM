from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

FK_ACTIONS = Literal["CASCADE", "RESTRICT", "SET NULL", "SET DEFAULT", "NO ACTION"]

_FK_ACTION_NORMALIZE: dict[str, str] = {
    "no_action": "NO ACTION",
    "no action": "NO ACTION",
    "cascade": "CASCADE",
    "restrict": "RESTRICT",
    "set_null": "SET NULL",
    "set null": "SET NULL",
    "set_default": "SET DEFAULT",
    "set default": "SET DEFAULT",
}


class TransitionDesign(BaseModel):
    from_state: str
    to_state: str


class ColumnDesign(BaseModel):
    name: str
    pg_type: str
    nullable: bool = False
    check: Optional[str] = None
    default_expr: Optional[str] = None
    identity: bool = False
    unique: bool = False


class FKDesign(BaseModel):
    field: str
    references_table: str
    references_field: str
    on_delete: FK_ACTIONS = "NO ACTION"
    on_update: FK_ACTIONS = "NO ACTION"

    @field_validator("on_delete", "on_update", mode="before")
    @classmethod
    def _normalize_fk_action(cls, v: str) -> str:
        if isinstance(v, str):
            return _FK_ACTION_NORMALIZE.get(v.lower().strip(), v.upper())
        return v


class ActionDesign(BaseModel):
    name: str
    function_type: str  # insert, update, delete, bulk_insert, bulk_update, bulk_delete
    transition: TransitionDesign


class SchemaDesign(BaseModel):
    table_name: str
    table_category: str = Field(
        default="business",
        description="'lookup' for reference/list tables, 'business' for entity tables",
    )
    pk_field: str
    pk_strategy: str = "uuid4"
    pk_generator_description: str = Field(
        default="",
        description="Natural language description of custom PK generation logic, "
        "or empty for uuid4/sequence/passthrough",
    )
    states: list[str]
    transitions: list[TransitionDesign]
    columns: list[ColumnDesign]
    actions: list[ActionDesign]
    fk_definitions: list[FKDesign] = Field(default_factory=list)
    table_constraints: list[str] = Field(default_factory=list)


class HandlerPayloadField(BaseModel):
    name: str
    field_type: str = "text"
    required: bool = True
    description: str = ""
    date_conversion: bool = False


class HandlerStep(BaseModel):
    step_number: int
    description: str
    table_name: str = ""
    action_name: str = ""
    is_raw_query: bool = False
    raw_query_description: str = ""
    input_mapping: str = ""
    output_key: str = ""


class HandlerDesign(BaseModel):
    handler_name: str
    mode: str = Field(default="sync", description="'sync' or 'async'")
    description: str
    tables_used: list[str]
    payload_fields: list[HandlerPayloadField] = Field(default_factory=list)
    steps: list[HandlerStep] = Field(default_factory=list)
    error_handling: str = ""
    return_description: str = ""


class RequirementAnalysis(BaseModel):
    operation_type: str = Field(
        description="One of: new_table, new_action, new_handler, update_table"
    )
    is_lookup: bool = Field(
        default=False,
        description="True if the table is a lookup/reference table (simple code+name, no complex state machine)",
    )
    summary: str = Field(description="Brief summary of what the user wants")
    missing_info: bool = Field(
        default=False,
        description="True when key design decisions are missing.",
    )
    questions: list[str] = Field(
        default_factory=list,
        description="Specific questions about missing design decisions. Only populated when missing_info=true.",
    )
    design: Optional[SchemaDesign] = Field(
        default=None,
        description="Full SchemaDesign. Populated when operation_type is new_table and missing_info=false.",
    )
    handler_design: Optional[HandlerDesign] = Field(
        default=None,
        description="Handler design. Populated when operation_type is new_handler and missing_info=false.",
    )


class GeneratedCode(BaseModel):
    filename: str = Field(description="e.g. 'order.py' or 'place_order.py'")
    file_type: str = Field(description="'table' or 'handler'")
    content: str = Field(description="Complete Python source code")
