# Data Platform -- Concepts

## Table of Contents

- [1. TableConfig](#1-tableconfig)
- [2. ColumnDef](#2-columndef)
- [3. FKDefinition](#3-fkdefinition)
- [4. PKConfig](#4-pkconfig)
- [5. StateTransition](#5-statetransition)
- [6. State Machine](#6-state-machine)
- [7. Base Functions](#7-base-functions)
- [8. ActionDef](#8-actiondef)
- [9. Action](#9-action)
- [10. ActionExecutor](#10-actionexecutor)
- [11. DB Error Translation](#11-db-error-translation)
- [12. Query (Read Path)](#12-query-read-path)
- [13. Conditions](#13-conditions)
- [14. TableHandle](#14-tablehandle)
- [15. Registry](#15-registry)
- [16. Handler](#16-handler)
- [17. HandlerContext (ctx)](#17-handlercontext-ctx)
- [18. HandlerError and ActionError](#18-handlererror-and-actionerror)
- [19. Communication Modes (Sync / Async)](#19-communication-modes-sync--async)
- [20. DB Backend](#20-db-backend)
- [21. HTTP API Conventions](#21-http-api-conventions)
- [22. Transaction Model](#22-transaction-model)
- [23. Schema Validation](#23-schema-validation)
- [24. Hot Reload and Schema Catalog](#24-hot-reload-and-schema-catalog)

---

## 1. TableConfig

A `TableConfig` is the **single source of truth** for everything about a database table. It defines the schema (columns, types, constraints, FKs), the state machine (states, transitions), the PK generation strategy, and all actions that can be performed on the table.

One `TableConfig` = one `register_table()` call. There is no separate "create table" step, no separate "register action" step, no separate "define states" step. Everything is declared together, validated together, and registered together.

```python
TableConfig(
    table_name="orders",         # must be a valid Python identifier
    pk_field="id",               # which column is the primary key (default: "id")
    pk_config=PKConfig(...),     # how to generate PKs
    states=["draft", "pending"], # real states stored in the DB
    transitions=[...],           # allowed state transitions
    columns=[...],               # full DDL column definitions
    fk_definitions=[...],        # foreign key constraints
    actions=[...],               # action bindings (ActionDef list)
)
```

When `register_table()` runs, a Pydantic `model_validator` checks:
- `table_name` and action names are valid Python identifiers (not reserved words)
- Every action's transition exists in the `transitions` list
- Insert actions have `from_state="init"`, delete actions have `to_state="deleted"`
- No duplicate `(function_type, transition)` pairs

If any check fails, registration is rejected with a clear error message before any SQL runs.


## 2. ColumnDef

Defines a single column in the table. Contains enough information to generate `CREATE TABLE` DDL.

```python
ColumnDef(
    name="amount",               # column name
    pg_type="numeric(12,2)",     # PostgreSQL type (exact string used in DDL)
    nullable=False,              # NOT NULL constraint
    default_expr="0",            # SQL default expression (e.g., "now()", "0", "'draft'")
    identity=None,               # "always" or "by_default" for GENERATED AS IDENTITY
    unique=False,                # UNIQUE constraint
    check="amount >= 0",         # CHECK constraint expression
)
```

Key points:
- `pg_type` is the raw PostgreSQL type string. You write exactly what you want in DDL.
- `default_expr` is a raw SQL expression, not a Python value. Use `"now()"` not `datetime.now()`.
- A column with `default_expr` or `identity` set is optional on insert -- the DB fills it in.
- The `state` column must be included in `columns` (typically `ColumnDef(name="state", pg_type="text", nullable=False)`). The platform manages its value automatically.


## 3. FKDefinition

Defines a foreign key relationship to another table.

```python
FKDefinition(
    field="customer_id",          # local column
    referenced_table="customers", # target table
    referenced_field="id",        # target column
    on_update="CASCADE",          # optional: CASCADE, RESTRICT, SET NULL, SET DEFAULT, NO ACTION
    on_delete="RESTRICT",         # optional: same options
)
```

FK constraints are created in the `CREATE TABLE` DDL and enforced by the database. If an INSERT or UPDATE references a non-existent FK target, the DB rejects it and the platform translates the error to a structured `FK_VIOLATION` response.

At `register_table()` time, the schema validator compares FK definitions in the config against the database, checking `field`, `referenced_table`, `referenced_field`, `on_update`, and `on_delete`. Mismatches are reported in the `SchemaConflictError`.


## 4. PKConfig

Controls how primary key values are generated for new rows.

```python
PKConfig(
    strategy="uuid4",            # "uuid4", "sequence", or "custom"
    generator=None,              # required when strategy="custom": Callable[[dict], str]
    retry_on_conflict=3,         # for custom generators: retry N times on PK collision
)
```

Three strategies:

- **`uuid4`** (default): The application generates a UUID4 string before INSERT. Virtually zero collision probability.
- **`sequence`**: The PK column is omitted from the INSERT statement. The database auto-generates the value via SERIAL/IDENTITY. The generated PK is read back from `RETURNING *`.
- **`custom`**: You provide a callable `generator(data: dict) -> str`. The function receives the row's data and returns a PK string. If the PK collides with an existing row, the system retries up to `retry_on_conflict` times.

The PK is generated by `ActionExecutor` before calling the base function. The caller never provides the PK value -- it is always injected automatically.


## 5. StateTransition

Represents a single allowed state change in the table's state machine.

```python
StateTransition(from_state="draft", to_state="pending")
```

Two virtual states exist:
- **`init`**: the row does not exist yet. Used as `from_state` for insert actions.
- **`deleted`**: the row has been hard-deleted. Used as `to_state` for delete actions.

Virtual states are never stored in the database. Real states (e.g., "draft", "pending", "active") are stored in the `state` column.

A table's `transitions` list defines the complete state graph. If a transition is not in the list, no action can use it.


## 6. State Machine

The state machine is the enforcement mechanism that guarantees rows follow their defined lifecycle. It operates differently depending on the operation type:

**INSERT**: No runtime state check. `from_state="init"` is a definition-time constraint meaning "row does not exist." The `ActionExecutor` injects `state = to_state` into the new row's data.

**UPDATE**: Single-statement CAS (Compare-And-Swap). The `ActionExecutor` builds `UPDATE ... SET state=$to_state ... WHERE id=$pk AND state=$from_state RETURNING *`. If no row is returned, the state was wrong -- `StateMismatchError` is raised. No separate SELECT is needed; atomicity comes from the SQL statement itself.

**DELETE**: Same CAS pattern. `DELETE FROM ... WHERE id=$pk AND state=$from_state RETURNING *`. If no row is returned, the state was wrong. `to_state="deleted"` is virtual -- the row is hard-deleted.

The caller never passes `state`. The binding determines it automatically.


## 7. Base Functions

Six internal functions that execute raw SQL. They are **never callable by users** -- they exist only as building blocks for `ActionExecutor`.

| Function      | Purpose                        | SQL                                                       |
| ------------- | ------------------------------ | --------------------------------------------------------- |
| `insert`      | Insert one row                 | `INSERT INTO ... VALUES ... RETURNING *`                  |
| `update`      | Update one row by PK           | `UPDATE ... SET ... WHERE pk=$1 RETURNING *`              |
| `delete`      | Delete one row by PK           | `DELETE FROM ... WHERE pk=$1 RETURNING *`                 |
| `bulk_insert` | Insert multiple rows           | `INSERT INTO ... VALUES (...),(...) RETURNING {pk_field}` |
| `bulk_update` | Update rows matching conditions| `UPDATE ... SET ... WHERE ... RETURNING {pk_field}`       |
| `bulk_delete` | Delete rows matching conditions| `DELETE FROM ... WHERE ... RETURNING {pk_field}`          |

Single-row operations return the full row (client needs server-generated PK and state). Bulk operations return only the PK column -- the `ActionExecutor` returns `{"count": N, "pks": [...]}`. If a handler needs full row data after a bulk operation, it can query explicitly via `ctx.table.list(conditions=[("pk", "IN", pks)])`.

Why are they not directly callable? Because they have **no safety**. No PK generation, no state injection, no state verification, no error translation. Calling `base.insert` directly could create a row with no PK, no state, or invalid FK references. The `ActionExecutor` exists to enforce all these rules.


## 8. ActionDef

Defines the binding between a base function type and a state transition. This binding creates a callable action on the table.

```python
ActionDef(
    name="create_order",           # method name on TableHandle, HTTP route segment
    function_type="insert",        # which of the 6 base functions
    transition=StateTransition(from_state="init", to_state="draft"),
)
```

The unique key for an action is `(function_type, transition)`. You cannot have two actions that are both `insert` with `init -> draft`. The `name` is for human use (method name, URL segment); the real identity is the binding.

**Definition-time validation rules:**
- `insert` / `bulk_insert`: `from_state` must be `"init"`
- `update` / `bulk_update`: `from_state` cannot be `"init"`, `to_state` cannot be `"deleted"`
- `delete` / `bulk_delete`: `to_state` must be `"deleted"`
- The transition must exist in the table's `transitions` list


## 9. Action

An Action is the **only way to mutate data** in the system. It is not a standalone concept you define separately -- it is the result of the binding declared in `ActionDef`.

When `registry.register_table()` processes the `actions` list in `TableConfig`, it creates an `ActionExecutor` for each `ActionDef`. The executor becomes a callable method on the `TableHandle`.

An action is **pure CRUD + state transition**. It contains no custom business logic. If you need logic (validation, computation, multi-table orchestration), that belongs in a Handler.


## 10. ActionExecutor

The runtime pipeline that makes actions safe. For every action call, it performs these steps in order:

1. Look up the `ActionDef` (function type + transition)
2. **PK generation** (for inserts): call the configured PK strategy
3. **State injection**: add `state = to_state` to the data
4. **CAS predicate** (for updates/deletes): build `WHERE state = from_state`
5. **Call base function**: execute the prepared SQL
6. **Error translation**: catch DB constraint errors, convert to structured `ActionError`
7. **Transaction management**: auto-commit if standalone, skip if inside a handler

The caller provides only business data. The executor handles PK, state, and transaction automatically.


## 11. DB Error Translation

The platform does **not** validate data in the application layer before sending SQL. Instead, it relies on PostgreSQL constraints (NOT NULL, FK, UNIQUE, CHECK) and translates database errors into structured responses.

| Error Source                    | Error Code         | HTTP Status | Example                                               |
| ------------------------------- | ------------------ | ----------- | ----------------------------------------------------- |
| Invalid conditions / input      | `INVALID_INPUT`    | 400         | "Condition at index 0: unknown operator 'BETWEEN'"    |
| NOT NULL violation              | `FIELD_REQUIRED`   | 422         | "field 'full_name' cannot be null"                    |
| FK violation (insert/update)    | `FK_VIOLATION`     | 422         | "referenced row does not exist in 'departments'"      |
| FK violation (delete restrict)  | `FK_RESTRICT`      | 409         | "cannot delete: referenced by 'employees'"            |
| UNIQUE violation                | `UNIQUE_VIOLATION` | 409         | "duplicate value for field 'email'"                   |
| CHECK violation                 | `CHECK_VIOLATION`  | 422         | "check constraint 'orders_amount_check' violated"     |
| CAS returned no row             | `STATE_MISMATCH`   | 409         | "expected state 'active' but row not found"           |
| Unrecognized DB error           | `DB_ERROR`         | 400         | "database error: ..."                                 |
| Platform unknown/unmapped fallback | `INTERNAL_ERROR` | 500         | "Unknown function_type: ..." or other unmapped platform error |

For handler execution paths, unexpected failures are mapped to `RAW_QUERY_ERROR`, `INFRA_ERROR`, and `HANDLER_RUNTIME_ERROR` (not `INTERNAL_ERROR`). `INTERNAL_ERROR` is reserved as a final fallback for truly unknown/unmapped platform failures.


## 12. Query (Read Path)

Every registered table automatically gets 4 read-only query methods. No `ActionDef` needed, no state transition, no PK generation. They are pure SELECT operations.

| Method      | Purpose                                   |
| ----------- | ----------------------------------------- |
| `get_by_pk` | Fetch a single row by primary key         |
| `list`      | Fetch multiple rows with filters/ordering |
| `count`     | Count rows matching conditions            |
| `exists`    | Check if any row matches conditions       |

Queries are distinct from actions. Actions mutate data and enforce state transitions. Queries only read data and have no side effects.


## 13. Conditions

Both actions (bulk operations) and queries use the same condition format for filtering:

```python
# Single condition -- tuple of (field, operator, value)
("state", "=", "active")

# Multiple conditions -- list of tuples (AND logic)
[("state", "=", "active"), ("amount", ">", 100)]
```

Supported operators:

| Operator      | SQL Generated              | Value Type    | Example                                        |
| ------------- | -------------------------- | ------------- | ---------------------------------------------- |
| `=`           | `field = $N`               | scalar        | `("state", "=", "active")`                     |
| `!=`          | `field != $N`              | scalar        | `("state", "!=", "deleted")`                   |
| `>`, `<`      | `field > $N`, `field < $N` | scalar        | `("amount", ">", 100)`                         |
| `>=`, `<=`    | `field >= $N`              | scalar        | `("amount", ">=", 50)`                         |
| `IN`          | `field = ANY($N)`          | list          | `("state", "IN", ["active", "pending"])`       |
| `NOT IN`      | `field != ALL($N)`         | list          | `("state", "NOT IN", ["deleted", "inactive"])` |
| `LIKE`        | `field LIKE $N`            | string        | `("name", "LIKE", "%Corp%")`                   |
| `ILIKE`       | `field ILIKE $N`           | string        | `("name", "ILIKE", "%corp%")`                  |
| `IS NULL`     | `field IS NULL`            | ignored       | `("note", "IS NULL", None)`                    |
| `IS NOT NULL`  | `field IS NOT NULL`        | ignored       | `("note", "IS NOT NULL", None)`                |

`IN` and `NOT IN` use PostgreSQL's `= ANY($N)` and `!= ALL($N)` syntax, which works with asyncpg's array parameter binding. Pass a Python list as the value.

`IS NULL` and `IS NOT NULL` do not consume a parameter. The value field is present in the tuple for structural consistency but is ignored.

Conditions are converted to parameterized `WHERE` clauses internally. Multiple conditions are combined with `AND`.

**Normalization and validation:** The SQL layer's `_normalize_conditions` processes every condition input before it reaches the SQL generator. It performs two jobs:

1. **Format normalization** -- JSON has no tuple type, so HTTP requests use arrays (`["state", "=", "active"]`). All inner elements are converted to tuples, ensuring a uniform `list[tuple[str, str, Any]]` representation regardless of whether conditions originate from Python code (tuples) or HTTP JSON (arrays). A single bare condition (tuple or list) is also accepted and wrapped into a one-element list.

2. **Structural validation** -- Each condition is checked for:
   - Exactly 3 elements (field, operator, value)
   - `field` must be a non-empty string
   - `operator` must be a string and one of the supported operators listed above

Invalid conditions raise a `ValueError` with a clear message identifying the problem and its index in the list. This catches malformed input early, before it reaches SQL generation, regardless of whether the call comes from Python or HTTP.


## 14. TableHandle

The object returned by `registry.table("orders")`. It is the primary interface for interacting with a table.

- **Action methods**: defined actions become async callable methods via `__getattr__`. `orders.create_order(data={...})` calls the action's `ActionExecutor`.
- **Query methods**: `get_by_pk()`, `list()`, `count()`, `exists()` are direct methods.
- **Transaction binding**: `handle.with_tx(tx)` returns a new `TableHandle` bound to a shared transaction. This is used internally by handlers so that all action calls share one tx.


## 15. Registry

The central coordinator for the entire platform.

- `Registry(db_backend=backend)` -- create with a DB backend
- `register_table(config, create_if_not_exists=True)` -- validate config, optionally create the table, build executors, create `TableHandle`
- `table("orders")` -- get the `TableHandle` for a registered table
- `scan_handlers("handlers/")` -- discover and register handler files
- `reload(tables_dir, handlers_dir)` -- production-safe hot reload with append-only checks
- `schema_catalog()` -- get read-only snapshot of all registered table configs and handlers
- `create_app()` -- return a FastAPI app with all routes mounted
- `get_task_status(task_id)` -- poll an async handler's task status

Three scenarios at `register_table()` time:
1. **Table doesn't exist + `create_if_not_exists=True`**: generates DDL, creates the table
2. **Table exists + schema matches**: registers normally, no DDL
3. **Table exists + schema conflicts**: raises `SchemaConflictError` with detailed diff (column types, nullability, UNIQUE, CHECK, FK constraints)


## 16. Handler

A Handler orchestrates multiple actions across multiple tables in a **shared database transaction**, with custom Python logic between them. It is always an API endpoint.

Key characteristics:
- **Convention-over-configuration**: each handler is a `.py` file in a `handlers/` directory
- **Entry point**: `async def handle(ctx, payload)` -- the file must define this function
- **Communication mode**: `MODE = "sync"` or `MODE = "async"` (module-level variable)
- **Auto-discovery**: `registry.scan_handlers("handlers/")` imports all `.py` files, reads `MODE` and `handle`, and registers them automatically
- **No boilerplate**: no decorators, no `register()` calls, no framework imports needed (except `HandlerError`/`ActionError` for error handling)
- **Step tracking**: all action calls through `ctx.{table_name}` are tracked. On failure, the error response includes which actions completed (and were rolled back) and which step failed.

The handler name = file name. `handlers/create_full_order.py` becomes handler `create_full_order`, accessible at `POST /api/handlers/create_full_order`.


## 17. HandlerContext (`ctx`)

The `ctx` object passed to every handler's `handle(ctx, payload)`. It provides:

- **`ctx.{table_name}`**: returns a `_TrackingTableHandle` wrapping the real `TableHandle`, bound to the handler's shared transaction. All action calls are tracked for step reporting.
- **`ctx.raw_query(sql, params)`**: executes a parameterized read-only SQL query in the shared tx. For complex JOINs and aggregations that built-in queries can't express.

All action calls through `ctx.{table_name}` share the same database connection and transaction. No action auto-commits. The `HandlerExecutor` commits on success or rolls back on failure.


## 18. HandlerError and ActionError

Two exception types for error handling:

**`ActionError`** -- raised by `ActionExecutor` when an action fails (state mismatch, DB constraint violation, missing PK). Contains `code`, `message`, `details`, `table`, `action`, `step`.

**`HandlerError`** -- raised by handler authors to return custom error responses. Contains `message`, `code`, `detail`, `http_status`. Handler authors catch `ActionError` from individual actions and optionally wrap them in a `HandlerError` with custom context.

If a handler does not catch an `ActionError`, the system automatically rolls back the entire transaction and returns a structured error response that includes:
- `failed_action`: which table/action failed, which step, the error code and detail
- `completed_actions`: list of actions that succeeded before the failure (all rolled back)


## 19. Communication Modes (Sync / Async)

Each handler declares its communication mode:

- **sync** (default): the HTTP request blocks until all actions complete. Returns HTTP 200 with the result.
- **async**: the HTTP request immediately returns HTTP 202 with a `task_id`. The handler runs in the background via `asyncio.create_task()`. The caller polls `GET /api/tasks/{task_id}` for status and result.

Async handler task lifecycle: `pending` -> `running` -> `completed` or `failed`.

Poll response when completed:
```json
{"task_id": "T-123", "handler_name": "bulk_migrate", "status": "completed", "result": {...}, "created_at": "...", "completed_at": "..."}
```

Poll response when failed:
```json
{"task_id": "T-123", "handler_name": "bulk_migrate", "status": "failed", "error": {...}, "created_at": "...", "completed_at": "..."}
```

Actions are always communication-sync (single-table, fast). The mode choice is only relevant for handlers.

Task state is stored in-memory via `TaskStore`. This means task records are lost on server restart.


## 20. DB Backend

A Protocol that abstracts all database access. The core library never touches `asyncpg` directly.

```python
class DBBackend(Protocol):
    async def acquire(self) -> Any           # get a connection from pool
    async def release(self, conn) -> None    # return connection to pool
    async def execute(self, conn, sql, params) -> list[dict]
    async def execute_one(self, conn, sql, params) -> dict | None
    async def begin(self, conn) -> None      # BEGIN transaction
    async def commit(self, conn) -> None     # COMMIT transaction
    async def rollback(self, conn) -> None   # ROLLBACK transaction
    async def close(self) -> None            # close connection pool
```

Currently the only implementation is `AsyncpgBackend` for PostgreSQL. The Protocol enables future backends (MySQL, SQLAlchemy) without changing any core library code.


## 21. HTTP API Conventions

The HTTP layer is a thin wrapper. It does not contain business logic.

**Fixed by the platform:**
- HTTP method: always POST (actions, queries, handlers); GET for task polling
- Content-Type: always `application/json`
- Response envelope: `{"success": true, "data": ...}` or `{"success": false, "error": ...}`
- URL patterns: `/api/actions/{table}/{action}`, `/api/queries/{table}/{method}`, `/api/handlers/{handler_name}`, `/api/tasks/{task_id}`
- Error-specific HTTP status codes (see Section 11)

**Controlled by the user:**
- Action data: `data`, `pk`, `rows`, `conditions` in the request body
- Handler request/response: payload is the raw body, return value becomes `data`
- Error detail: handler authors can raise `HandlerError` with custom `message`, `detail`, `http_status`


## 22. Transaction Model

Two transaction modes:

**Standalone** (action called directly via Python or HTTP): `ActionExecutor` acquires its own connection, runs `BEGIN`, executes the SQL, `COMMIT` on success, `ROLLBACK` on failure, then releases the connection.

**Shared** (action called inside a handler): `HandlerExecutor` acquires one connection, runs `BEGIN`. All actions called via `ctx.{table_name}` reuse this connection. No action commits individually. `HandlerExecutor` commits after all actions succeed, or rolls back if any fails. This guarantees all-or-nothing semantics across multiple tables.


## 23. Schema Validation

When `register_table()` finds an existing table, it compares the database schema against the `TableConfig`. The comparison covers:

- **Column presence**: columns in config vs columns in DB (both directions)
- **Column types**: normalized comparison (e.g., `varchar(255)` -> `character varying(255)`, `timestamptz` -> `timestamp with time zone`)
- **Nullability**: `NOT NULL` vs `nullable`
- **UNIQUE constraints**: single-column UNIQUE constraints
- **CHECK constraints**: existence of CHECK constraints on columns
- **FK definitions**: `field`, `referenced_table`, `referenced_field`, `on_update`, `on_delete`

Any mismatch raises `SchemaConflictError` with a detailed diff. The system never auto-alters existing tables.


## 24. Hot Reload and Schema Catalog

Two admin capabilities are now part of the platform runtime model:

- `POST /api/admin/reload`: re-scan `tables/` + `handlers/` and apply safe append-only updates without process restart.
- `GET /api/admin/schema-catalog`: return all currently registered table definitions and handler names as read-only JSON.

Hot reload uses three phases:

1. **Scan**: import each file in isolation; syntax/import errors are returned in `scan_errors` and do not interrupt service.
2. **Diff**: enforce append-only rules on existing tables (`T2`-`T10`).
3. **Execute**: stage new handles/configs and atomically swap them into registry on success.

If diff rejects or execution fails, existing registry state remains usable. In-flight requests keep their old handle references, and new requests continue against the previous stable registry snapshot.
