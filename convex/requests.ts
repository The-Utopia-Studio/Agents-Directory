import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { nextDisplayId, todayIso } from "./lib/helpers";
import {
  requestPriority,
  requestStatus,
} from "./lib/validators";

export const listRequests = query({
  args: {
    status: v.optional(requestStatus),
    priority: v.optional(requestPriority),
  },
  handler: async (ctx, args) => {
    let rows;
    if (args.status !== undefined) {
      rows = await ctx.db
        .query("requests")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
      if (args.priority !== undefined) {
        rows = rows.filter((r) => r.priority === args.priority);
      }
    } else if (args.priority !== undefined) {
      rows = await ctx.db
        .query("requests")
        .withIndex("by_priority", (q) => q.eq("priority", args.priority!))
        .collect();
    } else {
      rows = await ctx.db.query("requests").collect();
    }
    return rows;
  },
});

export const createRequest = mutation({
  args: {
    title: v.string(),
    desc: v.string(),
    requestedBy: v.string(),
    priority: requestPriority,
    date: v.optional(v.string()), // ISO; defaults to today
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("requests").collect();
    const displayId = nextDisplayId(
      existing.map((r) => r.displayId),
      "R",
    );
    return await ctx.db.insert("requests", {
      displayId,
      title: args.title.trim(),
      desc: args.desc.trim(),
      requestedBy: args.requestedBy.trim(),
      date: args.date || todayIso(),
      priority: args.priority,
      status: "Requested",
      notes: "",
      assignee: "",
      shippedAgentId: null,
    });
  },
});

export const updateRequest = mutation({
  args: {
    id: v.id("requests"),
    status: v.optional(requestStatus),
    priority: v.optional(requestPriority),
    assignee: v.optional(v.string()),
    notes: v.optional(v.string()),
    title: v.optional(v.string()),
    desc: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const req = await ctx.db.get(args.id);
    if (!req) throw new Error(`Request ${args.id} not found`);
    const { id, ...rest } = args;
    const patch: Record<string, unknown> = {};
    if (rest.status !== undefined) patch.status = rest.status;
    if (rest.priority !== undefined) patch.priority = rest.priority;
    if (rest.assignee !== undefined) patch.assignee = rest.assignee.trim();
    if (rest.notes !== undefined) patch.notes = rest.notes.trim();
    if (rest.title !== undefined) patch.title = rest.title.trim();
    if (rest.desc !== undefined) patch.desc = rest.desc.trim();
    await ctx.db.patch(id, patch);
    return id;
  },
});
