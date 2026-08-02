# Agents Directory

Utopia Studio's control plane for its fleet of agents. The **directory owns the
definition** of an agent — its goals, skills, tools, and context — and each
platform (Claude, Codex, an HTTP endpoint, an MCP bridge) is just an
interchangeable runtime behind an adapter. An agent is not "a Claude project";
it is a spec that currently runs on Claude and could run elsewhere.

This repo is three things in one tree:

- a **static front-end** (`index.html`, `app.js`, `api.js`, `styles.css`) — the
  catalog and request-intake UI, persisted to `localStorage`;
- a **Convex backend** (`convex/`) — the durable authority for agents,
  versions, evidence, evals, proposals, and reviews;
- a **loop service** (`server/`) — a zero-dependency Node service, deployed on
  Railway, that executes agent runs.

These are not yet wired into one system end to end. See
[Current limitations](#current-limitations) for exactly what is and isn't
connected.

## The three usability tiers

How an agent can actually be used is described by `usabilityModes[]` on the
agent record. It is an **array** — one agent can be several tiers at once (e.g.
both `hosted-run` and `download-install`). This is deliberately separate from
`invocation.type`, which is the single execution adapter used when the server
runs the agent. What a user may do and how the code executes it are different
concepts.

| Tier | What it means | Backed by |
|------|---------------|-----------|
| **Open** | Deep-link out to where the agent already lives; the server does not run it. | `invocation.type` of `link` / `prompt` (not server-run) |
| **Install** | Copy the evaluated `SKILL.md` or download its server-owned artifact folder as a ZIP. | `usabilityModes` including `download-install` **and** a resolvable server-owned artifact |
| **Handoff** | Copy an engagement **brief** that pins the repo and commit where the agent actually lives. | `usabilityModes` including `prepared-handoff` **and** a registered handoff entry |
| **Hosted-run** | The server invokes the agent and attempts to record a trace of the run. | `usabilityModes` including `hosted-run` **and** a server-run adapter (`mock`, `http`, or `runtime`) |

### Install and handoff are separate gates

`download-install` and `prepared-handoff` are different affordance sets and are
never collapsed into one condition. A prepared-handoff agent is not installed
and not hosted here: its artifact is a package in someone else's repo, so the
only honest export is a pointer plus the engagement terms. Offering it an
install-shaped export produced a skill file reassembled from directory metadata
whose own first step read "open the agent in Codex" — a document claiming to be
the agent while telling you to go and find it.

- `download-install` → **Copy single-shot SKILL.md** + **Download (.zip)**, both
  resolved from the server-owned runtime artifact.
- `prepared-handoff` → **Copy engagement brief**, resolved from the server-owned
  handoff registry.
- `hosted-run` → **Run**, plus whatever the other declared modes offer.

Neither substitutes for the other. An agent whose mode has no registered
server-owned artifact shows an explanation of what is missing, never a
generated stand-in. **Copy summary** remains available on install agents as a
plain-text description of the directory record, labelled as such.

`server/src/handoff/handoffArtifacts.js` is the handoff registry, parallel to
`runtimeArtifacts.js`: keyed by agent ID and holding the pinned repo URL, full
40-character commit SHA, brief/version/owner/runtime labels, pinned artifact
file inventory, setup checklist, prohibited-actions file reference, required
inputs, status-integrity note, and return protocol. The browser sends only an
agent ID and can never supply a repo, SHA, or path. Entries are validated when
the module loads, so a short SHA, branch name, empty checklist, or prohibited
actions reference that is not in the pinned file inventory throws instead of
shipping a brief with a hole where its provenance should be.

**A8 UX&QA is registered** at
`https://github.com/aiden150/ux-qa-agent`, commit
`2a8f2b9562c4d4569c156e2ae7559ab04a54b883`, version `0.1.0`, owned by Aiden
Kim. Its briefing points to the eight package files at that exact commit rather
than copying their contents. In particular, prohibited actions remain
authoritative in pinned `AGENT.md`, and the brief surfaces its status-integrity
rule that `Not reproducible` must not silently become `Verified`. The agent
runs in Codex; there is no endpoint.

The invocation adapters that exist today: `link` / `prompt` (manual, not
server-run), `http` (call an endpoint, with SSRF-guarded fetch), `mock` (canned
offline response), `runtime` (Anthropic Messages API using a server-owned skill
artifact), and `mcp` (a port stub that fails closed with 501 until configured).
The only registered runtime artifact is **Biocraft single-shot draft**: it
requires all source material and interview answers in one request. It is not
the full interactive `/biocraft` agent and has no Chrome, Drive, filesystem,
HTML-rendering, or conversation tools.

A `runtime` agent also owns its **input contract** server-side, in
`server/src/invoke/runtimeArtifacts.js`: stable field keys, which fields are
required, and which inputs the mode cannot read at all. `GET
/api/agents/:id/invocation-capability` returns it, and the run form is built
from it. The agent record's `inputs[]` array stays descriptive directory copy;
renaming a label there does not change the runtime contract. Inputs listed as
unsupported (LinkedIn URL, Drive folder, file path)
are shown as unavailable, are never required, and are not forwarded to the
model, since single-shot mode has no tool to fetch them.

### Runtime-bound exports and ZIP installs

A7 has one artifact: the single-shot `server/src/artifacts/biocraft/` directory
registered in `server/src/invoke/runtimeArtifacts.js`. Anthropic executes that
`SKILL.md` verbatim; Copy as SKILL.md reads the same file; Download zips the
same directory. The full Chrome/Drive `/biocraft` workflow is not exported
behind A7.

At boot the server computes `artifactDigest` as SHA-256 over the exact
`SKILL.md` bytes it caches and executes. `artifactDigestAlgorithm` is always
`sha256`. The same pair is returned with Copy as SKILL.md, written to
`MANIFEST.md`, attached to runtime traces and the capability response, shown in
the UI, and used in the ZIP filename.

The artifact declares its own stable, paste-surviving frontmatter label:
`artifact_version: biocraft-singleshot-v2`. Runtime parses that label from the
same bytes; it is not duplicated in configuration. Copy does not prepend or
alter anything, so re-hashing a pasted copy produces the recorded digest. ZIP
filenames use the label directly, for example
`A7-biocraft-singleshot-v2-<digest-prefix>.zip`.

The same frontmatter also declares `guardrails` and `success_criteria`. The
manifest reports those, never the mutable directory record, so what a reviewer
is held to is covered by the digest and cannot drift from the executed prompt.
Those lists are required: if either is missing or empty, `snapshotArtifact`
throws at module load and the server process does not start. A regression test
spawns that import path and asserts a non-zero exit — the guard is not a
warning and must not be refactored into one silently.

### v1 → v2 behaviour change (not byte-only)

`biocraft-singleshot-v1` → `biocraft-singleshot-v2` changed the **system
prompt the model receives**, not only the file hash. Frontmatter is part of
`SKILL.md`, and the runtime sends that file to Anthropic verbatim — it is not
stripped. v2 therefore adds the machine-readable `guardrails` /
`success_criteria` YAML blocks to the prompt on top of the existing prose
`## Guardrails` section. The model sees the same nine guardrails twice, in two
formats. That is redundant, not contradictory (a test asserts the lists stay
in step), but it is still a prompt change.

An earlier claim that “model-facing prose is unchanged” was wrong. Ratings
returned against `biocraft-singleshot-v1` are **not comparable** to ratings
against `biocraft-singleshot-v2`. When any of these bytes change again,
`artifact_version` must change with them.

`server/src/artifacts/installArtifacts.js` resolves through the runtime
registry; it has no separate artifact map. The browser sends only the agent ID.
Directories must resolve below the approved artifact root, and symlinks and
unsafe ZIP entry names fail closed. Download renders only when the record has
`download-install` and that runtime directory resolves.

Each ZIP contains the runtime directory plus a generated root `MANIFEST.md`
with the single-shot limitation, agent and display identifiers, artifact digest
and algorithm, file inventory and hashes, the artifact-declared guardrails and
success criteria, install instructions, and the human
output/rating/artifact-version return protocol. Exactly one version is offered
as the one to quote back — the artifact version. The directory catalog label
appears only as a cross-reference that says so. The digest remains persistent
machine provenance rather than something a reviewer must transcribe.

There is no fake or fallback identifier. If the runtime artifact cannot be
resolved at boot, it is not runnable or downloadable. If its bytes load but a
SHA-256 digest is unavailable, the server treats that as an internal error
rather than returning `unknown`.

## Architecture

**Convex is the durable authority.** The tables in `convex/schema.ts` are the
source of truth for the agent lifecycle:

- `agents`, `agentVersions` — the agent and its insert-only version history;
- `evidence` — metadata-only records of runs, tagged eligible/ineligible;
- `evalSets`, `evalCases`, `evalResults` — versioned rubrics, fixtures, scores;
- `proposals`, `reviewEvents` — candidate improvements and the append-only
  decision log;
- `entitlements`, `requests` — access grants (schema only) and the intake queue.

Release is a single transaction: only `convex/reviews.ts` writes
`currentApprovedVersionId`, in the same mutation that records the `reviewEvent`
(`reviews.ts` `approve`). It also exposes `reject`, `defer`, and an
`approveWithEdit` stub. All authority mutations require an authenticated
identity via `requireIdentity` (`convex/lib/auth.ts`).

**The loop service (`server/`, on Railway) executes runs.** It invokes agents
(`POST /api/agents/:id/run`), runs the eval → propose → verify loop on the file
store, and serves the front-end's optional REST bridge (`api.js`).

Honest note: the loop service still carries **its own** approve/reject path for
improvements (`server/src/http/routes.js` — `.../improvements/:pid/approve` and
`/reject`, backed by `loopService.approveImprovement` / `rejectImprovement`
against its local file store). That predates the Convex authority layer and is
independent of it. Removing it — so approval lives only in Convex — is **Order
3** (see [What's next](#specs-and-whats-next)).

## Repo layout

```
index.html · app.js · api.js · styles.css   Static front-end (localStorage; optional Railway bridge)
convex/                                       Durable authority: schema, mutations, queries, tests
convex/reviews.ts                             Approval as the sole release transaction
convex/lib/auth.ts                            requireIdentity / requireApprover (fail-closed)
convex/order1.test.ts                         Authority invariants + static immutability guard
server/src/                                   Loop service: invoke seam, observability, loop engine, HTTP
docs/                                         ARCHITECTURE, DEPLOYMENT, HANDOFF, migration snapshots
```

## Setup

Convex backend (from the repo root):

```sh
npm install
npm run convex:codegen     # regenerate convex/_generated
npm run typecheck          # tsc -p convex/tsconfig.json
npm run test:convex        # vitest run convex
```

Loop service:

```sh
npm test --prefix server   # node --test
npm start  --prefix server # node src/http/server.js
```

**Environment.** The Convex deployment URL lives in `.env.local` as `CONVEX_URL`
and is git-ignored. `.env.example` ships a placeholder (`CONVEX_URL=`) only —
never put a real deployment URL in a committed file. `.gitignore` ignores all
`.env.*` except `.env.example`, and ignores `convex/_generated/`.
Biocraft single-shot hosted runs additionally require `ANTHROPIC_API_KEY` in
`server/.env`; `server/.env.example` contains the empty placeholder.

**Live Anthropic smoke test** (from `server/`, with Railway env injected). The
test name is case-sensitive; a lowercase `biocraft` pattern matches **nothing**
and Node still exits 0 — that is not a pass.

```sh
# cwd: server/
RUN_LIVE_ANTHROPIC_TESTS=true npx @railway/cli run -- npm test -- test/invoke-security.test.js --test-name-pattern="live Biocraft"
```

Expect a real run to take seconds (API latency), not ~185ms. A genuine pass
prints `✔ live Biocraft single-shot runtime returns generated bio text`. A
gated skip prints `﹣ … # SKIP` with `tests 1 · pass 0 · skipped 1`. If you
see `tests 4 · pass 4` in ~200ms and no line naming that test, the pattern
matched zero tests — re-check the spelling.

## Current limitations

These are deliberate and known. Nothing here is aspirational — if a thing is
off, it is off.

- **The Convex authority layer is not yet wired to the running app.** Approvals
  in the live product do **not** go through `reviews.ts` today — the front-end
  still reads and writes `localStorage`, and the loop service keeps its own
  approve/reject path. Convex is exercised only through `convex-test`; wiring it
  into the app is tracked in **TUS-2327**.
- **General file trace writes are disabled.** `FILE_TRACE_WRITES_ENABLED` is
  `false` in `server/src/observability/localAdapter.js`. The only exception is
  an internally authorized `runtime` trace marked `source: "real"`; those runs
  persist metadata only: status, provider, model, token counts, latency, cost
  when returned, the mutable agent version label, and a SHA-256 output digest.
  Inputs and outputs are not stored. Client-posted traces and mock/HTTP runs
  remain a visible no-op. Historical file traces can still be read.
- **Reviewer feedback notes are stored, on the feedback record only.** A star
  rating carries a free-text `notes` field explaining the score — a reviewer's
  judgement of the agent, not run payload about the fellow. It is appended to
  the separate `feedback` collection, never to the trace, and never to
  `evalHistory`. Notes are capped at `FEEDBACK_NOTES_MAX_CHARS` (2000) and can
  be turned off for a deployment with `FEEDBACK_NOTES=false`, which rejects
  posted notes with 400 while still accepting the rating.
- **The maker refuses without evidence, and there is no offline stub.** A
  proposal must be derived from a real defect signal: a failing trace's
  reason, reviewer feedback notes, or an eval `knownIssues`/`notes`. Metadata
  traces and feedback records are read as evidence, but a successful run is
  not a defect signal — it records that the agent ran, never that it ran
  badly. With no signal, `runImprovement` returns 422 naming exactly what is
  missing, and no proposal is queued. Optimizers refuse too, so no adapter can
  emit a templated proposal with an unresolved placeholder in it. The
  front-end has no offline synthesis path; without the loop service, Propose
  simply declines.
- **Approving a proposal does not change what runs.** `approveImprovement`
  bumps the mutable directory catalog label (`1.0` → `1.1`) and appends a
  changelog entry. It does not edit `SKILL.md`, `artifact_version`, or the
  artifact bytes, so the runtime keeps executing the same digest afterwards.
  Proposals therefore record `targetArtifactVersion` and
  `targetArtifactDigest`, and approval is refused with 409 if the live
  artifact has moved since the proposal was derived. Applying an approved
  change to the artifact itself is still a manual edit plus an
  `artifact_version` bump.
- **Runtime traces have no approved `agentVersionId`.** A7 traces carry the same
  `artifactDigest` and `artifactDigestAlgorithm: "sha256"` used by
  run/copy/download plus the mutable directory version label, but the artifact
  is still not a Convex-approved version. It cannot support authoritative
  promotion until Railway is wired to Convex under **TUS-2327**.
- **No auth provider is configured (no Clerk).** There is no `auth.config.ts`.
  Against a real deployment, `ctx.auth.getUserIdentity()` returns nothing, so
  every authority mutation — evidence inserts, approvals — fails closed with a
  401. Tests get past this only because `convex-test` injects an identity via
  `.withIdentity(...)`.
- **Digests are caller attestations, not verified byte hashes.** Fields like
  `declaredDigest` / `declaredArtifactDigest` are values the caller supplies;
  nothing hashes the artifact to check them.
- **`agentVersions` immutability is enforced by a static test, not the
  database.** `convex/order1.test.ts` scans every non-generated module with a
  text heuristic for mutations that look like they target an `agentVersions`
  row. Convex has no row-level immutability; the guard is a heuristic and says
  so in its own failure messages.
- **Concurrent approvals are unverified under real OCC.** `convex-test`
  serializes top-level mutations, so the true optimistic-concurrency race can't
  be reproduced locally. The relevant test is `test.skip`-ed pending a deployed
  staging environment with two authenticated identities.
- **Railway has no service principal for Convex.** The loop service holds no
  Convex client or credentials, so it cannot write to the authority layer at
  all. The front-end likewise talks only to `localStorage` and the optional
  loop-service REST API — not to Convex.

## Specs and what's next

The design and its sequencing live in `docs/`:
[`ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`CONVEX_MIGRATION_AFTER.md`](docs/CONVEX_MIGRATION_AFTER.md) (the Order 1
authority snapshot and the explicit Order 2 / Order 3 deferrals),
[`DEPLOYMENT.md`](docs/DEPLOYMENT.md),
[`RAILWAY_DEPLOY_AUDIT.md`](docs/RAILWAY_DEPLOY_AUDIT.md), and
[`HANDOFF.md`](docs/HANDOFF.md). Repo-wide conventions are in
[`AGENTS.md`](AGENTS.md).

- **Order 1** (done) — Convex schema and insert-only version history.
- **Order 2** (done) — approval as the sole release transaction.
- **Order 3** (next) — give Railway a Convex service principal so runs can write
  durable evidence, and remove the loop service's own approve/reject path so
  approval authority lives only in Convex.
