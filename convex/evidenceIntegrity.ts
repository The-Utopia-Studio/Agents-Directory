// The invariant: no evidence row may be both service-written and
// promotion-eligible.
//
// One row currently violates it — an A7 row against biocraft-singleshot-v6
// (digest a8c08f4e…) carrying actorKind "service" with eligibleForPromotion
// true. No code path can produce that combination today; it predates
// eligibilityFor taking its present form. It is inert against v10/v4 because
// the promotion gate matches evidence to a candidate through evalResults by
// agentVersionId, and this row is pinned to v6.
//
// It is still the single standing counter-example to a rule the release path
// now depends on, and "there is one row that says otherwise" is how an
// invariant quietly stops being one. Evidence is insert-only, so the
// correction is recorded on the row rather than rewriting what it claimed.

import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireApprover } from "./lib/auth";

export const SERVICE_PROMOTION_FOSSIL_REASON =
  "Corrected by the eligibilityFor rule that derives promotion eligibility from " +
  "writer kind: a declared-service writer is never promotion-eligible, because a " +
  "release case needs a human somewhere or the loop builds its own promotion " +
  "dossier. This row predates that rule and could not be written today.";

/** Rows that violate the service/promotion invariant. */
function violations(rows: Array<Doc<"evidence">>) {
  return rows.filter(
    (row) => row.actorKind === "service" && row.eligibleForPromotion === true,
  );
}

async function allEvidence(ctx: QueryCtx) {
  return await ctx.db.query("evidence").collect();
}

/**
 * Read-only audit. Returns every row holding service + promotion-eligible.
 * Public so the invariant can be checked without write access.
 */
export const listServicePromotionViolations = query({
  args: {},
  handler: async (ctx) => {
    const bad = violations(await allEvidence(ctx));
    return {
      violationCount: bad.length,
      holds: bad.length === 0,
      violations: bad.map((row) => ({
        evidenceId: row._id,
        agentId: row.agentId,
        agentVersionId: row.agentVersionId,
        declaredArtifactDigest: row.declaredArtifactDigest,
        occurredAt: row.occurredAt,
        alreadyCorrected: Boolean(row.eligibilityCorrection),
      })),
    };
  },
});

/**
 * Backfill every violating row to eligibleForPromotion: false, recording what
 * it previously claimed and which rule corrected it.
 *
 * Approver-only: this changes what evidence is admissible for a release.
 * Idempotent — a row already carrying an eligibilityCorrection is left alone,
 * so re-running cannot stack corrections or rewrite the original claim twice.
 */
export const backfillServicePromotionEligibility = mutation({
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireApprover(ctx);
    const reason = (args.reason || SERVICE_PROMOTION_FOSSIL_REASON).trim();
    if (!reason) {
      throw new ConvexError({
        code: "CORRECTION_REASON_REQUIRED",
        status: 422,
        message:
          "CORRECTION_REASON_REQUIRED: a correction with no stated reason is a silent rewrite",
      });
    }
    const now = Date.now();
    const corrected: Array<{ evidenceId: string; digest: string }> = [];
    for (const row of violations(await allEvidence(ctx))) {
      if (row.eligibilityCorrection) continue;
      await ctx.db.patch(row._id, {
        eligibleForPromotion: false,
        eligibilityCorrection: {
          previousEligibleForPromotion: true,
          reason,
          correctedBy: actor,
          correctedAt: now,
        },
      });
      corrected.push({
        evidenceId: row._id,
        digest: row.declaredArtifactDigest,
      });
      console.warn(
        `[evidence] corrected service+promotion row ${row._id} ` +
          `(digest ${row.declaredArtifactDigest.slice(0, 12)}): ${reason}`,
      );
    }
    const remaining = violations(await allEvidence(ctx));
    return {
      correctedCount: corrected.length,
      corrected,
      invariantHolds: remaining.length === 0,
      remainingViolations: remaining.length,
    };
  },
});
