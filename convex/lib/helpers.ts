/** Shared helpers for Convex directory mutations / fleet health. */

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function initialsFrom(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Days since an ISO (or parseable) date string. Invalid → Infinity. */
export function daysSince(date: string | null | undefined): number {
  if (!date) return Infinity;
  const dt = new Date(date);
  if (Number.isNaN(dt.getTime())) return Infinity;
  return Math.floor((Date.now() - dt.getTime()) / 86400000);
}

/**
 * Mirrors app.js fleetHealth need-review predicate:
 * unevaluated OR status Needs improvement OR score < 70 (null counts) OR stale > 30d.
 */
export function needsReview(agent: {
  lastReviewedAt: string | null;
  latestEvalStatus: string | null;
  latestEvalScore: number | null;
}): boolean {
  if (!agent.lastReviewedAt) return true;
  if (agent.latestEvalStatus === "Needs improvement") return true;
  // Match JS prototype: null < 70 === true (blank score counts as weak)
  if (agent.latestEvalScore === null || agent.latestEvalScore < 70) return true;
  if (daysSince(agent.lastReviewedAt) > 30) return true;
  return false;
}

/** Next "A{n}" / "R{n}" from existing displayIds. */
export function nextDisplayId(
  existing: string[],
  prefix: "A" | "R",
): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of existing) {
    const m = id.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

/** Coerce legacy string[] tools/context or mixed input into structured items. */
export function normalizeTools(
  tools: Array<{ label: string; type?: string; permissions?: string } | string>,
): Array<{ label: string; type?: "mcp" | "api" | "integration" | "other"; permissions?: string }> {
  return tools.map((t) => {
    if (typeof t === "string") return { label: t };
    const out: { label: string; type?: "mcp" | "api" | "integration" | "other"; permissions?: string } = {
      label: t.label,
    };
    if (t.type === "mcp" || t.type === "api" || t.type === "integration" || t.type === "other") {
      out.type = t.type;
    }
    if (t.permissions !== undefined) out.permissions = t.permissions;
    return out;
  });
}

export function normalizeContext(
  context: Array<{ label: string; type?: string; source?: string } | string>,
): Array<{ label: string; type?: "memory" | "doc" | "dataset" | "other"; source?: string }> {
  return context.map((c) => {
    if (typeof c === "string") return { label: c };
    const out: { label: string; type?: "memory" | "doc" | "dataset" | "other"; source?: string } = {
      label: c.label,
    };
    if (c.type === "memory" || c.type === "doc" || c.type === "dataset" || c.type === "other") {
      out.type = c.type;
    }
    if (c.source !== undefined) out.source = c.source;
    return out;
  });
}
