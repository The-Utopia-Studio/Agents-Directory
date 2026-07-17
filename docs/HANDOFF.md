# Handoff — Agents Directory → self-improving loop

## TL;DR
We rebuilt the Agents Directory from a static catalog into the foundation of a
**self-improving agent system**. Agents are now defined by the four things they're
only ever as good as — **goals, skills, tools, context** — and can improve over
time through an **eval → propose → verify → approve loop with a human in the gate**.

Everything is on branch **`feat/four-pillar-loop`** →
[PR #1](https://github.com/The-Utopia-Studio/Agents-Directory/pull/1). It works
locally with **zero setup**; the team's job now is to review/merge, deploy the
new service, and set the environment variables.

## What was built (PR #1)
1. **Four-pillar schema + eval loop** — agent records restructured around
   goals/skills/tools/context; eval is an append-only history with scores;
   versioned changelog; human approve/reject; localStorage persistence;
   Requests → Agents; fleet-health strip.
2. **Loop service (`server/`)** — optional, zero-dependency Node service. Every
   external system is a swappable adapter chosen by an env var (no vendor lock).
   The front-end auto-detects it and degrades gracefully.
3. **Context pillar (memory)** — semantic recall. **Supermemory** recommended;
   **Activeloop** (Deep Lake) adapter included for the Utopia org.
4. **Loop heartbeat (automations)** — triage the fleet on a schedule, a
   maker/checker split (optimizer proposes, a separate verifier grades), a token
   budget, and a triage inbox. Auto-apply is opt-in; a human stays the gate.

15/15 tests passing, verified in-browser. See
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`../server/README.md`](../server/README.md),
[`strategy.html`](strategy.html).

## What works right now (before any keys)
- **Static app:** open `index.html`.
- **Loop service:** `cd server && npm start` then `npm test` — all on local
  providers, no accounts needed.

## What the team needs to do next
1. **Review & merge** [PR #1](https://github.com/The-Utopia-Studio/Agents-Directory/pull/1).
2. **Deploy `server/`** — it's a separate Node service, not the static site.
   Railway/Render/Fly. See [`DEPLOYMENT.md`](DEPLOYMENT.md).
3. **Set environment variables** on the service host (and mirror config into
   Vercel). Secrets = Sensitive ON; config selectors = Sensitive OFF.
4. **Provision keys** — Supermemory first (memory), then Langfuse / GEPA when ready.
5. **Point the front-end** at the service via `DIRECTORY_API_BASE`.
6. **Turn providers on one at a time**, keeping `LOOP_AUTOAPPLY=false`.

## Known follow-ups
- **Persistence:** front-end and server stores are separate — Supabase/Postgres
  is the next step for shared multi-user state.
- **Run-until-done** needs a real evaluator wired at the `reevaluate` hook.

## Links
- PR: https://github.com/The-Utopia-Studio/Agents-Directory/pull/1
- Deploy guide: [`DEPLOYMENT.md`](DEPLOYMENT.md)
- Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Env template: [`../server/.env.example`](../server/.env.example)
