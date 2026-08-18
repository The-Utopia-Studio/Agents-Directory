# Who can approve a release

**The approver role is not in this repository.** It exists only as a custom claim
in the Clerk dashboard's `convex` JWT template. Nothing here sets it, nothing
here can verify it is still configured, and a change to it does not appear in
any diff or code review.

This file exists so the answer to "who can approve a release" is written down
somewhere other than a dashboard someone can change silently.

## The claim

`requireApprover` reads a **top-level** `role` claim and requires the exact
string `approver`:

| where | what it does |
|---|---|
| `convex/lib/auth.ts:50` | `if (identity.role !== "approver")` → `FORBIDDEN` / 403 |
| `convex/lib/auth.ts:71` | `requireActorOrApprover` accepts `role === "approver"` |
| `server/src/auth/clerkJwt.js:73` | reads `claims.role`, `""` when absent |
| `server/src/auth/clerkJwt.js:91` | Railway's own approver gate |

## Why only the app can supply it

The claim rides on a **named** Clerk JWT template, not the default session token.

- `frontend/clerkAuth.js` requests it: `getToken({ template: "convex" })`
- `convex/auth.config.ts` accepts it: `applicationID: "convex"`, matched against `aud`
- Railway requires the same audience: `CLERK_JWT_AUDIENCE`, defaulting to `convex`

Clerk's default `__session` cookie carries `sub`, `sid`, `iss`, `exp` and a short
TTL — **no `role`**. So anything holding only that token fails `requireApprover`
by construction:

- the Clerk CLI
- the Convex dashboard
- any curl or script using the session cookie

That is not a misconfiguration to fix. It is why the maintainer surface exists:
approver-only mutations are callable **only from inside the signed-in app**,
because that is the only place a `convex`-templated token can be minted.

## Where it is configured

Clerk dashboard → JWT Templates → **`convex`** → Claims. The custom claim is
roughly:

```json
{ "role": "{{user.public_metadata.role}}" }
```

with `public_metadata.role = "approver"` set per user. Granting or revoking
approver is a Clerk change, not a code change — deliberately, so adding an
approver is not a deploy. The cost is that it is invisible here.

**If the claim is removed or renamed, every release path fails closed** with
`FORBIDDEN`, and the maintainer panel reports which claim is missing rather than
rendering a dead button. Failing closed is correct; failing *silently* would not
be, which is why the panel decodes the token it is about to send and says what
it found.

## There are TWO approver sets, and they can drift

| path | authority | configured in |
|---|---|---|
| UI approve / maintainer panel | Clerk `role: "approver"` | Clerk dashboard, `convex` template |
| Merged `loop/` PR release | GitHub login in `LOOP_RELEASE_APPROVERS` | Railway env var |

Same root cause: the merge-release webhook cannot obtain a `convex`-templated
token either, so it could not reuse `requireApprover` and needed its own
allowlist. See `docs/MERGED_PR_RELEASE.md`, which records that allowlist as a
**temporary** mechanism.

Someone can be an approver on one path and not the other, and nothing detects
it. The intended end state — a GitHub → Clerk approver mapping so one set
governs both — is recorded in `MERGED_PR_RELEASE.md` and is still open.

## What would make this checkable

Not done, listed so it is not rediscovered:

- a startup or health assertion that the configured template still yields a
  `role` claim for a known approver
- an audit query listing which Clerk subjects currently carry `approver`
- the GitHub → Clerk mapping that collapses the two sets into one

## CLOSED: preview evidence has no execution proof

`recordCandidatePreviewEvidence` creates **promotion-eligible** evidence from
caller-supplied identifiers alone. It verifies that the digest resolves to a
governed candidate, that an open proposal references it, and that it is not
already approved — but **nothing binds the row to a preview having actually
run**.

An approver who knows an open candidate's digest can mint promotion-eligible
evidence without ever executing or reading a draft. The release gate then
accepts a candidate nobody previewed.

The same gap exists on `recordVerifiedHumanRunEvidence`: the browser asserts
"a human saw output" and Convex takes that on trust.

Mitigated, not closed: both mutations now require an **approver**, so the blast
radius is the approver set rather than every authenticated user. That is a
smaller set, not a proof.

**Closing it properly** needs the execution to leave a durable record Convex can
check. The shape that fits the existing identity model:

1. Railway, after a successful preview, writes a `previewExecutions` row as the
   **service** principal — digest, artifact version, trace id, cost, timestamp.
   The service can prove execution because it performed it.
2. `recordCandidatePreviewEvidence` requires a recent, unconsumed row matching
   the digest, and marks it consumed so one preview cannot attest twice.
3. The human's act still supplies `actorKind: "human"` and `runBy`.

Service proves the run happened; the human proves they read it. Neither alone
is sufficient, which is the property the promotion gate was supposed to have.

**Built.** `executionRecords` holds service-authored proof; both evidence
mutations call `claimExecutionProof`, which requires a fresh unconsumed record
matching the digest AND the execution kind, then marks it consumed in the same
transaction as the insert. Proof expires after
`EXECUTION_PROOF_MAX_AGE_MS` (1 hour) — a run from last month is not evidence
that anyone looked at this candidate today.

Remaining limitation, stated so it is not mistaken for closed: the proof shows
that the service EXECUTED these bytes and that a named human attested within
the window. It does not show the human read the output. Nothing in software
can show that. What changed is that the claim is now bounded by a real
execution instead of resting entirely on the caller's word.
