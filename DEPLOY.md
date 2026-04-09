# AI Platform -- Railway Deployment Guide

## Architecture

```
Railway Project
  ├── Data Platform Service (existing)
  │     Volume: /data (tables/*.py, handlers/*.py)
  │     Env: DATABASE_URL, ADMIN_TOKEN, API_TOKEN
  │
  ├── AI Platform Service (this project)
  │     Volume: /data/crewai (LanceDB memory, ChromaDB knowledge)
  │     Env: see below
  │     Talks to Data Platform via private network
  │
  └── Frontend (Vercel or Railway static)
        Env: VITE_AI_API_URL, VITE_DP_API_URL
```

## Step 1: Push to GitHub

Push the `ai_platform/` directory to your GitHub repo.

## Step 2: Create Railway Service

1. In the same Railway project as the Data Platform, add a new service from GitHub.
2. Set **Root Directory** to `ai_platform/`.
3. Railway auto-detects the `Dockerfile`.

## Step 3: Attach Volume

1. Go to service **Settings** -> **Volumes**.
2. Add volume with mount path `/data/crewai` (1 GB).

## Step 4: Set Environment Variables

```
# Storage
CREWAI_STORAGE_DIR=/data/crewai

# Data Platform (private network)
DATA_PLATFORM_URL=http://data-platform.railway.internal:8000
DATA_PLATFORM_ADMIN_TOKEN=<same as Data Platform's ADMIN_TOKEN>
DATA_PLATFORM_API_TOKEN=<same as Data Platform's API_TOKEN>

# LLM via Requesty (agent reasoning)
OPENAI_API_KEY=<your Requesty API key>
OPENAI_API_BASE=https://router.requesty.ai/v1
OPENAI_MODEL=gpt-4o-mini

# Embedder (Memory + Knowledge vectors) -- direct to OpenAI
EMBEDDER_PROVIDER=openai
EMBEDDER_MODEL=text-embedding-3-small
EMBEDDER_API_KEY=<your actual OpenAI API key for embeddings>
```

**Finding the private URL**: Go to the Data Platform service -> Settings -> Networking -> Private Networking. The hostname is shown (e.g., `data-platform.railway.internal`). The port is the `PORT` variable value.

## Step 5: Generate Public Domain

1. Service Settings -> Networking -> Public Networking -> Generate Domain.
2. You get a URL like `https://ai-platform-production.up.railway.app`.

## Step 6: Deploy

Push to the connected branch. Railway builds and deploys.

Verify:

```bash
curl https://ai-platform-production.up.railway.app/api/health
```

## Step 7: Deploy Frontend

**Option A: Vercel**
1. Push `ai_platform/frontend/` to a repo.
2. Import in Vercel, set root directory to `ai_platform/frontend/`.
3. Set env vars:
   - `VITE_AI_API_URL=https://ai-platform-production.up.railway.app`
   - `VITE_DP_API_URL=https://data-platform-production.up.railway.app`
   - `VITE_DP_API_TOKEN=<your API token>`

**Option B: Railway Static**
1. Add another service in Railway from the same repo.
2. Set root to `ai_platform/frontend/`, build command `npm run build`, start command `npx serve dist`.

## Networking Summary

| From | To | URL |
|------|-----|-----|
| Frontend | AI Platform | `https://ai-platform-production.up.railway.app` (public HTTPS) |
| Frontend | Data Platform | `https://data-platform-production.up.railway.app` (public HTTPS) |
| AI Platform | Data Platform | `http://data-platform.railway.internal:PORT` (private HTTP) |
| Your laptop | AI Platform | `https://ai-platform-production.up.railway.app` (public HTTPS) |
| Your laptop | Data Platform | `https://data-platform-production.up.railway.app` (public HTTPS) |

## Local Development

```bash
cd ai_platform

# Create venv and install
python -m venv .venv
source .venv/bin/activate
pip install -e source/crewai/
pip install -e source/crewai-tools/ || true
pip install -e .

# Set env vars
cp .env.example .env
# Edit .env with your values

# Run backend
uvicorn app:app --host 0.0.0.0 --port 8000 --reload

# Run frontend (separate terminal)
cd frontend
npm install
npm run dev
```
