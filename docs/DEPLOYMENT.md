# Deployment

Two pieces deploy separately:

| Piece | What it is | Where it goes | Secrets? |
|---|---|---|---|
| **Front-end** | static `index.html` + `app.js` + `styles.css` | Vercel (already connected) | **none** |
| **Loop service** | the `server/` Node service | Railway / Render / Fly / Cloud Run | yes — server-side only |

The front-end works standalone. The loop service is **optional** — it adds live
observability, memory, and the automation heartbeat. The front-end auto-detects
it and degrades gracefully when it's absent.

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
4. Add environment variables (below). Deploy. Copy the public URL.

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
| `LOOP_AUTOAPPLY` | `false` | no | keep `false` — human approves |
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

The static app reads a non-secret base URL. Set it however you prefer:

```html
<!-- in index.html, before api.js -->
<script>window.DIRECTORY_API_BASE = "https://<your-loop-service-host>";</script>
```

or from the console once: `localStorage.setItem("directory_api_base", "https://…")`.
Default is `http://localhost:8790` for local dev.

---

## 4. Turn it on, one provider at a time
1. Deploy `server/`, confirm `GET /api/health` returns `ok`.
2. Set `MEMORY_PROVIDER=supermemory` + `SUPERMEMORY_API_KEY`; confirm memory
   recall works in an agent's Context block.
3. Add Langfuse, then GEPA, when ready. Keep `LOOP_AUTOAPPLY=false` until trusted.

## Follow-ups (not blocking)
- **Persistence:** front-end (`localStorage`) and server stores are separate.
  Moving to Supabase/Postgres gives true shared multi-user state.
- **Run-until-done** needs a real evaluator wired at the `reevaluate` hook.
