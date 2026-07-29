import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireIdentity } from "./lib/auth";
import {
  evalSetStatus,
  guardrailDefinition,
  rubricCriterion,
} from "./lib/validators";

export const createEvalSet = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    version: v.number(),
    status: evalSetStatus,
    rubric: v.array(rubricCriterion),
    guardrails: v.array(guardrailDefinition),
  },
  handler: async (ctx, args) => {
    const actor = await requireIdentity(ctx);
    if (!(await ctx.db.get(args.agentId))) {
      throw new Error(`Agent ${args.agentId} not found`);
    }
    if (!args.name.trim()) throw new Error("Eval set name is required");
    if (!Number.isInteger(args.version) || args.version < 1) {
      throw new Error("Eval set version must be a positive integer");
    }

    const criterionIds = new Set<string>();
    for (const criterion of args.rubric) {
      if (
        !criterion.id.trim() ||
        !criterion.label.trim() ||
        criterion.maxScore <= 0 ||
        criterionIds.has(criterion.id)
      ) {
        throw new Error("Rubric criteria require unique ids and positive maxima");
      }
      criterionIds.add(criterion.id);
    }
    const guardrailIds = new Set<string>();
    for (const guardrail of args.guardrails) {
      if (
        !guardrail.id.trim() ||
        !guardrail.label.trim() ||
        guardrailIds.has(guardrail.id)
      ) {
        throw new Error("Guardrails require unique ids and labels");
      }
      guardrailIds.add(guardrail.id);
    }

    return await ctx.db.insert("evalSets", {
      agentId: args.agentId,
      name: args.name.trim(),
      version: args.version,
      status: args.status,
      rubric: args.rubric,
      guardrails: args.guardrails,
      createdBy: actor,
      createdAt: Date.now(),
    });
  },
});

export const createEvalCase = mutation({
  args: {
    evalSetId: v.id("evalSets"),
    name: v.string(),
    fixtureRef: v.string(),
    declaredFixtureDigest: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireIdentity(ctx);
    if (!(await ctx.db.get(args.evalSetId))) {
      throw new Error(`Eval set ${args.evalSetId} not found`);
    }
    if (
      !args.name.trim() ||
      !args.fixtureRef.trim() ||
      !args.declaredFixtureDigest.trim()
    ) {
      throw new Error(
        "Eval cases require name, fixture reference, and declared digest",
      );
    }
    return await ctx.db.insert("evalCases", {
      evalSetId: args.evalSetId,
      name: args.name.trim(),
      fixtureRef: args.fixtureRef.trim(),
      declaredFixtureDigest: args.declaredFixtureDigest.trim(),
      createdBy: actor,
      createdAt: Date.now(),
    });
  },
});

export const listForAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("evalSets")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .collect(),
});

export const listCases = query({
  args: { evalSetId: v.id("evalSets") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("evalCases")
      .withIndex("by_evalSetId", (q) => q.eq("evalSetId", args.evalSetId))
      .collect(),
});
