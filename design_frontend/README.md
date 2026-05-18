# Schema Design Cockpit (Frontend)

A standalone Next.js 15 frontend for the **Schema Design Cockpit**. Talks
exclusively to the existing `ai_platform` FastAPI backend via the
`/api/design` router.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS (no shadcn CLI dependency — small custom primitives in
  `components/ui/`)
- React Three Fiber + drei + postprocessing for the 3D ERD
- reactflow for the per-table state transition bubble graph
- Zustand for client state
- Framer Motion for stream + UI animations
- @tanstack/react-query for server cache

## Local dev

```bash
cd ai_platform/design_frontend
cp .env.example .env.local
# point NEXT_PUBLIC_AI_API_URL at your local ai_platform backend
npm install
npm run dev
```

Open <http://localhost:3000>.

## Railway deployment

1. Create a **new Railway service** pointing at the same GitHub repo.
2. In the service settings set **Root Directory** to
   `ai_platform/design_frontend` so Railway only builds this folder.
3. Builder is "Dockerfile" (the included `railway.toml` declares it).
4. Set the env var `NEXT_PUBLIC_AI_API_URL` to the public URL of the
   existing `ai_platform` backend service.
5. Deploy.

The existing `ai_platform` backend service does **not** need a new
service — just redeploy from the same branch to pick up the new
`/api/design` router and supporting modules. Optionally attach a
volume mount at `/data/designs` to persist designs across restarts.
