import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireIdentity } from "./lib/auth";
import { artifactReference } from "./lib/validators";

async function assertUniqueVersion(
  ctx: MutationCtx,
  agentId: Doc<"agents">["_id"],
  version: string,
) {
  const existing = await ctx.db
    .query("agentVersions")
    .withIndex("by_agentId_and_version", (q) =>
      q.eq("agentId", agentId).eq("version", version),
    )
    .unique();
  if (existing) {
    throw new Error(`Version ${version} already exists for this agent`);
  }
}

export const listForAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("agentVersions")
      .withIndex("by_agentId", (q) => q.eq("agentId", args.agentId))
      .order("desc")
      .collect(),
});

export const getVersion = query({
  args: { versionId: v.id("agentVersions") },
  handler: async (ctx, args) => await ctx.db.get(args.versionId),
});

export const createDraftVersion = mutation({
  args: {
    agentId: v.id("agents"),
    version: v.string(),
    basedOnVersionId: v.optional(v.id("agentVersions")),
    artifact: v.optional(artifactReference),
  },
  handler: async (ctx, args) => {
    const actor = await requireIdentity(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error(`Agent ${args.agentId} not found`);
    const version = args.version.trim();
    if (!version) throw new Error("Version is required");
    await assertUniqueVersion(ctx, args.agentId, version);

    if (args.basedOnVersionId) {
      const base = await ctx.db.get(args.basedOnVersionId);
      if (!base || base.agentId !== args.agentId) {
        throw new Error("Base version must belong to the same agent");
      }
    }

    return await ctx.db.insert("agentVersions", {
      agentId: args.agentId,
      version,
      state: "draft",
      basedOnVersionId: args.basedOnVersionId,
      artifact: args.artifact,
      createdBy: actor,
      createdAt: Date.now(),
    });
  },
});

export const createCandidateVersion = mutation({
  args: {
    agentId: v.id("agents"),
    version: v.string(),
    basedOnVersionId: v.optional(v.id("agentVersions")),
    artifact: artifactReference,
  },
  handler: async (ctx, args) => {
    const actor = await requireIdentity(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error(`Agent ${args.agentId} not found`);
    const version = args.version.trim();
    if (!version) throw new Error("Version is required");
    if (
      !args.artifact.locator.trim() ||
      !args.artifact.declaredDigest.trim()
    ) {
      throw new Error(
        "Candidate versions require an artifact reference and declared digest",
      );
    }
    await assertUniqueVersion(ctx, args.agentId, version);

    if (args.basedOnVersionId) {
      const base = await ctx.db.get(args.basedOnVersionId);
      if (!base || base.agentId !== args.agentId) {
        throw new Error("Base version must belong to the same agent");
      }
    }

    return await ctx.db.insert("agentVersions", {
      agentId: args.agentId,
      version,
      state: "candidate",
      basedOnVersionId: args.basedOnVersionId,
      artifact: args.artifact,
      createdBy: actor,
      createdAt: Date.now(),
    });
  },
});
