# Data Platform -- Usage Guide

## Table of Contents

1. [Project Setup](#1-project-setup)
2. [Writing a Table Configuration](#2-writing-a-table-configuration)
3. [PK Generation Strategies](#3-pk-generation-strategies)
4. [Binding Actions](#4-binding-actions)
5. [Non-Query Actions: Input, Output, and HTTP](#5-non-query-actions-input-output-and-http)
6. [Query Methods: Input, Output, and HTTP](#6-query-methods-input-output-and-http)
7. [Writing a Handler](#7-writing-a-handler)
8. [Error Handling and Debugging](#8-error-handling-and-debugging)
9. [Plugging in a DB Backend](#9-plugging-in-a-db-backend)
10. [Full End-to-End Example](#10-full-end-to-end-example)
11. [Admin Endpoints: Hot Reload + Schema Catalog](#11-admin-endpoints-hot-reload--schema-catalog)

---

## 1. Project Setup

### Directory layout

```
my_project/
  app.py                    # entry point: create registry, register tables, start app
  tables/                   # one .py file per table config
    orders.py
    order_lines.py
    inventory.py
    payments.py
  handlers/                 # one .py file per handler (auto-scanned)
    create_full_order.py
    order_report.py
    bulk_migrate.py
```

All table configs go in `tables/`. All handlers go in `handlers/`. The `app.py` wires everything together.

### app.py

```python
import asyncio
from lib import Registry
from lib.db.backends.asyncpg import AsyncpgBackend

from tables.orders import config as orders_config
from tables.order_lines import config as order_lines_config
from tables.inventory import config as inventory_config
from tables.payments import config as payments_config


async def setup():
    backend = AsyncpgBackend(dsn="postgresql://user:pass@localhost:5432/mydb")
    registry = Registry(db_backend=backend)

    await registry.register_table(orders_config, create_if_not_exists=True)
    await registry.register_table(order_lines_config, create_if_not_exists=True)
    await registry.register_table(inventory_config, create_if_not_exists=True)
    await registry.register_table(payments_config, create_if_not_exists=True)

    registry.scan_handlers("handlers/")

    app = registry.create_app()
    return app


app = asyncio.run(setup())
# Run with: uvicorn app:app --host 0.0.0.0 --port 8000
```

---

## 2. Writing a Table Configuration

A table configuration lives in `tables/{table_name}.py` and exports a `config` variable.

### Complete example: `tables/orders.py`

```python
from lib import (
    TableConfig, ColumnDef, FKDefinition, PKConfig,
    StateTransition, ActionDef,
)

config = TableConfig(
    table_name="orders",

    # -- PK strategy --
    pk_field="id",
    pk_config=PKConfig(strategy="uuid4"),

    # -- States: real values stored in the DB "state" column --
    states=["draft", "pending", "active", "inactive"],

    # -- Transitions: the allowed state graph --
    # "init" = virtual state (row doesn't exist yet)
    # "deleted" = virtual state (row is hard-deleted)
    transitions=[
        StateTransition(from_state="init",     to_state="draft"),
        StateTransition(from_state="draft",    to_state="pending"),
        StateTransition(from_state="pending",  to_state="active"),
        StateTransition(from_state="active",   to_state="inactive"),
        StateTransition(from_state="inactive", to_state="deleted"),
    ],

    # -- Columns: full DDL definition --
    # The platform uses these to generate CREATE TABLE DDL.
    # The "state" column MUST be included.
    columns=[
        ColumnDef(name="id",          pg_type="uuid",          nullable=False),
        ColumnDef(name="customer_id", pg_type="uuid",          nullable=False),
        ColumnDef(name="amount",      pg_type="numeric(12,2)", nullable=False, check="amount >= 0"),
        ColumnDef(name="note",        pg_type="text"),
        ColumnDef(name="created_at",  pg_type="timestamptz",   nullable=False, default_expr="now()"),
        ColumnDef(name="state",       pg_type="text",          nullable=False),
    ],

    # -- Foreign keys --
    fk_definitions=[
        FKDefinition(
            field="customer_id",
            referenced_table="customers",
            referenced_field="id",
            on_delete="RESTRICT",
        ),
    ],

    # -- Table-level CHECK constraints (optional) --
    # Use this for multi-column invariants that cannot be expressed
    # as a single ColumnDef.check.
    table_constraints=[
        "amount >= 0 OR note IS NOT NULL",
    ],

    # -- Actions: bind base functions to state transitions --
    actions=[
        ActionDef(name="create_order",    function_type="insert",      transition=StateTransition(from_state="init",     to_state="draft")),
        ActionDef(name="submit_order",    function_type="update",      transition=StateTransition(from_state="draft",    to_state="pending")),
        ActionDef(name="activate_order",  function_type="update",      transition=StateTransition(from_state="pending",  to_state="active")),
        ActionDef(name="deactivate",      function_type="update",      transition=StateTransition(from_state="active",   to_state="inactive")),
        ActionDef(name="remove_order",    function_type="delete",      transition=StateTransition(from_state="inactive", to_state="deleted")),
    ],
)
```

### What each section does

**`pk_field` + `pk_config`**: Determines the primary key column name and how PKs are generated (see Section 3).

**`states`**: List of real state values that can appear in the `state` column. Does NOT include virtual states `init` and `deleted`.

**`transitions`**: Defines the state machine graph. Every action must reference a transition from this list. You cannot have an action with a transition that isn't declared here.

**`columns`**: Full DDL column definitions. Used to generate `CREATE TABLE` and to validate existing table schema (types, nullability, UNIQUE, CHECK). You must include the `state` column and the PK column.

**`fk_definitions`**: Foreign key constraints. These are included in the DDL, enforced by the database, and validated during schema comparison.

**`table_constraints`**: Table-level CHECK constraints for multi-column rules (for example, `start_date <= end_date`). These are emitted as `CHECK (...)` in DDL and validated by schema comparison.

**`actions`**: The list of actions (see Section 4).

### ColumnDef options reference

| Field          | Type                              | Default  | Description                                            |
| -------------- | --------------------------------- | -------- | ------------------------------------------------------ |
| `name`         | `str`                             | required | Column name                                            |
| `pg_type`      | `str`                             | required | PostgreSQL type (e.g., `"text"`, `"numeric(12,2)"`)    |
| `nullable`     | `bool`                            | `True`   | Whether the column allows NULL                         |
| `default_expr` | `str \| None`                     | `None`   | SQL default expression (e.g., `"now()"`, `"0"`)        |
| `identity`     | `"always" \| "by_default" \| None`| `None`   | GENERATED AS IDENTITY (for auto-increment integer PKs) |
| `unique`       | `bool`                            | `False`  | UNIQUE constraint                                      |
| `check`        | `str \| None`                     | `None`   | CHECK constraint expression (e.g., `"amount >= 0"`)    |

### Table-level CHECK constraints

`TableConfig.table_constraints` is a list of SQL expressions, each emitted as `CHECK (expr)` at table level:

```python
config = TableConfig(
    ...,
    table_constraints=[
        "issue_size IS NULL OR circulation_size IS NULL OR (circulation_size BETWEEN 0 AND issue_size)",
        "maturity IS NULL OR listing_date IS NULL OR listing_date <= maturity",
    ],
)
```

Use column-level `ColumnDef.check` for single-column rules, and `table_constraints` for cross-column invariants.

---

## 3. PK Generation Strategies

### Strategy: `uuid4` (default)

The platform generates a UUID4 string before INSERT. The caller never provides the PK.

```python
pk_config=PKConfig(strategy="uuid4")
```

PK column definition:
```python
ColumnDef(name="id", pg_type="uuid", nullable=False)
```

### Strategy: `sequence`

The PK column is omitted from the INSERT statement. The database generates the value via IDENTITY or SERIAL. The generated PK is read back from `RETURNING *`.

```python
pk_config=PKConfig(strategy="sequence")
```

PK column definition:
```python
ColumnDef(name="id", pg_type="bigint", nullable=False, identity="always")
```

### Strategy: `custom`

You provide a callable that receives the row data and returns a PK string.

```python
import random, string

def order_id_generator(data: dict) -> str:
    prefix = "ORD"
    suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=10))
    return f"{prefix}-{suffix}"
    # -> "ORD-X7R2M9P4KL"

pk_config=PKConfig(
    strategy="custom",
    generator=order_id_generator,
    retry_on_conflict=3,     # retry if generated PK collides with existing row
)
```

Data-dependent custom PK:
```python
def customer_order_id(data: dict) -> str:
    customer_prefix = data.get("customer_name", "UNK")[:4].upper()
    seq = ''.join(random.choices(string.digits, k=6))
    return f"{customer_prefix}-{seq}"
    # data={"customer_name": "Walmart"} -> "WALM-482917"
```

PK column definition for custom strategy:
```python
ColumnDef(name="id", pg_type="varchar(20)", nullable=False)
```

---

## 4. Binding Actions

Every action binds a **base function type** to a **state transition**. This binding creates a callable method on the table's `TableHandle`.

### ActionDef fields

```python
ActionDef(
    name="create_order",        # method name and HTTP route segment
    function_type="insert",     # which base function: insert, update, delete, bulk_insert, bulk_update, bulk_delete
    transition=StateTransition(from_state="init", to_state="draft"),
)
```

### Rules for each function_type

| function_type   | from_state constraint     | to_state constraint     | What it does                |
| --------------- | ------------------------- | ----------------------- | --------------------------- |
| `insert`        | must be `"init"`          | any real state          | Insert one row              |
| `bulk_insert`   | must be `"init"`          | any real state          | Insert multiple rows        |
| `update`        | cannot be `"init"`        | cannot be `"deleted"`   | Update one row by PK        |
| `bulk_update`   | cannot be `"init"`        | cannot be `"deleted"`   | Update rows by conditions   |
| `delete`        | any real state            | must be `"deleted"`     | Delete one row by PK        |
| `bulk_delete`   | any real state            | must be `"deleted"`     | Delete rows by conditions   |

### Example actions for a typical orders table

```python
actions=[
    # INSERT: init -> draft (create a new order in draft state)
    ActionDef(name="create_order",       function_type="insert",      transition=StateTransition(from_state="init",     to_state="draft")),

    # BULK INSERT: init -> draft (create multiple orders at once)
    ActionDef(name="bulk_create_orders", function_type="bulk_insert", transition=StateTransition(from_state="init",     to_state="draft")),

    # UPDATE: draft -> pending (submit an order for review)
    ActionDef(name="submit_order",       function_type="update",      transition=StateTransition(from_state="draft",    to_state="pending")),

    # UPDATE: pending -> active (approve the order)
    ActionDef(name="activate_order",     function_type="update",      transition=StateTransition(from_state="pending",  to_state="active")),

    # BULK UPDATE: pending -> active (approve all pending orders matching conditions)
    ActionDef(name="bulk_activate",      function_type="bulk_update", transition=StateTransition(from_state="pending",  to_state="active")),

    # DELETE: inactive -> deleted (remove an inactive order)
    ActionDef(name="remove_order",       function_type="delete",      transition=StateTransition(from_state="inactive", to_state="deleted")),

    # BULK DELETE: inactive -> deleted (purge all inactive orders matching conditions)
    ActionDef(name="bulk_remove",        function_type="bulk_delete", transition=StateTransition(from_state="inactive", to_state="deleted")),
]
```

---

## 5. Non-Query Actions: Input, Output, and HTTP

Actions are the write path. Each `function_type` has a specific input/output contract. All actions can be called as Python functions or via HTTP.

### Auto Type Coercion

All action inputs and outputs are automatically coerced based on `ColumnDef.pg_type`. You can pass JSON-native values (strings, numbers) and they will be converted to the correct Python types for asyncpg. Returned rows are automatically converted to JSON-safe values.

**Input examples (what you can pass):**
- Date column (`pg_type="date"`): pass `"1990-05-20"` (ISO string) -- auto-converted to Python `date`
- Boolean column (`pg_type="boolean"`): pass `"true"`, `"false"`, `1`, `0` -- auto-converted to Python `bool`
- Integer column (`pg_type="integer"`): pass `"42"` (string) or `42` (number) -- both work
- Timestamp column (`pg_type="timestamptz"`): pass `"2025-01-15T10:30:00"` or `"2025-01-15 10:30:00"` -- auto-converted to Python `datetime`

**Output format:**
- `date` -> `"2025-01-15"` (ISO 8601)
- `timestamp` / `timestamptz` -> `"2025-01-15 10:30:00"` (space separator, matches Navicat/psql display)
- `numeric` / `Decimal` -> `99.99` (JSON number)
- `text`, `boolean`, `integer`, `float` -> unchanged (already JSON-safe)

If a value cannot be coerced (e.g., `"abc"` for a date column), the action returns `INVALID_INPUT` (HTTP 400) with a descriptive error message. No data is committed.

Handler authors who already pass Python `date`/`datetime` objects can continue doing so -- coercion is idempotent.

### 5.1 `insert`

Creates one new row.

**Python call:**
```python
orders = registry.table("orders")

result = await orders.create_order(
    data={"customer_id": "cust-001", "amount": 99.99, "note": "first order"}
)
```

**Input structure:**
```python
{
    "data": {                         # the row's business fields (required)
        "customer_id": "cust-001",
        "amount": 99.99,
        "note": "first order",
    }
}
# Do NOT include "id" or "state" -- they are injected automatically.
# Fields with default_expr (e.g., "created_at") can be omitted.
```

**Output structure (success):**
```python
{
    "success": True,
    "data": {                         # the full inserted row from RETURNING *
        "id": "a1b2c3d4-...",        # auto-generated PK
        "customer_id": "cust-001",
        "amount": 99.99,             # numeric -> float (auto-coerced)
        "note": "first order",
        "created_at": "2026-03-26 10:00:00+00:00",  # timestamp uses space separator
        "state": "draft",            # auto-injected from transition's to_state
    }
}
```

**HTTP request:**
```
POST /api/actions/orders/create_order
Content-Type: application/json

{
    "data": {
        "customer_id": "cust-001",
        "amount": "99.99",
        "note": "first order"
    }
}
```

Note: `"amount": "99.99"` (string) is auto-coerced to `Decimal("99.99")` for `numeric(12,2)`. You can also pass `99.99` (number) directly.

**HTTP response (success):**
```json
{
    "success": true,
    "data": {
        "id": "a1b2c3d4-...",
        "customer_id": "cust-001",
        "amount": 99.99,
        "note": "first order",
        "created_at": "2026-03-26 10:00:00+00:00",
        "state": "draft"
    }
}
```

### 5.2 `update`

Updates one existing row by PK. Partial update: only fields present in `data` are changed.

**Python call:**
```python
result = await orders.submit_order(
    pk="a1b2c3d4-...",
    data={"note": "rush delivery"}
)
```

**Input structure:**
```python
{
    "pk": "a1b2c3d4-...",             # primary key of the row to update (required)
    "data": {                         # fields to update (partial -- unlisted fields unchanged)
        "note": "rush delivery",
    }
}
# Do NOT include "state" -- it is injected automatically from the transition's to_state.
```

**Output structure (success):**
```python
{
    "success": True,
    "data": {                         # the full updated row from RETURNING *
        "id": "a1b2c3d4-...",
        "customer_id": "cust-001",
        "amount": 99.99,
        "note": "rush delivery",      # updated
        "created_at": "2026-03-26 10:00:00+00:00",
        "state": "pending",           # changed from "draft" to "pending" by transition
    }
}
```

**HTTP request:**
```
POST /api/actions/orders/submit_order
Content-Type: application/json

{
    "pk": "a1b2c3d4-...",
    "data": {
        "note": "rush delivery"
    }
}
```

**HTTP response (success):**
```json
{
    "success": true,
    "data": {
        "id": "a1b2c3d4-...",
        "customer_id": "cust-001",
        "amount": 99.99,
        "note": "rush delivery",
        "created_at": "2026-03-26 10:00:00+00:00",
        "state": "pending"
    }
}
```

### 5.3 `delete`

Hard-deletes one row by PK.

**Python call:**
```python
result = await orders.remove_order(pk="a1b2c3d4-...")
```

**Input structure:**
```python
{
    "pk": "a1b2c3d4-...",             # primary key of the row to delete (required)
}
# No "data" field needed. The row is deleted.
```

**Output structure (success):**
```python
{
    "success": True,
    "data": {                         # the deleted row's data (from RETURNING * before deletion)
        "id": "a1b2c3d4-...",
        "customer_id": "cust-001",
        "amount": 99.99,
        "note": "rush delivery",
        "created_at": "2026-03-26 10:00:00+00:00",
        "state": "inactive",         # the state the row was in before deletion
    }
}
```

**HTTP request:**
```
POST /api/actions/orders/remove_order
Content-Type: application/json

{
    "pk": "a1b2c3d4-..."
}
```

### 5.4 `bulk_insert`

Inserts multiple rows in one SQL statement.

**Python call:**
```python
result = await orders.bulk_create_orders(rows=[
    {"customer_id": "cust-001", "amount": 50.00},
    {"customer_id": "cust-002", "amount": 75.00},
    {"customer_id": "cust-003", "amount": 120.00},
])
```

**Input structure:**
```python
{
    "rows": [                         # list of row dicts (required)
        {"customer_id": "cust-001", "amount": 50.00},
        {"customer_id": "cust-002", "amount": 75.00},
        {"customer_id": "cust-003", "amount": 120.00},
    ]
}
# Each row gets its own auto-generated PK and state injection.
```

**Output structure (success):**
```python
{
    "success": True,
    "data": {
        "count": 3,                   # number of rows inserted
        "pks": [                      # list of generated PKs (from RETURNING {pk_field})
            "uuid-1", "uuid-2", "uuid-3",
        ],
    }
}
```

**HTTP request:**
```
POST /api/actions/orders/bulk_create_orders
Content-Type: application/json

{
    "rows": [
        {"customer_id": "cust-001", "amount": 50.00},
        {"customer_id": "cust-002", "amount": 75.00}
    ]
}
```

### 5.5 `bulk_update`

Updates all rows matching conditions. All matched rows get the same SET values.

**Python call:**
```python
result = await orders.bulk_activate(
    data={"note": "batch approved"},
    conditions=[("amount", ">", 100), ("customer_id", "=", "cust-001")]
)
```

**Input structure:**
```python
{
    "data": {                         # fields to SET on all matched rows (required)
        "note": "batch approved",
    },
    "conditions": [                   # filter for which rows to update (required)
        ("amount", ">", 100),
        ("customer_id", "=", "cust-001"),
    ]
}
# The platform auto-appends a state condition: ("state", "=", from_state)
# So the actual WHERE is: amount > 100 AND customer_id = 'cust-001' AND state = 'pending'
```

**Output structure (success):**
```python
{
    "success": True,
    "data": {
        "count": 5,                   # number of rows updated
        "pks": [...],                 # list of PKs of updated rows (from RETURNING {pk_field})
    }
}
```

**HTTP request:**
```
POST /api/actions/orders/bulk_activate
Content-Type: application/json

{
    "data": {"note": "batch approved"},
    "conditions": [["amount", ">", 100]]
}
```

### 5.6 `bulk_delete`

Deletes all rows matching conditions.

**Python call:**
```python
result = await orders.bulk_remove(
    conditions=[("customer_id", "=", "cust-old")]
)
```

**Input structure:**
```python
{
    "conditions": [                   # filter for which rows to delete (required)
        ("customer_id", "=", "cust-old"),
    ]
}
# The platform auto-appends: ("state", "=", from_state)
```

**Output structure (success):**
```python
{
    "success": True,
    "data": {
        "count": 12,                  # number of rows deleted
        "pks": [...],                 # list of PKs of deleted rows (from RETURNING {pk_field})
    }
}
```

---

## 6. Query Methods: Input, Output, and HTTP

Queries are the read path. Every registered table gets 4 built-in query methods automatically. No `ActionDef` needed.

**Type coercion also applies to queries:** condition values are auto-coerced (e.g., `("date_of_birth", ">", "1990-01-01")` -- the string is converted to a `date` object), and returned rows are auto-coerced to JSON-safe values (e.g., `date` -> ISO string, `Decimal` -> float, `datetime` -> space-separated ISO).

### 6.1 `get_by_pk`

Fetch a single row by primary key.

**Python call:**
```python
orders = registry.table("orders")

result = await orders.get_by_pk("a1b2c3d4-...")

# With column selection:
result = await orders.get_by_pk("a1b2c3d4-...", select=["id", "amount", "state"])
```

**Input structure:**
```python
get_by_pk(pk, select=None)
# pk: the primary key value (required)
# select: list of column names to return (optional, default = all columns)
```

**Output structure:**
```python
{
    "success": True,
    "data": {                         # the row, or None if not found
        "id": "a1b2c3d4-...",
        "amount": 99.99,
        "state": "draft",
    }
}
```

**HTTP request:**
```
POST /api/queries/orders/get_by_pk
Content-Type: application/json

{
    "pk": "a1b2c3d4-...",
    "select": ["id", "amount", "state"]
}
```

**HTTP response:**
```json
{
    "success": true,
    "data": {
        "id": "a1b2c3d4-...",
        "amount": 99.99,
        "state": "draft"
    }
}
```

### 6.2 `list`

Fetch multiple rows with filtering, ordering, and pagination.

**Python call:**
```python
result = await orders.list(
    select=["id", "amount", "state", "customer_id"],
    conditions=[("state", "=", "active"), ("amount", ">", 50)],
    order_by=[("amount", "desc"), ("created_at", "asc")],
    limit=20,
    offset=0,
)
```

**Input structure:**
```python
list(
    select=None,          # column names to return (optional, default = all)
    conditions=None,      # filter conditions (optional)
    order_by=None,        # sort order as list of (field, "asc"|"desc") (optional)
    limit=None,           # max rows to return (optional, capped at 500)
    offset=None,          # skip first N rows (optional)
)
```

**Output structure:**
```python
{
    "success": True,
    "data": [                         # list of matching rows
        {"id": "uuid-1", "amount": 200.00, "state": "active", "customer_id": "cust-001"},
        {"id": "uuid-2", "amount": 150.00, "state": "active", "customer_id": "cust-002"},
    ],
    "meta": {
        "limit": 20,
        "offset": 0,
        "count": 2,                   # number of rows returned (not total matching)
    }
}
```

**HTTP request:**
```
POST /api/queries/orders/list
Content-Type: application/json

{
    "select": ["id", "amount", "state"],
    "conditions": [["state", "=", "active"], ["amount", ">", 50]],
    "order_by": [["amount", "desc"]],
    "limit": 20,
    "offset": 0
}
```

**HTTP response:**
```json
{
    "success": true,
    "data": [
        {"id": "uuid-1", "amount": 200.00, "state": "active"},
        {"id": "uuid-2", "amount": 150.00, "state": "active"}
    ],
    "meta": {"limit": 20, "offset": 0, "count": 2}
}
```

### 6.3 `count`

Count rows matching conditions.

**Python call:**
```python
result = await orders.count(conditions=[("state", "=", "active")])
```

**Output structure:**
```python
{"success": True, "data": {"count": 42}}
```

**HTTP request:**
```
POST /api/queries/orders/count
Content-Type: application/json

{
    "conditions": [["state", "=", "active"]]
}
```

### 6.4 `exists`

Check if any row matches conditions.

**Python call:**
```python
result = await orders.exists(conditions=[("id", "=", "a1b2c3d4-...")])
```

**Output structure:**
```python
{"success": True, "data": {"exists": True}}
```

**HTTP request:**
```
POST /api/queries/orders/exists
Content-Type: application/json

{
    "conditions": [["id", "=", "a1b2c3d4-..."]]
}
```

### 6.5 Advanced condition operators

All query methods (and bulk actions) support the full set of condition operators:

**IN -- match any value in a list:**
```python
result = await orders.list(
    conditions=[("state", "IN", ["active", "pending"])]
)
```

```json
POST /api/queries/orders/list
{"conditions": [["state", "IN", ["active", "pending"]]]}
```

**NOT IN -- exclude values in a list:**
```python
result = await orders.list(
    conditions=[("state", "NOT IN", ["deleted", "inactive"])]
)
```

**LIKE -- pattern matching (case-sensitive):**
```python
result = await orders.list(
    conditions=[("note", "LIKE", "%rush%")]
)
```

```json
POST /api/queries/orders/list
{"conditions": [["note", "LIKE", "%rush%"]]}
```

**ILIKE -- pattern matching (case-insensitive):**
```python
result = await orders.list(
    conditions=[("note", "ILIKE", "%RUSH%")]
)
```

**IS NULL / IS NOT NULL:**
```python
result = await orders.list(
    conditions=[("note", "IS NULL", None)]
)

result = await orders.list(
    conditions=[("note", "IS NOT NULL", None)]
)
```

```json
POST /api/queries/orders/list
{"conditions": [["note", "IS NULL", null]]}
```

**Combining operators:**
```python
result = await orders.list(
    conditions=[
        ("state", "IN", ["active", "pending"]),
        ("amount", ">", 100),
        ("note", "IS NOT NULL", None),
        ("customer_id", "LIKE", "cust-%"),
    ],
    order_by=[("amount", "desc")],
    limit=50,
)
```

### Using queries in handlers

Inside a handler, queries share the handler's transaction (read-your-writes):

```python
async def handle(ctx, payload):
    order = await ctx.orders.get_by_pk(payload["order_id"])

    if order["data"] is None:
        raise HandlerError(message="Order not found", http_status=404)

    if order["data"]["amount"] > 1000:
        await ctx.orders.activate_order(pk=payload["order_id"], data={})

    count = await ctx.orders.count(conditions=[("state", "=", "active")])
    return {"activated": True, "active_count": count["data"]["count"]}
```

---

## 7. Writing a Handler

> **Comprehensive reference:** See [handler_guide.md](handler_guide.md) for the full handler development guide, including transaction model, step tracking, error propagation flow, validation endpoint details, and best practices.

### Basic handler structure (sync)

Create a `.py` file in the `handlers/` directory. The file name becomes the handler name and URL.

**`handlers/create_full_order.py`:**

```python
from lib import HandlerError, ActionError

MODE = "sync"    # "sync" or "async"

async def handle(ctx, payload: dict):
    # payload = the raw HTTP request body (any shape you define)

    # --- validate input ---
    customer_id = payload.get("customer_id")
    if not customer_id:
        raise HandlerError(message="customer_id is required", http_status=400)

    items = payload.get("items", [])
    if not items:
        raise HandlerError(message="items cannot be empty", http_status=400)

    # --- call actions across multiple tables ---
    total = sum(item["price"] * item["qty"] for item in items)

    order = await ctx.orders.create_order(data={
        "customer_id": customer_id,
        "amount": total,
    })
    order_id = order["data"]["id"]

    line_result = await ctx.order_lines.bulk_create_lines(rows=[
        {
            "order_id": order_id,
            "product_id": item["product_id"],
            "quantity": item["qty"],
            "unit_price": item["price"],
        }
        for item in items
    ])

    # --- return custom response ---
    return {
        "order_id": order_id,
        "total": total,
        "line_count": line_result["data"]["count"],
    }
```

**HTTP usage:**
```
POST /api/handlers/create_full_order
Content-Type: application/json

{
    "customer_id": "cust-001",
    "items": [
        {"product_id": "prod-A", "qty": 2, "price": 29.99},
        {"product_id": "prod-B", "qty": 1, "price": 49.99}
    ]
}
```

**Response (success -- HTTP 200):**
```json
{
    "success": true,
    "data": {
        "order_id": "a1b2c3d4-...",
        "total": 109.97,
        "line_count": 2
    }
}
```

### Accessing full row data after bulk operations

Bulk actions (`bulk_insert`, `bulk_update`, `bulk_delete`) return `{"count": N, "pks": [...]}` instead of full rows. This avoids transferring potentially massive result sets (e.g., 60,000 rows x 10 columns) that the caller usually does not need.

If a handler needs the full row data after a bulk insert, query explicitly:

```python
result = await ctx.order_lines.bulk_create_lines(rows=prepared)
pks = result["data"]["pks"]

full_rows = await ctx.order_lines.list(
    conditions=[("line_id", "IN", pks)],
    limit=len(pks),
)
```

This makes the data transfer cost an explicit opt-in rather than a silent default. For most use cases, the count and PKs are sufficient -- the handler already has the input data it sent.

### Async handler (background execution)

For long-running operations, declare `MODE = "async"`. The HTTP request returns immediately with a `task_id`.

**`handlers/bulk_migrate.py`:**

```python
from lib import HandlerError

MODE = "async"

async def handle(ctx, payload: dict):
    source_state = payload.get("from_state", "pending")
    target_state_action = payload.get("action", "activate_order")
    limit = payload.get("limit", 1000)

    orders = await ctx.orders.list(
        conditions=[("state", "=", source_state)],
        limit=limit,
    )

    migrated = 0
    for order in orders["data"]:
        action_fn = getattr(ctx.orders, target_state_action)
        await action_fn(pk=order["id"], data={})
        migrated += 1

    return {"migrated": migrated, "source_state": source_state}
```

**HTTP request:**
```
POST /api/handlers/bulk_migrate
Content-Type: application/json

{"from_state": "pending", "action": "activate_order", "limit": 500}
```

**Immediate response (HTTP 202):**
```json
{
    "success": true,
    "task_id": "e4f5a6b7-...",
    "status": "accepted"
}
```

**Poll for result:**
```
GET /api/tasks/e4f5a6b7-...
```

**Poll response (running):**
```json
{
    "task_id": "e4f5a6b7-...",
    "handler_name": "bulk_migrate",
    "status": "running",
    "created_at": "2026-03-26T10:00:00+00:00"
}
```

**Poll response (completed):**
```json
{
    "task_id": "e4f5a6b7-...",
    "handler_name": "bulk_migrate",
    "status": "completed",
    "result": {"migrated": 42, "source_state": "pending"},
    "created_at": "2026-03-26T10:00:00+00:00",
    "completed_at": "2026-03-26T10:00:05+00:00"
}
```

**Poll response (failed):**
```json
{
    "task_id": "e4f5a6b7-...",
    "handler_name": "bulk_migrate",
    "status": "failed",
    "error": {
        "code": "ACTION_FAILED",
        "message": "Action 'orders.activate_order' failed: ...",
        "detail": {
            "failed_action": {...},
            "completed_actions": [...]
        }
    },
    "created_at": "2026-03-26T10:00:00+00:00",
    "completed_at": "2026-03-26T10:00:03+00:00"
}
```

**Task not found:**
```
GET /api/tasks/nonexistent-id

HTTP 404
{"success": false, "error": {"code": "NOT_FOUND", "message": "Task 'nonexistent-id' not found"}}
```

### Handler with error catching

```python
from lib import HandlerError, ActionError

MODE = "sync"

async def handle(ctx, payload: dict):
    order = await ctx.orders.create_order(data={
        "customer_id": payload["customer_id"],
        "amount": payload["amount"],
    })

    try:
        await ctx.inventory.deduct_stock(
            data={"qty_delta": -payload["quantity"]},
            conditions=[("product_id", "=", payload["product_id"])],
        )
    except ActionError as e:
        raise HandlerError(
            message=f"Cannot deduct stock: {e.message}",
            detail={
                "product_id": payload["product_id"],
                "requested_qty": payload["quantity"],
                "action_error_code": e.code,
            },
            http_status=409,
        )

    return {"order_id": order["data"]["id"], "status": "fulfilled"}
```

### Read-only handler (query-only, using `raw_query`)

```python
MODE = "sync"

async def handle(ctx, payload: dict):
    customer_id = payload["customer_id"]

    active_orders = await ctx.orders.list(
        select=["id", "amount", "state"],
        conditions=[("customer_id", "=", customer_id), ("state", "=", "active")],
    )

    summary = await ctx.raw_query(
        "SELECT o.id, o.amount, p.method, p.state as payment_state "
        "FROM orders o JOIN payments p ON p.order_id = o.id "
        "WHERE o.customer_id = $1 AND o.state = 'active'",
        [customer_id],
    )

    return {
        "customer_id": customer_id,
        "active_order_count": len(active_orders["data"]),
        "details": summary,
    }
```

### Key rules for handler files

1. **File name = handler name = URL segment.** `handlers/my_handler.py` -> `POST /api/handlers/my_handler`
2. **Must define `async def handle(ctx, payload)`.** This is the entry point.
3. **`MODE` variable is optional.** Defaults to `"sync"` if not specified. Set to `"async"` for background execution.
4. **No decorators, no `register()` calls.** Just write the function.
5. **`ctx.{table_name}`** gives you a tracked `TableHandle` bound to the shared transaction.
6. **`ctx.raw_query(sql, params)`** for custom SQL.
7. **Return value** becomes the response `data` field (sync) or the `result` field in the task record (async).
8. **All actions share one transaction.** If any fails, everything rolls back.
9. **Files starting with `_` are skipped** during auto-scan.
10. **Step tracking is automatic.** All action calls through `ctx` are tracked. On failure, the error response includes which step failed and which prior steps were rolled back.
11. **No manual type conversion needed.** The platform auto-coerces date strings, boolean strings, numeric strings, etc. based on `ColumnDef.pg_type`. You can pass `"1990-05-20"` directly in `data` and the `date` column will receive a Python `date` object. If your handler already converts types manually (e.g., `date.fromisoformat()`), it still works -- coercion is idempotent.

---

## 8. Error Handling and Debugging

### Error code registry

All error codes are defined as constants in `lib/errors.py` (`ErrorCode` class) and mapped to HTTP status codes via `HTTP_STATUS`. Import them with:

```python
from lib.errors import ErrorCode, HTTP_STATUS
```

### Error response envelope

All errors follow the same structure:

```json
{
    "success": false,
    "error": {
        "code": "ERROR_CODE",
        "message": "Human-readable message",
        "details": {}
    }
}
```

Handler errors use `"detail"` (singular) instead of `"details"` -- this is intentional because handler errors carry structured step-tracking data rather than simple field-level details.

### Error codes reference

| Code               | Source            | Meaning                                                  | HTTP Status | Layer                    |
| ------------------ | ----------------- | -------------------------------------------------------- | ----------- | ------------------------ |
| `INVALID_INPUT`    | Input validation / type coercion  | Malformed conditions, bad JSON, structural input errors, type coercion failures (e.g., `"abc"` for a `date` column)  | 400         | HTTP route, action executor, query executor, TypeCoercer |
| `FIELD_REQUIRED`   | DB NOT NULL       | A non-nullable field was null or missing                 | 422         | Error translator         |
| `FK_VIOLATION`     | DB FK constraint  | Referenced row doesn't exist in target table             | 422         | Error translator         |
| `FK_RESTRICT`      | DB FK constraint  | Cannot delete: other rows reference this row             | 409         | Error translator         |
| `UNIQUE_VIOLATION` | DB UNIQUE         | Duplicate value for a unique column                      | 409         | Error translator         |
| `CHECK_VIOLATION`  | DB CHECK          | Value violates a CHECK constraint                        | 422         | Error translator         |
| `STATE_MISMATCH`   | CAS predicate     | Row's current state doesn't match the action's from_state| 409         | Action executor          |
| `MISSING_PK`       | ActionExecutor    | `pk` was not provided for update/delete                  | 400         | Action executor          |
| `PK_CONFLICT`      | PK generator      | Custom PK generator failed after retries                 | 409         | Action executor, pk.py   |
| `DB_ERROR`         | Error translator  | Unrecognized database error (fallback)                   | 400         | Error translator         |
| `NOT_FOUND`        | HTTP route        | Table, action, handler, query method, or task not found  | 404         | HTTP route, registry     |
| `HANDLER_ERROR`    | Handler author    | Custom error raised by handler code                      | varies      | Handler function         |
| `ACTION_FAILED`    | Handler executor  | Action failed inside handler (uncaught)                  | 409         | Handler executor         |
| `RAW_QUERY_ERROR`  | Handler context   | `ctx.raw_query(...)` execution failed                    | 500         | Handler context          |
| `HANDLER_RUNTIME_ERROR` | Handler executor | Unexpected exception in handler logic                | 500         | Handler executor         |
| `INFRA_ERROR`      | Handler executor  | Connection/network/timeout failure                       | 503         | Handler executor         |
| `INTERNAL_ERROR`   | Platform          | Truly unknown/unmapped platform fallback (e.g., action executor or HTTP route fallback) | 500         | Platform fallback path   |

### Error codes by execution path

The following tables show which error codes you can encounter in each execution path, and which layer produces them.

#### Path 1: Action -- Function call (standalone)

`await handle.create_order(data={...})` -- called from Python code, no HTTP.

| Error Code         | Layer              | Trigger                                       |
| ------------------ | ------------------ | --------------------------------------------- |
| `INVALID_INPUT`    | Action executor / TypeCoercer | Malformed params/conditions (e.g. bad operator), type coercion failures (e.g. invalid date string) |
| `MISSING_PK`       | Action executor    | `pk` not provided for update/delete           |
| `STATE_MISMATCH`   | Action executor    | Row not in expected `from_state`              |
| `PK_CONFLICT`      | Action executor    | PK generation exhausted retries               |
| `INTERNAL_ERROR`   | Action executor (Path 1 example) | Unknown `function_type` (platform fallback when unmapped) |
| `FIELD_REQUIRED`   | Error translator   | NOT NULL violation                            |
| `FK_VIOLATION`     | Error translator   | FK reference doesn't exist                    |
| `FK_RESTRICT`      | Error translator   | FK prevents delete (row still referenced)     |
| `UNIQUE_VIOLATION` | Error translator   | Duplicate value on UNIQUE column              |
| `CHECK_VIOLATION`  | Error translator   | CHECK constraint violated                     |
| `DB_ERROR`         | Error translator   | Unrecognized DB exception                     |

All errors are raised as `ActionError`.

`INTERNAL_ERROR` in this Path 1 table is a path-specific example. In other execution paths, the same code may also appear as a platform-level fallback (for example, an uncaught exception in HTTP route fallback logic).

#### Path 2: Action -- HTTP

`POST /api/actions/{table}/{action}` -- called via HTTP.

| Error Code         | Layer              | Trigger                                       |
| ------------------ | ------------------ | --------------------------------------------- |
| `NOT_FOUND`        | HTTP route         | Table or action not registered                |
| `INVALID_INPUT`    | HTTP route / action executor / TypeCoercer | Bad JSON body, non-object JSON body, malformed params/conditions, or type coercion failures |
| *(all from Path 1)*| Action executor    | *(same triggers as standalone)*               |

The HTTP route validates JSON/body structure, catches `ActionError`, and maps `error.code` to an HTTP status via `HTTP_STATUS`. Malformed action params/conditions are raised from the action path as `ActionError(code=INVALID_INPUT)`.

#### Path 3: Handler -- Sync

`POST /api/handlers/{name}` with `MODE="sync"`.

| Error Code         | Layer              | Trigger                                       |
| ------------------ | ------------------ | --------------------------------------------- |
| `NOT_FOUND`        | Registry / route   | Handler not registered                        |
| `INVALID_INPUT`    | HTTP route         | Bad JSON body or non-object JSON body         |
| `HANDLER_ERROR`    | Handler function   | Handler author raises `HandlerError`          |
| `ACTION_FAILED`    | Handler executor   | An action inside the handler raised `ActionError`; wraps original error code in `detail.failed_action.error_code` |
| `RAW_QUERY_ERROR`  | Handler context    | `ctx.raw_query(...)` failed                   |
| `INFRA_ERROR`      | Handler executor   | `ConnectionError`, `OSError`, or `TimeoutError` during handler execution |
| `HANDLER_RUNTIME_ERROR` | Handler executor | Any other unexpected exception in handler logic |

When `ACTION_FAILED` is returned, inspect `detail.failed_action` for the original error code (e.g., `FK_VIOLATION`) and `detail.completed_actions` for rolled-back steps.

Handler results are automatically serialized to JSON-safe types before the transaction is committed. Types like `datetime.date`, `uuid.UUID`, and `decimal.Decimal` returned by asyncpg are converted automatically -- handler authors do not need to write manual serialization helpers.

Type coercion errors (e.g., passing `"bad-date"` to a `date` column) inside a handler are surfaced as `ACTION_FAILED` with the original `INVALID_INPUT` error code in `detail.failed_action.error_code`. The entire handler transaction is rolled back, and all completed steps are marked as `rolled_back`.

#### Path 4: Handler -- Async

`POST /api/handlers/{name}` with `MODE="async"`.

The HTTP response is always `202 Accepted` with a `task_id`. Errors appear in the task record, retrieved via `GET /api/tasks/{task_id}`.

| Error Code         | Layer              | Where it appears                              |
| ------------------ | ------------------ | --------------------------------------------- |
| `NOT_FOUND`        | Registry / route   | HTTP 404 (before task creation)               |
| `INVALID_INPUT`    | HTTP route         | HTTP 400 for bad JSON/non-object JSON body (before task creation) |
| `HANDLER_ERROR`    | Background task    | `task.error.code`                             |
| `ACTION_FAILED`    | Background task    | `task.error.code` + `task.error.detail`       |
| `RAW_QUERY_ERROR`  | Background task    | `task.error.code`                             |
| `INFRA_ERROR`      | Background task    | `task.error.code`                             |
| `HANDLER_RUNTIME_ERROR` | Background task | `task.error.code`                            |

#### Path 5: Query actions (list, get_by_pk, count, exists)

`POST /api/queries/{table}/{method}`.

| Error Code         | Layer              | Trigger                                       |
| ------------------ | ------------------ | --------------------------------------------- |
| `NOT_FOUND`        | HTTP route         | Table or query method not found               |
| `INVALID_INPUT`    | HTTP route / TypeCoercer | Bad JSON body, non-object JSON body, bad conditions (ValueError), or type coercion failures in condition values |
| `DB_ERROR`         | HTTP route         | Unexpected DB exception during query          |

Query actions are read-only. DB constraint errors are not expected, but any exception is caught and returned as `DB_ERROR` rather than an unhandled 500.

#### Path 6: Raw query (inside handlers)

`ctx.raw_query(sql, params)` -- available only inside handler functions.

| Error Code         | Layer              | Trigger                                       |
| ------------------ | ------------------ | --------------------------------------------- |
| `RAW_QUERY_ERROR`  | Handler context    | Any exception from the raw SQL execution      |

Raw query errors are **not** translated through `error_translator` because they are arbitrary SQL. `HandlerContext.raw_query()` catches all exceptions and wraps them as `HandlerError(code=RAW_QUERY_ERROR)`, which flows through the existing `except HandlerError` handler in the executor.

### Debugging: where is the error from?

**Step 1: Check `error.code`**

The `code` field tells you the category:
- `FIELD_REQUIRED`, `FK_VIOLATION`, `CHECK_VIOLATION` (HTTP 422) -- the data you sent is **semantically invalid**. The database rejected it.
- `STATE_MISMATCH`, `UNIQUE_VIOLATION`, `FK_RESTRICT`, `PK_CONFLICT` (HTTP 409) -- there is a **conflict** with existing state. The row is in the wrong state, or the value already exists.
- `MISSING_PK`, `DB_ERROR`, `INVALID_INPUT` (HTTP 400) -- the request is **malformed**, a value could not be coerced to the column's type (e.g., invalid date string), or triggered an unrecognized database error.
- `HANDLER_ERROR` -- the handler author raised this error intentionally. Read `message` and `detail`.
- `ACTION_FAILED` (HTTP 409) -- an action failed inside a handler. Check `detail.failed_action` for which table/action/step failed and the original `error_code`.
- `NOT_FOUND` (HTTP 404) -- the table, action, handler, query method, or task ID does not exist.
- `RAW_QUERY_ERROR` (HTTP 500) -- a `ctx.raw_query(...)` call failed. Check the SQL and parameters.
- `INFRA_ERROR` (HTTP 503) -- a connection, network, or timeout failure. Check database connectivity and infrastructure.
- `HANDLER_RUNTIME_ERROR` (HTTP 500) -- an unexpected exception in handler logic (e.g., `TypeError`, `ValueError`). Check handler code for bugs.
- `INTERNAL_ERROR` (HTTP 500) -- a truly unknown/unmapped platform fallback (for example, unknown action `function_type` or an uncaught handler-route exception). This should be rare; report it as a bug.

**Step 2: Read `error.message`**

The message is human-readable and specific. Examples:
- `"field 'customer_id' cannot be null"` -- you forgot to include `customer_id` in the data
- `"referenced row does not exist in 'party_type_list' for type"` -- the `type` value doesn't exist in the `party_type_list` table
- `"expected state 'pending' but row not found or state differs"` -- the row is not in `pending` state

**Step 3: Check `error.details`**

For DB constraint errors, details include the specific field, constraint name, or referenced table:

| Error Code         | `details` contents                              |
| ------------------ | ----------------------------------------------- |
| `FIELD_REQUIRED`   | `{"field": "customer_id"}`                      |
| `FK_VIOLATION`     | `{"field": "type", "referenced_table": "party_type_list"}` |
| `FK_RESTRICT`      | `{"referenced_by": "orders"}`                   |
| `UNIQUE_VIOLATION` | `{"field": "email"}`                            |
| `CHECK_VIOLATION`  | `{"constraint": "orders_amount_check"}`         |
| `STATE_MISMATCH`   | `{"pk": "...", "expected_state": "draft"}`      |
| `DB_ERROR`         | `{"original": "..."}`                           |

For handler errors, `detail` contains step-tracking data (see examples below).

### Error translation pipeline

The error translator (`action/error_translator.py`) converts raw DB exceptions into structured `ActionError` objects using a three-tier extraction strategy:

1. **asyncpg structured attributes** (preferred): read `exc.column_name`, `exc.table_name`, `exc.constraint_name`, `exc.detail` directly from the exception object.
2. **DETAIL string regex**: parse the PostgreSQL DETAIL line, e.g., `Key (type)=(PERSO) is not present in table "party_type_list"`.
3. **Message substring fallback**: search the main error message for keywords like `column`, `table`, `constraint` (for non-asyncpg backends).

This ensures accurate field/table extraction regardless of whether the exception comes from asyncpg (with structured attributes) or another backend.

### Real error examples

**Example 1: Missing required field (HTTP 422)**

Request:
```json
POST /api/actions/orders/create_order
{"data": {"amount": 99.99}}
```
Response:
```json
{
    "success": false,
    "error": {
        "code": "FIELD_REQUIRED",
        "message": "field 'customer_id' cannot be null",
        "details": {"field": "customer_id"}
    }
}
```
**Fix:** Include `customer_id` in the data.

**Example 2: FK violation (HTTP 422)**

Request:
```json
POST /api/actions/party/create_party_draft
{"data": {"name": "Keyi", "type": "PERSO", "description": "test"}}
```
Response:
```json
{
    "success": false,
    "error": {
        "code": "FK_VIOLATION",
        "message": "referenced row does not exist in 'party_type_list' for type",
        "details": {"field": "type", "referenced_table": "party_type_list"}
    }
}
```
**Fix:** The `type` value `"PERSO"` does not exist in `party_type_list`. Use a valid value like `"PERSON"` or `"CORP"`.

**Example 3: State mismatch on update (HTTP 409)**

Request:
```json
POST /api/actions/orders/submit_order
{"pk": "a1b2c3d4-...", "data": {"note": "rush"}}
```
Response (the order is in "active" state, but `submit_order` requires "draft"):
```json
{
    "success": false,
    "error": {
        "code": "STATE_MISMATCH",
        "message": "expected state 'draft' but row not found or state differs",
        "details": {"pk": "a1b2c3d4-...", "expected_state": "draft"}
    }
}
```
**Fix:** Check the row's current state with `get_by_pk`. The order might already be submitted.

**Example 4: CHECK constraint violation (HTTP 422)**

Request:
```json
POST /api/actions/orders/create_order
{"data": {"customer_id": "cust-001", "amount": -50}}
```
Response (the table has `CHECK (amount >= 0)`):
```json
{
    "success": false,
    "error": {
        "code": "CHECK_VIOLATION",
        "message": "check constraint 'orders_amount_check' violated",
        "details": {"constraint": "orders_amount_check"}
    }
}
```
**Fix:** Amount must be >= 0.

**Example 5: Type coercion failure (HTTP 400)**

Request:
```json
POST /api/actions/party_person/create_party_person_draft
{"data": {"party_id": "abc-123", "date_of_birth": "not-a-date", "first_name": "Test"}}
```
Response:
```json
{
    "success": false,
    "error": {
        "code": "INVALID_INPUT",
        "message": "Cannot coerce 'not-a-date' to date for column 'date_of_birth'",
        "details": {"reason": "Cannot coerce 'not-a-date' to date for column 'date_of_birth'"}
    }
}
```
**Fix:** Use a valid ISO 8601 date string like `"1990-05-20"`, or pass a Python `date` object from handler code.

**Example 6: Unique violation (HTTP 409)**

Request:
```json
POST /api/actions/users/create_user
{"data": {"email": "alice@example.com", "name": "Alice"}}
```
Response (email has a UNIQUE constraint and alice@example.com already exists):
```json
{
    "success": false,
    "error": {
        "code": "UNIQUE_VIOLATION",
        "message": "duplicate value for field 'email'",
        "details": {"field": "email"}
    }
}
```
**Fix:** Use a different email, or update the existing user instead.

**Example 7: Handler error -- uncaught action failure with step tracking (HTTP 409)**

Request:
```json
POST /api/handlers/create_full_order
{"customer_id": "cust-001", "items": [{"product_id": "prod-X", "qty": 100, "price": 10}]}
```
Response (inventory deduction failed at step 3):
```json
{
    "success": false,
    "error": {
        "code": "ACTION_FAILED",
        "message": "Action 'inventory.deduct_stock' failed: state mismatch",
        "detail": {
            "failed_action": {
                "table": "inventory",
                "action": "deduct_stock",
                "step": 3,
                "error_code": "STATE_MISMATCH",
                "error_detail": "expected state 'in_stock' but row not found or state differs"
            },
            "completed_actions": [
                {"table": "orders", "action": "create_order", "step": 1, "status": "rolled_back"},
                {"table": "order_lines", "action": "bulk_create_lines", "step": 2, "status": "rolled_back"}
            ]
        }
    }
}
```
**Diagnosis:** The inventory item for prod-X is not in "in_stock" state. Steps 1 and 2 (order creation and line items) were rolled back.

**Example 8: Handler error -- custom, caught by handler author**

Request:
```json
POST /api/handlers/create_full_order
{"customer_id": "cust-001", "items": []}
```
Response:
```json
{
    "success": false,
    "error": {
        "code": "HANDLER_ERROR",
        "message": "items cannot be empty",
        "detail": {}
    }
}
```
**Diagnosis:** The handler author explicitly validates that items is non-empty.

---

## 9. Plugging in a DB Backend

The platform uses a `DBBackend` Protocol. To use PostgreSQL:

```python
from lib.db.backends.asyncpg import AsyncpgBackend

backend = AsyncpgBackend(dsn="postgresql://user:pass@host:5432/dbname")
registry = Registry(db_backend=backend)
```

The `AsyncpgBackend` manages a connection pool internally. It is created lazily on first `acquire()` call.

To create a custom backend (e.g., for testing with SQLite), implement the protocol:

```python
class MyBackend:
    async def acquire(self) -> Any: ...
    async def release(self, conn) -> None: ...
    async def execute(self, conn, sql, params) -> list[dict]: ...
    async def execute_one(self, conn, sql, params) -> dict | None: ...
    async def begin(self, conn) -> None: ...
    async def commit(self, conn) -> None: ...
    async def rollback(self, conn) -> None: ...
    async def close(self) -> None: ...
```

Note: the SQL generator currently produces PostgreSQL-specific syntax (`$1, $2` placeholders, `RETURNING *` / `RETURNING {pk_field}`, `= ANY()` for IN). A different database would require adapting the SQL generation layer.

---

## 10. Full End-to-End Example

This example shows a complete setup with two tables (orders and order_lines), one sync handler, one async handler, and usage via both Python and HTTP.

### Table configs

**`tables/orders.py`:**

```python
from lib import (
    TableConfig, ColumnDef, FKDefinition, PKConfig,
    StateTransition, ActionDef,
)

config = TableConfig(
    table_name="orders",
    pk_config=PKConfig(strategy="uuid4"),
    states=["draft", "pending", "active", "cancelled"],
    transitions=[
        StateTransition(from_state="init",      to_state="draft"),
        StateTransition(from_state="draft",     to_state="pending"),
        StateTransition(from_state="pending",   to_state="active"),
        StateTransition(from_state="pending",   to_state="cancelled"),
        StateTransition(from_state="active",    to_state="deleted"),
    ],
    columns=[
        ColumnDef(name="id",          pg_type="uuid",          nullable=False),
        ColumnDef(name="customer_id", pg_type="uuid",          nullable=False),
        ColumnDef(name="amount",      pg_type="numeric(12,2)", nullable=False, check="amount >= 0"),
        ColumnDef(name="note",        pg_type="text"),
        ColumnDef(name="created_at",  pg_type="timestamptz",   nullable=False, default_expr="now()"),
        ColumnDef(name="state",       pg_type="text",          nullable=False),
    ],
    fk_definitions=[
        FKDefinition(field="customer_id", referenced_table="customers",
                     referenced_field="id", on_delete="RESTRICT"),
    ],
    actions=[
        ActionDef(name="create_order",   function_type="insert", transition=StateTransition(from_state="init",    to_state="draft")),
        ActionDef(name="submit_order",   function_type="update", transition=StateTransition(from_state="draft",   to_state="pending")),
        ActionDef(name="activate_order", function_type="update", transition=StateTransition(from_state="pending", to_state="active")),
        ActionDef(name="cancel_order",   function_type="update", transition=StateTransition(from_state="pending", to_state="cancelled")),
        ActionDef(name="remove_order",   function_type="delete", transition=StateTransition(from_state="active",  to_state="deleted")),
    ],
)
```

**`tables/order_lines.py`:**

```python
from lib import (
    TableConfig, ColumnDef, FKDefinition, PKConfig,
    StateTransition, ActionDef,
)

config = TableConfig(
    table_name="order_lines",
    pk_config=PKConfig(strategy="uuid4"),
    states=["active"],
    transitions=[
        StateTransition(from_state="init",   to_state="active"),
        StateTransition(from_state="active", to_state="deleted"),
    ],
    columns=[
        ColumnDef(name="id",         pg_type="uuid",          nullable=False),
        ColumnDef(name="order_id",   pg_type="uuid",          nullable=False),
        ColumnDef(name="product_id", pg_type="varchar(50)",   nullable=False),
        ColumnDef(name="quantity",   pg_type="integer",       nullable=False, check="quantity > 0"),
        ColumnDef(name="unit_price", pg_type="numeric(10,2)", nullable=False, check="unit_price >= 0"),
        ColumnDef(name="state",      pg_type="text",          nullable=False),
    ],
    fk_definitions=[
        FKDefinition(field="order_id", referenced_table="orders",
                     referenced_field="id", on_delete="CASCADE"),
    ],
    actions=[
        ActionDef(name="create_line",       function_type="insert",      transition=StateTransition(from_state="init",   to_state="active")),
        ActionDef(name="bulk_create_lines", function_type="bulk_insert", transition=StateTransition(from_state="init",   to_state="active")),
        ActionDef(name="remove_line",       function_type="delete",      transition=StateTransition(from_state="active", to_state="deleted")),
    ],
)
```

### Handlers

**`handlers/place_order.py` (sync):**

```python
from lib import HandlerError, ActionError

MODE = "sync"

async def handle(ctx, payload: dict):
    customer_id = payload.get("customer_id")
    if not customer_id:
        raise HandlerError(message="customer_id is required", http_status=400)

    items = payload.get("items")
    if not items:
        raise HandlerError(message="items is required and must be non-empty", http_status=400)

    total = sum(item["price"] * item["qty"] for item in items)

    order = await ctx.orders.create_order(data={
        "customer_id": customer_id,
        "amount": total,
        "note": payload.get("note", ""),
    })
    order_id = order["data"]["id"]

    lines = await ctx.order_lines.bulk_create_lines(rows=[
        {
            "order_id": order_id,
            "product_id": item["product_id"],
            "quantity": item["qty"],
            "unit_price": item["price"],
        }
        for item in items
    ])

    return {
        "order_id": order_id,
        "total": total,
        "lines_created": lines["data"]["count"],
        "state": "draft",
    }
```

**`handlers/bulk_submit.py` (async):**

```python
MODE = "async"

async def handle(ctx, payload: dict):
    limit = payload.get("limit", 100)

    drafts = await ctx.orders.list(
        conditions=[("state", "=", "draft")],
        limit=limit,
    )

    submitted = 0
    for order in drafts["data"]:
        await ctx.orders.submit_order(pk=order["id"], data={})
        submitted += 1

    return {"submitted": submitted}
```

### app.py

```python
import asyncio
from lib import Registry
from lib.db.backends.asyncpg import AsyncpgBackend
from tables.orders import config as orders_config
from tables.order_lines import config as order_lines_config

async def setup():
    backend = AsyncpgBackend(dsn="postgresql://user:pass@localhost:5432/mydb")
    registry = Registry(db_backend=backend)

    await registry.register_table(orders_config, create_if_not_exists=True)
    await registry.register_table(order_lines_config, create_if_not_exists=True)
    registry.scan_handlers("handlers/")

    return registry.create_app()

app = asyncio.run(setup())
```

### Using the system

**Create an order via action (HTTP):**
```bash
curl -X POST http://localhost:8000/api/actions/orders/create_order \
  -H "Content-Type: application/json" \
  -d '{"data": {"customer_id": "cust-001", "amount": 99.99}}'

# Response (HTTP 200):
# {"success": true, "data": {"id": "abc-123", "customer_id": "cust-001", "amount": 99.99, "state": "draft", "created_at": "2026-03-26 10:00:00+00:00", ...}}
```

**Submit the order (change state draft -> pending):**
```bash
curl -X POST http://localhost:8000/api/actions/orders/submit_order \
  -H "Content-Type: application/json" \
  -d '{"pk": "abc-123", "data": {"note": "please expedite"}}'

# Response (HTTP 200):
# {"success": true, "data": {"id": "abc-123", ..., "state": "pending", "note": "please expedite"}}
```

**Query active orders with IN filter:**
```bash
curl -X POST http://localhost:8000/api/queries/orders/list \
  -H "Content-Type: application/json" \
  -d '{"conditions": [["state", "IN", ["active", "pending"]]], "order_by": [["amount", "desc"]], "limit": 10}'

# Response (HTTP 200):
# {"success": true, "data": [...], "meta": {"limit": 10, "offset": 0, "count": 3}}
```

**Use the sync handler (create order + lines in one transaction):**
```bash
curl -X POST http://localhost:8000/api/handlers/place_order \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "cust-001",
    "items": [
      {"product_id": "WIDGET-A", "qty": 3, "price": 19.99},
      {"product_id": "GADGET-B", "qty": 1, "price": 49.99}
    ],
    "note": "Birthday gift"
  }'

# Response (HTTP 200):
# {"success": true, "data": {"order_id": "xyz-789", "total": 109.96, "lines_created": 2, "state": "draft"}}
```

**Use the async handler (background batch submit):**
```bash
curl -X POST http://localhost:8000/api/handlers/bulk_submit \
  -H "Content-Type: application/json" \
  -d '{"limit": 50}'

# Response (HTTP 202):
# {"success": true, "task_id": "e4f5a6b7-...", "status": "accepted"}

# Poll for result:
curl http://localhost:8000/api/tasks/e4f5a6b7-...

# Response (HTTP 200):
# {"task_id": "e4f5a6b7-...", "handler_name": "bulk_submit", "status": "completed", "result": {"submitted": 12}, ...}
```

**Using Python directly (outside HTTP):**
```python
orders = registry.table("orders")

result = await orders.create_order(data={"customer_id": "cust-001", "amount": 50.00})
order_id = result["data"]["id"]

result = await orders.submit_order(pk=order_id, data={})
assert result["data"]["state"] == "pending"

result = await orders.activate_order(pk=order_id, data={})
assert result["data"]["state"] == "active"

all_active = await orders.list(
    conditions=[("state", "IN", ["active", "pending"])],
    order_by=[("amount", "desc")],
)
print(f"Active/pending orders: {all_active['meta']['count']}")

has_notes = await orders.list(
    conditions=[("note", "IS NOT NULL", None), ("note", "ILIKE", "%rush%")],
)
print(f"Orders with 'rush' in note: {has_notes['meta']['count']}")
```

---

## 11. Admin Endpoints: Hot Reload, Schema Catalog, and File Management

These endpoints are intended for controlled runtime operations in production-like environments:

- `POST /api/admin/reload` -- trigger hot reload
- `GET /api/admin/schema-catalog` -- read-only schema snapshot
- `PUT /api/admin/files/{category}/{filename}` -- write a `.py` file
- `DELETE /api/admin/files/{category}/{filename}` -- delete a `.py` file
- `GET /api/admin/files/{category}` -- list `.py` files
- `GET /api/admin/files/{category}/{filename}` -- read a `.py` file's content
- `GET /api/admin/workspace/download` -- download workspace as zip
- `POST /api/admin/validate-table` -- validate table config source code against live registry
- `POST /api/admin/validate-handler` -- validate handler source code against live registry
- `GET /api/admin/api-catalog` -- list all action + handler APIs with full URLs
- `GET /api/admin/api-catalog/{table_name}` -- list all action + query APIs for one table

### Mounting admin routes

`Registry.create_app()` mounts the standard action/query/handler/task routes.  
For admin endpoints, mount `admin.py` explicitly and pass runtime directories:

```python
import os
from fastapi import FastAPI

from lib import Registry
from lib.api.routes.actions import mount_action_routes
from lib.api.routes.handlers import mount_handler_routes
from lib.api.routes.queries import mount_query_routes
from lib.api.routes.tasks import mount_task_routes
from lib.api.routes.admin import mount_admin_routes

app = FastAPI()
registry = Registry(db_backend=backend)

tables_dir = os.environ.get("TABLES_DIR", os.path.join(os.path.dirname(__file__), "tables"))
handlers_dir = os.environ.get("HANDLERS_DIR", os.path.join(os.path.dirname(__file__), "handlers"))

mount_action_routes(app.router, registry)
mount_query_routes(app.router, registry)
mount_handler_routes(app.router, registry)
mount_task_routes(app.router, registry)
mount_admin_routes(app.router, registry, tables_dir, handlers_dir)
```

### Optional admin token

If `ADMIN_TOKEN` is set in environment variables, endpoints that mutate/validate runtime state require:

```
Authorization: Bearer <ADMIN_TOKEN>
```

These endpoints are currently readable without `ADMIN_TOKEN`: `GET /api/admin/schema-catalog`, `GET /api/admin/api-catalog`, `GET /api/admin/api-catalog/{table_name}`.

### Reload behavior guarantees

Reload follows a three-phase safety pipeline:

1. **Scan**: file import errors are isolated per file and returned as `scan_errors`.
2. **Diff**: append-only rules reject unsafe modifications with HTTP `409`.
3. **Execute**: staged updates are atomically swapped; failures do not replace live registry state.

Typical success response:

```json
{
  "success": true,
  "tables": {
    "added": ["new_table"],
    "updated": [],
    "unchanged": ["orders", "items"],
    "removed": [],
    "details": {}
  },
  "handlers": {
    "added": ["new_handler"],
    "skipped": ["existing_handler"],
    "removed": []
  }
}
```

Typical rejection response (`409`):

```json
{
  "success": false,
  "message": "Reload rejected: unsafe modifications detected in existing definitions",
  "rejections": [
    {
      "table": "orders",
      "rule": "T10",
      "field": "actions",
      "old": "deleted: ['bulk_remove']",
      "new": "(not present)"
    }
  ]
}
```

### Schema catalog endpoint

`GET /api/admin/schema-catalog` returns all currently registered table configs and handler names:

```json
{
  "tables": {
    "orders": {
      "table_name": "orders",
      "pk_field": "id",
      "pk_strategy": "uuid4",
      "states": ["draft", "pending", "active", "inactive"],
      "transitions": [...],
      "columns": [...],
      "fk_definitions": [...],
      "table_constraints": [...],
      "actions": [...]
    }
  },
  "handlers": ["place_order", "bulk_submit"]
}
```

### File management endpoints

These endpoints enable external systems (e.g., CrewAI) to push table configs and handler files at runtime, then trigger hot reload -- without requiring filesystem access to the server.

#### Write a file

```
PUT /api/admin/files/{category}/{filename}
Content-Type: application/json
Authorization: Bearer <ADMIN_TOKEN>

{"content": "from lib import TableConfig, ColumnDef, ...\n\nconfig = TableConfig(...)"}
```

`category` must be `tables` or `handlers`. Validation rules:
- Filename must end with `.py`
- No path traversal (`..`, `/`, `\`)
- Filenames starting with `_` are reserved (scanner skips them)

Response:

```json
{"success": true, "path": "tables/inventory.py"}
```

#### List files

```
GET /api/admin/files/{category}
Authorization: Bearer <ADMIN_TOKEN>
```

Response:

```json
{"success": true, "files": ["party.py", "party_corp.py", "inventory.py"]}
```

#### Read a file

```
GET /api/admin/files/{category}/{filename}
Authorization: Bearer <ADMIN_TOKEN>
```

Response:

```json
{"success": true, "filename": "inventory.py", "content": "from lib import TableConfig, ..."}
```

Not found:

```json
{"success": false, "error": "tables/nonexistent.py not found"}
```

#### Download entire workspace

```
GET /api/admin/workspace/download
Authorization: Bearer <ADMIN_TOKEN>
```

Returns a zip file (`Content-Type: application/zip`, `Content-Disposition: attachment; filename=workspace.zip`) containing all `.py` files:

```
workspace.zip
  tables/
    party.py
    party_corp.py
    inventory.py
  handlers/
    create_party.py
    deduct_stock.py
```

Usage with curl (local dev; for Railway deployment URLs see [deployment.md](deployment.md)):

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/admin/workspace/download \
  -o workspace.zip
```

#### Typical workflow: external system adds a new table at runtime

Examples below use `http://localhost:8000` (local dev). On Railway, replace with your service URL (see [deployment.md](deployment.md#railway-networking)).

```bash
# 1. Write the table config file
curl -X PUT http://localhost:8000/api/admin/files/tables/inventory.py \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "from lib import TableConfig, ColumnDef, PKConfig, StateTransition, ActionDef\n\nconfig = TableConfig(\n    table_name=\"inventory\",\n    pk_config=PKConfig(strategy=\"uuid4\"),\n    states=[\"active\"],\n    transitions=[StateTransition(from_state=\"init\", to_state=\"active\")],\n    columns=[\n        ColumnDef(name=\"id\", pg_type=\"uuid\", nullable=False),\n        ColumnDef(name=\"product\", pg_type=\"text\", nullable=False),\n        ColumnDef(name=\"qty\", pg_type=\"integer\", nullable=False),\n        ColumnDef(name=\"state\", pg_type=\"text\", nullable=False),\n    ],\n    actions=[\n        ActionDef(name=\"create_item\", function_type=\"insert\", transition=StateTransition(from_state=\"init\", to_state=\"active\")),\n    ],\n)"}'

# 2. Trigger hot reload
curl -X POST http://localhost:8000/api/admin/reload \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 3. The new table is now live -- use it immediately
curl -X POST http://localhost:8000/api/actions/inventory/create_item \
  -H "Content-Type: application/json" \
  -d '{"data": {"product": "Widget-A", "qty": 100}}'
```

#### Delete a file

```
DELETE /api/admin/files/{category}/{filename}
Authorization: Bearer <ADMIN_TOKEN>
```

This removes the file from disk. After that, call `POST /api/admin/reload`:

- If it was a table file, the table is removed from in-memory registry (`tables.removed`) and its APIs stop being callable.
- If it was a handler file, the handler is removed from in-memory registry (`handlers.removed`).
- The PostgreSQL table is not dropped automatically by file deletion.

This does not weaken append-only safety for updates: existing table definitions are still checked by rules `T2`-`T10`.

### Validation endpoints

These endpoints enable external systems (e.g., CrewAI) to validate table configs and handler source code **before** writing files and triggering hot reload. Validation runs against the live registry without any side effects -- no files are written, no tables are created, no handlers are registered.

#### Validate a table config

```
POST /api/admin/validate-table
Content-Type: application/json
Authorization: Bearer <ADMIN_TOKEN>

{"content": "from lib import TableConfig, ColumnDef, ...\n\nconfig = TableConfig(...)"}
```

The endpoint parses the Python source, extracts the `config: TableConfig` variable, then runs registry-aware checks:

- **PARSE_ERROR** -- source has syntax errors, import errors, or missing/invalid `config` variable
- **DUPLICATE_TABLE** -- `table_name` already exists in the live registry
- **INVALID_FK_TABLE** -- `FKDefinition.referenced_table` not registered
- **INVALID_FK_FIELD** -- `FKDefinition.referenced_field` not found on the referenced table
- **MISSING_PK_COLUMN** -- `pk_field` not found in `columns`
- **PK_COLUMN_NOT_NULL_REQUIRED** -- PK column must set `nullable=False`
- **PK_COLUMN_REDUNDANT_UNIQUE** -- PK column should not also set `unique=True`
- **MISSING_STATE_COLUMN** -- required `state` column not in `columns`

Pydantic model validation (identifier checks, transition consistency, action binding rules) is enforced automatically during `TableConfig` construction and surfaces as `PARSE_ERROR`.

Response (valid):

```json
{"valid": true, "errors": [], "warnings": []}
```

Response (invalid):

```json
{
  "valid": false,
  "errors": [
    {
      "code": "INVALID_FK_TABLE",
      "message": "Referenced table 'nonexistent' is not registered",
      "path": "fk_definitions[0].referenced_table",
      "suggestion": "Check available tables via GET /api/admin/schema-catalog"
    }
  ],
  "warnings": []
}
```

#### Validate a handler

```
POST /api/admin/validate-handler
Content-Type: application/json
Authorization: Bearer <ADMIN_TOKEN>

{"content": "async def handle(ctx, payload):\n    ..."}
```

The endpoint parses the Python source and checks:

- **PARSE_ERROR** -- source has syntax errors or import errors
- **MISSING_HANDLE** -- no callable `handle` function found
- **HANDLE_NOT_ASYNC** -- `handle` must be defined with `async def` (the executor uses `await`)
- **INVALID_HANDLE_SIGNATURE** -- `handle` must accept at least 2 parameters (`ctx`, `payload`)
- **INVALID_MODE** -- `MODE` variable (if present) must be `"sync"` or `"async"`
- **UNKNOWN_TABLE_REF** (warning) -- `ctx.<table_name>` references a table not in the live registry
- **UNKNOWN_ACTION_REF** (warning) -- `ctx.<table>.<action>()` references an action not registered on that table

See [handler_guide.md](handler_guide.md#11-validation-endpoint) for detailed validation examples and response formats.

Response (valid with warning):

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "code": "UNKNOWN_TABLE_REF",
      "message": "ctx.inventory references table 'inventory' which is not currently registered",
      "path": "ctx.inventory",
      "suggestion": "Check available tables via GET /api/admin/schema-catalog"
    }
  ]
}
```

#### Typical workflow: validate before writing

```bash
# 1. Validate the table config first
curl -X POST $DATA_PLATFORM_URL/api/admin/validate-table \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "from lib import TableConfig, ..."}'

# 2. If valid, write the file
curl -X PUT $DATA_PLATFORM_URL/api/admin/files/tables/inventory.py \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "from lib import TableConfig, ..."}'

# 3. Trigger hot reload
curl -X POST $DATA_PLATFORM_URL/api/admin/reload \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### API catalog endpoints

These endpoints let external systems (e.g., CrewAI) discover all callable APIs at runtime. URLs auto-adapt based on the incoming request: `http://localhost:8000` locally, `https://your-domain.up.railway.app` on Railway. After a hot reload adds new tables or handlers, the catalog immediately reflects them.
These two catalog endpoints are read-only and currently do not enforce `ADMIN_TOKEN`.

#### List all action and handler APIs

```
GET /api/admin/api-catalog
```

Returns all registered action APIs (grouped by table) and handler APIs, excluding query endpoints. Each entry includes the full callable URL.

Response:

```json
{
  "success": true,
  "base_url": "https://data-platform-production.up.railway.app",
  "actions": [
    {
      "table": "party",
      "action": "create_party_active",
      "function_type": "insert",
      "transition": "init -> active",
      "method": "POST",
      "url": "https://data-platform-production.up.railway.app/api/actions/party/create_party_active"
    },
    {
      "table": "inventory",
      "action": "add_item",
      "function_type": "insert",
      "transition": "init -> in_stock",
      "method": "POST",
      "url": "https://data-platform-production.up.railway.app/api/actions/inventory/add_item"
    }
  ],
  "handlers": [
    {
      "handler": "create_party",
      "mode": "sync",
      "method": "POST",
      "url": "https://data-platform-production.up.railway.app/api/handlers/create_party"
    }
  ]
}
```

#### List all APIs for a specific table

```
GET /api/admin/api-catalog/{table_name}
```

Returns all action and query endpoints for a single table.

Response:

```json
{
  "success": true,
  "base_url": "http://localhost:8000",
  "table": "party",
  "endpoints": [
    {
      "name": "create_party_active",
      "type": "action",
      "function_type": "insert",
      "transition": "init -> active",
      "method": "POST",
      "url": "http://localhost:8000/api/actions/party/create_party_active"
    },
    {
      "name": "get_by_pk",
      "type": "query",
      "method": "POST",
      "url": "http://localhost:8000/api/queries/party/get_by_pk"
    },
    {
      "name": "list",
      "type": "query",
      "method": "POST",
      "url": "http://localhost:8000/api/queries/party/list"
    },
    {
      "name": "count",
      "type": "query",
      "method": "POST",
      "url": "http://localhost:8000/api/queries/party/count"
    },
    {
      "name": "exists",
      "type": "query",
      "method": "POST",
      "url": "http://localhost:8000/api/queries/party/exists"
    }
  ]
}
```

Table not found returns 404:

```json
{"success": false, "error": "table 'nonexistent' not registered"}
```

#### Hot reload + API catalog

After a hot reload adds new tables or handlers, the API catalog reflects them immediately without restart:

```bash
# 1. Add a new table via file management
curl -X PUT $DATA_PLATFORM_URL/api/admin/files/tables/inventory.py \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "..."}'

# 2. Trigger reload
curl -X POST $DATA_PLATFORM_URL/api/admin/reload \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 3. API catalog now includes the new table's endpoints
curl $DATA_PLATFORM_URL/api/admin/api-catalog/inventory
# -> lists add_item action + all query endpoints with full URLs
```
