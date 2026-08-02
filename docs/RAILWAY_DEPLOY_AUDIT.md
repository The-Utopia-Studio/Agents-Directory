# Railway Deploy Audit — Loop Service (`server/`)

Read-only audit of everything in this repo related to deploying the loop service to Railway.  
**No code was changed for this document.** Sources: `server/railway.json`, `server/Dockerfile`, `render.yaml`, `server/package.json`, `server/.env.example`, `server/src/config.js`, `server/src/http/*`, `server/src/core/store.js`, `api.js`, `app.js`, `docs/DEPLOYMENT.md`, `server/README.md`.

Date of audit: 2026-07-27.

---

## 1. Deploy config files

### 1.1 Full contents — `server/railway.json`

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node src/http/server.js",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

**What it tells Railway to do**

| Setting | Value | Meaning |
|---------|--------|---------|
| Builder | `DOCKERFILE` | Build via Docker, not Nixpacks / Railpack |
| Dockerfile path | `Dockerfile` | Relative to the service root (expects cwd = `server/`) |
| Start command | `node src/http/server.js` | Overrides / duplicates image `CMD` |
| Health check path | `/api/health` | Railway HTTP probe after deploy |
| Health check timeout | `30` seconds | Fail deploy if unhealthy within this window |
| Restart policy | `ON_FAILURE`, max 3 retries | Restart crashed processes up to 3 times |

**Not set in this file (manual Railway UI):**

- **Root Directory** — must be `server` (documented in `docs/DEPLOYMENT.md`; not encoded in `railway.json`)
- **Public networking / generate domain** — must be enabled in the UI to get an HTTPS URL
- **Environment variables** — none declared in `railway.json`; set in the Railway Variables UI
- **Volume / persistent disk** — not configured (see §8)

### 1.2 Full contents — `server/Dockerfile`

```dockerfile
# Loop service — zero runtime dependencies, so the image is tiny and portable.
# Works on Railway, Render, Fly, Cloud Run, or any container host.
FROM node:20-alpine

WORKDIR /app

# No dependencies to install (built-in http + fetch only). Copy source and go.
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
# Hosts inject PORT; the app reads it (defaults to 8790 locally).
EXPOSE 8790

# Basic healthcheck against the built-in endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:${PORT:-8790}/api/health || exit 1

CMD ["node", "src/http/server.js"]
```

**What it tells the host to do**

| Concern | Behavior |
|---------|----------|
| Base image | Node **20** Alpine |
| Build | Copy `package.json` + `src/` only — **no `npm install`** (zero deps) |
| Start | `node src/http/server.js` |
| Port | `EXPOSE 8790` is documentation; runtime port comes from env `PORT` |
| Docker HEALTHCHECK | Hits `/api/health` on `localhost:$PORT` every 30s |

### 1.3 Full contents — `render.yaml` (repo root)

```yaml
# Render blueprint for the loop service (server/). Alternative to Railway.
# Secrets are NOT set here — add them in the Render dashboard (sync: false).
services:
  - type: web
    name: agents-directory-loop
    runtime: docker
    rootDir: server
    dockerfilePath: ./Dockerfile
    healthCheckPath: /api/health
    plan: starter
    envVars:
      # ── non-secret config (safe to declare here) ──
      - key: CORS_ORIGIN
        value: "*"                 # tighten to the front-end origin in production
      - key: MEMORY_PROVIDER
        value: local
      - key: OBS_PROVIDER
        value: local
      - key: OPTIMIZER
        value: heuristic
      - key: VERIFIER
        value: heuristic
      - key: LOOP_ENABLED
        value: "false"
      - key: LOOP_AUTOAPPLY
        value: "false"
      # ── secrets — set the values in the dashboard, never in git ──
      - key: SUPERMEMORY_API_KEY
        sync: false
      - key: LANGFUSE_PUBLIC_KEY
        sync: false
      - key: LANGFUSE_SECRET_KEY
        sync: false
```

**What it tells Render to do:** Docker web service, root `server`, health `/api/health`, starter plan, non-secret defaults + secret placeholders.

**Railway ignores this file.** It is an alternate host blueprint only.

### 1.4 Conflicts / manual assumptions

| Issue | Detail |
|-------|--------|
| **Root Directory not in `railway.json`** | If you deploy the whole repo without setting Root Directory = `server`, Railway won’t find `Dockerfile` / `railway.json` in the expected place. **You must set this in the UI.** |
| **`startCommand` vs Dockerfile `CMD`** | Both say `node src/http/server.js`. Redundant, not conflicting — Railway’s `startCommand` typically wins over image CMD. |
| **`EXPOSE 8790` vs Railway `PORT`** | Not a conflict: app reads `PORT` from env (see §2). `EXPOSE` does not bind the process. |
| **Render declares env defaults; Railway does not** | On Railway you must set `CORS_ORIGIN` (etc.) yourself if you want non-defaults. Unset → code defaults still work (see §3). |
| **Docker `HEALTHCHECK` uses `wget`** | `node:20-alpine` often **does not ship `wget`**. Railway’s own `healthcheckPath` is what matters for deploys; the Dockerfile HEALTHCHECK may fail if a host relies on it. |
| **No volume in any config** | File store under `DATA_DIR` is ephemeral on Railway unless you add a volume (see §8). |

---

## 2. Server entry point and startup

| Question | Answer |
|----------|--------|
| Entry file | `server/src/http/server.js` |
| `npm start` | `"node src/http/server.js"` (`server/package.json`) |
| Same as Docker / Railway start | Yes |

**Boot sequence (`start()`):**

1. `buildApp()` → create file store, **idempotent seed**, wire obs/optimizer/memory/verifier, seed context into memory once, register routes  
2. `createServer(handler).listen(config.port)`  
3. Log health line  
4. Optionally start in-process loop scheduler if `LOOP_ENABLED=true` and `LOOP_INTERVAL_MS > 0`

**Port**

```js
// server/src/config.js
port: Number(env.PORT || 8790),
```

- Reads **`PORT` from the environment** ✓  
- Default `8790` only when unset (local)  
- Railway injects `PORT` dynamically — **not hardcoded at listen time**

**Successful startup log**

```
[loop] listening on :<port>  obs=<provider>(ok|down) optimizer=<provider> memory=<provider>
```

Example with defaults:

```
[loop] listening on :8080  obs=local(ok) optimizer=heuristic memory=local
```

If the heartbeat is enabled, an extra line:

```
[loop] heartbeat every <ms>ms (autoApply=false)
```

---

## 3. Environment variables

### 3.1 Full contents of `server/.env.example`

(See repo file — reproduced in audit scope above in the read; key list with defaults below.)

### 3.2 Variable reference

| Variable | Controls | Default if unset | Required? | Secret? | Zero-secrets deploy? |
|----------|----------|------------------|-----------|---------|----------------------|
| `PORT` | Listen port | `8790` | Optional (Railway sets it) | No | ✓ leave to Railway |
| `DATA_DIR` | File store path | `server/data/` (resolved from `config.js`) | Optional | No | ✓ |
| `CORS_ORIGIN` | `Access-Control-Allow-Origin` value | `*` | Optional | No | ✓ (`*` works for Vercel without credentials) |
| `OBS_PROVIDER` | Trace backend | `local` | Optional | No | ✓ |
| `LANGFUSE_HOST` | Langfuse API host | `https://cloud.langfuse.com` | Optional | No | N/A until Langfuse |
| `LANGFUSE_PUBLIC_KEY` | Langfuse auth | `""` | Required only if `OBS_PROVIDER=langfuse` | **Yes** | skip |
| `LANGFUSE_SECRET_KEY` | Langfuse auth | `""` | Required only if langfuse | **Yes** | skip |
| `OPTIMIZER` | Maker | `heuristic` | Optional | No | ✓ |
| `GEPA_ENDPOINT` | GEPA HTTP job | `""` | Required for live GEPA | **Yes** (endpoint) | skip |
| `GEPA_CMD` | GEPA local CLI | `""` | Alt to endpoint | Borderline | skip |
| `GEPA_MODEL` | Model name for GEPA | `claude-opus-4-8` | Optional | No | skip |
| `GEPA_BUDGET` | GEPA budget knobs | `10` | Optional | No | skip |
| `VERIFIER` | Checker | `heuristic` | Optional | No | ✓ |
| `VERIFIER_ENDPOINT` | LLM judge URL | `""` | Required if `VERIFIER=llm` | **Yes** | skip |
| `VERIFIER_MODEL` | Judge model label | `claude-opus-4-8` | Optional | No | skip |
| `LOOP_ENABLED` | In-process scheduler | `false` (must be string `"true"`) | Optional | No | ✓ leave false |
| `LOOP_INTERVAL_MS` | Scheduler period | `0` (manual only) | Optional | No | ✓ |
| `LOOP_LOW_SCORE` | Triage threshold | `70` | Optional | No | ✓ |
| `LOOP_MAX_JOBS` | Jobs per cycle | `3` | Optional | No | ✓ |
| `LOOP_BUDGET_USD` | $ cap per cycle | `1` | Optional | No | ✓ |
| `LOOP_COST_PER_JOB` | Assumed $ per job | `0.05` | Optional | No | ✓ |
| `LOOP_AUTOAPPLY` | Retired auto-approval switch | `false` | Optional | No | Must be false/unset; true aborts boot |
| `MEMORY_PROVIDER` | Memory backend | `local` | Optional | No | ✓ |
| `MEMORY_TOP_K` | Recall result count | `5` | Optional | No | ✓ |
| `SUPERMEMORY_API_KEY` | Supermemory auth | `""` | If provider=supermemory | **Yes** | skip |
| `SUPERMEMORY_BASE_URL` | Supermemory API | `https://api.supermemory.ai` | Optional | No | skip |
| `ACTIVELOOP_TOKEN` | Activeloop auth | `""` | If activeloop | **Yes** | skip |
| `ACTIVELOOP_ORG` | Activeloop org | `""` | If activeloop | No | skip |
| `ACTIVELOOP_DATASET` | Dataset name | `agent_memory` | Optional | No | skip |
| `ACTIVELOOP_BASE_URL` | Query API | Activeloop default URL | Optional | No | skip |
| `EMBED_ENDPOINT` | Embeddings for Activeloop search | `""` | If activeloop search | **Yes** | skip |
| `ACTIVELOOP_INGEST_ENDPOINT` | Writer sidecar | `""` | If activeloop ingest | **Yes** | skip |

**Also in code, not in `.env.example`:** `OBS_LOW_SCORE` (default `70`) — optional plain config.

### 3.3 Zero-secrets first deploy

Deploy with **no Variables set at all** (or only `CORS_ORIGIN` tightened). Working defaults:

- `OBS_PROVIDER=local`, `OPTIMIZER=heuristic`, `VERIFIER=heuristic`, `MEMORY_PROVIDER=local`
- `LOOP_ENABLED` off, `LOOP_AUTOAPPLY` off  
- `CORS_ORIGIN=*`  

No API keys required. Heuristic propose/verify and file-backed traces/memory all work offline.

### 3.4 Secrets vs plain config

| Secrets (never in git / browser) | Plain config |
|----------------------------------|--------------|
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | `PORT`, `DATA_DIR`, `CORS_ORIGIN` |
| `SUPERMEMORY_API_KEY` | `*_PROVIDER`, `LOOP_*`, `MEMORY_TOP_K` |
| `ACTIVELOOP_TOKEN`, `EMBED_ENDPOINT`, `ACTIVELOOP_INGEST_ENDPOINT` | `LANGFUSE_HOST`, `GEPA_MODEL`, `VERIFIER_MODEL`, org/dataset/base URLs |
| `GEPA_ENDPOINT` / `GEPA_CMD`, `VERIFIER_ENDPOINT` | |

---

## 4. Health check and routes

### Health

- **Path:** `GET /api/health`  
- **Used by:** Railway `healthcheckPath`, Dockerfile `HEALTHCHECK`, front-end `DirectoryAPI.probe()`  
- **Returns** (from `svc.health()`), conceptually:

```json
{
  "ok": true,
  "observability": { "provider": "local", "ok": true, "detail": "…" },
  "optimizer": { "provider": "heuristic", "ok": true, "detail": "…" },
  "memory": { "provider": "local", "ok": true, "detail": "…" },
  "verifier": { "provider": "heuristic", "ok": true, "detail": "…" }
}
```

Front-end treats the service as up when `info.ok` is truthy (`api.enabled = !!api.info.ok`).

### All HTTP routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Provider health (probe) |
| `GET` | `/api/fleet/health` | Aggregated fleet eval metrics |
| `POST` | `/api/loop/run` | One automation cycle across the fleet |
| `POST` | `/api/loop/research` | Research/discover queue items |
| `GET` | `/api/loop/queue` | Research queue (`?status=`) |
| `GET` | `/api/loop/runs` | Recent loop runs (`?limit=`) |
| `GET` | `/api/loop/inbox` | Proposals awaiting human triage |
| `GET` | `/api/loop/learnings` | Recent learnings (`?limit=`) |
| `POST` | `/api/agents/:id/goal` | Run-until-done on one agent |
| `GET` | `/api/agents` | List agents (server store) |
| `GET` | `/api/agents/:id` | Get one agent |
| `PUT` | `/api/agents/:id` | Upsert agent |
| `POST` | `/api/agents/:id/traces` | Record a trace |
| `GET` | `/api/agents/:id/traces` | List traces |
| `POST` | `/api/agents/:id/evals` | Append eval |
| `POST` | `/api/agents/:id/context` | Ingest memory item |
| `GET` | `/api/agents/:id/context/search` | Recall (`?q=`) |
| `POST` | `/api/agents/:id/improvements` | Run optimizer → proposal |
| `POST` | `/api/agents/:id/improvements/:pid/approve` | Approve (`pid=current` ok) |
| `POST` | `/api/agents/:id/improvements/:pid/reject` | Reject |
| `OPTIONS` | *(any)* | CORS preflight → `204` |

No auth middleware on any route.

---

## 5. CORS

**Config:** `createRouter({ corsOrigin: config.corsOrigin, apiToken: config.apiToken })` with  
`corsOrigin: env.CORS_ORIGIN || "*"`.

**Headers on every response (and OPTIONS):**

```
access-control-allow-origin: <CORS_ORIGIN value>
access-control-allow-methods: GET,POST,PUT,DELETE,OPTIONS
access-control-allow-headers: content-type, authorization
```

**If unset:** defaults to **`*`** — allows **all origins** (not “block all”).  
`api.js` does not send cookies/`credentials: 'include'`, so `*` is compatible with browser `fetch` from Vercel.

**For production Vercel → Railway:**

1. Prefer tightening: set Railway `CORS_ORIGIN` to your exact front-end origin, e.g. `https://your-app.vercel.app` (no trailing slash; must match the browser `Origin` header exactly).  
2. Or leave `*` for the first zero-secrets deploy.  
3. Multi-origin (prod + preview) is **not** supported by the current router — one static string only. Previews either need `*` or a code change later.

### Optional bearer auth (`API_TOKEN`)

The public Railway domain is open by default. To lock it down without breaking zero-secrets deploys:

1. Set Railway (or `.env`) **`API_TOKEN`** to a long random string.  
2. When set, every route **except** `GET /api/health` and `OPTIONS` requires  
   `Authorization: Bearer <API_TOKEN>` — missing/wrong → `401 {"error":"Unauthorized"}`.  
3. When **unset/empty**, the check is skipped entirely (identical to pre-auth behavior).  
4. Front-end: set the same value via `window.DIRECTORY_API_TOKEN` (e.g. next to `DIRECTORY_API_BASE` in `index.html`) or  
   `localStorage.setItem("directory_api_token", "…")`. `api.js` attaches the header when present.  
5. Health probes (Railway `healthcheckPath`, Docker HEALTHCHECK) stay unauthenticated so deploys keep working.  
6. CORS already allows the `authorization` request header for browser preflight.

---

## 6. Front-end connection

### Base URL resolution (`api.js`)

Priority order:

1. `localStorage.getItem("directory_api_base")` — per-browser override for local development
2. `window.DIRECTORY_API_BASE` (set via inline script before `api.js`) — the deployed default
3. Fallback: `"http://localhost:8790"`

The override outranks the page default deliberately: editing `index.html` to
point at a local loop is how a `http://127.0.0.1:8790` base URL shipped to
Vercel and sent every visitor's browser to their own machine.

**There is no Vercel/build-time env injection today.** `index.html` only loads:

```html
<script src="api.js"></script>
<script src="app.js"></script>
```

`index.html` ships the Railway host in `window.DIRECTORY_API_BASE`. To point a
single browser somewhere else (a local loop, a preview service), set the
override once in the console and reload — never by editing the tracked default:

```js
localStorage.setItem("directory_api_base", "http://127.0.0.1:8790");
```

### Detecting up / down

On load, `DirectoryAPI.ready = api.probe()` → `GET {base}/api/health`.

| Outcome | Behavior |
|---------|----------|
| Health returns `ok: true` | `DirectoryAPI.enabled = true` |
| Network error / non-OK / missing `ok` | `enabled = false`; catalog keeps working on **localStorage** |

When down: propose/approve fall back to local stubs (or error toast on approve live path); automations panel and memory recall stay hidden/empty.

### UI that lights up when the backend is reachable

| Surface | Condition |
|---------|-----------|
| **Automations panel** (agents list) | `DirectoryAPI.enabled` — inbox, recent runs, learnings, research queue, “Run automations now” |
| **Memory recall** block on agent detail | `DirectoryAPI.enabled` |
| **Propose improvement** | Uses live optimizer when enabled; else local stub |
| **Approve / reject** | Hits Railway when enabled |
| **Log eval** | Still saves to localStorage; *also* POSTs to server when enabled (fire-and-forget) |

Note: front-end agent IDs (`A1`…) and server-seeded agents share the same string IDs by convention for seed data, but they are **separate stores**. Custom localStorage-only agents won’t exist on Railway until synced.

---

## 7. Dependencies and build

### `server/package.json`

- **`"dependencies"`:** none (omitted entirely)  
- **`"devDependencies"`:** none  
- Scripts use Node built-ins only (`node`, `node --test`, `node --watch`)  
- **Confirmed: zero runtime npm dependencies**

### Node version

| Place | Requirement |
|-------|-------------|
| `package.json` `engines` | `>=18` |
| `Dockerfile` | **`node:20-alpine`** (pinned major 20) |

Railway Docker build uses 20. Local `npm start` needs ≥18.

### Build step

**None.** Image copies source and runs `node src/http/server.js`. No transpile, no `npm ci`.

---

## 8. Data persistence

| Detail | Value |
|--------|--------|
| Default store | File-backed JSON under `DATA_DIR` (default `server/data/`) |
| Writes to disk? | **Yes** — `mkdir` + `writeFile` per collection (`agents.json`, `traces.json`, etc.) |
| First boot | Seeds six agents + A2 failing traces; seeds context into memory once |

**Railway ephemeral filesystem:** container disk is **not durable**. Redeploy / restart / scale-to-zero → **`./data` is wiped** → service re-seeds from scratch (looks “fresh” every time).

**Required fix on Railway:**

1. Attach a **Railway Volume** mounted at `/data`
2. Set `DATA_DIR=/data` on the loop service
3. Redeploy — boot **fails closed** if `DATA_DIR` is unset or the mount is missing/unwritable (no silent mkdir onto ephemeral disk)

See `docs/DEPLOYMENT.md` § Railway volume. Longer-term, swap the store adapter to Postgres/Convex (architectural direction in `AGENTS.md`).

---

## 9. Deploy checklist

Do these in order.

1. **Confirm local sanity (optional)**  
   `cd server && npm start` → open `http://localhost:8790/api/health` → expect `"ok": true`.

2. **Railway → New Project → Deploy from GitHub** → select `The-Utopia-Studio/Agents-Directory` (or your fork).

3. **Service settings → Root Directory = `server`**  
   Verify: without this, Docker/`railway.json` won’t resolve correctly.

4. **Confirm build settings**  
   Railway should pick up `railway.json`: builder Dockerfile, `dockerfilePath=Dockerfile`, health `/api/health`.  
   If the UI doesn’t show them, set Builder = Dockerfile manually.

5. **Generate a public domain**  
   Settings → Networking → Generate domain. Copy `https://<service>.up.railway.app`.

5b. **Attach a Volume** (Settings → Volumes → Add Volume)  
   Mount path: `/data`. Without this the service exits on boot rather than
   writing evidence to ephemeral disk.

6. **Environment variables (zero-secrets first)**  
   Minimum recommended:
   - `DATA_DIR` = `/data` *(must match the volume mount; required on Railway)*  
   - `CORS_ORIGIN` = `*` *(or your Vercel origin once known)*  
   Leave providers unset (defaults = local/heuristic).  
   Do **not** set `PORT` (Railway injects it).  
   Do **not** set `LOOP_AUTOAPPLY=true`; auto-approval is disabled and the
   service fails boot when that stale value is present.

7. **Deploy / wait for healthy**  
   Verify in Railway logs: `[loop] listening on :<port> dataDir=/data (Railway volume required) obs=local(ok) …`  
   Verify in browser or curl:  
   `curl -s https://<service>.up.railway.app/api/health` → `"ok":true`.

8. **Point the Vercel front-end at Railway**  
   Either:
   - Console on the live site:  
     `localStorage.setItem("directory_api_base", "https://<service>.up.railway.app"); location.reload();`  
   - Or add to `index.html` before `api.js` (separate PR — not done in this audit):  
     `window.DIRECTORY_API_BASE = "https://…"`  

9. **Verify front-end bridge**  
   - Hard-refresh the Vercel app.  
   - Agents tab: automations panel should populate (inbox / runs / queue).  
   - Open an agent (e.g. Bio Generator): Memory recall block visible.  
   - “Propose improvement” toast should mention the live optimizer source (e.g. `heuristic`), not only the offline stub.  
   - DevTools Network: requests to `https://<railway>/api/...` return 200.

10. **Attach the volume before treating evidence as real.** Settings → Volumes →
    mount `/data`, set `DATA_DIR=/data`, redeploy. Without this the process now
    refuses to start on Railway rather than writing to ephemeral disk. Then add
    keys for Supermemory/Langfuse/GEPA one at a time.

---

## 10. Known risks (first deploy)

| Risk | Symptom | Diagnosis / fix |
|------|---------|-----------------|
| **Root Directory wrong** | Build can’t find Dockerfile / fails | Set Root Directory to `server`; rebuild |
| **No public domain** | Health works internally, browser can’t reach | Enable public networking / generate domain |
| **Front-end still on localhost:8790** | Automations never appear; Network tab shows failed calls to localhost | Set `directory_api_base` or `DIRECTORY_API_BASE` to Railway HTTPS URL |
| **CORS mismatch** | Browser blocks with CORS error after you set a wrong single origin | Align `CORS_ORIGIN` exactly with `https://….vercel.app`, or use `*` for smoke test |
| **Ephemeral data loss / boot refuse** | Deploy crash-loops with `DATA_DIR must be set` or `missing or not mounted` | Attach Volume at `/data`, set `DATA_DIR=/data`, redeploy. Do not mkdir `/data` in the image. |
| **Agent ID mismatch** | Propose/approve 404 for custom UI agents | Server only has seeded A1–A6 until you PUT agents; localStorage and server are separate |
| **Docker `wget` HEALTHCHECK** | Container marked unhealthy on hosts that use Dockerfile HEALTHCHECK | Railway uses HTTP `healthcheckPath` instead; ignore unless a different host fails |
| **HTTPS mixed content** | Page on HTTPS calling `http://…` blocked | Always use Railway’s `https://` URL |
| **Preview deploy origins** | Prod CORS origin blocks Vercel preview URLs | Use `*` or accept previews offline until multi-origin support |
| **`LOOP_ENABLED=true` without care** | Background cycles + spend on ephemeral disk | Keep false until volume + budget understood |
| **Assuming Vercel env wires the API base** | Setting vars only on Vercel does nothing for static `api.js` | Must set `window.DIRECTORY_API_BASE` or localStorage as above |

---

## Quick reference — “is it ready?”

| Check | Command / action |
|-------|------------------|
| Service up | `curl -s https://<railway>/api/health \| jq .ok` → `true` |
| CORS preflight | `curl -i -X OPTIONS https://<railway>/api/health -H "Origin: https://your.vercel.app"` → `204` + ACAO header |
| UI bridge | Automations panel + memory recall visible; Network calls to Railway succeed |
| Persistence | Redeploy and see if `/api/agents` still has prior edits — if not, volume needed |
