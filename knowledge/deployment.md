# Data Platform -- Deployment Guide (Railway)

## Table of Contents

- [Deployment Architecture](#deployment-architecture)
- [Three Layers of State](#three-layers-of-state)
- [All HTTP Endpoints](#all-http-endpoints)
  - [Data Endpoints (business logic)](#data-endpoints-business-logic)
  - [Admin Endpoints (operations)](#admin-endpoints-operations)
- [Environment Variables](#environment-variables)
- [Railway Setup: Step by Step](#railway-setup-step-by-step)
  - [1. Push to GitHub](#1-push-to-github)
  - [2. Create Railway Service](#2-create-railway-service)
  - [3. Attach a Volume](#3-attach-a-volume)
  - [4. Set Environment Variables](#4-set-environment-variables)
  - [5. Generate Public Domain](#5-generate-public-domain)
  - [6. Deploy](#6-deploy)
- [Railway Networking](#railway-networking)
  - [Public Domain (external access)](#public-domain-external-access)
  - [Private Networking (service-to-service)](#private-networking-service-to-service)
  - [Which URL to use](#which-url-to-use)
- [Volume: Seeding and Lifecycle](#volume-seeding-and-lifecycle)
- [Runtime Hot Reload via External System](#runtime-hot-reload-via-external-system)
  - [Step 1: Write files via HTTP](#step-1-write-files-via-http)
  - [Step 2: Trigger reload](#step-2-trigger-reload)
  - [Step 3: Use the new table immediately](#step-3-use-the-new-table-immediately)
  - [Updating an existing table (append-only)](#updating-an-existing-table-append-only)
- [Backup and Migration](#backup-and-migration)
  - [Download workspace zip](#download-workspace-zip)
  - [Per-file inspection](#per-file-inspection)
- [Adding a New Workspace](#adding-a-new-workspace)
  - [1. Create the workspace directory](#1-create-the-workspace-directory)
  - [2. Write app.py](#2-write-apppy)
  - [3. Deploy as a separate Railway service](#3-deploy-as-a-separate-railway-service)
- [Local Development](#local-development)
- [Dockerfile and Entrypoint Reference](#dockerfile-and-entrypoint-reference)

---

## Deployment Architecture

```
                  ┌───────────────┐
                  │  Your Laptop  │
                  │  curl/browser │
                  └───────┬───────┘
                          │ HTTPS (public domain)
                          │ https://crm-demo-production.up.railway.app
┌─────────────────────────┼───────────────────────────────────────┐
│  Railway Project         │                                       │
│                          ▼                                       │
│  ┌──────────────────┐  ┌─────────────────────────────────────┐  │
│  │  CrewAI Service   │  │  Data Platform Service               │  │
│  │                   │  │                                     │  │
│  │  PUT files        │  │  FastAPI (uvicorn)                  │  │
│  │  POST reload      │  │    ├── /api/actions/...             │  │
│  │  Use new APIs     │  │    ├── /api/queries/...             │  │
│  │                   │  │    ├── /api/handlers/...            │  │
│  │  Uses private URL:│  │    ├── /api/tasks/...               │  │
│  │  http://data-     │  │    └── /api/admin/...               │  │
│  │  platform.railway │  │                                     │  │
│  │  .internal:PORT   │  │  Volume (/data)                     │  │
│  └────────┬──────────┘  │    ├── tables/*.py                  │  │
│           │              │    └── handlers/*.py                │  │
│           │ HTTP         └──────────┬──────────────────────────┘  │
│           │ (private)               │                             │
│           └─────────────────────────┘                             │
│                                     │ TCP                        │
└─────────────────────────────────────┼────────────────────────────┘
                                      │
                           ┌──────────▼──────────┐
                           │  Supabase PostgreSQL  │
                           │  (external)           │
                           └───────────────────────┘
```

Two networking paths exist:
- **Public domain** (`https://crm-demo-production.up.railway.app`): for access from your laptop, browser, external clients. Generated manually in Railway settings.
- **Private network** (`http://data-platform.railway.internal:PORT`): for service-to-service communication within the same Railway project (e.g., CrewAI -> Data Platform). Automatic, lower latency, no TLS overhead.

Each workspace (e.g., `crm_demo`, `trading_demo`) is deployed as a **separate Railway service** with its own volume and its own `DATABASE_URL`. They share the same Docker image but differ in environment variables.

---

## Three Layers of State

Understanding where data lives is critical for operations:

| Layer | What | Persistence | Lost on restart? |
|-------|------|-------------|-----------------|
| **Disk (volume)** | `.py` files in `tables/` and `handlers/` | Railway volume, persists across deploys | No |
| **Memory** | `Registry._table_configs`, `Registry._table_handles`, `HandlerExecutor._handlers` | Python process RAM | **Yes** -- rebuilt on startup from disk |
| **PostgreSQL** | Actual database tables (rows, schema) | Supabase, permanent | No |

**What happens on restart / redeploy:**

1. PostgreSQL tables already exist (permanent, on Supabase).
2. In-memory Registry is empty (process restarted).
3. `app.py` startup sequence:
   - Registers the 10 hard-coded initial tables (FK order matters).
   - Scans the volume `TABLES_DIR` for any additional `.py` files added at runtime (e.g., by CrewAI). Already-registered tables are skipped.
   - Scans the volume `HANDLERS_DIR` for handler files.
4. The service is ready to handle requests.

---

## All HTTP Endpoints

### Data Endpoints (business logic)

Protected by `API_TOKEN` when set. Include `Authorization: Bearer <token>` in requests.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/actions/{table}/{action}` | Execute a write action (insert, update, delete, bulk variants) |
| `POST` | `/api/queries/{table}/{method}` | Execute a read query (`get_by_pk`, `list`, `count`, `exists`) |
| `POST` | `/api/handlers/{handler_name}` | Execute a handler (sync: 200, async: 202) |
| `GET` | `/api/tasks/{task_id}` | Poll async handler task status and result |

### Admin Endpoints (operations)

All admin endpoints are protected by `ADMIN_TOKEN` when set. Include `Authorization: Bearer <token>` in requests.

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `POST` | `/api/admin/reload` | Trigger hot reload (scan -> diff -> execute) | JSON: reload result |
| `GET` | `/api/admin/schema-catalog` | Read-only snapshot of all registered table configs and handlers | JSON: full schema |
| `PUT` | `/api/admin/files/{category}/{filename}` | Write/overwrite a `.py` file | JSON: `{"success": true, "path": "tables/x.py"}` |
| `GET` | `/api/admin/files/{category}` | List all `.py` files in `tables/` or `handlers/` | JSON: `{"files": ["a.py", "b.py"]}` |
| `GET` | `/api/admin/files/{category}/{filename}` | Read a single file's content | JSON: `{"filename": "x.py", "content": "..."}` |
| `GET` | `/api/admin/workspace/download` | Download entire workspace as zip | Binary: `workspace.zip` |
| `GET` | `/api/admin/api-catalog` | List all callable action + handler APIs with full URLs | JSON: actions + handlers |
| `GET` | `/api/admin/api-catalog/{table}` | List all APIs for a table (actions + queries) with full URLs | JSON: endpoints list |

URLs in the API catalog auto-adapt: `http://localhost:8000` locally, `https://your-domain.up.railway.app` on Railway, or `http://service.railway.internal:PORT` via private network. After hot reload, newly added tables/handlers appear immediately in the catalog.

`{category}` must be `tables` or `handlers`. File validation rules:
- Filename must end with `.py`
- No path traversal (`..`, `/`, `\`)
- Filenames starting with `_` are reserved (the scanner skips them)
- No DELETE endpoint -- the hot reload system is append-only by design

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | -- | PostgreSQL connection string (e.g., Supabase) |
| `ADMIN_TOKEN` | Recommended | `None` (no auth) | Bearer token for admin endpoints (`/api/admin/*`) |
| `API_TOKEN` | Recommended | `None` (no auth) | Bearer token for business endpoints (`/api/actions/*`, `/api/queries/*`, `/api/handlers/*`, `/api/tasks/*`) |
| `PORT` | No | `8000` | HTTP port (Railway sets this automatically) |
| `TABLES_DIR` | No | `./tables` (relative to `app.py`) | Path to table config `.py` files |
| `HANDLERS_DIR` | No | `./handlers` (relative to `app.py`) | Path to handler `.py` files |
| `WORKSPACE_SEED_DIR` | No | -- | Path to baked-in workspace for first-boot volume seeding |

**Two-token authentication:**

- `ADMIN_TOKEN` protects admin operations: hot reload, file management, schema catalog, API catalog, workspace download.
- `API_TOKEN` protects business operations: actions, queries, handlers, task polling.
- Both tokens are optional. When not set (e.g., local development), no authentication is required.
- On Railway, both should be set to prevent unauthorized access via the public domain.

On Railway, set `TABLES_DIR` and `HANDLERS_DIR` to point to the volume mount (e.g., `/data/tables`, `/data/handlers`). Locally, leave them unset to use the default `./tables` and `./handlers` relative to `app.py`.

---

## Railway Setup: Step by Step

### 1. Push to GitHub

The `data_platform/` directory contains everything needed:

```
data_platform/
  Dockerfile
  entrypoint.sh
  pyproject.toml
  lib/                  # the platform library
  workspace/
    crm_demo/           # workspace app
      app.py
      tables/
      handlers/
  docs/
```

Push this to a GitHub repository.

### 2. Create Railway Service

1. Go to [railway.app](https://railway.app) and create a new project.
2. Add a new service from your GitHub repo.
3. In the service settings, set **Root Directory** to `data_platform/`.
4. Railway will auto-detect the `Dockerfile` and use it for builds.

### 3. Attach a Volume

1. In the Railway service settings, go to **Volumes**.
2. Add a new volume with mount path `/data`.
3. Size: 1 GB is sufficient (the volume only stores `.py` files).

The volume persists across deploys. On first boot, the entrypoint script seeds it from the baked-in image.

### 4. Set Environment Variables

In the Railway service settings, add:

```
DATABASE_URL=postgresql://postgres.xxx:password@host:5432/postgres
ADMIN_TOKEN=your-admin-secret
API_TOKEN=your-api-secret
TABLES_DIR=/data/tables
HANDLERS_DIR=/data/handlers
WORKSPACE_SEED_DIR=/app/workspace/crm_demo
```

### 5. Generate Public Domain

Railway does not assign a public URL by default. You must explicitly generate one:

1. In the service dashboard, go to **Settings** -> **Networking** -> **Public Networking**.
2. Click **Generate Domain**. Railway assigns a URL like `crm-demo-production.up.railway.app`.
3. (Optional) Add a custom domain if you have one.

This public domain is what external clients (curl, browser, Postman) use to reach the service. Without it, the service is only accessible via Railway's private network.

### 6. Deploy

Click **Deploy** or push to the connected branch. Railway builds the Docker image and starts the service.

Verify the service is running using the public domain from step 5:

```bash
# Replace with your actual Railway domain
export DATA_PLATFORM_URL="https://crm-demo-production.up.railway.app"
export ADMIN_TOKEN="your-secret-token-here"

curl "$DATA_PLATFORM_URL/api/admin/schema-catalog" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Railway Networking

Railway provides two ways for clients to reach your service. Understanding the difference is important for security and performance.

### Public Domain (external access)

```
https://crm-demo-production.up.railway.app
```

- Generated in **Settings -> Networking -> Public Networking** (see step 5 above).
- Accessible from anywhere on the internet.
- Uses HTTPS (Railway manages TLS certificates automatically).
- Use this for: curl from your laptop, browser access, Postman, external CI/CD, any client outside Railway.

### Private Networking (service-to-service)

```
http://data-platform.railway.internal:8000
```

- Automatically available for services **within the same Railway project**.
- Not accessible from the internet -- only from other Railway services in the same project.
- Uses HTTP (no TLS needed, traffic stays within Railway's internal network).
- Lower latency than public domain (no internet round-trip).
- The hostname is the **service name** (as shown in Railway dashboard) + `.railway.internal`.
- The port is the port your app listens on (the value of `$PORT`, which Railway assigns).

To find the private URL:
1. Go to the data platform service in Railway dashboard.
2. Go to **Settings** -> **Networking** -> **Private Networking**.
3. The internal hostname is shown (e.g., `data-platform.railway.internal`).
4. The port is shown as the `PORT` variable value.

### Which URL to use

| Caller | URL to use | Example |
|--------|-----------|---------|
| Your laptop (curl, browser) | Public domain | `https://crm-demo-production.up.railway.app` |
| CrewAI (same Railway project) | Private network | `http://data-platform.railway.internal:$PORT` |
| Another Railway service (same project) | Private network | `http://data-platform.railway.internal:$PORT` |
| External CI/CD, webhooks | Public domain | `https://crm-demo-production.up.railway.app` |

**CrewAI configuration example:**

Since CrewAI is deployed as a separate service in the same Railway project, it should use the private URL. In CrewAI's environment variables on Railway:

```
DATA_PLATFORM_URL=http://data-platform.railway.internal:8000
DATA_PLATFORM_ADMIN_TOKEN=your-admin-secret
DATA_PLATFORM_API_TOKEN=your-api-secret
```

CrewAI then calls the data platform like:

```python
import httpx

url = os.environ["DATA_PLATFORM_URL"]
admin_token = os.environ["DATA_PLATFORM_ADMIN_TOKEN"]
api_token = os.environ["DATA_PLATFORM_API_TOKEN"]
admin_headers = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
api_headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}

# Admin operations (file management, reload) use ADMIN_TOKEN
httpx.put(f"{url}/api/admin/files/tables/inventory.py", json={"content": "..."}, headers=admin_headers)
httpx.post(f"{url}/api/admin/reload", headers=admin_headers)

# Business operations (actions, queries, handlers) use API_TOKEN
httpx.post(f"{url}/api/actions/inventory/add_item", json={"data": {"product": "X", "qty": 10}}, headers=api_headers)
httpx.post(f"{url}/api/queries/inventory/list", json={}, headers=api_headers)
```

---

## Volume: Seeding and Lifecycle

The `entrypoint.sh` script manages volume initialization:

```
First boot (volume empty):
  1. Check: WORKSPACE_SEED_DIR is set and /data/tables/.seeded does not exist
  2. Copy: /app/workspace/crm_demo/tables/* -> /data/tables/
  3. Copy: /app/workspace/crm_demo/handlers/* -> /data/handlers/
  4. Create: /data/tables/.seeded marker file
  5. Start: uvicorn

Subsequent boots (volume already seeded):
  1. Check: /data/tables/.seeded exists -> skip copy
  2. Start: uvicorn (volume already has all files, including runtime-added ones)
```

The `.seeded` marker ensures the baked-in files are only copied once. Files added at runtime by external systems (via `PUT /api/admin/files/...`) are already on the volume and survive restarts.

**Important:** If you update initial table configs in git and redeploy, the volume keeps the old versions (because `.seeded` exists). To update initial tables on a running service, use `PUT /api/admin/files/tables/party.py` with the new content, then `POST /api/admin/reload`.

---

## Runtime Hot Reload via External System

This is the primary use case for production deployments. An external system (e.g., CrewAI) can add new tables and handlers at runtime without restarting the data platform.

All examples below use `$DATA_PLATFORM_URL` as a variable. Set it to:
- The **public domain** if calling from outside Railway: `https://crm-demo-production.up.railway.app`
- The **private URL** if calling from another Railway service in the same project: `http://data-platform.railway.internal:PORT`

```bash
# From your laptop (public domain):
export DATA_PLATFORM_URL="https://crm-demo-production.up.railway.app"

# From CrewAI on Railway (private network):
export DATA_PLATFORM_URL="http://data-platform.railway.internal:8000"
```

### Step 1: Write files via HTTP

```bash
# Write a new table config
curl -X PUT $DATA_PLATFORM_URL/api/admin/files/tables/inventory.py \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "from lib import TableConfig, ColumnDef, PKConfig, StateTransition, ActionDef\n\nconfig = TableConfig(\n    table_name=\"inventory\",\n    pk_config=PKConfig(strategy=\"uuid4\"),\n    states=[\"in_stock\", \"reserved\"],\n    transitions=[\n        StateTransition(from_state=\"init\", to_state=\"in_stock\"),\n        StateTransition(from_state=\"in_stock\", to_state=\"reserved\"),\n    ],\n    columns=[\n        ColumnDef(name=\"id\", pg_type=\"uuid\", nullable=False),\n        ColumnDef(name=\"product\", pg_type=\"text\", nullable=False),\n        ColumnDef(name=\"qty\", pg_type=\"integer\", nullable=False, check=\"qty >= 0\"),\n        ColumnDef(name=\"state\", pg_type=\"text\", nullable=False),\n    ],\n    actions=[\n        ActionDef(name=\"add_item\", function_type=\"insert\", transition=StateTransition(from_state=\"init\", to_state=\"in_stock\")),\n        ActionDef(name=\"reserve_item\", function_type=\"update\", transition=StateTransition(from_state=\"in_stock\", to_state=\"reserved\")),\n    ],\n)"
  }'

# Write a new handler
curl -X PUT $DATA_PLATFORM_URL/api/admin/files/handlers/reserve_stock.py \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "from lib.handler.errors import HandlerError\n\nMODE = \"sync\"\n\nasync def handle(ctx, payload: dict) -> dict:\n    product_id = payload[\"product_id\"]\n    item = await ctx.inventory.reserve_item(pk=product_id, data={})\n    return {\"reserved\": item[\"data\"]}\n"
  }'
```

### Step 2: Trigger reload

```bash
curl -X POST $DATA_PLATFORM_URL/api/admin/reload \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Response:

```json
{
  "success": true,
  "tables": {
    "added": ["inventory"],
    "updated": [],
    "unchanged": ["party", "party_type_list", "..."],
    "details": {}
  },
  "handlers": {
    "added": ["reserve_stock"],
    "skipped": ["create_party"]
  }
}
```

### Step 3: Use the new table immediately

```bash
# The inventory table is now live
curl -X POST $DATA_PLATFORM_URL/api/actions/inventory/add_item \
  -H "Content-Type: application/json" \
  -d '{"data": {"product": "Widget-A", "qty": 100}}'
```

### Updating an existing table (append-only)

You can add new states, transitions, and actions to an existing table by writing an updated `.py` file. The diff checker enforces append-only rules:

- New states can be added; existing states cannot be removed
- New transitions can be added; existing transitions cannot be removed
- New actions can be added; existing actions cannot be deleted or modified
- Columns, FK definitions, PK config must remain identical

Example: adding a `deactivate_item` action to the existing `inventory` table:

```bash
# 1. Read current file to get the existing config
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  $DATA_PLATFORM_URL/api/admin/files/tables/inventory.py

# 2. Modify locally: add new state, transition, and action
# 3. PUT the updated file
curl -X PUT $DATA_PLATFORM_URL/api/admin/files/tables/inventory.py \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "...updated config with new deactivate_item action..."}'

# 4. Reload
curl -X POST $DATA_PLATFORM_URL/api/admin/reload \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

If the update violates append-only rules (e.g., removes an existing action), the reload returns `409 Conflict` and the running service is unaffected.

---

## Backup and Migration

### Download workspace zip

Download all table configs and handler files in a single call:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  $DATA_PLATFORM_URL/api/admin/workspace/download \
  -o workspace.zip
```

The zip contains:

```
workspace.zip
  tables/
    party.py
    party_type_list.py
    inventory.py          (added by CrewAI at runtime)
    ...
  handlers/
    create_party.py
    reserve_stock.py      (added by CrewAI at runtime)
    ...
```

Unzip into a local workspace directory to migrate to another platform or restore from backup.

### Per-file inspection

List all files:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  $DATA_PLATFORM_URL/api/admin/files/tables

# {"success": true, "files": ["party.py", "party_type_list.py", "inventory.py", ...]}
```

Read a specific file:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  $DATA_PLATFORM_URL/api/admin/files/tables/inventory.py

# {"success": true, "filename": "inventory.py", "content": "from lib import ..."}
```

---

## Adding a New Workspace

A workspace is a self-contained application that uses the data platform library. Each workspace has its own `app.py`, `tables/`, `handlers/`, and connects to its own database.

### 1. Create the workspace directory

```
data_platform/
  workspace/
    crm_demo/         # existing
    trading_demo/      # new
      app.py
      tables/
        positions.py
        instruments.py
      handlers/
        open_position.py
```

### 2. Write app.py

Follow the same pattern as `crm_demo/app.py`:

```python
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from lib import Registry
from lib.db.backends.asyncpg import AsyncpgBackend
from lib.api.routes.actions import mount_action_routes
from lib.api.routes.admin import mount_admin_routes
from lib.api.routes.handlers import mount_handler_routes
from lib.api.routes.queries import mount_query_routes
from lib.api.routes.tasks import mount_task_routes
from lib.reload.scanner import scan_tables

from tables.instruments import config as instruments_config
from tables.positions import config as positions_config

DSN = os.environ["DATABASE_URL"]
_HERE = os.path.dirname(__file__)
TABLES_DIR = os.environ.get("TABLES_DIR", os.path.join(_HERE, "tables"))
HANDLERS_DIR = os.environ.get("HANDLERS_DIR", os.path.join(_HERE, "handlers"))


@asynccontextmanager
async def lifespan(application: FastAPI):
    backend = AsyncpgBackend(dsn=DSN)
    registry = Registry(db_backend=backend)

    # Register initial tables (FK order matters)
    await registry.register_table(instruments_config, create_if_not_exists=True)
    await registry.register_table(positions_config, create_if_not_exists=True)

    # Scan volume for runtime-added tables
    extra_configs, _ = scan_tables(TABLES_DIR)
    for cfg in extra_configs:
        if cfg.table_name not in registry.table_configs:
            await registry.register_table(cfg, create_if_not_exists=True)

    registry.scan_handlers(HANDLERS_DIR)

    mount_action_routes(application.router, registry)
    mount_query_routes(application.router, registry)
    mount_handler_routes(application.router, registry)
    mount_task_routes(application.router, registry)
    mount_admin_routes(application.router, registry, TABLES_DIR, HANDLERS_DIR)

    yield


app = FastAPI(title="Trading Demo API", lifespan=lifespan)
```

### 3. Deploy as a separate Railway service

Each workspace is a separate Railway service with its own volume and database:

1. In the same Railway project, add a **new service** from the same GitHub repo.
2. Set **Root Directory** to `data_platform/`.
3. Add a **new volume** at `/data` (separate from the crm_demo volume).
4. Set environment variables:

```
DATABASE_URL=postgresql://...trading_db_connection_string...
ADMIN_TOKEN=trading-secret-token
TABLES_DIR=/data/tables
HANDLERS_DIR=/data/handlers
WORKSPACE_SEED_DIR=/app/workspace/trading_demo
```

The only difference from `crm_demo` is `WORKSPACE_SEED_DIR` and `DATABASE_URL`. The Dockerfile's `WORKDIR` is hardcoded to `crm_demo`, so you need to update the Dockerfile to accept a build argument:

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY pyproject.toml .
COPY lib/ lib/
COPY workspace/ workspace/
RUN pip install --no-cache-dir .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
ARG WORKSPACE=crm_demo
WORKDIR /app/workspace/${WORKSPACE}
ENTRYPOINT ["/app/entrypoint.sh"]
```

Then set the Railway build argument `WORKSPACE=trading_demo` for the trading service.

**Summary of multi-workspace setup:**

| Setting | crm_demo service | trading_demo service |
|---------|-----------------|---------------------|
| `DATABASE_URL` | Supabase CRM DB | Supabase Trading DB |
| `ADMIN_TOKEN` | `crm-secret` | `trading-secret` |
| `TABLES_DIR` | `/data/tables` | `/data/tables` |
| `HANDLERS_DIR` | `/data/handlers` | `/data/handlers` |
| `WORKSPACE_SEED_DIR` | `/app/workspace/crm_demo` | `/app/workspace/trading_demo` |
| Volume | `/data` (volume A) | `/data` (volume B) |
| Build arg `WORKSPACE` | `crm_demo` | `trading_demo` |

Each service is completely independent: separate database, separate volume, separate hot reload lifecycle.

---

## Local Development

Local development requires no Docker, no volume, no Railway. The default paths resolve to sibling directories of `app.py`.

```bash
cd data_platform
source .venv/bin/activate
cd workspace/crm_demo
source .env          # sets DATABASE_URL
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

The `.env` file in `workspace/crm_demo/` contains:

```bash
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
```

This file is listed in `.gitignore` and is never pushed to GitHub.

`TABLES_DIR` and `HANDLERS_DIR` are not set, so they default to `./tables` and `./handlers` -- the same directories that existed before the deployment changes. The startup volume scan finds no additional tables (they're already registered via hard-coded imports) and has no effect.

---

## Dockerfile and Entrypoint Reference

### Dockerfile

```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY pyproject.toml .
COPY lib/ lib/
COPY workspace/ workspace/
RUN pip install --no-cache-dir .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
WORKDIR /app/workspace/crm_demo
ENTRYPOINT ["/app/entrypoint.sh"]
```

- `pip install .` installs the `data-platform` package, making `lib/` importable.
- `WORKDIR` is set to the workspace directory so `tables/` and `handlers/` resolve as siblings of `app.py`.
- The entrypoint handles volume seeding and uvicorn startup.

### entrypoint.sh

```bash
#!/bin/sh
TABLES_DIR="${TABLES_DIR:-./tables}"
HANDLERS_DIR="${HANDLERS_DIR:-./handlers}"

if [ -n "$WORKSPACE_SEED_DIR" ] && [ ! -f "$TABLES_DIR/.seeded" ]; then
  mkdir -p "$TABLES_DIR" "$HANDLERS_DIR"
  cp -r "$WORKSPACE_SEED_DIR/tables/"* "$TABLES_DIR/" 2>/dev/null || true
  cp -r "$WORKSPACE_SEED_DIR/handlers/"* "$HANDLERS_DIR/" 2>/dev/null || true
  touch "$TABLES_DIR/.seeded"
fi

exec uvicorn app:app --host 0.0.0.0 --port "${PORT:-8000}"
```

- On Railway, `PORT` is set automatically by the platform.
- Locally (Docker), defaults to `8000`.
- `exec` replaces the shell with uvicorn so signals (SIGTERM) reach the process directly.
