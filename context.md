# Agents Directory — Context

**Last updated:** 29 July 2026
**Owner:** Haniyah Umair (Utopia Studio)
**Repo:** `The-Utopia-Studio/Agents-Directory`
**Linear:** [Agent Inventory](https://linear.app/the-utopia-studio/project/agent-inventory-e962d3f8b3de)
**Deployed:** https://agents-inventory.vercel.app/

> Drop this into a new agent session before asking for work. It exists so decisions
> already made don't get relitigated, and so nobody proposes building something that
> already exists on a branch.

---

## 1. What this is

An Agents Directory inside Studio OS for Utopia Studio, a venture studio.

Two-sided:
- **Studio-facing** — manage internal agents, usage caps, department ownership
- **Fellows-facing** — browse, request access, use agents via a token/compute stipend

Long-term goal is an agent factory. The directory is the foundation it deploys from,
not a side catalogue. Sequencing is deliberate: the inventory ships **before** the
agent-building sprint.

## 2. The two constraints from leadership

Both from Karan Pinto (studio lead). These are the bar everything is judged against.

**1. It must not be a catalogue.**
A list of agents with GitHub or deployment links is explicitly rejected — "that could
live in a Google Sheet." The standard is *operational access*, not documentation.
His words: "no agent is ever just a link."

**But also: do not deeply integrate into the Studio OS backend first.** Build
something standalone that works, prove it's useful, integrate after. The failure
mode he's guarding against is spending all the time on integration while the thing
remains unproven.

**2. Agents must be genuinely usable.**
One example he gave was that people should be able to download an agent, or use
commands to make it usable. Offered as illustration, not a finalised requirement.

## 3. The fleet — four agents, structurally unalike

This heterogeneity is the central design problem. Any proposal that assumes one
shape is wrong.

| Agent | Owner | What it is | Runtime |
|---|---|---|---|
| `/con` | Sarah (+ Karan) | LinkedIn audit + recommended fixes. Single markdown file. Weekly use. | Claude |
| `/biocraft` | Sarah | Professional bios optimised for LinkedIn. Single markdown file. Weekly use. | Claude |
| UX/QA | Aiden | 10-step engagement, human checkpoints at scenario-matrix approval (step 6) and regression retest (step 9). Needs dedicated test accounts + authenticated browser session. | **Codex** |
| Concierge | Haajar | Runs daily per fellow in the background, **never invoked by anyone**. Drafts portal changes into an approval queue. | Studio OS. Design stage, not built. |

Two of four do not run on Claude. Self-rated quality: 3, 3, 4, 3 — nobody rated
their own agent highly.

`/con` and `/biocraft` were recorded on the inventory form as "not sure" where they
live, with the only copies held personally by Haniyah. **Fixing that is task zero.**

## 4. Architecture decisions — settled, do not relitigate

### 4.1 The directory standardises evidence and change control, not execution

It does not pretend one run surface fits every agent. What is common across the
fleet is: custody of the artifact, version identity, evidence, review, release.

### 4.2 Capability adapters, not archetypes

Declared per agent. Any UI tier or badge is **derived** from these, never structural.

```
runner:          native | api | scheduled | none
usabilityModes[]: hosted-run | download-install | prepared-handoff | approval-queue
evaluator:       golden-case | human-rubric | artifact-checker | downstream-metric
evidence:        trace | submitted-artifact | approval-decision | edit-diff |
                 test-report | manual-attestation
change_surface:  prompt | skill | config | code-version | tool-policy |
                 not-safely-changeable
```

**`runner` and `usabilityModes[]` MUST be separate fields.** `/biocraft` is
`runner: native` with `["hosted-run", "download-install"]`. A single enum forces a
false either/or. This replaces the old `deploymentType` enum, which is structurally
load-bearing in legacy code and needs migrating out.

### 4.3 Four usability modes

| Mode | For | Evidence quality |
|---|---|---|
| **Hosted run** | Simple harness-compatible agents | Best — full trace automatically |
| **Download / install / invoke** | Markdown command agents | Near-zero — runs on their machine |
| **Prepared handoff** | Foreign runtimes (Codex, ChatGPT) | Submitted artifact + human score |
| **Approval queue** | Background agents nobody invokes | Excellent and free — every decision is a judgment |

**Prepared handoff is NOT a link.** It is a package containing: pinned approved
version (commit SHA, not `main`), setup checklist, required accounts, prohibited
actions, the inputs, and a defined return path. What comes back: the agent's output,
a score from the person who ran it, and **the version they actually ran** (pasted
SHA, so a mismatch is visible).

Modes 2 and 3 share a mechanism — both are "take a pinned version elsewhere, run it
where we can't see, come back with the result." Download is a handoff with light
setup and an optional return. **Build the return form once and reuse it.**

**Governing principle:** returning the result is *required* where we have no other
way to see it, *optional* where we do.

### 4.4 Four contracts per agent

| Contract | Status | Contents |
|---|---|---|
| Execution | Mandatory | Inputs, access methods, runner config |
| Evidence | Mandatory | Accepted evidence types, required return artifact |
| Outcome | Mandatory | Success criteria, rubric / eval-set reference |
| Optimisable unit | **Optional** | Pointer to one artifact section or config field |

Keep these compact — short fields and checkboxes, not essay blobs.
`not-safely-changeable` is a valid and normal value for the optimisable unit, and
it must not be required to register an agent.

**Critical guardrail:** the optimisable unit must never become the definition of
quality. For UX/QA we may optimise the scenario-matrix prompt while the **ten-step
engagement remains the evaluated product.** A good matrix score does not mean the
agent is good.

### 4.5 Convex is the single durable authority

- **Convex** — agents, versions, artifacts + hashes, evidence, review events,
  eval sets/cases/results, proposals, entitlements
- **Railway loop service** — transient job state only (in-progress optimisation,
  retries, scratch output). If the process dies, work must be reconstructible from
  Convex or safely restartable.
- **Railway PROPOSES. Convex RATIFIES.** The loop service never releases a version.

Currently built standalone (outside Studio OS) so it can be tested before
integration — but must use the same identity model (Clerk) so users map when folded
in.

### 4.6 The release invariant

The single most important code in the project.

1. **Only an approval mutation sets `currentApprovedVersionId`.** No other path.
2. **No version update mutation exists** — stronger than "versions are immutable."
3. **Every decision appends a review event** with actor + timestamp: approve /
   approve-with-edit / reject / defer.
4. **Actor derived from Clerk identity**, never browser-supplied — otherwise the
   audit trail is forgeable.
5. **Failed guardrail blocks promotion**, regardless of score.
6. Concurrent decisions must be deterministic and idempotent — exactly one
   resulting version, no duplicate snapshots.

### 4.7 The loop is offline prompt regression, not self-improvement

Call it what it is. It can spot repeated failures and propose a fix to one part of
an agent, then test that fix against saved cases. It cannot yet prove a new version
is better at the real job.

Before any version can be promoted:
- Versioned eval set with a **sealed holdout the optimiser can never read**
- Minimum improvement threshold on holdout
- No regression on guardrails, cost, latency — **where those metrics are
  applicable** (a Codex handoff may have no reliable cost telemetry; don't block on
  a fabricated measurement)
- Human approval, always

**Sealed holdout is ceremony below ~12–20 diverse cases.** With five cases, a
two-case holdout proves nothing. The real invariant is narrower: *never let the
optimiser grade itself on the cases it was given.*

### 4.8 Evaluation is decoupled from execution

We can score UX/QA's scenario-matrix prompt from saved inputs without test
credentials, a browser session, or running the engagement.

**This proves that this agent has one component evaluable offline. It does not
prove every complex agent does** — some have no meaningful inner component and no
safe offline proxy.

### 4.9 Shared proposal/review primitive

One primitive: versioned proposal, verdict, decision states, audit history,
notifications. Concierge layers its own payload, scheduling and domain actions on
top. **Shared infrastructure, separate workflows.** Do not merge the workflows.

### 4.10 Structured review events

One **required** edit category from a fixed vocabulary: `factual-correction` ·
`policy-safety` · `tone` · `priority` · `formatting` · `missing-context`
(plus `no-edit` for unchanged approval).

**One required field maximum.** The concierge queue runs daily across all fellows —
if approving takes three clicks the queue backs up and the signal dies entirely.

### 4.11 Amended core principle

Not "you cannot evaluate honestly what you cannot observe." Instead:

> **You can only make claims that match the evidence you control.** Native runs
> yield traces; foreign runtimes yield submitted artifacts and reviewed
> evaluations; background agents yield proposal-and-decision histories.

## 5. Buy vs build — settled by layer

**Composio — adopting.** Tools and delegated auth: just-in-time tool calls, OAuth
lifecycle, sandboxed execution, per-session user-scoped endpoints, runtime-agnostic
(works with Claude and Codex). Solves test credentials without the directory ever
storing secrets.

*What it does NOT solve:* it will not make a Codex or ChatGPT session observable to
us. Prepared handoff still needs a human-held test account, a checklist, and a
returned report. "Covers the whole fleet" is true for tools and auth, **not** for
observability.

**CrewAI — buy at the harness/factory layer, not for governing the existing fleet.**
CrewAI AMP manages agents that run *on* CrewAI: agent repository, RBAC, audit logs,
HITL approval gates, adaptive optimisation, agents downloadable as code. Genuinely
overlaps the governance spine — *for CrewAI-native agents*. Ours run in Claude,
Codex and Studio OS, so adopting it means rebuilding all four, and for UX/QA that
discards the Codex session and credential handling that **is** the agent.

Their **Flows** (controlled multi-step sequence with state, resumable execution,
human checkpoints) are a real candidate for new complex agents we build and host —
being tested against Concierge.

A2A lets external agents *communicate with* AMP agents. It does not let AMP *govern*
them, and it requires being a running HTTP service with a discoverable agent card —
which a markdown file cannot be.

**Do not force foreign-runtime migration.** UX/QA's value is its Codex-native
browser and credential handling.

## 6. Current state — verified against the repo

### Built and tested (on `main`)
- Node HTTP API — `server/src/http/*`
- Loop engine — `server/src/loop/engine.js`
- File-backed store — `server/src/core/store.js`
- Static front end — `index.html`, `app.js`, `api.js`
- Append-only eval history

### Partial
- Four pillars exist (goals · skills · tools · context) but not the four-contract model
- Maker/checker split exists; no optimise/holdout partition, no threshold gate, no
  cost/latency regression check
- `proposedImprovement` is a **single embedded field** on an agent — no proposal
  history, no approve-with-edit or defer, no review events, no notifications

### Not built
- Capability adapters — `deploymentType` enum is still structural
- Evidence contract; explicit contract objects
- Structured edit categories — only free-text `notes` and `knownIssues`
- Composio — no dependency, adapter, or scope declaration anywhere
- Artifact table; immutable version snapshots
- Custody of `/con` and `/biocraft` — **not in the repo**

### Contradicted
- **Convex is unwired draft.** Front end uses `localStorage`; loop service uses JSON
  files; Convex schema connects to neither. **Three stores, no authority.**
- **Four promotion bypasses exist on Railway:** `approveImprovement`, `runCycle`
  auto-apply, `runGoal` shipping, and unrestricted agent replacement/version edits.
  `LOOP_AUTOAPPLY` defaults off but can still be *enabled* for L2–L4 agents.

### Open branch — READ BEFORE PLANNING ANY EXECUTION WORK
**PR #2, `feat/invocation-usable`** (Karan, +223/−4, 11 files). Adds an invocation
seam: `server/src/invoke/` with http/mock/mcp/runtime/manual adapters,
`svc.runAgent()`, `POST /api/agents/:id/run`, and a front-end panel with Open /
Copy prompt / **Copy as SKILL.md** / Run form.

**This means hosted run and download/export partly EXIST.** Do not plan them as
from-scratch builds.

Blockers on that PR:
- **P1 SSRF** — persisted invocation URL flows from an unauthenticated agent PUT
  straight into server-side `fetch` with no destination validation. Needs an
  allowlist rejecting private, loopback, link-local and redirect-resolved internal
  addresses.
- **P1 silent failure** — `runAgent` converts invocation exceptions into normal
  return values, so the route responds 201 and the UI shows the exception under
  "Output" with a trace-recorded success indicator. **Failed runs record as
  successes**, which poisons the evidence the loop depends on.
- `invocation.type` is single-valued — same false either/or as `deploymentType`.
  Needs to be an array.
- Greptile: 2/5 against a required 4/5. Cannot merge as-is.
- Vercel blocks deployment — Karan isn't on the Utopia Vercel team.

## 7. Known traps

1. **`store.query` takes arbitrary JavaScript predicates**
   (`server/src/core/loopService.js`). Convex has no equivalent. Migration is a
   rewrite around named repository operations — "read approved version", "append
   evidence", "create candidate proposal" — **not** a store swap.

2. **The Google Form's 17 questions are not a schema.** They produced descriptive
   metadata. Import responses as source material to map *from*, or you inherit
   `deploymentType` thinking.

3. **Version drift on downloads is real and cannot be hidden.** If someone installs
   v2 and we publish v3, we cannot reach into their Claude and update a file. Honest
   model: artifacts immutable and visibly versioned; v3 marked current, v2
   superseded; downloaded usage is not treated as current-version evidence unless
   the receipt identifies its version.

4. **The directory must never store credentials.** UX/QA needs test accounts;
   agents declare required accounts and scopes, Composio owns the auth lifecycle.

5. **Evidence retention is unresolved.** `/con` and `/biocraft` touch fellow
   LinkedIn profiles and Google Drive folders. Decide what fellow data may land in
   evidence records, who can see it, and for how long — before building unbounded
   retention.

6. **Conditional rubric criteria need N/A.** Aiden's rubric has criteria that only
   apply sometimes. Without N/A plus a normalised total, scores aren't comparable
   across cases.

## 8. Explicitly out of scope

- Arbitrary code execution or container sandboxing. `native` runner = model calls
  plus registry tools only.
- Per-agent custom UI.
- Deep Studio OS provisioning.
- Entitlements logic (schema only for now).
- Rebuilding working Codex or ChatGPT agents to fit our runtime.

## 9. Open questions and who owns them

| Question | Owner | Blocks |
|---|---|---|
| Approval policy — who approves, who can approve-with-edit, emergency revoke path | Karan | Enforcing approver roles |
| Clerk identity model; Composio project/account ownership; who owns shared test accounts | Oliver (on leave) | Composio as production dependency |
| The three UX/QA test runs he's already done | Aiden | Real eval cases instead of synthetic |
| `/biocraft` rubric + 3–4 real examples | Sarah | Scoring hosted runs |
| Canonical artifact storage — Git, Convex file storage, or both | Oliver | Custody model |

## 10. People

- **Karan Pinto** — studio lead. Set the two constraints. Author of PR #2.
- **Oliver** — supervisor. Rebuilt the backend around the AI-native thesis. On leave.
- **James** — co-scoping the underlying model and harness with Oliver.
- **Haajar** — building Concierge. Will consume the shared proposal/review primitive.
- **Aiden** — owns UX/QA agent; applying the ceramic design system.
- **Sarah** — owns `/con` and `/biocraft`.
- **Corran** — joining to push toward user-ready launch.
- **Conn** — Granola API admin access.

## 11. Roadmap

- **v1** — Studio-side catalogue + request pipeline *(deployed)*
- **v1.5** — Custody, version authority, evidence, usability modes *(current)*
- **v2** — Two-sided directory: fellows access, provisioning mirroring the modules
  flow, token system
- **v3** — Agent factory *(blocked on the model-layer decision)*

## 12. How to use this file

**Ask before deviating from a §4 decision** — they were each reached by working
through a specific failure, and the reasoning isn't always visible from the code.

**Verify §6 against the repo before planning.** It was accurate on 29 Jul 2026 and
will drift. If you can't confirm something from the code, say UNVERIFIED rather
than assuming.

**Roles:** Claude is project manager (design, specs, sequencing, comms). Codex is
code manager (audit, verification, adversarial review). Cursor is builder
(implementation). One writes, one reviews — never both writing the same code.