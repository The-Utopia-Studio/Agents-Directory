# Deployment

Two pieces deploy separately:

| Piece | What it is | Where it goes | Secrets? |
|---|---|---|---|
| **Front-end** | static `index.html` + `app.js` + `styles.css` | Vercel (already connected) | **none** |
| **Loop service** | the `server/` Node service | Railway / Render / Fly / Cloud Run | yes — server-side only |

The front-end works standalone. The loop service is **optional** — it adds live
observability, memory, and the automation heartbeat. The front-end auto-detects
it and degrades gracefully when it's absent.

### Vercel: read-only Convex directory pilot

Set the non-secret `CONVEX_URL` environment variable on the Vercel project.
`vercel.json` runs `npm run build:frontend`, which generates
`deployment-config.js` from that value and bundles the browser query client.
That generated file is gitignored; never commit it. No URL is committed. The
client invokes only
`agents:listGovernedDirectoryPilot`; it never invokes a mutation or an import
endpoint. If the variable is blank or the query fails, A1–A8 continue rendering
from the existing browser data and no agent is labelled “Governed in Convex.”

For local testing, set `CONVEX_URL` before `npm run build:frontend`, or use the
non-secret per-browser override:

```js
localStorage.setItem("directory_convex_url", "https://your-dev-deployment.convex.cloud")
```

The override is a deployment URL only. Never put a Clerk token, JWT, admin key,
or other credential in browser storage.

> **Golden rule:** secrets live only on the service host (or a shared secret
> manager). Never in git, never in the browser. `.env` is gitignored; only
> `server/.env.example` (the template) is committed.

---

## 1. Deploy the loop service (`server/`)

Zero runtime dependencies + a `Dockerfile`, so it runs on any container host.

### Railway (recommended)
1. New Project → Deploy from GitHub repo → this repo.
2. Set the service **Root Directory** to `server`.
3. Railway reads `server/railway.json` (Dockerfile build, health check at `/api/health`).
4. **Attach a volume** (required for durable evidence — see below).
5. Add environment variables (below). Deploy. Copy the public URL.

#### Railway volume — durable `DATA_DIR` (required on Railway)

Container disk is ephemeral. Without a volume, every deploy wipes traces,
feedback, scores, and loop history, and the improvement loop can never
accumulate evidence. On Railway the process **refuses to start** unless
`DATA_DIR` points at an existing writable mount — it will not fall back to
image-local storage. On Railway, `DATA_DIR` must be exactly `/data` (not
`/tmp` or another writable path); the app cannot prove a mount is a volume,
but it can refuse configuration that redirects persistence elsewhere.

In the Railway dashboard, on the **loop service** (Root Directory = `server`):

1. **Settings → Volumes → Add Volume**
2. **Mount path:** `/data` (must match `DATA_DIR`)
3. **Variables → New Variable**
   - Name: `DATA_DIR`
   - Value: `/data`
4. Redeploy.

| Setting | Value |
|---|---|
| Service | the loop/`server` service (not the static front-end) |
| Volume mount path | `/data` |
| Env var | `DATA_DIR=/data` |

**First boot with an empty volume:** the mount path exists and is empty.
`seedIfEmpty` writes the catalogue agents (including A7 and A8). Seed is
idempotent: a later deploy against a volume that already has `agents.json`
does **not** re-seed. New server-owned agents still need the explicit upsert
in `seed.js` (`upsertServerOwnedAgents`) — a seed entry alone will not reach
a non-empty volume (that is how A8 stayed missing until the upsert).

**Missing volume or unset `DATA_DIR`:** boot exits non-zero with an explicit
error. Do not “fix” that by letting the app `mkdir` `/data` on ephemeral
disk — that recreates the silent-wipe bug.

### Render (alternative)
- The repo includes `render.yaml` (a blueprint). New → Blueprint → pick the repo.
  Non-secret config is declared there; set the secret values in the dashboard.

### Fly / Cloud Run / anything
- `cd server && docker build -t agents-loop . && docker run -p 8790:8790 --env-file .env agents-loop`
- The app reads `PORT` from the environment, so injected ports "just work".

---

## 2. Environment variables

Set these on the **service host** (Railway/Render/…). Mirror the *non-secret*
config ones into Vercel too if you want `vercel env pull` to give local devs the
same setup.

### Works today with none of these (local providers, no accounts)

### To turn providers on

| Variable | Example | Secret? | Notes |
|---|---|---|---|
| `DATA_DIR` | `/data` | no | **Required on Railway.** Must be exactly `/data`. Boot fails if unset, anything else (e.g. `/tmp`), missing, or unwritable. |
| `MEMORY_PROVIDER` | `supermemory` | no | `local` (default) · `supermemory` · `activeloop` |
| `SUPERMEMORY_API_KEY` | `sk-…` | **yes** | from the Supermemory console |
| `ACTIVELOOP_TOKEN` | `…` | **yes** | Utopia Deep Lake org (if using activeloop) |
| `ACTIVELOOP_ORG` | `utopia` | no | org id for `hub://<org>/<dataset>` |
| `EMBED_ENDPOINT` | `https://…` | **yes** | embeddings for activeloop search |
| `OBS_PROVIDER` | `langfuse` | no | `local` (default) · `langfuse` |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | `pk-… / sk-…` | **yes** | from Langfuse |
| `OPTIMIZER` | `gepa` | no | `heuristic` (default) · `gepa` |
| `GEPA_ENDPOINT` **or** `GEPA_CMD` | `https://…` | **yes** | the GEPA job |
| `VERIFIER` | `llm` | no | `heuristic` (default) · `llm` |
| `VERIFIER_ENDPOINT` | `https://…` | **yes** | judge service |
| `LOOP_ENABLED` | `true` | no | turn the scheduler on |
| `LOOP_INTERVAL_MS` | `3600000` | no | e.g. hourly |
| `LOOP_AUTOAPPLY` | `false` | no | must be `false` or unset; `true` aborts boot |
| `LOOP_BUDGET_USD` / `LOOP_MAX_JOBS` | `1` / `3` | no | per-cycle cost cap |
| `CORS_ORIGIN` | `https://…vercel.app` | no | lock to the front-end origin |

Full annotated list: [`server/.env.example`](../server/.env.example).

### In the Vercel "Add Environment Variable" dialog
- **Config selectors** (`*_PROVIDER`, `LOOP_*`, `CORS_ORIGIN`): **Sensitive = OFF**.
- **Keys** (`*_API_KEY`, `*_SECRET_KEY`, tokens, endpoints with auth): **Sensitive = ON**.
- **Environments:** All (Production / Preview / Development).
- With `MEMORY_PROVIDER=supermemory` but no key, the service safely falls back to
  local memory and logs a warning — set both together.

### Team secret sharing
Pick one source of truth so nobody emails a `.env`: **Vercel env vars**
(`vercel env pull` for local), or a manager like **Doppler / Infisical /
1Password**.

---

## 3. Point the front-end at the service

The static app reads a non-secret base URL. `index.html` holds the deployed
host, which is what ships to Vercel:

```html
<!-- in index.html, before api.js -->
<script>window.DIRECTORY_API_BASE = "https://<your-loop-service-host>";</script>
```

To develop against a local loop, override it per browser instead of editing
that line: `localStorage.setItem("directory_api_base", "http://127.0.0.1:8790")`.
The override wins over the shipped default, so a local value cannot be
committed and pointed at every visitor's own machine. With neither set, the
base falls back to `http://localhost:8790`.

### Bulk migration export

`GET /api/migration/export` returns the whole metadata catalogue in one
response. On Railway it answers `401` until `API_TOKEN` is set, and then
requires `Authorization: Bearer <API_TOKEN>`. Keep that token out of the repo
and out of the browser: run the export from a trusted client (for example
`curl -H "Authorization: Bearer $API_TOKEN"`), not from the deployed page.

---

## 4. Turn it on, one provider at a time
1. Deploy `server/`, confirm `GET /api/health` returns `ok`.
2. Set `MEMORY_PROVIDER=supermemory` + `SUPERMEMORY_API_KEY`; confirm memory
   recall works in an agent's Context block.
3. Add Langfuse, then a structured maker, when ready. Keep
   `LOOP_AUTOAPPLY=false`; auto-approval is disabled and `true` aborts boot.

## Follow-ups (not blocking)
- **Persistence:** front-end (`localStorage`) and server stores are separate.
  Moving to Supabase/Postgres gives true shared multi-user state.
- **Run-until-done** needs a real evaluator wired at the `reevaluate` hook.
