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
