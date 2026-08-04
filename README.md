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

A registry entry is only half of it: the agent must also exist in the store, or
`/api/agents/:id/invocation-capability` returns 404 and there is nothing to
attach the button to. `seedIfEmpty` is a first-boot path and will not touch a
store that already has records, which is how A8 shipped a registered brief that
no deploy could reach. `upsertServerOwnedAgents` in `server/src/scripts/seed.js`
closes that gap on every boot: any seed agent with a registered runtime or
handoff artifact is inserted if absent, and never overwritten if present, so a
directory edit survives a restart.

When that capability request fails, the detail view now renders the reason in
the slot the button would have occupied — "Engagement brief unavailable — A8 is
not registered on the server." A blank slot is indistinguishable from an agent
that legitimately offers nothing, and reading a correct 404 then rendering
nothing costs a manual API audit to discover what the server already said.

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
`artifact_version: biocraft-singleshot-v6`. Runtime parses that label from the
same bytes; it is not duplicated in configuration. Copy does not prepend or
alter anything, so re-hashing a pasted copy produces the recorded digest. ZIP
filenames use the label directly, for example
`A7-biocraft-singleshot-v6-<digest-prefix>.zip`.

The same frontmatter also declares `guardrails`, `success_criteria`, and
`checks`. The manifest reports the first two, never the mutable directory
record, so what a reviewer is held to is covered by the digest and cannot drift
from the executed prompt. All three lists are required; unknown check names
also fail boot. A regression test spawns that import path and asserts a
non-zero exit — the guard is not a warning and must not be refactored into one
silently.

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

### v2 → v3 → v4 behaviour change

`biocraft-singleshot-v3` incorporated Sarah's owner-approved bio method.
**v4 renames one check id** in the frontmatter, from
`about_final_paragraph_has_cta` to `about_closing_has_cta`, because the check
inspects the closing rather than a single final paragraph. That id is what
lands in evidence and what the maker reads, so a name describing something else
is the same failure as any other misleading label. Frontmatter is part of the
prompt, so the bytes and digest moved with it and the version had to move too.
Nothing else about the prompt changed between v3 and v4.

`biocraft-singleshot-v4` incorporates Sarah's owner-approved bio method:
positioning before drafting; 3–5 isolated hook candidates; Context → Proof →
optional Method body structure; 5–8 keywords integrated into sentences; one
explicit CTA in the final LinkedIn About paragraph; and a final specificity
cut. The mobile-fold hook limit changes from 300 to **200 characters**. The
About CTA is required, while a CTA in the third-person event introduction
remains prohibited.

The runtime now executes the artifact's three deterministic `checks:` after
Anthropic returns: hook ≤200, no delimiter-separated keyword run in the About,
and a CTA in its closing. Ratings against v2 are **not comparable** to ratings
against v3 or v4.

### v4 → v5 section-scope widening

`biocraft-singleshot-v5` widens the delimiter-separated keyword-run detector
from the LinkedIn About to all three generated sections: About, spoken event
introduction, and suggested headline. Its check id is therefore
`generated_sections_have_no_delimiter_separated_keyword_run`, not an
About-scoped name. The artifact bytes and SHA-256 moved with this behaviour
change. Ratings against v4 are **not comparable** to ratings against v5.

### v5 → v6 check correction

`biocraft-singleshot-v6` restores the delimiter-separated keyword-run check to
the LinkedIn About only; pipe-separated LinkedIn headlines are valid and are
not inspected by that rule. CTA detection now recognises conditional and
first-person invitation wording such as “connect with me” and “I would like to
connect”. The artifact also registers mechanical checks for em dashes/double
hyphens and the observed multi-word phrase “sits at the intersection of” across
all three generated sections. Ratings against v5 are **not comparable** to
ratings against v6 because the check set and scope changed.

### A failed check is a scored failure, not a refusal

The checks are a **quality** gate; the guardrails are the safety layer. A check
failure therefore returns the output, marked, rather than throwing it away:

- HTTP **201** with `status: "checks_failed"`, `failedChecks[]`, and the output.
- The trace is `status: "fail"` — it ran and missed the bar — as distinct from
  `"error"`, which means it did not run. `getFailingTraces` returns both.
- The UI re-frames the whole result card (`.run-result-failed`) with a banner
  naming each failed check. It is never presented as a clean run.

The reasons: Anthropic has already billed by the time a check runs, so a 502
discarded output we paid for; a reviewer cannot tell a wrong check from a wrong
draft without seeing the draft; and a returned run is **rateable**, so the miss
becomes feedback the maker can read.

### The checker's verdict survives the metadata-only rule

`failureReason` used to be stripped in two places — the `metadataOnlyTrace`
allowlist and the observability adapter's defence-in-depth — because free text
can carry model output. That also discarded the only failure signal generated
mechanically, so `collectImprovementEvidence` read `failureReason` off every
failing trace, always found nothing, and `runImprovement` refused with 422 on
agents that had genuinely failed runs.

`server/src/core/traceSafety.js` now draws the line at **membership, not
shape**. `KNOWN_CHECK_IDS` and `KNOWN_FAILURE_CODES` are the complete
vocabulary a trace may use; an unregistered token rejects the whole string
rather than passing because it looks like an id. A pattern such as
`/^[a-z0-9_]+$/` would only prove a value *looks* right, and shape checks are
how content eventually reaches a layer built to exclude it — a future caller
deriving a token from model output would sail through. Adding a check means
adding its id here deliberately, and a test asserts `KNOWN_CHECK_IDS` never
drifts from `RUNTIME_CHECKS`.

Alongside the id, a trace may carry numeric/boolean facts per failed check:
paragraph counts, character lengths, whether the section was found, and which
of the CTA detectors fired. It may never carry a matched substring or excerpt;
`sanitizeCheckResults` drops unknown keys rather than trusting them. Both write
paths use the same filter.

### CTA detection is three signals, not a phrase list

A fixed phrase list rejected valid closings ("Available for advisory work",
"Book a call", "For speaking enquiries, email hello@…", "Currently taking on
new projects"), and a check that fails good output trains reviewers to ignore
it. The check now passes if **any one** of three independent signals fires over
the **trailing two paragraphs** — Sarah's "one or two final lines". The window
is capped there and never grows: an expand-until-N-characters rule would
swallow a short About whole and pass a bio whose CTA sits mid-text, which is
the opposite of what the check is for.

1. **Contact channel** — an email, URL, or handle. Pure pattern.
2. **Imperative opener** — sentence-initial contact verb. Positional, so "Book
   a call", "Book a slot", and "Book time with me" all fire on one rule.
3. **Invitation frame** — the remaining lexical branch, bounded by the
   artifact's own wording: "what the fellow is open to, or how to reach out".

A closing where none of the three fire still fails, which is the v2 regression
Sarah caught. The check id is `about_closing_has_cta`, named for the window it
actually inspects.

**Read the recorded booleans as detector state, not as a verdict.** Three
`false` values mean no detector fired — which is consistent with the model
omitting the CTA *and* with a valid CTA the detectors do not recognise. They
are the best diagnostic available and worth keeping, but neither the failure
message nor the run banner asserts omission from them, and neither should any
future evidence text.

The directory record mirrors the artifact's four success criteria and ten
guardrails for display. Server seed refreshes those fields on boot, and the
browser refreshes its localStorage A7 copy during hydration, so the UI cannot
silently retain v2's 300-character rule. Sarah's browser/scheduler actions do
not enter the prompt: the record SOP tells a human to paste the About into
LinkedIn, check the fold on a phone, and set a 2–3 month refresh reminder.

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
index.html · app.js · api.js · styles.css   Static front-end (localStorage + read-only Convex A7/A8 pilot)
frontend/convexDirectory.js                  Query-only governed-record overlay, bundled for Vercel
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
npm run build:frontend    # bundle query client + generate public deployment config
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
never put a real deployment URL in a committed file. The Vercel build runs
`npm run build:frontend`, which writes that non-secret URL into
`deployment-config.js` and bundles the browser clients. Vercel also needs
`CLERK_PUBLISHABLE_KEY` (a non-secret `pk_…` key) for the sign-in surface;
never put a Clerk secret key, JWT, or token in the generated file.
`deployment-config.js` is gitignored — never commit the generated file or a
real Convex URL. A blank, missing, or unavailable deployment preserves the
complete local directory and shows no Convex governance label. `.gitignore`
ignores all `.env.*` except `.env.example`, `convex/_generated/`,
`convex-directory.bundle.js`, `clerk-auth.bundle.js`, and
`deployment-config.js`.
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

- **Mechanical compare UI is unverified in a browser.** The A7 mechanical-compare
  API (`POST /api/agents/A7/mechanical-compare`, preview, and mechanical-results)
  is tested and working (coverage vs quality experiments, canned provenance
  labelled as plumbing, live path wired). The agent-detail compare panel has
  not been exercised end-to-end in a browser against a running loop service —
  local static serving without `deployment-config.js` blocks the governed
  directory UI, so recent verification was API-only. Do not treat the panel as
  confirmed until someone runs it with Clerk/Convex config generated and the
  loop pointed at the same origin.
- **On Railway, `DATA_DIR` must be `/data`.** Container disk is ephemeral.
  The loop service detects Railway via `RAILWAY_ENVIRONMENT` /
  `RAILWAY_SERVICE_ID` and refuses to start unless `DATA_DIR` is exactly
  `/data` and that path already exists and is writable (a Volume mounted
  there). It will not accept `/tmp` or any other directory, and will not
  `mkdir` `/data` on ephemeral storage — either would look like persistence
  while wiping traces, feedback, and loop history on every deploy. First
  boot against an empty volume runs `seedIfEmpty`; later boots are no-ops
  for seeding, and new server-owned agents still need the explicit upsert.
  Dashboard steps: `docs/DEPLOYMENT.md`.
- **Only A7/A8 directory reads are wired to Convex.** Phase 4 overlays the
  imported A7/A8 agent and governed-version fields after one successful public
  query. A1–A6, requests, edits, approvals, runs, evidence, feedback, exports,
  and every write remain on their existing local/Railway paths. Approvals in
  the live product do **not** go through `reviews.ts` today. A failed or
  unconfigured Convex read preserves the full local directory and makes no
  “Governed in Convex” claim. The remaining cutover is tracked in **TUS-2327**.
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
  proposal must contain a non-empty `changes[]`; each change names a
  `prompt | check | runtime` surface, concrete target, bounded current/proposed
  text, one-sentence rationale, and at least one existing trace or feedback id.
  The server validates those ids against records scoped to the agent and
  rejects unknown ids, empty changes, overlong edit text, and verbatim inlined
  feedback. Evidence is cited by reference, not pasted into the title or
  rationale.

  The offline heuristic only emits edits for defect classes it explicitly
  understands. It can separate known prompt and checker defects, but it refuses
  unknown prose rather than keyword-extracting a reviewer note into a template.
  A mechanical check failure alone also remains ambiguous: detector facts show
  what fired, not whether the draft or detector is wrong, so the heuristic
  refuses until reviewer evidence identifies the edit. The current GEPA
  adapter is structurally prompt-only (`optimizedPrompt`/`diff`) and therefore
  refuses all proposals until its endpoint/CLI can emit valid `changes[]`; it
  never converts a prompt diff into a fake checker/runtime edit. No LLM maker
  is wired yet.
- **Approving a proposal does not change what runs.** `approveImprovement`
  bumps the mutable directory catalog label (`1.0` → `1.1`) and appends a
  changelog entry. It does not edit `SKILL.md`, `artifact_version`, or the
  artifact bytes, so the runtime keeps executing the same digest afterwards.
  Proposals therefore record `targetArtifactVersion` and
  `targetArtifactDigest`, and approval is refused with 409 if the live
  artifact has moved since the proposal was derived. Applying an approved
  change to the artifact itself is still a manual edit plus an
  `artifact_version` bump.
- **The loop cannot approve on its own.** Verifier `ship` is a recommendation,
  not a review event. Cycle runs leave it in the inbox; goal runs stop at
  `held-for-human`. `shouldAutoApply` always returns false and
  `LOOP_AUTOAPPLY=true` fails boot rather than reopening a stale configuration
  path. `autonomyLevel` describes action scope only.
- **Runtime traces have no approved `agentVersionId`.** A7 traces carry the same
  `artifactDigest` and `artifactDigestAlgorithm: "sha256"` used by
  run/copy/download plus the mutable directory version label, but the artifact
  is still not a Convex-approved version. It cannot support authoritative
  promotion until Railway is wired to Convex under **TUS-2327**.
- **Clerk sign-in governs browser writes and human loop approvals.**
  `convex/auth.config.ts` trusts the configured
  `CLERK_JWT_ISSUER_DOMAIN` using the `convex` audience. Authority mutations
  fail closed with 401 when no signed identity is present. Release decisions
  additionally require the signed, user-level top-level claim
  `role: "approver"` and fail with 403 for every other role. The static
  front-end loads Clerk with the non-secret publishable key, requests
  the `convex` JWT template, and attaches that token to the Convex HTTP client.
  Signed-out users retain read access and get a visible sign-in action; missing
  configuration or token failure is visibly unavailable, not a silent
  permissions fallback. The Railway approval endpoint independently verifies
  the same signed token against Clerk's JWKS and requires `role: "approver"`;
  it never accepts a browser-supplied actor. Approval retains the proposal and
  a copyable change patch, but does not bump `agent.version`, edit an artifact,
  or release a governed version. Railway must have
  `CLERK_JWT_ISSUER_DOMAIN` set to the trusted issuer (and optionally
  `CLERK_JWT_AUDIENCE`, default `convex`) or approval visibly fails closed.
- **Digests are caller attestations, not verified byte hashes.** Fields like
  `declaredDigest` / `declaredArtifactDigest` are values the caller supplies;
  nothing hashes the artifact to check them.
- **The Phase 2.5B import gate is an Approved import-spec digest, not a file
  digest.** The value `2da90…` (`APPROVED_IMPORT_MANIFEST_DIGEST`, passed as the
  machine argument `manifestDigest`) is the SHA-256 of the canonical, stable
  import specification — `sha256(stableStringify(APPROVED_IMPORT_SPEC))` — not
  the byte hash of the formatted JSON manifest file. Reformatting the JSON
  changes the file bytes but not this digest.
- **A7's imported artifact identity has a custody limitation.** The imported A7
  version records a SHA-256 `declaredDigest` that identifies the exact imported
  artifact bytes and a repo-relative `locator`
  (`server/src/artifacts/biocraft/SKILL.md`). This is not yet a Git commit pin
  or a canonical artifact-storage location, so the locator alone cannot be
  relied on to reproduce those bytes later. A real Git pin / canonical storage
  is a later decision and must not be backfilled onto the immutable A7 version.
- **Demo/mock evidence is synthetic and ineligible by construction.** Its
  Convex writers own `source`, force `eligibleForEvaluation: false` and
  `eligibleForPromotion: false`, and accept no caller-supplied eligibility
  flags. Demo fixtures are restricted to version-linked A7 metadata in tests;
  nothing seeds demo evidence on deployment. Synthetic rows are excluded from
  evaluation and promotion queries and cannot be passed to `recordEvalResult`.
- **A8 cannot record evidence yet.** A8 is a foreign-runtime handoff whose Git
  commit is a source pin, explicitly not an artifact-content digest. Until a
  valid foreign-runtime evidence-identity model is approved, Convex refuses
  evidence creation for A8 rather than inventing a digest or treating the
  commit SHA as one.
- **`agentVersions` immutability is enforced by a static test, not the
  database.** `convex/order1.test.ts` scans every non-generated module with a
  text heuristic for mutations that look like they target an `agentVersions`
  row. Convex has no row-level immutability; the guard is a heuristic and says
  so in its own failure messages.
- **Concurrent approvals are unverified under real OCC.** `convex-test`
  serializes top-level mutations, so the true optimistic-concurrency race can't
  be reproduced locally. The relevant test is `test.skip`-ed pending a deployed
  staging environment with two authenticated identities.
- **Concurrent display-ID allocation is not proven in production.** Eight
  simultaneous `registerAgent` callers receive distinct `A<n>` values under
  `convex-test`, but that harness serializes top-level mutations. The current
  scan-and-insert allocator has no database uniqueness constraint; a genuine
  deployed overlap still needs a two-session smoke test before multi-user use.
- **Phase 5 removes legacy display-only measurements.** `evalHistory`,
  `changelog`, and `costPerOutcome` are no longer rendered from browser data;
  they return only when governed, version-linked Convex query models exist for
  them.
- **Railway has no service principal for Convex.** The loop service holds no
  Convex client or credentials, so it cannot write to the authority layer at
  all. The front-end reads and edits the catalogue through Convex, while live
  run/export/proposal affordances still use the optional loop-service REST API.

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
