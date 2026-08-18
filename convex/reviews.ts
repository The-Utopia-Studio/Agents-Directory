import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireApprover } from "./lib/auth";
import { assertServiceReviewIdentity } from "./lib/serviceActor";
import { actorIdentity, editCategory, releaseTrigger } from "./lib/validators";

type TerminalDecision = "approve" | "reject";

type DecisionResult = {
  proposalId: Id<"proposals">;
  reviewEventId: Id<"reviewEvents">;
  decision: "approve" | "reject" | "defer";
  status: "approved" | "rejected" | "deferred";
  priorApprovedVersionId?: Id<"agentVersions">;
  resultingVersionId?: Id<"agentVersions">;
};

function decisionConflict(message: string): never {
  console.warn(`[reviews] decision conflict: ${message}`);
  throw new ConvexError({
    code: "DECISION_CONFLICT",
    status: 409,
    message,
  });
}

async function proposalEvents(
  ctx: MutationCtx,
  proposalId: Id<"proposals">,
): Promise<Array<Doc<"reviewEvents">>> {
  return await ctx.db
    .query("reviewEvents")
    .withIndex("by_proposalId", (q) => q.eq("proposalId", proposalId))
    .collect();
}

function eventResult(event: Doc<"reviewEvents">): DecisionResult {
  if (
    event.decision !== "approve" &&
    event.decision !== "reject" &&
    event.decision !== "defer"
  ) {
    throw new Error("Canonical decision event has an unsupported decision");
  }
  return {
    proposalId: event.proposalId,
    reviewEventId: event._id,
    decision: event.decision,
    status:
      event.decision === "approve"
        ? "approved"
        : event.decision === "reject"
          ? "rejected"
          : "deferred",
    priorApprovedVersionId: event.priorApprovedVersionId,
    resultingVersionId: event.resultingVersionId,
  };
}

async function terminalResultOrConflict(
  ctx: MutationCtx,
  proposal: Doc<"proposals">,
  requested: TerminalDecision,
): Promise<DecisionResult | null> {
  if (proposal.status !== "approved" && proposal.status !== "rejected") {
    return null;
  }
  const terminalDecision =
    proposal.status === "approved" ? "approve" : "reject";
  if (terminalDecision !== requested) {
    decisionConflict(
      `Proposal already has terminal decision ${terminalDecision}; ${requested} cannot replace it`,
    );
  }
  const event = (await proposalEvents(ctx, proposal._id)).find(
    (candidate) => candidate.decision === terminalDecision,
  );
  if (!event) {
    throw new Error("Terminal proposal is missing its canonical review event");
  }
  return eventResult(event);
}

async function loadDecisionTarget(
  ctx: MutationCtx,
  proposalId: Id<"proposals">,
) {
  const proposal = await ctx.db.get(proposalId);
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
  const [agent, candidate] = await Promise.all([
    ctx.db.get(proposal.agentId),
    ctx.db.get(proposal.candidateVersionId),
  ]);
  if (!agent) throw new Error(`Agent ${proposal.agentId} not found`);
  if (
    !candidate ||
    candidate.agentId !== proposal.agentId ||
    candidate.state !== "candidate"
  ) {
    throw new Error("Proposal candidate is not a valid immutable candidate version");
  }
  return { proposal, agent, candidate };
}

/**
 * Every gate between a candidate and the pointer. Shared verbatim by the human
 * UI path and the merged-PR service path so the two can never drift: the
 * promotion-evidence requirement is the only thing standing between a merged
 * PR and a live version, and it is applied here once.
 */
async function assertReleasableCandidate(
  ctx: MutationCtx,
  {
    proposal,
    agent,
    candidate,
  }: {
    proposal: Doc<"proposals">;
    agent: Doc<"agents">;
    candidate: Doc<"agentVersions">;
  },
): Promise<void> {
  if (agent.currentApprovedVersionId !== proposal.priorApprovedVersionId) {
    decisionConflict(
      "Proposal was based on a different approved version and cannot be released",
    );
  }
  if (
    !candidate.artifact ||
    !candidate.artifact.locator.trim() ||
    !candidate.artifact.declaredDigest.trim()
  ) {
    throw new Error(
      "Unchanged approval requires an immutable artifact reference and declared digest",
    );
  }

  const evalResults = await ctx.db
    .query("evalResults")
    .withIndex("by_agentVersionId", (q) =>
      q.eq("agentVersionId", candidate._id),
    )
    .collect();
  const evidenceRows = await Promise.all(
    evalResults.map((result) => ctx.db.get(result.evidenceId)),
  );
  const hasPromotionEligibleEvidence = evidenceRows.some(
    (evidence) => evidence?.eligibleForPromotion === true,
  );
  if (!hasPromotionEligibleEvidence) {
    throw new ConvexError({
      code: "PROMOTION_EVIDENCE_REQUIRED",
      status: 409,
      message:
        "PROMOTION_EVIDENCE_REQUIRED: candidate has no evalResult whose evidence is eligibleForPromotion",
    });
  }
  if (
    evalResults.some((result) =>
      result.guardrailResults.some((guardrail) => !guardrail.passed),
    )
  ) {
    throw new Error("Promotion blocked by a failed guardrail");
  }
}

export const approve = mutation({
  args: {
    proposalId: v.id("proposals"),
    editCategory,
  },
  handler: async (ctx, args): Promise<DecisionResult> => {
    const actor = await requireApprover(ctx);
    if (args.editCategory !== "no-edit") {
      throw new Error("Unchanged approval requires edit category no-edit");
    }
    const { proposal, agent, candidate } = await loadDecisionTarget(
      ctx,
      args.proposalId,
    );
    const canonical = await terminalResultOrConflict(ctx, proposal, "approve");
    if (canonical) return canonical;

    await assertReleasableCandidate(ctx, { proposal, agent, candidate });

    await ctx.db.patch(agent._id, {
      currentApprovedVersionId: candidate._id,
    });
    await ctx.db.patch(proposal._id, { status: "approved" });
    const reviewEventId = await ctx.db.insert("reviewEvents", {
      proposalId: proposal._id,
      decision: "approve",
      actor,
      actorKind: "human",
      editCategory: args.editCategory,
      priorApprovedVersionId: proposal.priorApprovedVersionId,
      resultingVersionId: candidate._id,
      timestamp: Date.now(),
    });
    return {
      proposalId: proposal._id,
      reviewEventId,
      decision: "approve",
      status: "approved",
      priorApprovedVersionId: proposal.priorApprovedVersionId,
      resultingVersionId: candidate._id,
    };
  },
});

/**
 * Release triggered by a merged loop/ PR on utopia-agents.
 *
 * Called by the loop service with the Convex deploy key — there is no Clerk
 * session and none is fabricated. The row records the loop principal as
 * `actor` with actorKind "service" and the merging GitHub human as
 * `onBehalfOf`; both are always present on an approval or the write is
 * refused. The merge event travels on `releaseTrigger` as primary evidence.
 *
 * This does NOT check the approver allowlist — Railway does that before
 * calling, because a rejected login must never reach a mutation that can move
 * the pointer. What this enforces is that the allowlist in force was recorded.
 */
export const releaseFromMergedLoopPr = internalMutation({
  args: {
    proposalId: v.id("proposals"),
    onBehalfOf: actorIdentity,
    releaseTrigger,
  },
  handler: async (ctx, args): Promise<DecisionResult> => {
    const { actor, onBehalfOf } = assertServiceReviewIdentity({
      decision: "approve",
      onBehalfOf: args.onBehalfOf,
    });
    if (!onBehalfOf) {
      // Unreachable: assertServiceReviewIdentity throws first. Kept so a
      // future edit cannot quietly drop the human and still typecheck.
      throw new Error("Merged-PR release lost its onBehalfOf identity");
    }
    if (!args.releaseTrigger.approverAllowlist.length) {
      throw new ConvexError({
        code: "RELEASE_ALLOWLIST_EMPTY",
        status: 403,
        message:
          "RELEASE_ALLOWLIST_EMPTY: an empty approver allowlist is never permissive; refusing the release",
      });
    }
    if (!args.releaseTrigger.mergeCommitSha.trim()) {
      throw new ConvexError({
        code: "RELEASE_TRIGGER_INCOMPLETE",
        status: 400,
        message:
          "RELEASE_TRIGGER_INCOMPLETE: merge commit SHA is the primary evidence and is missing",
      });
    }
    if (!args.releaseTrigger.headRef.startsWith("loop/")) {
      throw new ConvexError({
        code: "RELEASE_BRANCH_NOT_LOOP",
        status: 403,
        message: `RELEASE_BRANCH_NOT_LOOP: ${args.releaseTrigger.headRef} is not a loop/ branch`,
      });
    }

    const { proposal, agent, candidate } = await loadDecisionTarget(
      ctx,
      args.proposalId,
    );
    const canonical = await terminalResultOrConflict(ctx, proposal, "approve");
    if (canonical) return canonical;

    await assertReleasableCandidate(ctx, { proposal, agent, candidate });

    await ctx.db.patch(agent._id, {
      currentApprovedVersionId: candidate._id,
    });
    await ctx.db.patch(proposal._id, { status: "approved" });
    const reviewEventId = await ctx.db.insert("reviewEvents", {
      proposalId: proposal._id,
      decision: "approve",
      actor,
      actorKind: "service",
      onBehalfOf,
      releaseTrigger: args.releaseTrigger,
      editCategory: "no-edit",
      priorApprovedVersionId: proposal.priorApprovedVersionId,
      resultingVersionId: candidate._id,
      timestamp: Date.now(),
    });
    return {
      proposalId: proposal._id,
      reviewEventId,
      decision: "approve",
      status: "approved",
      priorApprovedVersionId: proposal.priorApprovedVersionId,
      resultingVersionId: candidate._id,
    };
  },
});

/**
 * A merged loop/ PR asked for a release and did not get one.
 *
 * Separate mutation because Convex mutations are transactional: a refusal
 * recorded inside the failing release would roll back with it and leave no
 * trace. The caller catches the failure and calls this. Non-terminal — the
 * proposal keeps its status and the pointer stays where it is.
 *
 * `onBehalfOf` is omitted only when identity resolution is itself what failed.
 */
export const recordReleaseRefusal = internalMutation({
  args: {
    proposalId: v.id("proposals"),
    refusalCode: v.string(),
    refusalMessage: v.string(),
    onBehalfOf: v.optional(actorIdentity),
    releaseTrigger,
  },
  handler: async (ctx, args): Promise<{ reviewEventId: Id<"reviewEvents"> }> => {
    const { actor, onBehalfOf } = assertServiceReviewIdentity({
      decision: "release-refused",
      onBehalfOf: args.onBehalfOf ?? null,
    });
    if (!args.refusalCode.trim() || !args.refusalMessage.trim()) {
      throw new Error(
        "A release refusal requires a code and a message — a refusal with no reason is a silent skip",
      );
    }
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new Error(`Proposal ${args.proposalId} not found`);

    console.warn(
      `[reviews] RELEASE REFUSED ${args.refusalCode} for proposal ${args.proposalId} ` +
        `(PR #${args.releaseTrigger.pullRequestNumber} ${args.releaseTrigger.headRef}): ${args.refusalMessage}`,
    );

    const reviewEventId = await ctx.db.insert("reviewEvents", {
      proposalId: proposal._id,
      decision: "release-refused",
      actor,
      actorKind: "service",
      ...(onBehalfOf ? { onBehalfOf } : {}),
      releaseTrigger: args.releaseTrigger,
      refusalCode: args.refusalCode.trim(),
      refusalMessage: args.refusalMessage.trim(),
      editCategory: "no-edit",
      priorApprovedVersionId: proposal.priorApprovedVersionId,
      timestamp: Date.now(),
    });
    return { reviewEventId };
  },
});

export const reject = mutation({
  args: {
    proposalId: v.id("proposals"),
    editCategory,
  },
  handler: async (ctx, args): Promise<DecisionResult> => {
    const actor = await requireApprover(ctx);
    const { proposal } = await loadDecisionTarget(ctx, args.proposalId);
    const canonical = await terminalResultOrConflict(ctx, proposal, "reject");
    if (canonical) return canonical;

    await ctx.db.patch(proposal._id, { status: "rejected" });
    const reviewEventId = await ctx.db.insert("reviewEvents", {
      proposalId: proposal._id,
      decision: "reject",
      actor,
      editCategory: args.editCategory,
      priorApprovedVersionId: proposal.priorApprovedVersionId,
      timestamp: Date.now(),
    });
    return {
      proposalId: proposal._id,
      reviewEventId,
      decision: "reject",
      status: "rejected",
      priorApprovedVersionId: proposal.priorApprovedVersionId,
    };
  },
});

export const defer = mutation({
  args: {
    proposalId: v.id("proposals"),
    editCategory,
  },
  handler: async (ctx, args): Promise<DecisionResult> => {
    const actor = await requireApprover(ctx);
    const { proposal } = await loadDecisionTarget(ctx, args.proposalId);
    if (proposal.status === "approved" || proposal.status === "rejected") {
      decisionConflict(
        `Proposal already has terminal decision ${proposal.status}; defer cannot replace it`,
      );
    }

    if (proposal.status === "deferred") {
      const existing = (await proposalEvents(ctx, proposal._id)).find(
        (event) =>
          event.decision === "defer" &&
          event.editCategory === args.editCategory,
      );
      if (existing) return eventResult(existing);
    }

    await ctx.db.patch(proposal._id, { status: "deferred" });
    const reviewEventId = await ctx.db.insert("reviewEvents", {
      proposalId: proposal._id,
      decision: "defer",
      actor,
      editCategory: args.editCategory,
      priorApprovedVersionId: proposal.priorApprovedVersionId,
      timestamp: Date.now(),
    });
    return {
      proposalId: proposal._id,
      reviewEventId,
      decision: "defer",
      status: "deferred",
      priorApprovedVersionId: proposal.priorApprovedVersionId,
    };
  },
});

export const approveWithEdit = mutation({
  args: {
    proposalId: v.id("proposals"),
    editCategory,
  },
  handler: async (ctx, _args) => {
    await requireApprover(ctx);
    throw new ConvexError({
      code: "ARTIFACT_STORAGE_NOT_CONFIGURED",
      status: 501,
      message: "artifact storage not configured",
    });
  },
});

export const listForProposal = query({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("reviewEvents")
      .withIndex("by_proposalId", (q) => q.eq("proposalId", args.proposalId))
      .collect(),
});
