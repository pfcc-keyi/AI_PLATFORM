import random

from lib import (
    ActionDef,
    ColumnDef,
    FKDefinition,
    PKConfig,
    StateTransition,
    TableConfig,
)


def _generate_party_id(data: dict) -> str:
    """Generate party_id: first 2 letters of name (uppercased) + 6-digit zero-padded number."""
    name: str = data.get("name", "")
    prefix = (name[:2]).upper()
    suffix = str(random.randint(0, 999999)).zfill(6)
    return f"{prefix}{suffix}"


config = TableConfig(
    table_name="party",
    pk_field="party_id",
    pk_config=PKConfig(strategy="custom", generator=_generate_party_id),
    states=["draft", "active", "disabled"],
    transitions=[
        StateTransition(from_state="init", to_state="draft"),
        StateTransition(from_state="init", to_state="active"),
        StateTransition(from_state="draft", to_state="draft"),
        StateTransition(from_state="draft", to_state="active"),
        StateTransition(from_state="active", to_state="active"),
        StateTransition(from_state="active", to_state="disabled"),
        StateTransition(from_state="disabled", to_state="deleted"),
    ],
    columns=[
        ColumnDef(name="party_id", pg_type="text", nullable=False),
        ColumnDef(name="name", pg_type="text", nullable=False),
        ColumnDef(name="local_name", pg_type="text", nullable=True),
        ColumnDef(name="short_name", pg_type="text", nullable=True),
        ColumnDef(name="short_code", pg_type="text", nullable=True),
        ColumnDef(name="type", pg_type="text", nullable=False),
        ColumnDef(name="description", pg_type="text", nullable=True),
        ColumnDef(name="state", pg_type="text", nullable=False),
    ],
    fk_definitions=[
        FKDefinition(
            field="type",
            referenced_table="party_type_list",
            referenced_field="type",
            on_update="CASCADE",
            on_delete="RESTRICT",
        ),
    ],
    actions=[
        ActionDef(
            name="create_party_draft",
            function_type="insert",
            transition=StateTransition(from_state="init", to_state="draft"),
        ),
        ActionDef(
            name="update_party_draft",
            function_type="update",
            transition=StateTransition(from_state="draft", to_state="draft"),
        ),
        ActionDef(
            name="create_party_active",
            function_type="insert",
            transition=StateTransition(from_state="init", to_state="active"),
        ),
        ActionDef(
            name="activate_party",
            function_type="update",
            transition=StateTransition(from_state="draft", to_state="active"),
        ),
        ActionDef(
            name="party_update",
            function_type="update",
            transition=StateTransition(from_state="active", to_state="active"),
        ),
        ActionDef(
            name="disable_party",
            function_type="update",
            transition=StateTransition(from_state="active", to_state="disabled"),
        ),
        ActionDef(
            name="delete_party",
            function_type="delete",
            transition=StateTransition(from_state="disabled", to_state="deleted"),
        ),
    ],
)
