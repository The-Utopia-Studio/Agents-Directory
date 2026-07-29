# Convex Authority — Order 1 Snapshot

Updated 29 July 2026. This replaces the earlier localStorage-parity draft.
The catalogue UI remains on localStorage temporarily; that does not make it the
authority for the new version/evidence model.

## Durable authority model

Convex owns these tables:

- `agents` — catalogue identity, canonical `runner`, UI `usabilityModes[]`,
  compact contracts, and the optional approved-version pointer.
- `agentVersions` — immutable draft/candidate snapshots with optional artifact
  reference on drafts and mandatory reference/declared digest on candidates.
- `evidence` — version-linked metadata and provenance only.
- `proposals` — candidate history, separate from agents.
- `reviewEvents` — append-only decision audit schema (mutations land in Order 2).
- `evalSets`, `evalCases`, `evalResults` — versioned rubrics, fixture references,
  normalized N/A scoring, and independent guardrail gates.
- `entitlements` — schema only; no logic this week.
- `requests` — retained for intake compatibility; it cannot ship an agent.

## Capability truth

`runner` is canonical:

- `native` permits `invocation.type` `runtime` or `mock`.
- `api` permits `http` or `mcp`.
- `foreign-runtime-handoff`, `scheduled-worker`, and `none` have no server
  invocation adapter.

`usabilityModes[]` controls what the UI may offer. Registration rejects
incompatible runner/invocation combinations and requires the execution
contract's access methods to match the declared usability modes.

The removed `deploymentType` field is not mapped forward.

## Version and artifact boundary

Registration creates an agent and a `draft` version in one mutation and does
not set `currentApprovedVersionId`. There is no version update mutation.

Artifact storage is deliberately unresolved (Git vs Convex storage vs both).
The schema records a generic scheme, locator, caller-declared digest, and
declared algorithm. It does not store artifact bytes or compute or verify the
digest. Candidate versions require a complete reference/digest claim; drafts
may omit one.

## Evidence provenance

Evidence stores metadata only:

- required `agentVersionId` and declared artifact digest copied from that version;
- `source`: `real | mock | demo | imported`;
- server-derived evaluation/promotion eligibility;
- Clerk-derived operator identity;
- optional provider/model/token-attributed cost;
- optional evidence-to-evidence feedback reference.

There are no input, output, prompt, response, note, or redacted-payload fields.
Retention/access rules for fellow LinkedIn and Drive data remain a blocking
policy decision.

Mock and demo writers are separate internal operations. Both force evaluation
and promotion eligibility false. Eligible readers query the eligibility index
and also allow-list provenance, so synthetic rows cannot enter eval or
promotion inputs by convention or by a client-supplied flag.

## Evaluation

Each rubric criterion result is either a bounded score or `n/a`. Only
conditional criteria may be N/A. `evalResults` persists:

- earned points (`earnedMaximum`);
- applicable maximum;
- normalized percentage;
- independent pass/fail guardrail results.

Eval recording rejects evidence that is synthetic or otherwise evaluation
ineligible. Promotion eligibility is derived and requires real evidence plus
all guardrails passing.

## Identity and environment

Clerk is configured through `CLERK_JWT_ISSUER_DOMAIN`. Authority mutations
derive actors from `ctx.auth.getUserIdentity()`; there is no client actor field.

`.env.example` contains placeholders only. The standalone deployment URL and
deployment name live in ignored `.env.local`. Codegen currently requires the
Clerk issuer to be configured on the Convex deployment before functions can be
uploaded.

## Explicitly deferred

- Approval/reject/defer mutations and release pointer updates (Order 2).
- `approve-with-edit` and artifact byte storage.
- Railway durable writes/service identity (Order 3).
- Front-end migration, hosted runs, feedback UI, and entitlements logic.
