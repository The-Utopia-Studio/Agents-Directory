# Agents Directory — Agent Guide

Context for humans **and** builder agents working in this repo. Read this before large changes. Written in the spirit of the [Studio Product Framework](https://github.com/The-Utopia-Studio/studio-product-framework) (SPF) — this directory should read as a native SPF citizen, not a parallel stack.

## What this is

The studio's **control plane** for its fleet of agents. Every agent is defined by the four things it's only ever as good as — **goals · skills · tools · context** — and improves over time through an **eval → propose → verify → approve loop with a human in the gate**.

## Two kinds of agents (do not conflate)

| Kind | Where | Job |
|------|-------|-----|
| **Runtime agent** | the records this directory catalogs | Does work for the studio/fellows (LinkedIn audit, research, …) |
| **Builder agent** | the loop engine in `server/src/loop/` | Improves runtime agents |

**Runtime agents must not self-modify builder skills.** The loop improves agents; agents don't rewrite the loop. (SPF rule.)

## The four pillars (the schema is the product)

- **Goals** — `objective`, `successCriteria[]`, `guardrails[]`, `goldenCases[]` (the scorable eval set), `failureClasses[]`, `costPerOutcome`, `autonomyLevel`
- **Skills** — `skills[]` (references into a shared SKILL.md library)
- **Tools** — `tools[]` (MCPs / integrations / APIs)
- **Context** — `context[]`, backed by a live memory provider

*A scope you cannot score is an opinion.* Prefer golden cases over prose success criteria.

## Loop doctrine (from SPF `docs/loop-engineering.md`)

A loop is a **bounded, recursive workflow** with a **Loop Contract**: goal · done-when · max-iterations · **forbidden moves** · artifacts · human gate. *If it can't state an exit condition, it isn't a loop — it's busywork.*

Hard rules the loop engine enforces:

1. **Autonomy-gated auto-apply.** The loop only auto-applies up to an agent's declared `autonomyLevel` (L0–L4). Promotion is earned via eval result, not vibe. `LOOP_AUTOAPPLY` is a master kill-switch on top.
2. **Human gate** for taste, money, or irreversible actions. Everything else can be autonomous within contract.
3. **Never retry a failed identical attempt.** Same failure signal twice → **stop and write a learning**; the signal is then skipped. *The agent forgets, the repo doesn't.*
4. **Budget-bounded.** Every cycle respects a token/cost ceiling.
5. **Maker ≠ checker.** The optimizer proposes; a separate verifier grades; a human approves.

Learnings feed back into the **Context pillar** (memory), so blocks compound.

## Architecture

Front-end (static, vanilla, unchanged Vercel deploy) **+ optional `server/`** (zero-dependency Node) that runs the loop. Every external system is a **swappable adapter chosen by a config name** — no vendor lock. Seams: observability, optimizer (maker), verifier (checker), memory, store, loop.

Status keys (SPF style): **Shipped** (wired & tested) · **Port** (adapter ready, needs creds) · **Process** (external setup).

| Seam | Shipped (offline) | Port (needs creds) |
|------|-------------------|--------------------|
| Store | file | Convex / Postgres |
| Observability | `local` | Langfuse |
| Optimizer (maker) | `heuristic` | GEPA / DSPy |
| Verifier (checker) | `heuristic` | LLM judge |
| Memory (context) | `local` | Supermemory · Activeloop |

## Aligning to SPF (the direction of travel)

- **Backend → Convex** as the control plane (Workflow/Workpool for the loop scheduler; RAG for memory) — not a separate Supabase stack.
- **Run + evaluate agents via `@studio/ai-runtime`** (sandbox + metered inference) — that's how run-until-done gets a real evaluator and real cost-per-outcome.
- **Product truth → PostHog, failure truth → Sentry** via `@studio/observability`; Langfuse stays for LLM traces (complementary).
- **Effect fence** the money/trust-critical paths (budget, auto-apply, cost metering).

## Hard rules

1. Secrets never in git or the browser — only `.env.example` templates are tracked.
2. The static front-end holds **no** secrets (only a non-secret API base URL).
3. Adding a provider = new adapter file + one `register()` call; no caller changes.
4. The store clones on read/write — callers must not alias the cache.
5. Keep HTML escaping consistent across all render paths.
6. Don't add a loop without a contract, or a provider without a status.

## Repo map

```
index.html · app.js · api.js · styles.css   Static front-end (four-pillar UI, automations panel)
server/src/core/        types · store (persistence seam) · loopService · version
server/src/observability/ · improve/ · verify/ · memory/   provider seams (maker/checker/memory)
server/src/loop/        engine (runCycle/runGoal) · policy (contract, autonomy, budget)
server/src/http/        router · routes · server entrypoint
docs/                   ARCHITECTURE · DEPLOYMENT · HANDOFF · strategy.html
```

See `docs/ARCHITECTURE.md`, `server/README.md`, and `docs/DEPLOYMENT.md`.
