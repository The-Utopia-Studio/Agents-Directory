import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireIdentity } from "./lib/auth";

export const createCandidateProposal = mutation({
  args: {
    agentId: v.id("agents"),
    candidateVersionId: v.id("agentVersions"),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireIdentity(ctx);
    const agent = await ctx.db.get(args.agentId);
    if (!agent) throw new Error(`Agent ${args.agentId} not found`);
    const candidate = await ctx.db.get(args.candidateVersionId);
    if (!candidate || candidate.agentId !== args.agentId) {
      throw new Error("Candidate version must belong to the proposed agent");
    }
    if (candidate.state !== "candidate" || !candidate.artifact) {
      throw new Error(
        "A proposal requires an immutable candidate artifact reference and declared digest",
      );
    }
    if (!args.summary.trim()) throw new Error("Proposal summary is required");

    const existing = await ctx.db
      .query("proposals")
      .withIndex("by_candidateVersionId", (q) =>
        q.eq("candidateVersionId", args.candidateVersionId),
      )
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("proposals", {
      agentId: args.agentId,
      priorApprovedVersionId: agent.currentApprovedVersionId,
      candidateVersionId: args.candidateVersionId,
      status: "open",
      summary: args.summary.trim(),
      createdBy: actor,
      createdAt: Date.now(),
    });
  },
});

export const getProposal = query({
  args: { proposalId: v.id("proposals") },
  handler: async (ctx, args) => await ctx.db.get(args.proposalId),
});

export const listOpenForAgent = query({
  args: { agentId: v.id("agents") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("proposals")
      .withIndex("by_agentId_and_status", (q) =>
        q.eq("agentId", args.agentId).eq("status", "open"),
      )
      .collect(),
});
