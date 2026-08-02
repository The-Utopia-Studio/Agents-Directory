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
type SyntheticEvidenceSource = Extract<EvidenceSource, "mock" | "demo">;

const A7_DEMO_DISPLAY_ID = "A7";

function syntheticEligibility(_source: SyntheticEvidenceSource) {
  // Synthetic writers own these values. They are deliberately absent from
  // mutation arguments, so no caller can promote demo/mock data by supplying
  // eligibility flags.
  return {
    eligibleForEvaluation: false as const,
    eligibleForPromotion: false as const,
  };
}

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
    if (version.sourcePin?.kind === "git-commit") {
      throw new Error(
        "Foreign-runtime evidence is unavailable: a Git commit source pin is not an artifact content digest, and the evidence-identity model is not yet defined",
      );
    }
    throw new Error(
      "Evidence requires a version with a declared artifact digest",
    );
  }
  const agent = await ctx.db.get(version.agentId);
  if (!agent) throw new Error(`Agent ${version.agentId} not found`);
  if (source === "demo" && agent.displayId !== A7_DEMO_DISPLAY_ID) {
    throw new Error("Demo evidence is restricted to A7");
  }
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
  const eligibility = isSynthetic
    ? syntheticEligibility(source)
    : {
        eligibleForEvaluation: true,
        eligibleForPromotion: source === "real",
      };
  return await ctx.db.insert("evidence", {
    agentId: version.agentId,
    agentVersionId: version._id,
    declaredArtifactDigest: version.artifact.declaredDigest,
    type: args.type,
    source,
    ...eligibility,
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
