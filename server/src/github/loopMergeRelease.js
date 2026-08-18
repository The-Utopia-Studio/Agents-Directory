// Merged loop/ PR → Convex release. Railway proposes; Convex ratifies. This is
// the step that closes the loop: merging the PR moves currentApprovedVersionId
// with no second human click, so every gate here is load-bearing.
//
// Order matters. Signature, then event shape, then branch prefix, then
// identity, then allowlist — each refusal names itself. Nothing reaches the
// Convex mutation until all of them pass.

export const LOOP_BRANCH_PREFIX = "loop/";
export const LOOP_RELEASE_REPO = "The-Utopia-Studio/utopia-agents";

export class LoopReleaseError extends Error {
  constructor(message, { status = 400, code = "loop_release_failed", recordRefusal = false } = {}) {
    super(message);
    this.name = "LoopReleaseError";
    this.status = status;
    this.code = code;
    // Whether this refusal should also be written to Convex as a review event.
    // False for deliveries that never identified a proposal — there is no row
    // to attach to. True once we know which proposal was denied.
    this.recordRefusal = recordRefusal;
  }
}

/**
 * Ignored, not refused: deliveries this endpoint is not for.
 *
 * A ping, a non-merge PR event, or a PR on a non-loop branch is a normal thing
 * for GitHub to send. It returns 200 with an explicit reason so the delivery
 * log shows why nothing happened — an ignore is still reported, never silent.
 */
function ignored(reason, detail = {}) {
  return { released: false, ignored: true, reason, ...detail };
}

/**
 * Parse the approver allowlist. Unset, empty, or whitespace-only means REFUSE
 * EVERY RELEASE. An empty allowlist is never permissive — that inversion is
 * how a config gap turns into an open door.
 */
export function parseReleaseApprovers(raw) {
  return String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Case-insensitive, whitespace-trimmed, otherwise exact. No prefix matching. */
export function loginIsAllowed(login, allowlist) {
  const candidate = String(login || "").trim().toLowerCase();
  if (!candidate) return false;
  return allowlist.some((entry) => entry.trim().toLowerCase() === candidate);
}

/**
 * The merging human, from the merge event only.
 *
 * `merged_by.id` is the identity — logins are renameable and reusable, so a
 * login-keyed subject can silently re-point at a different person. If GitHub
 * did not report a merger, this returns null and the caller refuses the
 * release. There is no fallback to the PR author, the sender, or the service.
 */
export function resolveMergingIdentity(pullRequest) {
  const mergedBy = pullRequest?.merged_by;
  const id = mergedBy?.id;
  const login = String(mergedBy?.login || "").trim();
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || !login) {
    return null;
  }
  return {
    subject: `github:${id}`,
    issuer: "https://github.com",
    name: login,
    login,
  };
}

/**
 * Classify a delivery without touching any authority.
 * Returns { kind: "ignore" | "release", ... }.
 */
export function classifyDelivery({ eventName, payload }) {
  if (eventName === "ping") {
    return { kind: "ignore", reason: "ping delivery — endpoint reachable, nothing to release" };
  }
  if (eventName !== "pull_request") {
    return { kind: "ignore", reason: `event ${eventName || "(none)"} is not pull_request` };
  }
  const pr = payload?.pull_request;
  if (!pr) {
    return { kind: "ignore", reason: "pull_request payload has no pull_request object" };
  }
  if (payload.action !== "closed") {
    return { kind: "ignore", reason: `pull_request action ${payload.action} is not closed` };
  }
  if (pr.merged !== true) {
    return { kind: "ignore", reason: "pull request was closed without merging" };
  }

  const repo = String(payload.repository?.full_name || "").trim();
  if (repo && repo.toLowerCase() !== LOOP_RELEASE_REPO.toLowerCase()) {
    return {
      kind: "ignore",
      reason: `merged PR is on ${repo}, not ${LOOP_RELEASE_REPO}`,
    };
  }

  const headRef = String(pr.head?.ref || "").trim();
  // Only loop/ branches. A hand-merged PR on any other branch does nothing.
  if (!headRef.startsWith(LOOP_BRANCH_PREFIX)) {
    return {
      kind: "ignore",
      reason: `merged branch ${headRef || "(unknown)"} is not a ${LOOP_BRANCH_PREFIX} branch — hand-merged PRs never release`,
    };
  }

  return {
    kind: "release",
    repo: repo || LOOP_RELEASE_REPO,
    headRef,
    pullRequestNumber: Number(pr.number),
    mergeCommitSha: String(pr.merge_commit_sha || "").trim(),
    pullRequest: pr,
  };
}

/**
 * Handle one webhook delivery end to end.
 *
 * @param {object} args
 * @param {string} args.eventName            X-GitHub-Event
 * @param {object} args.payload              parsed delivery body
 * @param {string[]} args.approverAllowlist  parsed LOOP_RELEASE_APPROVERS
 * @param {(branch: string) => Promise<object|null>} args.findProposalByBranch
 *        Railway-side lookup: loop branch → { proposalId, convexProposalId, agentId }
 * @param {(args: object) => Promise<object>} args.release
 *        Calls Convex reviews.releaseFromMergedLoopPr
 * @param {(args: object) => Promise<object>} args.recordRefusal
 *        Calls Convex reviews.recordReleaseRefusal
 * @param {(args: object) => Promise<void>} [args.onReleased] Railway bookkeeping
 * @param {(msg: string) => void} [args.log]
 */
export async function handleMergedLoopPullRequest({
  eventName,
  payload,
  approverAllowlist,
  findProposalByBranch,
  release,
  recordRefusal,
  onReleased = null,
  log = (msg) => console.warn(msg),
  now = () => Date.now(),
}) {
  const classified = classifyDelivery({ eventName, payload });
  if (classified.kind === "ignore") {
    log(`[loop-release] ignored: ${classified.reason}`);
    return ignored(classified.reason);
  }

  const { repo, headRef, pullRequestNumber, mergeCommitSha, pullRequest } = classified;
  const trigger = {
    kind: "merged-loop-pull-request",
    repo,
    pullRequestNumber,
    headRef,
    mergeCommitSha,
    approverAllowlist,
    observedAt: now(),
  };

  // Which proposal did this branch carry? Resolved before any identity work so
  // that a refusal has a row to attach to.
  const link = await findProposalByBranch(headRef);
  if (!link?.convexProposalId) {
    const message =
      `Merged ${headRef} (PR #${pullRequestNumber}) has no Convex proposal linked — ` +
      `nothing was released and no refusal could be recorded against a proposal. ` +
      `The pointer did not move.`;
    log(`[loop-release] REFUSED loop_release_unlinked_branch: ${message}`);
    throw new LoopReleaseError(message, {
      status: 409,
      code: "loop_release_unlinked_branch",
      recordRefusal: false,
    });
  }
  const { convexProposalId } = link;

  async function refuse(code, message, { onBehalfOf = null, status = 403 } = {}) {
    log(`[loop-release] REFUSED ${code} (PR #${pullRequestNumber} ${headRef}): ${message}`);
    let refusalEvent = null;
    let refusalRecordError = null;
    try {
      refusalEvent = await recordRefusal({
        proposalId: convexProposalId,
        refusalCode: code,
        refusalMessage: message,
        ...(onBehalfOf ? { onBehalfOf } : {}),
        releaseTrigger: trigger,
      });
    } catch (err) {
      // The refusal must never be swallowed by a failure to record it.
      refusalRecordError = err?.message || String(err);
      log(
        `[loop-release] REFUSAL NOT RECORDED IN CONVEX (${code}): ${refusalRecordError}. ` +
          `The refusal itself stands — the pointer did not move.`,
      );
    }
    const error = new LoopReleaseError(message, {
      status,
      code,
      recordRefusal: true,
    });
    error.refusalEvent = refusalEvent;
    error.refusalRecordError = refusalRecordError;
    error.releaseTrigger = trigger;
    throw error;
  }

  if (!mergeCommitSha) {
    await refuse(
      "loop_release_no_merge_sha",
      `Merged PR #${pullRequestNumber} reported no merge_commit_sha. The merge event is the primary evidence; without it the release is refused.`,
      { status: 409 },
    );
  }

  // Identity before authority. An unresolvable merger is a refusal, never a
  // fallback to the service identity presented as a person.
  const identity = resolveMergingIdentity(pullRequest);
  if (!identity) {
    await refuse(
      "loop_release_merger_unresolved",
      `Merged PR #${pullRequestNumber} on ${headRef} did not report a resolvable merged_by user (need numeric id + login). ` +
        `Refusing the release rather than attributing it to the loop service. The pointer did not move.`,
      { status: 403 },
    );
  }

  if (!approverAllowlist.length) {
    await refuse(
      "loop_release_allowlist_unset",
      `LOOP_RELEASE_APPROVERS is unset or empty. An empty allowlist is never permissive: refusing the release of PR #${pullRequestNumber} ` +
        `merged by ${identity.login}. The pointer did not move.`,
      { onBehalfOf: identityForConvex(identity), status: 403 },
    );
  }

  if (!loginIsAllowed(identity.login, approverAllowlist)) {
    await refuse(
      "loop_release_approver_not_allowed",
      `GitHub user ${identity.login} merged PR #${pullRequestNumber} but is not in LOOP_RELEASE_APPROVERS ` +
        `(${approverAllowlist.join(", ")}). The pointer did not move.`,
      { onBehalfOf: identityForConvex(identity), status: 403 },
    );
  }

  // Every gate passed. Convex still applies the promotion-evidence gate and
  // can refuse — that refusal is recorded here too.
  let result;
  try {
    result = await release({
      proposalId: convexProposalId,
      onBehalfOf: identityForConvex(identity),
      releaseTrigger: trigger,
    });
  } catch (err) {
    const raw = err?.message || String(err);
    const code = /PROMOTION_EVIDENCE_REQUIRED/.test(raw)
      ? "loop_release_promotion_evidence_required"
      : "loop_release_convex_refused";
    await refuse(
      code,
      `Convex refused the release of PR #${pullRequestNumber} (${headRef}) merged by ${identity.login}: ${raw}. ` +
        `currentApprovedVersionId was NOT moved.`,
      { onBehalfOf: identityForConvex(identity), status: 409 },
    );
  }

  log(
    `[loop-release] RELEASED PR #${pullRequestNumber} (${headRef}) merge ${mergeCommitSha.slice(0, 7)} ` +
      `on behalf of ${identity.login} — pointer moved to ${result?.resultingVersionId || "(unreported)"}`,
  );

  if (onReleased) {
    await onReleased({
      link,
      identity,
      releaseTrigger: trigger,
      result,
    });
  }

  return {
    released: true,
    ignored: false,
    pullRequestNumber,
    headRef,
    mergeCommitSha,
    approvedBy: { login: identity.login, subject: identity.subject },
    executedBy: {
      subject: "agents-directory-loop",
      issuer: "service:agents-directory",
    },
    proposalId: convexProposalId,
    priorApprovedVersionId: result?.priorApprovedVersionId ?? null,
    resultingVersionId: result?.resultingVersionId ?? null,
    reviewEventId: result?.reviewEventId ?? null,
  };
}

/** Strip the convenience `login` field; Convex stores login in `name`. */
function identityForConvex(identity) {
  return {
    subject: identity.subject,
    issuer: identity.issuer,
    name: identity.name,
  };
}
