# Loop service

The observability + self-improvement backend for the Agents Directory. It turns
the directory from a static catalog into a **closed loop**: agent runs are
traced, evaluated against success criteria, and a reflective optimizer proposes
improvements that a human approves to cut a new version.

**Zero runtime dependencies.** Node's built-in `http` + `fetch` only — so it runs
anywhere and every provider is swappable by config, not by code.

## Run

```sh
cd server
cp .env.example .env        # optional — defaults work with no accounts
npm start                   # http://localhost:8790
npm test                    # end-to-end loop tests (offline)
```

On first boot it seeds six agents and a set of failing traces for **A2 (Bio
Generator)**, so the loop has real signal to work with immediately.

## The loop, over HTTP

```
POST /api/agents/A2/improvements            # run the optimizer on failing traces
  → { source:"heuristic", summary:"…voice mismatch", evidence:{failing:4}, id }
POST /api/agents/A2/improvements/current/approve
  → { version:"1.1", agent:{…} }            # bumps version, logs changelog
POST /api/agents/A2/improvements/current/reject
```

Other routes: `GET /api/health`, `GET /api/fleet/health`,
`GET|PUT /api/agents/:id`, `GET|POST /api/agents/:id/traces`,
`POST /api/agents/:id/evals`.

## Context / memory (the fourth pillar)

Each agent's declared `context[]` is seeded into memory on first boot, and you
can add more and recall it semantically:

```
POST /api/agents/A2/context           { "content": "Fellow's voice is warm, concise." }
GET  /api/agents/A2/context/search?q=what%20is%20the%20voice
  → { results:[ { content:"…", score } ] }        # namespaced per agent
```

**Provider choice:** `supermemory` is recommended for agent memory (REST
ingest + search, embeddings/chunking handled for you, memory graph). `activeloop`
targets the Utopia Deep Lake org — it's a vector+tensor data lake whose REST is
query-first (you bring embeddings via `EMBED_ENDPOINT` and a deeplake writer
sidecar for ingest), better suited to large multimodal RAG than lightweight
per-agent memory. `local` (default) ranks by token overlap — offline, no keys.

## Automations — the heartbeat (loop engineering)

What makes it a *loop* and not a one-off run. The engine finds the work, hands it
to the maker (optimizer), has a separate **checker** (verifier) grade it, routes
the result to the human triage inbox or auto-applies within policy, respects a
token budget, and logs every cycle to state.

```
POST /api/loop/run            # one heartbeat across the fleet
  → { scanned, selected, jobs:[{agentId, action, verdict}], budget:{spentUsd} }
GET  /api/loop/inbox          # proposals awaiting human triage (with verdicts)
GET  /api/loop/runs           # cycle history (state / memory)
POST /api/agents/A2/goal      # run-until-done: iterate until success criteria met
  { "targetScore": 80, "maxIterations": 3 }
```

- **Maker/checker split** — the `Optimizer` proposes; a distinct `Verifier`
  (`VERIFIER=heuristic|llm`) grades `ship | hold | reject` with a confidence.
  The human stays the final gate unless `LOOP_AUTOAPPLY=true`.
- **Stop condition = your success criteria.** `runGoal` iterates until the eval
  score crosses `targetScore`, re-verified each pass. A real eval run plugs in at
  the `reevaluate` hook; without it the loop ships one verified change and stops
  (`needs-evaluator`) rather than pretending to measure progress.
- **Budget.** `LOOP_BUDGET_USD` / `LOOP_MAX_JOBS` cap each cycle (Osmani's token
  caveat, made concrete).
- **Scheduler.** Off by default. `LOOP_ENABLED=true` + `LOOP_INTERVAL_MS` runs an
  in-process heartbeat; in production push it to cron / GitHub Actions.

## Swapping providers (the scalability lever)

Everything is selected in `.env` by name. The rest of the code depends on
interfaces (`ObservabilityProvider`, `Optimizer` in `src/core/types.js`), never
a concrete provider.

| Concern | Default (offline) | Production | Switch |
|---|---|---|---|
| Observability | `local` (file traces) | **Langfuse** | `OBS_PROVIDER=langfuse` + keys |
| Optimizer | `heuristic` (reflective, offline) | **GEPA / DSPy** | `OPTIMIZER=gepa` + endpoint/cmd |
| Memory (Context) | `local` (token overlap) | **Supermemory** / Activeloop | `MEMORY_PROVIDER=supermemory` + key |
| Verifier (checker) | `heuristic` (offline skeptic) | **LLM judge** | `VERIFIER=llm` + endpoint |
| Store | file (`data/*.json`) | Postgres / Supabase | reimplement `src/core/store.js` |

Adding a new backend = write an adapter implementing the interface, then
`register(name, factory)` in `src/observability/index.js` or
`src/improve/index.js`. Nothing else changes.

### Wiring GEPA

Set one of:

- `GEPA_ENDPOINT` — the adapter POSTs a dataset (built from failing traces) to
  your job runner and parses the optimized prompt back.
- `GEPA_CMD` — e.g. `python -m gepa optimize`; the adapter pipes the task in on
  stdin and reads JSON back on stdout.

See `src/improve/gepaAdapter.js`. Until configured, `OPTIMIZER=gepa` falls back
to the heuristic optimizer with a warning, so the loop never hard-fails.

## Layout

```
src/
  config.js               env-driven config + provider selection
  core/
    types.js              interfaces (the contracts everything agrees on)
    registry.js           provider registry / factory
    store.js              persistence seam (file store; swap for a DB)
    loopService.js        the loop's business rules
    version.js            shared version bump
  observability/          ObservabilityProvider: local + langfuse adapters
  improve/                Optimizer (maker): heuristic + gepa adapters
  verify/                 Verifier (checker): heuristic + llm adapters
  memory/                 MemoryProvider: local + supermemory + activeloop
  loop/                   the heartbeat: engine (runCycle/runGoal) + policy
  http/                   router, routes, server entrypoint
  scripts/seed.js         idempotent seed (agents + failing traces)
test/                     offline end-to-end loop tests
```
