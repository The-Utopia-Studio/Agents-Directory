# Architecture

How the Agents Directory is organised, and why. The guiding idea (from the
[ai-native framing](https://karanmjpinto.github.io/ai-native)): the moat is
**the loop, not the tool**, and an agent is only ever as good as its **goals,
skills, tools, and context**. Both ideas are load-bearing here.

## Two halves

```
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│  Front-end (static)         │  HTTP  │  Loop service (server/)          │
│  index.html · app.js · css  │ ─────▶ │  observability + optimizer       │
│  localStorage source        │ ◀───── │  file store (→ Postgres at scale)│
│  of truth (works offline)   │        │  zero-dependency Node             │
└─────────────────────────────┘        └──────────────────────────────────┘
        api.js probes /api/health; if the service is down the app
        runs fully offline and loop actions use local stubs.
```

The front-end is deliberately still vanilla + static (no build step, deploys to
Vercel as-is). The loop service is **optional and additive** — the directory
degrades gracefully to a local-only catalog when it isn't running.

## The record: four pillars

Every agent is structured around the four things it's only as good as. This is
the "common language" the directory exists to provide.

- **Goals** — `objective`, `successCriteria[]`, `guardrails[]`
- **Skills** — `skills[]` (references into a shared SKILL.md library)
- **Tools** — `tools[]` (MCPs / integrations / APIs)
- **Context** — `context[]` (memory / knowledge / data sources), backed by a
  live `MemoryProvider` (Supermemory recommended; Activeloop for the Utopia Deep
  Lake org; `local` offline). Declared context is seeded into memory and becomes
  semantically recallable per agent.

Plus the machinery that makes the loop possible: `version` + `changelog[]`, an
append-only `evalHistory[]` (numeric scores → trendable fleet health), and a
`proposedImprovement` (the human-in-the-loop hook).

## The loop

```
spec ──run──▶ traces ──score──▶ eval history
  ▲                                   │
  │                          failing signal
  │                                   ▼
new version ◀─ human approve ◀─ optimizer proposes
```

1. **Observe** — runs are recorded as traces (`ObservabilityProvider`).
2. **Score** — evals are appended, measured against the success criteria.
3. **Improve** — an `Optimizer` reads the *failing* traces and proposes a
   targeted prompt/skill revision.
4. **Human in the loop** — the owner approves (cuts a new version, logs the
   changelog) or rejects. This is what replaces one-shot builds.

## Why it's modular & scalable

Three seams, each an interface with swappable implementations:

| Seam | Interface | Ships with | Scales to |
|---|---|---|---|
| Persistence | `store.js` | file (`data/*.json`) | Postgres / Supabase |
| Observability | `ObservabilityProvider` | `local`, `langfuse` | any tracer |
| Self-improvement | `Optimizer` | `heuristic`, `gepa` | DSPy / custom |
| Memory (Context) | `MemoryProvider` | `local`, `supermemory`, `activeloop` | any memory layer |

Selection happens once, in `config.js`, by name. Adding a provider is a new file
+ one `register(...)` call; no caller changes. The store clones on read/write so
callers can't alias the cache — the same isolation a database gives you, which
keeps the swap honest.

## What's real vs. stubbed

- **Real & running:** the full loop (trace → eval → propose → approve → version),
  the file store, the local observability adapter, the heuristic optimizer, the
  REST API, and the front-end integration with offline fallback.
- **Real code, needs credentials/infra:** the Langfuse adapter (needs keys) and
  the GEPA adapter (needs an endpoint or CLI). Both implement the same
  interfaces and are covered by the config switch — flipping them on is an `.env`
  change, not a code change.
