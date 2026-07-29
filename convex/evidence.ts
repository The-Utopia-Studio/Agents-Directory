import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireIdentity } from "./lib/auth";
import { evidenceType, providerCost } from "./lib/validators";

type EvidenceSource = "real" | "mock" | "demo" | "imported";

async function insertEvidence(
  ctx: MutationCtx,
  args: {
    agentVersionId: Doc<"agentVersions">["_id"];
    type:
      | "run"
      | "submitted-artifact"
      | "test-report"
      | "approval-decision"
      | "edit-diff"
      | "manual-attestation"
      | "feedback";
    feedbackForEvidenceId?: Doc<"evidence">["_id"];
    cost?: {
      amountUsd: number;
      provider: string;
      modelId: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  },
  source: EvidenceSource,
) {
  const runBy = await requireIdentity(ctx);
  const version = await ctx.db.get(args.agentVersionId);
  if (!version) throw new Error(`Version ${args.agentVersionId} not found`);
  if (!version.artifact?.declaredDigest) {
    throw new Error(
      "Evidence requires a version with a declared artifact digest",
    );
  }
  const agent = await ctx.db.get(version.agentId);
  if (!agent) throw new Error(`Agent ${version.agentId} not found`);
  if (!agent.evidenceContract.acceptedTypes.includes(args.type)) {
    throw new Error(`Evidence type ${args.type} is not accepted by this agent`);
  }
  if (args.type === "feedback" && !args.feedbackForEvidenceId) {
    throw new Error("Feedback evidence must reference the evidence it evaluates");
  }
  if (args.type !== "feedback" && args.feedbackForEvidenceId) {
    throw new Error("Only feedback evidence may reference another evidence row");
  }
  if (args.feedbackForEvidenceId) {
    const target = await ctx.db.get(args.feedbackForEvidenceId);
    if (!target || target.agentId !== version.agentId) {
      throw new Error("Feedback target must exist and belong to the same agent");
    }
  }
  if (args.cost) {
    if (
      args.cost.amountUsd < 0 ||
      !args.cost.provider.trim() ||
      !args.cost.modelId.trim()
    ) {
      throw new Error("Provider-attributed cost is invalid");
    }
    for (const tokens of [
      args.cost.inputTokens,
      args.cost.outputTokens,
      args.cost.totalTokens,
    ]) {
      if (tokens !== undefined && (!Number.isInteger(tokens) || tokens < 0)) {
        throw new Error("Token counts must be non-negative integers");
      }
    }
  }

  const isSynthetic = source === "mock" || source === "demo";
  return await ctx.db.insert("evidence", {
    agentId: version.agentId,
    agentVersionId: version._id,
    declaredArtifactDigest: version.artifact.declaredDigest,
    type: args.type,
    source,
    eligibleForEvaluation: !isSynthetic,
    eligibleForPromotion: source === "real",
    runBy,
    occurredAt: Date.now(),
    cost: args.cost,
    feedbackForEvidenceId: args.feedbackForEvidenceId,
  });
}

const executionEvidenceArgs = {
  agentVersionId: v.id("agentVersions"),
  type: evidenceType,
  feedbackForEvidenceId: v.optional(v.id("evidence")),
  cost: v.optional(providerCost),
};

export const recordRealExecutionEvidence = internalMutation({
  args: executionEvidenceArgs,
  handler: async (ctx, args) => await insertEvidence(ctx, args, "real"),
});

export const recordMockEvidence = internalMutation({
  args: {
    agentVersionId: v.id("agentVersions"),
    type: evidenceType,
    feedbackForEvidenceId: v.optional(v.id("evidence")),
  },
  handler: async (ctx, args) => await insertEvidence(ctx, args, "mock"),
});

export const recordDemoEvidence = internalMutation({
  args: {
    agentVersionId: v.id("agentVersions"),
    type: evidenceType,
    feedbackForEvidenceId: v.optional(v.id("evidence")),
  },
  handler: async (ctx, args) => await insertEvidence(ctx, args, "demo"),
});

export const recordImportedEvidence = mutation({
  args: {
    agentVersionId: v.id("agentVersions"),
    type: evidenceType,
    feedbackForEvidenceId: v.optional(v.id("evidence")),
  },
  handler: async (ctx, args) => await insertEvidence(ctx, args, "imported"),
});

export const listForVersion = query({
  args: { agentVersionId: v.id("agentVersions") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("evidence")
      .withIndex("by_agentVersionId", (q) =>
        q.eq("agentVersionId", args.agentVersionId),
      )
      .collect(),
});

export const listEligibleForEvaluation = query({
  args: { agentVersionId: v.id("agentVersions") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("evidence")
      .withIndex("by_version_and_eval_eligibility", (q) =>
        q
          .eq("agentVersionId", args.agentVersionId)
          .eq("eligibleForEvaluation", true),
      )
      .collect();
    return rows.filter((row) => row.source === "real" || row.source === "imported");
  },
});

export const listEligibleForPromotion = query({
  args: { agentVersionId: v.id("agentVersions") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("evidence")
      .withIndex("by_version_and_promotion_eligibility", (q) =>
        q
          .eq("agentVersionId", args.agentVersionId)
          .eq("eligibleForPromotion", true),
      )
      .collect();
    return rows.filter((row) => row.source === "real");
  },
});
