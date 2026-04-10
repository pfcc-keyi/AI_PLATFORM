# Handler Development Guide

This document is the authoritative reference for writing handlers on the Data Platform. It covers the full lifecycle from file structure to error propagation, with exact code contracts derived from the runtime implementation.

## Table of Contents

1. [What Is a Handler](#1-what-is-a-handler)
2. [File Structure and Conventions](#2-file-structure-and-conventions)
3. [The `handle(ctx, payload)` Function](#3-the-handlectx-payload-function)
4. [MODE: Sync vs Async](#4-mode-sync-vs-async)
5. [HandlerContext (`ctx`)](#5-handlercontext-ctx)
6. [Transaction Model](#6-transaction-model)
7. [Step Tracking](#7-step-tracking)
8. [Error Handling](#8-error-handling)
   - [8.1 HandlerError: Custom Business Logic Errors](#81-handlererror-custom-business-logic-errors)
   - [8.2 ActionError: Platform-Generated Errors](#82-actionerror-platform-generated-errors)
   - [8.3 Error Propagation Flow](#83-error-propagation-flow)
   - [8.4 Handler Error Codes Reference](#84-handler-error-codes-reference)
9. [Auto Type Coercion](#9-auto-type-coercion)
10. [Output Serialization](#10-output-serialization)
11. [Validation Endpoint](#11-validation-endpoint)
12. [Lifecycle: Scanning, Registration, Hot Reload](#12-lifecycle-scanning-registration-hot-reload)
13. [Patterns and Best Practices](#13-patterns-and-best-practices)
14. [Complete Examples](#14-complete-examples)
15. [Source Code Reference](#15-source-code-reference)

---

## 1. What Is a Handler

A handler is a user-defined async function that orchestrates **multiple actions and queries across multiple tables** in a single atomic transaction. Handlers are the business logic layer.

**Use a handler when:**

- You need to write to 2+ tables atomically (e.g., create a Party + PartyPerson in one go)
- You need to validate business rules before executing actions
- You need to combine queries and actions in a single transaction (read-your-writes)
- You need custom SQL via `raw_query`

**Use a direct action when:**

- You only need to write to 1 table with 1 action (e.g., simple insert)
- No cross-table business logic is needed

---

## 2. File Structure and Conventions

### File placement

```
workspace/
  handlers/
    create_party.py        # -> handler name: "create_party"
    bulk_migrate.py        # -> handler name: "bulk_migrate"
    _helpers.py            # skipped (underscore prefix)
```

### Naming rules

| Rule | Description |
|------|-------------|
| File location | Must be in the `handlers/` directory |
| File extension | Must be `.py` |
| Handler name | = file stem (e.g., `create_party.py` -> `create_party`) |
| URL segment | = handler name (e.g., `POST /api/handlers/create_party`) |
| Underscore prefix | Files starting with `_` are **skipped** by the scanner |

### Required exports

A handler file must define:

```python
async def handle(ctx, payload: dict) -> dict:
    ...
```

### Optional exports

```python
MODE = "sync"   # or "async". Defaults to "sync" if omitted.
```

### What you do NOT need

- No decorators
- No `register()` calls
- No class definitions
- No `app` or router references

The platform auto-discovers handlers by scanning the directory.

### Minimal valid handler

```python
async def handle(ctx, payload: dict) -> dict:
    return {"message": "hello"}
```

---

## 3. The `handle(ctx, payload)` Function

### Signature

```python
async def handle(ctx, payload: dict) -> dict:
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `ctx` | `HandlerContext` | Provides access to registered tables, queries, and raw SQL. Bound to a shared transaction. |
| `payload` | `dict` | The raw JSON body from the HTTP request. Any shape -- you define the contract. |
| Return | `dict` (or any JSON-serializable value) | Becomes `response.data` (sync) or `task.result` (async). |

### Critical requirements

1. **Must be `async def`**. The executor calls `await handle(ctx, payload)`. A non-async function will cause `TypeError` at runtime.
2. **Must accept at least 2 parameters** (`ctx` and `payload`).
3. **The return value is serialized before commit.** Non-JSON types (`date`, `UUID`, `Decimal`) are auto-converted by `_make_json_safe`. See [Section 10](#10-output-serialization).

---

## 4. MODE: Sync vs Async

### Sync (default)

```python
MODE = "sync"
```

HTTP flow:
```
Client -> POST /api/handlers/my_handler {payload}
       <- 200 {"success": true, "data": {handler return value}}
```

The request blocks until the handler completes. The response contains the handler's return value.

### Async (background)

```python
MODE = "async"
```

HTTP flow:
```
Client -> POST /api/handlers/my_handler {payload}
       <- 202 {"success": true, "task_id": "e4f5a6b7-...", "status": "accepted"}

Client -> GET /api/tasks/e4f5a6b7-...
       <- 200 {"task_id": "...", "status": "running", ...}

Client -> GET /api/tasks/e4f5a6b7-...
       <- 200 {"task_id": "...", "status": "completed", "result": {handler return value}, ...}
```

The request returns immediately with a `task_id`. The handler runs in a background `asyncio.Task`. Poll `GET /api/tasks/{task_id}` for progress.

### Task states

| Status | Meaning |
|--------|---------|
| `pending` | Task created, not yet started |
| `running` | Handler is executing |
| `completed` | Success -- `result` field contains the return value |
| `failed` | Error -- `error` field contains `{code, message, detail}` |

### When to use async

- Long-running operations (batch migrations, bulk processing)
- Operations where the client shouldn't wait
- Any handler that might exceed HTTP timeout thresholds

---

## 5. HandlerContext (`ctx`)

`ctx` is an instance of `HandlerContext` (defined in `lib/handler/context.py`). It provides three capabilities:

### 5.1 Table access: `ctx.{table_name}`

Access any registered table by name as a direct attribute:

```python
party = await ctx.party.create_party_active(data={...})
orders = await ctx.orders.list(conditions=[("state", "=", "active")])
```

`ctx.{table_name}` returns a `_TrackingTableHandle` that wraps the table's `TableHandle`, bound to the handler's shared transaction. All operations through `ctx` share the same DB connection and transaction.

**Available operations on a table handle:**

Actions (write):

```python
await ctx.orders.create_order(data={...})                           # insert
await ctx.orders.submit_order(pk="abc-123", data={...})             # update
await ctx.orders.remove_order(pk="abc-123")                         # delete
await ctx.orders.bulk_create_orders(rows=[{...}, {...}])            # bulk_insert
await ctx.orders.bulk_activate(data={...}, conditions=[...])        # bulk_update
await ctx.orders.bulk_remove(conditions=[...])                      # bulk_delete
```

Queries (read):

```python
await ctx.orders.get_by_pk("abc-123")                               # single row
await ctx.orders.get_by_pk("abc-123", select=["id", "amount"])      # with column selection
await ctx.orders.list(conditions=[...], order_by=[...], limit=10)   # filtered list
await ctx.orders.count(conditions=[("state", "=", "active")])       # count
await ctx.orders.exists(conditions=[("id", "=", "abc-123")])        # existence check
```

**What table names are available?** Every table registered in the `Registry`. If you reference a table that doesn't exist, you get `AttributeError` at runtime:

```
AttributeError: No registered table named 'nonexistent'. Available: orders, party, ...
```

### 5.2 Raw SQL: `ctx.raw_query(sql, params)`

Execute arbitrary parameterized SQL within the shared transaction:

```python
rows = await ctx.raw_query(
    "SELECT o.id, p.method FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.customer_id = $1",
    ["cust-001"],
)
# rows = [{"id": "...", "method": "credit_card"}, ...]
```

Rules:
- Uses the handler's shared transaction (read-your-writes)
- Parameters use PostgreSQL `$1, $2, ...` syntax
- Returns `list[dict]`
- On error, wraps the exception as `HandlerError(code="RAW_QUERY_ERROR", http_status=500)`
- **Not** processed by the error translator or type coercer

### 5.3 Accessing `ctx` attributes

| Access pattern | What it returns |
|----------------|-----------------|
| `ctx.orders` | `_TrackingTableHandle` for "orders" table |
| `ctx.raw_query(sql, params)` | `list[dict]` from raw SQL execution |
| `ctx._anything` | `AttributeError` (private names are blocked) |
| `ctx.nonexistent` | `AttributeError` with available table list |

---

## 6. Transaction Model

### Single shared transaction

All operations within a handler share **one database connection and one transaction**:

```python
async def handle(ctx, payload):
    # Step 1: INSERT into orders (uses shared tx)
    order = await ctx.orders.create_order(data={...})

    # Step 2: INSERT into order_lines (same tx - can reference the order we just created)
    lines = await ctx.order_lines.bulk_create_lines(rows=[...])

    # Step 3: SELECT from orders (same tx - sees Step 1's insert, even before commit)
    check = await ctx.orders.get_by_pk(order["data"]["id"])

    return {"order": order["data"], "lines": lines["data"]["count"]}
    # Transaction is committed AFTER handle() returns successfully
```

### Commit / rollback rules

| Scenario | What happens |
|----------|--------------|
| `handle()` returns normally | Return value is serialized -> **COMMIT** -> HTTP response sent |
| `handle()` raises `HandlerError` | **ROLLBACK** -> error response sent |
| An action inside `handle()` raises `ActionError` (uncaught) | **ROLLBACK** -> wrapped as `HandlerError(ACTION_FAILED)` -> error response sent |
| Infrastructure error (`ConnectionError`, `OSError`, `TimeoutError`) | **ROLLBACK** -> wrapped as `HandlerError(INFRA_ERROR)` |
| Any other exception | **ROLLBACK** -> wrapped as `HandlerError(HANDLER_RUNTIME_ERROR)` |

### Serialize-before-commit guarantee

The handler's return value is serialized (via `_make_json_safe`) **before** the transaction is committed. This prevents the scenario where data is committed to the DB but the response fails to serialize, causing a misleading error.

The sequence is:

```
1. result = await handle(ctx, payload)
2. safe_result = _make_json_safe(result)    # serialize BEFORE commit
3. await backend.commit(conn)               # commit AFTER serialize succeeds
4. return {"success": True, "data": safe_result}
```

If serialization fails (e.g., return value contains a non-serializable type), the transaction is rolled back.

---

## 7. Step Tracking

Every action call through `ctx` is automatically tracked with a step number. This provides a detailed audit trail in error responses.

### How it works

```python
async def handle(ctx, payload):
    order = await ctx.orders.create_order(data={...})       # step 1
    lines = await ctx.order_lines.bulk_create_lines(rows=[...])  # step 2
    await ctx.inventory.deduct_stock(data={...}, conditions=[...])  # step 3
    return {...}
```

Each action call increments the step counter. On success, the step is recorded as `completed`. On failure, the error includes the failing step number and all prior steps are marked `rolled_back`.

### Step data in error responses

When an action fails at step 3:

```json
{
    "success": false,
    "error": {
        "code": "ACTION_FAILED",
        "message": "Action 'inventory.deduct_stock' failed: ...",
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

### What is NOT tracked

- Queries (`get_by_pk`, `list`, `count`, `exists`) are not tracked -- they are read-only
- `raw_query` calls are not tracked
- Private helper function calls within the handler

---

## 8. Error Handling

There are two error classes in the handler system, and the executor wraps all other exceptions into one of them.

### 8.1 HandlerError: Custom Business Logic Errors

**What it is:** An exception you raise intentionally to return a structured error to the client.

**When to use:** Input validation failures, business rule violations, any situation where the handler should return a specific error instead of data.

**Import:**

```python
from lib.handler.errors import HandlerError
# or
from lib import HandlerError
```

**Constructor:**

```python
class HandlerError(Exception):
    def __init__(
        self,
        message: str,           # human-readable error message
        *,
        code: str = "HANDLER_ERROR",   # error code (default: "HANDLER_ERROR")
        detail: dict | None = None,     # structured detail data (default: {})
        http_status: int = 400,         # HTTP status code to return
    )
```

**Example -- input validation:**

```python
async def handle(ctx, payload):
    if not payload.get("customer_id"):
        raise HandlerError(
            message="customer_id is required",
            http_status=400,
        )
```

Response:
```json
{
    "success": false,
    "error": {
        "code": "HANDLER_ERROR",
        "message": "customer_id is required",
        "detail": {}
    }
}
```

**Example -- custom code and detail:**

```python
raise HandlerError(
    message="Insufficient inventory for product X",
    code="INSUFFICIENT_STOCK",
    detail={"product_id": "X", "available": 5, "requested": 10},
    http_status=409,
)
```

Response (HTTP 409):
```json
{
    "success": false,
    "error": {
        "code": "INSUFFICIENT_STOCK",
        "message": "Insufficient inventory for product X",
        "detail": {"product_id": "X", "available": 5, "requested": 10}
    }
}
```

**The `code` field is fully customizable.** You can use any string. The platform defines some canonical codes (see [Section 8.4](#84-handler-error-codes-reference)), but your handler can define its own.

**The `http_status` field controls the HTTP response status code.** Default is 400. Common values:

| http_status | Use case |
|-------------|----------|
| 400 | Bad input, missing required fields |
| 404 | Resource not found (by handler logic) |
| 409 | Conflict, business rule violation |
| 422 | Semantic validation failure |

### 8.2 ActionError: Platform-Generated Errors

**What it is:** An exception raised by the action executor when a database operation or validation fails.

**When it occurs:** DB constraint violations (FK, UNIQUE, CHECK, NOT NULL), state mismatches, PK conflicts, type coercion failures.

**Import:**

```python
from lib.handler.errors import ActionError
# or
from lib import ActionError
```

**Constructor (for reference -- you rarely construct this yourself):**

```python
class ActionError(Exception):
    def __init__(
        self,
        message: str,
        code: str = "ACTION_FAILED",
        details: dict | None = None,
        *,
        table: str = "",
        action: str = "",
        step: int = 0,
    )
```

**Key attributes:**

| Attribute | Type | Description |
|-----------|------|-------------|
| `message` | `str` | Human-readable error message |
| `code` | `str` | Error code (e.g., `FK_VIOLATION`, `STATE_MISMATCH`) |
| `details` | `dict` | Structured details (e.g., `{"field": "type", "referenced_table": "party_type_list"}`) |
| `table` | `str` | Table where the error occurred |
| `action` | `str` | Action that triggered the error |
| `step` | `int` | Step number within the handler |

### Two ways to handle ActionError in a handler

**Option A: Let it propagate (recommended for most cases)**

```python
async def handle(ctx, payload):
    order = await ctx.orders.create_order(data={...})
    lines = await ctx.order_lines.bulk_create_lines(rows=[...])
    # If any action fails, the executor catches the ActionError,
    # rolls back everything, and returns a structured error response
    # with step tracking information.
    return {"order": order["data"]}
```

The executor wraps uncaught `ActionError` into `HandlerError(code="ACTION_FAILED")` automatically. The response includes the failing action's details and all rolled-back steps.

**Option B: Catch and re-raise as HandlerError (for custom error messages)**

```python
async def handle(ctx, payload):
    order = await ctx.orders.create_order(data={...})

    try:
        await ctx.inventory.deduct_stock(
            data={"qty_delta": -payload["quantity"]},
            conditions=[("product_id", "=", payload["product_id"])],
        )
    except ActionError as e:
        raise HandlerError(
            message=f"Cannot deduct stock: {e.message}",
            code="INSUFFICIENT_STOCK",
            detail={
                "product_id": payload["product_id"],
                "original_error_code": e.code,
            },
            http_status=409,
        )
    # Note: if you raise HandlerError, the ENTIRE transaction is still rolled back
    # (including the order created in step 1).
    return {"order": order["data"]}
```

### 8.3 Error Propagation Flow

This is the complete error handling chain in `HandlerExecutor.execute_sync()`:

```
handle(ctx, payload) executes
  │
  ├─ Returns normally
  │   └─ _make_json_safe(result) -> COMMIT -> {"success": true, "data": ...}
  │
  ├─ Raises HandlerError
  │   └─ ROLLBACK -> re-raise as-is
  │       └─ HTTP route returns: {"success": false, "error": {code, message, detail}}
  │          with status = exc.http_status
  │
  ├─ Raises ActionError (uncaught by handler)
  │   └─ ROLLBACK
  │       └─ Wrap as HandlerError(code="ACTION_FAILED", http_status=409)
  │           with detail: {failed_action: {...}, completed_actions: [...rolled_back...]}
  │
  ├─ Raises ConnectionError / OSError / TimeoutError
  │   └─ ROLLBACK
  │       └─ Wrap as HandlerError(code="INFRA_ERROR", http_status=503)
  │
  └─ Raises any other Exception
      └─ ROLLBACK
          └─ Wrap as HandlerError(code="HANDLER_RUNTIME_ERROR", http_status=500)
```

**For async mode**, the same error handling applies, but errors are stored in the task record (retrievable via `GET /api/tasks/{task_id}`) instead of the HTTP response.

### 8.4 Handler Error Codes Reference

| Code | Source | HTTP | Meaning |
|------|--------|------|---------|
| `HANDLER_ERROR` | Handler raises `HandlerError()` (default code) | varies (default 400) | Custom handler error -- check `message` and `detail` |
| `ACTION_FAILED` | Executor catches uncaught `ActionError` | 409 | An action failed inside the handler. Check `detail.failed_action` for the original error code |
| `RAW_QUERY_ERROR` | `ctx.raw_query()` fails | 500 | Raw SQL execution failed |
| `INFRA_ERROR` | `ConnectionError`, `OSError`, `TimeoutError` | 503 | Infrastructure/connectivity failure |
| `HANDLER_RUNTIME_ERROR` | Any other uncaught exception | 500 | Bug in handler code (e.g., `TypeError`, `KeyError`) |

**Original `ActionError` codes that can appear in `detail.failed_action.error_code`:**

| Code | Trigger |
|------|---------|
| `INVALID_INPUT` | Malformed params, type coercion failure (e.g., invalid date string) |
| `MISSING_PK` | `pk` not provided for update/delete |
| `STATE_MISMATCH` | Row not in expected `from_state` |
| `PK_CONFLICT` | Custom PK generator exhausted retries |
| `FIELD_REQUIRED` | NOT NULL violation |
| `FK_VIOLATION` | FK reference doesn't exist |
| `FK_RESTRICT` | FK prevents delete (row still referenced) |
| `UNIQUE_VIOLATION` | Duplicate value on UNIQUE column |
| `CHECK_VIOLATION` | CHECK constraint violated |
| `DB_ERROR` | Unrecognized DB exception |

---

## 9. Auto Type Coercion

The platform automatically converts JSON values to the correct Python types for asyncpg, and converts asyncpg output back to JSON-safe values. **Handler authors do not need to manually convert types.**

### What this means for handlers

```python
# Before auto-coercion (manual conversion was needed):
from datetime import date
person_data["date_of_birth"] = date.fromisoformat(person_data["date_of_birth"])

# After auto-coercion (the platform handles it):
# Just pass the string directly -- TypeCoercer in ActionExecutor handles it
person = await ctx.party_person.create_party_person_active(data=person_data)
```

### Coercion happens at the ActionExecutor level

When `ctx.party_person.create_party_person_active(data={...})` is called, the `ActionExecutor`:

1. **Input**: Converts `"1990-05-20"` (string) -> `date(1990, 5, 20)` (Python object) before passing to asyncpg
2. **Output**: Converts `date(1990, 5, 20)` (asyncpg result) -> `"1990-05-20"` (JSON string) in the returned dict

This means the handler's return value already contains JSON-safe types from action/query results.

### Idempotent

If your handler already passes a Python `date` object (e.g., from `date.fromisoformat()`), the coercer detects `isinstance(v, date)` and passes it through unchanged.

### Where coercion does NOT apply

- `ctx.raw_query()` results -- raw SQL output is not coerced
- Custom Python objects in the handler's return value -- these go through `_make_json_safe` instead (see [Section 10](#10-output-serialization))

---

## 10. Output Serialization

The handler's return value passes through `_make_json_safe()` before the transaction is committed. This converts Python types to JSON-serializable values.

### Conversion rules

| Python type | JSON output | Example |
|-------------|-------------|---------|
| `str`, `int`, `float`, `bool`, `None` | passthrough | `42` -> `42` |
| `dict` | recursive conversion | `{"k": date(2025,1,1)}` -> `{"k": "2025-01-01"}` |
| `list`, `tuple` | recursive conversion | `[date(2025,1,1)]` -> `["2025-01-01"]` |
| `datetime` | `isoformat(sep=" ")` | `"2025-01-15 10:30:00"` |
| `date` | `isoformat()` | `"2025-01-15"` |
| `time` | `isoformat()` | `"10:30:00"` |
| `timedelta` | `str()` | `"1:30:00"` |
| `uuid.UUID` | `str()` | `"a1b2c3d4-..."` |
| `decimal.Decimal` | `float()` | `99.99` |
| anything else | `TypeError` raised (-> ROLLBACK) | |

### When this matters

If your handler returns data that came from action/query results, it's already JSON-safe (because of output coercion at the executor level). `_make_json_safe` acts as a safety net for:

- Values from `ctx.raw_query()` (not coerced by TypeCoercer)
- Custom Python objects constructed by the handler
- Any non-standard return values

---

## 11. Validation Endpoint

The `POST /api/admin/validate-handler` endpoint validates handler source code **before** writing files or triggering hot reload. No side effects -- no files written, no handlers registered.

### Request

```
POST /api/admin/validate-handler
Content-Type: application/json
Authorization: Bearer <ADMIN_TOKEN>

{"content": "async def handle(ctx, payload):\n    ..."}
```

### Validation checks

| Code | Severity | What it checks |
|------|----------|----------------|
| `PARSE_ERROR` | error | Python syntax errors, import errors, module execution failures |
| `MISSING_HANDLE` | error | No callable `handle` function in the module |
| `HANDLE_NOT_ASYNC` | error | `handle` is not defined with `async def` |
| `INVALID_HANDLE_SIGNATURE` | error | `handle` has fewer than 2 parameters |
| `INVALID_MODE` | error | `MODE` is set but not `"sync"` or `"async"` |
| `UNKNOWN_TABLE_REF` | warning | `ctx.{name}` references a table not currently registered |
| `UNKNOWN_ACTION_REF` | warning | `ctx.{table}.{action}()` references an action/query not registered on that table |

### Response examples

Valid:
```json
{"valid": true, "errors": [], "warnings": []}
```

Invalid (not async):
```json
{
    "valid": false,
    "errors": [
        {
            "code": "HANDLE_NOT_ASYNC",
            "message": "'handle' must be an async function (defined with 'async def')",
            "path": "handle",
            "suggestion": "Change 'def handle(ctx, payload)' to 'async def handle(ctx, payload)'"
        }
    ],
    "warnings": []
}
```

Valid with warnings (typo in action name):
```json
{
    "valid": true,
    "errors": [],
    "warnings": [
        {
            "code": "UNKNOWN_ACTION_REF",
            "message": "ctx.orders.create_ordr() references 'create_ordr' which is not a registered action or built-in query on table 'orders'",
            "path": "ctx.orders.create_ordr",
            "suggestion": "Available actions: create_order, submit_order, .... Built-in queries: count, exists, get_by_pk, list"
        }
    ]
}
```

### Recommended workflow

```bash
# 1. Validate
curl -X POST $URL/api/admin/validate-handler \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "async def handle(ctx, payload):\n    ..."}'

# 2. If valid, write the file
curl -X PUT $URL/api/admin/files/handlers/my_handler.py \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "async def handle(ctx, payload):\n    ..."}'

# 3. Trigger reload
curl -X POST $URL/api/admin/reload \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 12. Lifecycle: Scanning, Registration, Hot Reload

### Startup scanning

At application startup, `app.py` calls:

```python
registry.scan_handlers(HANDLERS_DIR)
```

This runs the **strict scanner** (`lib/handler/scanner.py`):
- Scans all `*.py` files in the directory (excluding `_`-prefixed)
- Imports each module, looks for a callable `handle` function
- Reads `MODE` (defaults to `"sync"`)
- Creates `HandlerDef(name, mode, handle_fn)` and registers it

If the handlers directory doesn't exist, the scanner raises `FileNotFoundError` (startup fails).

### Hot reload

When `POST /api/admin/reload` is called, the **safe scanner** (`lib/reload/scanner.py`) runs:

```python
scan_handlers_safe(handlers_dir)
```

This scanner is identical to the strict scanner but wraps each file in try/except. A broken handler file doesn't prevent other handlers from loading.

Reload behavior for handlers:

| Scenario | Result |
|----------|--------|
| New handler file added | `handlers.added: ["new_handler"]` |
| Existing handler file updated | `handlers.skipped: ["existing_handler"]` (re-imported with new code) |
| Handler file deleted | `handlers.removed: ["old_handler"]` |
| Handler file has syntax error | Appears in `scan_errors`, other handlers unaffected |

### Hot reload result format

```json
{
    "success": true,
    "handlers": {
        "added": ["new_handler"],
        "skipped": ["existing_handler"],
        "removed": ["deleted_handler"]
    }
}
```

---

## 13. Patterns and Best Practices

### Pattern: Input validation first

Validate the payload before making any action calls. This avoids unnecessary DB work and provides clear error messages.

```python
async def handle(ctx, payload):
    customer_id = payload.get("customer_id")
    if not customer_id:
        raise HandlerError(message="customer_id is required", http_status=400)

    items = payload.get("items")
    if not items or not isinstance(items, list):
        raise HandlerError(message="items must be a non-empty list", http_status=400)

    for i, item in enumerate(items):
        if "product_id" not in item:
            raise HandlerError(
                message=f"items[{i}] missing product_id",
                http_status=400,
            )

    # Now safe to proceed with actions
    ...
```

### Pattern: Catch specific ActionError for custom messages

```python
async def handle(ctx, payload):
    try:
        await ctx.inventory.deduct_stock(
            data={"qty_delta": -qty},
            conditions=[("product_id", "=", pid)],
        )
    except ActionError as e:
        if e.code == "STATE_MISMATCH":
            raise HandlerError(
                message=f"Product {pid} is not available for deduction",
                code="PRODUCT_UNAVAILABLE",
                http_status=409,
            )
        raise  # re-raise unexpected ActionErrors for automatic handling
```

### Pattern: Query-then-act

```python
async def handle(ctx, payload):
    order = await ctx.orders.get_by_pk(payload["order_id"])
    if order["data"] is None:
        raise HandlerError(message="Order not found", code="NOT_FOUND", http_status=404)

    if order["data"]["amount"] > 10000:
        raise HandlerError(
            message="Orders over $10,000 require manual approval",
            code="REQUIRES_APPROVAL",
            http_status=409,
        )

    result = await ctx.orders.activate_order(pk=payload["order_id"], data={})
    return result["data"]
```

### Pattern: Cross-table atomic operation

```python
async def handle(ctx, payload):
    party = await ctx.party.create_party_active(data={
        "type": payload["type"],
        "description": payload["description"],
        "name": payload["entity_name"],
    })
    party_id = party["data"]["party_id"]

    corp = await ctx.party_corp.create_party_corp_active(data={
        "party_id": party_id,
        "legal_form": payload["legal_form"],
        "entity_name": payload["entity_name"],
        "country_of_domicile": payload["country_of_domicile"],
        "listed_ind": payload["listed_ind"],
    })

    return {"party": party["data"], "party_corp": corp["data"]}
```

### Pattern: Bulk with follow-up query

```python
async def handle(ctx, payload):
    result = await ctx.order_lines.bulk_create_lines(rows=payload["lines"])
    pks = result["data"]["pks"]

    full_rows = await ctx.order_lines.list(
        conditions=[("line_id", "IN", pks)],
        limit=len(pks),
    )
    return {"count": result["data"]["count"], "lines": full_rows["data"]}
```

### Pattern: Read-only handler with raw SQL

```python
MODE = "sync"

async def handle(ctx, payload):
    customer_id = payload["customer_id"]

    summary = await ctx.raw_query(
        "SELECT o.id, o.amount, p.method "
        "FROM orders o JOIN payments p ON p.order_id = o.id "
        "WHERE o.customer_id = $1 AND o.state = 'active'",
        [customer_id],
    )

    active_count = await ctx.orders.count(
        conditions=[("customer_id", "=", customer_id), ("state", "=", "active")]
    )

    return {
        "customer_id": customer_id,
        "active_orders": active_count["data"]["count"],
        "details": summary,
    }
```

### Things the platform handles for you

| Concern | Handled by | You do NOT need to |
|---------|------------|-------------------|
| PK generation | `ActionExecutor` + `PKConfig` | Generate UUIDs or sequence IDs |
| State injection | `ActionExecutor` + `StateTransition` | Set `data["state"]` manually |
| Type coercion | `TypeCoercer` in `ActionExecutor` | Call `date.fromisoformat()`, `int()`, etc. |
| CAS (compare-and-swap) | `ActionExecutor` + `build_cas_state_condition` | Add `WHERE state = ...` manually |
| Transaction management | `HandlerExecutor` | Call `BEGIN`, `COMMIT`, `ROLLBACK` |
| Step tracking | `_TrackingTableHandle` | Count action steps manually |
| Output serialization | `_make_json_safe` | Convert `UUID`, `Decimal`, `date` to strings |
| DB error translation | `error_translator` | Parse asyncpg exception messages |

### Things you DO need to handle

| Concern | How |
|---------|-----|
| Input validation | Check `payload` fields, raise `HandlerError` |
| Business rules | Check conditions, raise `HandlerError` |
| Custom error messages | Catch `ActionError`, raise `HandlerError` with context |
| Payload contract | Define expected fields in the module docstring |

---

## 14. Complete Examples

### Example 1: Sync handler -- create party with sub-entity

This is the real `create_party.py` from the CRM demo:

```python
"""Handler: create_party

Accepts a flattened payload, routes by type, creates Party + PartyCorp or Party + PartyPerson
in a single atomic transaction.

Payload (CORP):
    type, description, legal_form, entity_name, country_of_domicile, listed_ind
    optional: short_name, short_code, local_name,
              country_of_incorporation, market_id, isin_code, industry_type

Payload (PERSON):
    type, description, first_name, last_name
    optional: short_name, short_code,
              title, mid_name, preferred_name,
              first_name_local, last_name_local, mid_name_local, preferred_name_local,
              local_lang, gender, date_of_birth,
              nationality, country_of_residence, country_of_birth,
              education_level, marital_status

Endpoint: POST /api/handlers/create_party
"""
from lib.handler.errors import HandlerError

MODE = "sync"

_CORP_OPTIONAL = {
    "country_of_incorporation", "market_id", "isin_code", "industry_type",
}

_PERSON_OPTIONAL = {
    "title", "mid_name", "preferred_name",
    "first_name_local", "last_name_local", "mid_name_local", "preferred_name_local",
    "local_lang", "gender", "date_of_birth",
    "nationality", "country_of_residence", "country_of_birth",
    "education_level", "marital_status",
}


def _pick(payload: dict, keys: set) -> dict:
    return {k: payload[k] for k in keys if k in payload}


async def handle(ctx, payload: dict) -> dict:
    party_type = (payload.get("type") or "").upper()

    if party_type == "CORP":
        party_data = {
            "type":        payload["type"],
            "description": payload["description"],
            "name":        payload["entity_name"],
            **_pick(payload, {"short_name", "short_code", "local_name"}),
        }
        party = await ctx.party.create_party_active(data=party_data)
        party_id = party["data"]["party_id"]

        corp_data = {
            "party_id":            party_id,
            "legal_form":          payload["legal_form"],
            "entity_name":         payload["entity_name"],
            "country_of_domicile": payload["country_of_domicile"],
            "listed_ind":          payload["listed_ind"],
            **_pick(payload, _CORP_OPTIONAL),
        }
        corp = await ctx.party_corp.create_party_corp_active(data=corp_data)

        return {"party": party["data"], "party_corp": corp["data"]}

    elif party_type == "PERSON":
        party_data = {
            "type":        payload["type"],
            "description": payload["description"],
            "name":        f"{payload['first_name']} {payload['last_name']}",
            **_pick(payload, {"short_name", "short_code"}),
        }
        party = await ctx.party.create_party_active(data=party_data)
        party_id = party["data"]["party_id"]

        person_data = {
            "party_id":   party_id,
            "first_name": payload["first_name"],
            "last_name":  payload["last_name"],
            **_pick(payload, _PERSON_OPTIONAL),
        }
        person = await ctx.party_person.create_party_person_active(data=person_data)

        return {"party": party["data"], "party_person": person["data"]}

    else:
        raise HandlerError(
            message=f"'type' must be 'CORP' or 'PERSON', got: '{payload.get('type')}'",
            code="INVALID_INPUT",
            http_status=400,
        )
```

Key points:
- Docstring describes the payload contract
- `_pick` helper extracts optional fields from the flat payload
- No manual type conversion needed (date_of_birth passed as string -> auto-coerced)
- Uses `HandlerError` with custom `code="INVALID_INPUT"` for invalid type
- Multi-table atomicity: if `party_corp` insert fails, the `party` insert is rolled back

### Example 2: Async handler -- batch migration

```python
MODE = "async"

async def handle(ctx, payload: dict) -> dict:
    source_state = payload.get("from_state", "pending")
    limit = payload.get("limit", 100)

    orders = await ctx.orders.list(
        conditions=[("state", "=", source_state)],
        limit=limit,
    )

    migrated = 0
    for order in orders["data"]:
        await ctx.orders.activate_order(pk=order["id"], data={})
        migrated += 1

    return {"migrated": migrated, "source_state": source_state}
```

HTTP flow:
```
POST /api/handlers/bulk_migrate {"from_state": "pending", "limit": 50}
-> 202 {"success": true, "task_id": "abc-123", "status": "accepted"}

GET /api/tasks/abc-123
-> 200 {"task_id": "abc-123", "status": "completed", "result": {"migrated": 42, "source_state": "pending"}}
```

### Example 3: Error-catching handler

```python
from lib.handler.errors import HandlerError, ActionError

MODE = "sync"

async def handle(ctx, payload: dict) -> dict:
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

---

## 15. Source Code Reference

| File | Role |
|------|------|
| `lib/handler/executor.py` | `HandlerExecutor` -- transaction management, sync/async dispatch, `_make_json_safe` |
| `lib/handler/context.py` | `HandlerContext` -- `ctx` object, `_TrackingTableHandle`, `raw_query` |
| `lib/handler/errors.py` | `HandlerError` and `ActionError` class definitions |
| `lib/handler/scanner.py` | Strict handler scanner (startup) |
| `lib/handler/task_store.py` | In-memory task state store for async handlers |
| `lib/handler/__init__.py` | Re-exports `HandlerContext`, `HandlerError`, `ActionError` |
| `lib/reload/scanner.py` | Safe handler scanner (hot reload, per-file isolation) |
| `lib/api/routes/handlers.py` | HTTP route: `POST /api/handlers/{name}` |
| `lib/api/routes/tasks.py` | HTTP route: `GET /api/tasks/{task_id}` |
| `lib/api/validators.py` | `validate_handler_content()` for validation endpoint |
| `lib/api/routes/admin.py` | Admin route: `POST /api/admin/validate-handler` |
| `lib/errors.py` | `ErrorCode` constants and `HTTP_STATUS` mapping |
| `lib/action/executor.py` | `ActionExecutor` -- where `ActionError` originates |
| `lib/table/coerce.py` | `TypeCoercer` -- auto type coercion layer |
