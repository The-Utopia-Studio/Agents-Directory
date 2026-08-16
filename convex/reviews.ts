import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireApprover } from "./lib/auth";
import { editCategory } from "./lib/validators";

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
    if (
      evalResults.some((result) =>
        result.guardrailResults.some((guardrail) => !guardrail.passed),
      )
    ) {
      throw new Error("Promotion blocked by a failed guardrail");
    }

    await ctx.db.patch(agent._id, {
      currentApprovedVersionId: candidate._id,
    });
    await ctx.db.patch(proposal._id, { status: "approved" });
    const reviewEventId = await ctx.db.insert("reviewEvents", {
      proposalId: proposal._id,
      decision: "approve",
      actor,
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
