import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  requireActorOrApprover,
  requireApprover,
  requireIdentity,
  type AuthorityActor,
} from "./lib/auth";
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
  objective: v.optional(v.string()),
  whenToUse: v.optional(v.string()),
  sop: v.optional(v.string()),
  outputs: v.optional(v.array(v.string())),
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

// This is deliberately a field allowlist, not a body spread. Identity,
// display-id, version, release, and artifact fields do not appear here.
const editableAgentFields = {
  name: v.optional(v.string()),
  tagline: v.optional(v.string()),
  description: v.optional(v.string()),
  platform: v.optional(platform),
  status: v.optional(agentStatus),
  category: v.optional(category),
  owner: v.optional(v.string()),
  model: v.optional(v.string()),
  objective: v.optional(v.string()),
  whenToUse: v.optional(v.string()),
  sop: v.optional(v.string()),
  outputs: v.optional(v.array(v.string())),
  runner: v.optional(runner),
  usabilityModes: v.optional(v.array(usabilityMode)),
  invocation: v.optional(invocation),
  autonomyLevel: v.optional(autonomyLevel),
  executionContract: v.optional(executionContract),
  evidenceContract: v.optional(evidenceContract),
  optimisableUnit: v.optional(optimisableUnit),
  guardrails: v.optional(v.array(guardrailDefinition)),
  successCriteria: v.optional(
    v.array(v.object({ id: v.string(), label: v.string() })),
  ),
  skills: v.optional(v.array(v.string())),
  tools: v.optional(v.array(toolItem)),
  context: v.optional(v.array(contextItem)),
  accessUrl: v.optional(v.string()),
  repoUrl: v.optional(v.string()),
};

function cleanText(value: string) {
  return value.trim();
}

async function isArtifactBacked(ctx: any, agent: any): Promise<boolean> {
  if (
    agent.optimisableUnit?.kind !== "artifact" &&
    agent.optimisableUnit?.kind !== "artifact-section"
  ) {
    return false;
  }
  if (!agent.currentApprovedVersionId) return false;
  const version = await ctx.db.get(agent.currentApprovedVersionId);
  return Boolean(version?.artifact);
}

function sameIdentity(
  left: AuthorityActor | undefined,
  right: AuthorityActor | undefined,
) {
  return left?.subject === right?.subject && left?.issuer === right?.issuer;
}

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
      ownerIdentity: actor,
      model: args.model,
      objective: args.objective,
      whenToUse: args.whenToUse,
      sop: args.sop,
      outputs: args.outputs,
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

/** Directory metadata only. Versions and release state have separate mutations. */
export const updateAgent = mutation({
  args: { agentId: v.id("agents"), ...editableAgentFields },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error(`Agent ${args.agentId} not found`);
    await requireActorOrApprover(ctx, agent.ownerIdentity, "Editing this agent");

    const { agentId, successCriteria, guardrails, ...rest } = args;
    const supplied = [...Object.values(rest), successCriteria, guardrails].some(
      (value) => value !== undefined,
    );
    if (!supplied) throw new Error("At least one editable agent field is required");

    if (rest.runner !== undefined || rest.invocation !== undefined) {
      assertRunnerInvocation(
        rest.runner ?? agent.runner,
        rest.invocation ?? agent.invocation,
      );
    }
    if (rest.usabilityModes !== undefined) {
      assertUsabilityModes(rest.runner ?? agent.runner, rest.usabilityModes);
    }

    if (
      (guardrails !== undefined || successCriteria !== undefined) &&
      (await isArtifactBacked(ctx, agent))
    ) {
      throw new Error(
        "Artifact-backed guardrails and success criteria are read-only; create a new artifact version and review it instead",
      );
    }

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        patch[key] = typeof value === "string" ? cleanText(value) : value;
      }
    }
    if (guardrails !== undefined) patch.guardrails = guardrails;
    if (successCriteria !== undefined) {
      patch.outcomeContract = {
        ...agent.outcomeContract,
        successCriteria,
      };
    }
    await ctx.db.patch(agentId, patch);
    return agentId;
  },
});

/** A claimant proves their own Clerk identity; an approver decides the transfer. */
export const requestOwnershipClaim = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) => {
    const claimant = await requireIdentity(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error(`Agent ${args.agentId} not found`);
    const existing = await ctx.db
      .query("ownershipClaims")
      .withIndex("by_agentId_and_claimant", (q) =>
        q.eq("agentId", args.agentId).eq("claimant.subject", claimant.subject),
      )
      .collect();
    if (
      existing.some(
        (claim) =>
          claim.status === "pending" && claim.claimant.issuer === claimant.issuer,
      )
    ) {
      throw new Error("You already have a pending ownership claim for this agent");
    }
    return await ctx.db.insert("ownershipClaims", {
      agentId: args.agentId,
      claimant,
      expectedOwnerIdentity: agent.ownerIdentity,
      status: "pending",
      requestedAt: Date.now(),
    });
  },
});

export const transferOwnership = mutation({
  args: { claimId: v.id("ownershipClaims") },
  handler: async (ctx, args) => {
    const approver = await requireApprover(ctx);
    const claim = await ctx.db.get(args.claimId);
    if (!claim) throw new Error(`Ownership claim ${args.claimId} not found`);
    if (claim.status !== "pending") throw new Error("Ownership claim is no longer pending");
    const agent = await ctx.db.get(claim.agentId);
    if (!agent) throw new Error(`Agent ${claim.agentId} not found`);
    if (!sameIdentity(agent.ownerIdentity, claim.expectedOwnerIdentity)) {
      await ctx.db.patch(claim._id, {
        status: "stale",
        resolvedBy: approver,
        resolvedAt: Date.now(),
      });
      throw new Error("Ownership changed after this claim was made; request a new claim");
    }
    const now = Date.now();
    await ctx.db.patch(agent._id, { ownerIdentity: claim.claimant });
    await ctx.db.patch(claim._id, {
      status: "accepted",
      resolvedBy: approver,
      resolvedAt: now,
    });
    const eventId = await ctx.db.insert("ownershipEvents", {
      agentId: agent._id,
      claimId: claim._id,
      previousOwnerIdentity: agent.ownerIdentity,
      newOwnerIdentity: claim.claimant,
      transferredBy: approver,
      transferredAt: now,
    });
    return { agentId: agent._id, eventId };
  },
});

export const linkOutcomeEvalSet = mutation({
  args: {
    agentId: v.id("agents"),
    evalSetId: v.id("evalSets"),
  },
  handler: async (ctx, args) => {
    const [agent, evalSet] = await Promise.all([
      ctx.db.get(args.agentId),
      ctx.db.get(args.evalSetId),
    ]);
    if (!agent) throw new Error(`Agent ${args.agentId} not found`);
    await requireActorOrApprover(
      ctx,
      agent.ownerIdentity,
      "Linking this agent's eval set",
    );
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
