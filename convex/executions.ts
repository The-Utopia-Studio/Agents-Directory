// Execution proof: the service records that a run actually happened, and a
// human's attestation consumes it.
//
// Before this, both evidence mutations took caller-supplied identifiers and
// trusted them. An approver who knew an open candidate's digest could create
// promotion-eligible evidence without ever executing or reading a draft, and
// the release gate would accept it. The gate's central claim — that a human
// saw real output — was asserted, never enforced.
//
// Railway can prove execution because it performed it. It writes these rows as
// the declared service principal. The human's attestation must find and consume
// one. Service proves the run; the human proves the reading.

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import { declaredLoopServiceActor } from "./lib/serviceActor";
import { executionKind, previewSourceKind, providerCost } from "./lib/validators";

/**
 * How long an execution may sit unattested before it stops counting.
 *
 * A run from last month is not evidence that anyone looked at this candidate
 * today. Bounding it stops a stale execution being redeemed long after the
 * artifact, the checks, or the reviewer's memory have moved on.
 */
export const EXECUTION_PROOF_MAX_AGE_MS = 60 * 60 * 1000;

export const EXECUTION_PROOF_REQUIRED = "EXECUTION_PROOF_REQUIRED";

/** Written by Railway with the deploy key — never reachable from a browser. */
export const recordExecution = internalMutation({
  args: {
    displayId: v.string(),
    artifactDigest: v.string(),
    executionKind,
    traceId: v.optional(v.string()),
    cost: v.optional(providerCost),
    // Observed by the service that ran it, not claimed by whoever attests.
    blockingCheckIds: v.optional(v.array(v.string())),
    previewSourceKind: v.optional(previewSourceKind),
  },
  handler: async (ctx, args): Promise<Id<"executionRecords">> => {
    // requireIdentity is deliberately NOT called: the actor is declared, not
    // verified, exactly as hosted-run evidence does it.
    const recordedBy = declaredLoopServiceActor();
    const displayId = args.displayId.trim();
    const digest = args.artifactDigest.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error("artifactDigest must be a sha256 hex digest");
    }
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_displayId", (q) => q.eq("displayId", displayId))
      .unique();
    if (!agent) throw new Error(`No agent ${displayId}`);

    const versions = await ctx.db
      .query("agentVersions")
      .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
      .collect();
    const matches = versions.filter(
      (row) => String(row.artifact?.declaredDigest || "").toLowerCase() === digest,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Execution proof requires exactly one governed version matching the digest; found ${matches.length}. Convex looks up, never creates.`,
      );
    }

    return await ctx.db.insert("executionRecords", {
      agentId: agent._id,
      agentVersionId: matches[0]._id,
      declaredArtifactDigest: digest,
      executionKind: args.executionKind,
      recordedBy,
      ...(args.traceId ? { traceId: args.traceId } : {}),
      ...(args.cost ? { cost: args.cost } : {}),
      ...(args.blockingCheckIds ? { blockingCheckIds: args.blockingCheckIds } : {}),
      ...(args.previewSourceKind ? { previewSourceKind: args.previewSourceKind } : {}),
      occurredAt: Date.now(),
    });
  },
});

/**
 * Find a fresh, unconsumed execution of these bytes and claim it.
 *
 * Called from inside the evidence mutations, in the same transaction as the
 * insert, so an execution cannot be consumed twice by concurrent attestations.
 */
export async function claimExecutionProof(
  ctx: MutationCtx,
  {
    agentVersionId,
    declaredArtifactDigest,
    executionKind: wantKind,
    now = Date.now(),
  }: {
    agentVersionId: Id<"agentVersions">;
    declaredArtifactDigest: string;
    executionKind: "production" | "candidate-preview";
    now?: number;
  },
): Promise<Doc<"executionRecords">> {
  const digest = declaredArtifactDigest.trim().toLowerCase();
  const rows = await ctx.db
    .query("executionRecords")
    .withIndex("by_digest", (q) => q.eq("declaredArtifactDigest", digest))
    .collect();

  const usable = rows
    .filter((row) => row.agentVersionId === agentVersionId)
    .filter((row) => row.executionKind === wantKind)
    .filter((row) => !row.consumedByEvidenceId)
    .filter((row) => now - row.occurredAt <= EXECUTION_PROOF_MAX_AGE_MS)
    .sort((a, b) => b.occurredAt - a.occurredAt);

  if (!usable.length) {
    const anyKind = rows.filter((row) => row.agentVersionId === agentVersionId);
    const unconsumed = anyKind.filter((row) => !row.consumedByEvidenceId);
    const stale = unconsumed.filter(
      (row) => now - row.occurredAt > EXECUTION_PROOF_MAX_AGE_MS,
    );
    const detail = !anyKind.length
      ? "no execution of these bytes has been recorded — run it before attesting it"
      : !unconsumed.length
        ? "every recorded execution of these bytes has already been attested; one execution attests one evidence row"
        : stale.length
          ? `the most recent unconsumed execution is older than ${EXECUTION_PROOF_MAX_AGE_MS / 60000} minutes`
          : `no unconsumed ${wantKind} execution; recorded kinds: ${[...new Set(unconsumed.map((r) => r.executionKind))].join(", ")}`;
    throw new ConvexError({
      code: EXECUTION_PROOF_REQUIRED,
      status: 409,
      message: `${EXECUTION_PROOF_REQUIRED}: ${detail}. Evidence asserts a human saw real output; without a service-recorded execution that claim is unverifiable.`,
    });
  }
  return usable[0];
}

/** Visible so an operator can see what is attestable without attesting it. */
export const listUnconsumedForDigest = query({
  args: { artifactDigest: v.string() },
  handler: async (ctx, args) => {
    const digest = args.artifactDigest.trim().toLowerCase();
    const rows = await ctx.db
      .query("executionRecords")
      .withIndex("by_digest", (q) => q.eq("declaredArtifactDigest", digest))
      .collect();
    const now = Date.now();
    return rows
      .filter((row) => !row.consumedByEvidenceId)
      .map((row) => ({
        executionRecordId: row._id,
        executionKind: row.executionKind,
        occurredAt: row.occurredAt,
        traceId: row.traceId ?? null,
        costUsd: row.cost?.amountUsd ?? null,
        expired: now - row.occurredAt > EXECUTION_PROOF_MAX_AGE_MS,
      }));
  },
});
