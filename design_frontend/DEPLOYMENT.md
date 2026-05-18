# Railway deployment guide

This document explains how to deploy the **Schema Design Cockpit** on
Railway with the minimum operator changes: add exactly **one** new Railway
service for the frontend, and (optionally) one persistent volume on the
existing backend service.

## 1. Existing backend service (no new service needed)

The `ai_platform` FastAPI service already exists on Railway. The new
`/api/design` router and supporting modules ship inside that same
codebase, so to pick them up:

1. Push the changes to the branch your existing backend service tracks.
2. Trigger a redeploy of the existing backend service (Railway will do
   this automatically on push if "Deploy on push" is enabled).

No service settings, no env vars, no extra build commands are required
for the backend to pick up the new design endpoints.

### Optional: persist designs across restarts

By default designs are saved to `/data/designs/*.json` inside the
container. Without a volume mount, those files disappear when the
container restarts or redeploys (acceptable for a V1 demo).

To persist designs:

1. In the backend service settings, attach a **Persistent Volume**
   mounted at `/data/designs` (Railway: Service → Settings → Volumes
   → New Volume).
2. Add the env var `DESIGN_STORAGE_DIR=/data/designs` (the Dockerfile
   already exports this by default, but setting it explicitly is
   harmless and clearer).

Designs (and their revision history) survive redeploys after this.

## 2. New frontend service (the only new service)

Create one new Railway service pointing at the **same** GitHub repo as
the backend:

1. Railway → New Service → Deploy from GitHub repo → pick the repo that
   contains `ai_platform/`.
2. In the new service's **Settings**:
   - Set **Root Directory** to `ai_platform/design_frontend`. This
     scopes the Dockerfile build to only this subfolder.
   - Builder: Railway will auto-detect `Dockerfile` (the
     `railway.toml` in this folder also declares `builder = "DOCKERFILE"`).
3. Under **Variables**, set:
   - `NEXT_PUBLIC_AI_API_URL` = the public URL of the existing
     `ai_platform` backend service (for example
     `https://ai-platform-production.up.railway.app`). No trailing
     slash; the Next app appends `/api/design/...` itself.
4. Click Deploy.

The service exposes port `3000` and answers `GET /api/health` for
Railway's healthcheck.

## 3. Verify

After both services redeploy:

- `GET <backend-url>/api/design/` should return `{"designs": []}` (or a
  list of any previously saved designs).
- Open the frontend service URL: you should see the cockpit landing
  page with a drag-and-drop upload zone.
- Drop a `.xlsx` schema dictionary; the UI navigates to
  `/design/<id>`, opens the SSE stream, and starts rendering the 3D ERD
  as the agents finish each phase.

## 4. Net Railway change

| | Before | After |
|---|---|---|
| Repos | 1 | 1 (unchanged) |
| Backend services | 1 | 1 (redeployed, no new service) |
| Existing FE services | 1 | 1 (unchanged) |
| Design FE service | 0 | **+1** |
| Persistent volumes | unchanged | optionally +1 on backend |
