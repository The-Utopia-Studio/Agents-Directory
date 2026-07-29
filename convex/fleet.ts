import { query } from "./_generated/server";

export const getFleetHealth = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    const total = agents.length;
    const approvedVersionIds = agents.flatMap((agent) =>
      agent.currentApprovedVersionId ? [agent.currentApprovedVersionId] : [],
    );
    const resultGroups = await Promise.all(
      approvedVersionIds.map(async (versionId) =>
        await ctx.db
          .query("evalResults")
          .withIndex("by_agentVersionId", (q) =>
            q.eq("agentVersionId", versionId),
          )
          .collect(),
      ),
    );
    const latestResults = resultGroups.flatMap((rows) =>
      rows.length
        ? [rows.reduce((latest, row) =>
            row.evaluatedAt > latest.evaluatedAt ? row : latest,
          )]
        : [],
    );
    const scores = latestResults.map((result) => result.normalizedScore);
    const avg = scores.length
      ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length)
      : 0;
    const coverage = total
      ? Math.round((latestResults.length / total) * 100)
      : 0;
    const proposals = (
      await ctx.db
        .query("proposals")
        .filter((q) => q.eq(q.field("status"), "open"))
        .collect()
    ).length;

    return {
      avg,
      coverage,
      needsReview: total - latestResults.length,
      proposals,
      evaluated: latestResults.length,
      total,
    };
  },
});

/**
 * Categories that currently have ≥1 agent — powers filter chips
 * (mirrors `["All", ...new Set(agents.map(a => a.category))]`).
 */
export const getActiveCategories = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").collect();
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const a of agents) {
      if (!seen.has(a.category)) {
        seen.add(a.category);
        ordered.push(a.category);
      }
    }
    return ordered;
  },
});
