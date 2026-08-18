# Merged loop/ PR → Convex release

Merging a `loop/` PR on `The-Utopia-Studio/utopia-agents` moves
`currentApprovedVersionId` in Convex. There is no second human click.

Until this existed there were two severed approve paths: Convex `reviews.approve`
moved the pointer but opened no PR, and Railway `approveImprovement` opened a PR
but never moved the pointer. The loop did not close. This closes it.

Railway PROPOSES, Convex RATIFIES — unchanged. Railway resolves and checks;
Convex is still the only thing that can move the pointer, and it re-applies its
own gates regardless of what Railway decided.

## LOOP_RELEASE_APPROVERS is temporary

> **This env var is a stopgap. The intended end state is a GitHub → Clerk
> approver mapping, so one approver set governs both the UI approve button and
> the merge path.**

The reason a second set exists at all is recorded in
[APPROVER_IDENTITY.md](APPROVER_IDENTITY.md): the Clerk `approver` role rides on
a named `convex` JWT template that only a live browser session can mint, so the
merge webhook could not reuse `requireApprover`.

Today there are two approver sets that can drift:

| Path | Authority |
|---|---|
| UI approve button (`reviews.approve`) | Clerk identity with top-level `role: "approver"` |
| Merged loop/ PR (`reviews.releaseFromMergedLoopPr`) | GitHub login in `LOOP_RELEASE_APPROVERS` |

Someone can be an approver on one path and not the other, and nothing in the
system notices. The mapping table was deferred deliberately — it is a schema
decision, and the flow was proven first — but it is the thing that retires this
file's central caveat. Do not let the env var quietly become permanent.

Until then, every release records the allowlist that was in force
(`reviewEvents.releaseTrigger.approverAllowlist`), so widening the env var later
cannot rewrite what governed a past release.

### Rules

- Unset, empty, or whitespace-only **refuses every release**. An empty allowlist
  is never permissive. Asserted in `server/test/loop-merge-release.test.js` and
  again in Convex (`RELEASE_ALLOWLIST_EMPTY`).
- Logins compare case-insensitively and whitespace-trimmed, otherwise exactly.
  No prefix or substring matching — `haniyahumair2` is a different person.
- A rejected login is logged **and** written to Convex as a `release-refused`
  review event. A refusal that exists only in a log nobody reads is a silent skip.

## Identity

A merged PR produces no Clerk session, and none is fabricated.

```
reviewEvents {
  actor:      { subject: "agents-directory-loop", issuer: "service:agents-directory" }
  actorKind:  "service"
  onBehalfOf: { subject: "github:4242", issuer: "https://github.com", name: "haniyahumair" }
  releaseTrigger: { pullRequestNumber, mergeCommitSha, headRef, approverAllowlist, ... }
}
```

- `actor` is the service, because a service act is recorded as a service act.
- `onBehalfOf` is **required** on any service-written row that moves the pointer.
  A service approval with no resolved human fails validation and does not
  persist (`assertServiceReviewIdentity`). It is omitted only on a
  `release-refused` row where identity resolution is itself what failed.
- The subject is the GitHub **numeric id**, not the login. Logins are renameable
  and reusable; a login-keyed subject can silently re-point at a different person.
  The login travels in `name` for reading, never as identity.
- The merge event is the primary evidence, not the identity derived from it. The
  GitHub identity is reconstructable from `releaseTrigger`; the reverse is not true.

**Anywhere an approving identity is displayed or serialised, the human in
`onBehalfOf` must be shown with equal prominence to `actor`.** "One field
removed" is only a problem if a reader reads one field.

## Gates, in order

Each one refuses by name. Nothing reaches the Convex mutation until all pass.

| # | Gate | Refusal code | Recorded in Convex? |
|---|---|---|---|
| 1 | HMAC over the raw body (`X-Hub-Signature-256`) | `webhook_signature_*` | no — no proposal identified |
| 2 | Event is a merged `pull_request` on utopia-agents | *(ignored, 200 + reason)* | no |
| 3 | Branch starts `loop/` | *(ignored, 200 + reason)* | no |
| 4 | Branch links to a Convex proposal | `loop_release_unlinked_branch` | no — nothing to attach to |
| 5 | No sealed holdout material on the proposal | `sealed_material_in_release` | no |
| 6 | `merge_commit_sha` present | `loop_release_no_merge_sha` | **yes** |
| 7 | `merged_by` resolves to numeric id + login | `loop_release_merger_unresolved` | **yes** (no `onBehalfOf`) |
| 8 | Allowlist non-empty | `loop_release_allowlist_unset` | **yes** |
| 9 | Merging login on the allowlist | `loop_release_approver_not_allowed` | **yes** |
| 10 | Convex promotion-evidence gate | `loop_release_promotion_evidence_required` | **yes** |
| 11 | Convex guardrail gate | `loop_release_convex_refused` | **yes** |

Refusals are recorded by a **separate** mutation (`reviews.recordReleaseRefusal`).
Convex mutations are transactional: a refusal written inside the failing release
would roll back with it and leave no trace.

`release-refused` is **not terminal**. The proposal keeps its status, the pointer
stays put, and a corrected merge can still release later.

## Sealed holdout material

`assertProposalCarriesNoSealedMaterial` runs on the release path independently of
the maker-side P3 guard. The release path reaches the proposal by a different
route — merge webhook → branch → stored proposal — and a guard that only covers
the maker's input does not cover it.

It catches three ways sealed material could ride along: the case id, verbatim
sealed source text, and verbatim canned bad output. Text comparison collapses
whitespace, so re-wrapped material is still caught.

## Configuration

| Variable | Effect if unset |
|---|---|
| `GITHUB_WEBHOOK_SECRET` | Webhook refuses **every** delivery (503). It is the only auth on this route. |
| `LOOP_RELEASE_APPROVERS` | Every release refused. Never permissive. |
| `CONVEX_URL` / `CONVEX_DEPLOY_KEY` | Release refused with `loop_release_convex_unconfigured`. |
| `GITHUB_LOOP_TOKEN` | PRs cannot be opened (pre-existing). |

The webhook route is exempt from the shared `API_TOKEN` gate — GitHub cannot send
our bearer token — and is HMAC-gated instead. It is the only entry in
`SELF_AUTHENTICATED_PATHS` in `server/src/http/router.js`. Nothing is added there
without an equivalent gate of its own.

### GitHub webhook setup

On `The-Utopia-Studio/utopia-agents` → Settings → Webhooks:

- Payload URL: `https://<railway-host>/api/github/webhook`
- Content type: `application/json`
- Secret: the same value as `GITHUB_WEBHOOK_SECRET`
- Events: **Pull requests** only

### Linking a proposal

The webhook maps a merged branch to a Convex proposal via `convexProposalId`
stored on the Railway proposal. Record it after the PR opens:

```
POST /api/agents/:id/improvements/:pid/link-convex-proposal
{ "convexProposalId": "<Convex proposals id>" }
```

An unlinked branch refuses with `loop_release_unlinked_branch` rather than
searching for a plausible proposal — guessing wrong releases the wrong version.

## Invariants this must not break

- `LOOP_AUTOAPPLY` still throws at config import. Not softened.
- Nothing writes to `main`. Every prompt change is still a PR a human merges.
- The loop still never writes the executed prompt directly.
- One proposal, one defect, one PR.
- Identity is never fabricated.
- Fellow material never reaches the maker.
- A failure at any step is visible with a reason.
