import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireIdentity } from "./lib/auth";
import {
  guardrailResult,
  rubricCriterionResult,
} from "./lib/validators";

export const recordEvalResult = mutation({
  args: {
    evalSetId: v.id("evalSets"),
    evalCaseId: v.id("evalCases"),
    agentVersionId: v.id("agentVersions"),
    evidenceId: v.id("evidence"),
    criterionResults: v.array(rubricCriterionResult),
    guardrailResults: v.array(guardrailResult),
  },
  handler: async (ctx, args) => {
    const evaluatedBy = await requireIdentity(ctx);
    const [evalSet, evalCase, version, evidence] = await Promise.all([
      ctx.db.get(args.evalSetId),
      ctx.db.get(args.evalCaseId),
      ctx.db.get(args.agentVersionId),
      ctx.db.get(args.evidenceId),
    ]);
    if (!evalSet) throw new Error(`Eval set ${args.evalSetId} not found`);
    if (!evalCase || evalCase.evalSetId !== args.evalSetId) {
      throw new Error("Eval case must belong to the eval set");
    }
    if (!version || version.agentId !== evalSet.agentId) {
      throw new Error("Version must belong to the evaluated agent");
    }
    if (
      !evidence ||
      evidence.agentVersionId !== args.agentVersionId ||
      !evidence.eligibleForEvaluation ||
      (evidence.source !== "real" && evidence.source !== "imported")
    ) {
      throw new Error("Evidence is not eligible for evaluation");
    }

    const rubricById = new Map(evalSet.rubric.map((item) => [item.id, item]));
    const seenCriteria = new Set<string>();
    let earnedMaximum = 0;
    let applicableMaximum = 0;
    for (const result of args.criterionResults) {
      const criterion = rubricById.get(result.criterionId);
      if (!criterion || seenCriteria.has(result.criterionId)) {
        throw new Error("Criterion results must reference each rubric item once");
      }
      seenCriteria.add(result.criterionId);
      if (result.result.kind === "n/a") {
        if (!criterion.conditional) {
          throw new Error("Only conditional rubric criteria may be N/A");
        }
        continue;
      }
      if (
        result.result.score < 0 ||
        result.result.score > criterion.maxScore
      ) {
        throw new Error("Rubric score is outside the criterion range");
      }
      earnedMaximum += result.result.score;
      applicableMaximum += criterion.maxScore;
    }
    if (seenCriteria.size !== rubricById.size) {
      throw new Error("Every rubric criterion requires a result");
    }
    if (applicableMaximum <= 0) {
      throw new Error("At least one rubric criterion must be applicable");
    }

    const expectedGuardrails = new Set(
      evalSet.guardrails.map((guardrail) => guardrail.id),
    );
    const seenGuardrails = new Set<string>();
    for (const result of args.guardrailResults) {
      if (
        !expectedGuardrails.has(result.guardrailId) ||
        seenGuardrails.has(result.guardrailId)
      ) {
        throw new Error(
          "Guardrail results must reference each configured gate once",
        );
      }
      if (result.evidenceId) {
        const supportingEvidence = await ctx.db.get(result.evidenceId);
        if (
          !supportingEvidence ||
          supportingEvidence.agentVersionId !== args.agentVersionId ||
          !supportingEvidence.eligibleForEvaluation ||
          (supportingEvidence.source !== "real" &&
            supportingEvidence.source !== "imported")
        ) {
          throw new Error(
            "Guardrail evidence must be eligible and belong to the evaluated version",
          );
        }
      }
      seenGuardrails.add(result.guardrailId);
    }
    if (seenGuardrails.size !== expectedGuardrails.size) {
      throw new Error("Every guardrail requires an independent pass/fail result");
    }

    const allGuardrailsPassed = args.guardrailResults.every(
      (result) => result.passed,
    );
    const normalizedScore = (earnedMaximum / applicableMaximum) * 100;
    return await ctx.db.insert("evalResults", {
      evalSetId: args.evalSetId,
      evalCaseId: args.evalCaseId,
      agentVersionId: args.agentVersionId,
      evidenceId: args.evidenceId,
      criterionResults: args.criterionResults,
      earnedMaximum,
      applicableMaximum,
      normalizedScore,
      guardrailResults: args.guardrailResults,
      eligibleForPromotion:
        evidence.eligibleForPromotion &&
        evidence.source === "real" &&
        allGuardrailsPassed,
      evaluatedBy,
      evaluatedAt: Date.now(),
    });
  },
});

export const listForVersion = query({
  args: { agentVersionId: v.id("agentVersions") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("evalResults")
      .withIndex("by_agentVersionId", (q) =>
        q.eq("agentVersionId", args.agentVersionId),
      )
      .collect(),
});

export const listEligibleForPromotion = query({
  args: { agentVersionId: v.id("agentVersions") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("evalResults")
      .withIndex("by_version_and_promotion_eligibility", (q) =>
        q
          .eq("agentVersionId", args.agentVersionId)
          .eq("eligibleForPromotion", true),
      )
      .collect(),
});
