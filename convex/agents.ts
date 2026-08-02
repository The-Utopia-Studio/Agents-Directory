import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireIdentity } from "./lib/auth";
import {
  assertRunnerInvocation,
  assertUsabilityModes,
} from "./lib/capabilities";
import { initialsFrom, nextDisplayId } from "./lib/helpers";
import {
  agentStatus,
  artifactReference,
  autonomyLevel,
  category,
  contextItem,
  evidenceContract,
  executionContract,
  guardrailDefinition,
  invocation,
  optimisableUnit,
  outcomeContract,
  platform,
  runner,
  toolItem,
  usabilityMode,
} from "./lib/validators";

const registrationFields = {
  name: v.string(),
  tagline: v.string(),
  description: v.optional(v.string()),
  platform,
  status: agentStatus,
  category,
  owner: v.string(),
  model: v.optional(v.string()),
  runner,
  usabilityModes: v.array(usabilityMode),
  invocation: v.optional(invocation),
  autonomyLevel: v.optional(autonomyLevel),
  executionContract,
  evidenceContract,
  outcomeContract,
  optimisableUnit: v.optional(optimisableUnit),
  guardrails: v.array(guardrailDefinition),
  skills: v.optional(v.array(v.string())),
  tools: v.optional(v.array(toolItem)),
  context: v.optional(v.array(contextItem)),
  accessUrl: v.optional(v.string()),
  repoUrl: v.optional(v.string()),
  draftVersion: v.string(),
  draftArtifact: v.optional(artifactReference),
};

export const listAgents = query({
  args: {
    category: v.optional(category),
    status: v.optional(agentStatus),
  },
  handler: async (ctx, args) => {
    let agents;
    if (args.category !== undefined) {
      agents = await ctx.db
        .query("agents")
        .withIndex("by_category", (q) => q.eq("category", args.category!))
        .collect();
      if (args.status !== undefined) {
        agents = agents.filter((a) => a.status === args.status);
      }
    } else if (args.status !== undefined) {
      agents = await ctx.db
        .query("agents")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      agents = await ctx.db.query("agents").collect();
    }
    return agents;
  },
});

export const getAgent = query({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getApprovedVersion = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent?.currentApprovedVersionId) return null;
    return await ctx.db.get(agent.currentApprovedVersionId);
  },
});

const DIRECTORY_PILOT_DISPLAY_IDS = new Set(["A7", "A8"]);

/**
 * Phase 4 read-only pilot. This deliberately returns only imported A7/A8
 * records and their governed versions; it is not a catalogue query or cutover.
 */
export const listGovernedDirectoryPilot = query({
  args: {},
  handler: async (ctx) => {
    const importedAgents = (await ctx.db.query("agents").collect())
      .filter(
        (agent) =>
          DIRECTORY_PILOT_DISPLAY_IDS.has(agent.displayId) &&
          Boolean(agent.importProvenance),
      )
      .sort((a, b) => a.displayId.localeCompare(b.displayId));

    return await Promise.all(
      importedAgents.map(async (agent) => {
        const versions = await ctx.db
          .query("agentVersions")
          .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
          .collect();
        const governedVersions = versions
          .filter((version) => Boolean(version.importProvenance))
          .sort((a, b) => b.createdAt - a.createdAt);
        const version =
          governedVersions.find(
            (candidate) => candidate._id === agent.currentApprovedVersionId,
          ) ??
          governedVersions[0] ??
          null;
        return { agent, version };
      }),
    );
  },
});

export const registerAgent = mutation({
  args: registrationFields,
  handler: async (ctx, args) => {
    const actor = await requireIdentity(ctx);
    assertRunnerInvocation(args.runner, args.invocation);
    assertUsabilityModes(args.runner, args.usabilityModes);

    if (args.outcomeContract.evalSetId !== null) {
      throw new Error(
        "A newly registered agent cannot reference an eval set before it exists",
      );
    }
    if (!args.draftVersion.trim()) {
      throw new Error("draftVersion is required");
    }
    if (
      args.draftArtifact &&
      (!args.draftArtifact.locator.trim() ||
        !args.draftArtifact.declaredDigest.trim())
    ) {
      throw new Error(
        "Draft artifact locator and declared digest must be non-empty",
      );
    }

    const existing = await ctx.db.query("agents").collect();
    const displayId = nextDisplayId(
      existing.map((a) => a.displayId),
      "A",
    );
    const now = Date.now();
    const agentId = await ctx.db.insert("agents", {
      displayId,
      name: args.name.trim(),
      tagline: args.tagline.trim(),
      description: args.description,
      platform: args.platform,
      status: args.status,
      category: args.category,
      owner: args.owner.trim(),
      initials: initialsFrom(args.owner),
      model: args.model,
      runner: args.runner,
      usabilityModes: args.usabilityModes,
      invocation: args.invocation,
      autonomyLevel: args.autonomyLevel,
      executionContract: args.executionContract,
      evidenceContract: args.evidenceContract,
      outcomeContract: args.outcomeContract,
      optimisableUnit: args.optimisableUnit,
      guardrails: args.guardrails ?? [],
      skills: args.skills ?? [],
      tools: args.tools ?? [],
      context: args.context ?? [],
      accessUrl: args.accessUrl,
      repoUrl: args.repoUrl,
      createdBy: actor,
      createdAt: now,
    });

    const draftVersionId = await ctx.db.insert("agentVersions", {
      agentId,
      version: args.draftVersion.trim(),
      state: "draft",
      artifact: args.draftArtifact,
      createdBy: actor,
      createdAt: now,
    });

    return { agentId, draftVersionId, displayId };
  },
});

export const linkOutcomeEvalSet = mutation({
  args: {
    agentId: v.id("agents"),
    evalSetId: v.id("evalSets"),
  },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    const [agent, evalSet] = await Promise.all([
      ctx.db.get(args.agentId),
      ctx.db.get(args.evalSetId),
    ]);
    if (!agent) throw new Error(`Agent ${args.agentId} not found`);
    if (!evalSet || evalSet.agentId !== args.agentId) {
      throw new Error("Eval set must belong to the same agent");
    }
    await ctx.db.patch(args.agentId, {
      outcomeContract: {
        ...agent.outcomeContract,
        evalSetId: args.evalSetId,
      },
    });
    return args.agentId;
  },
});
