import { api } from "../_generated/api";

const authorityApi = api as any;

let evalSetVersion = 1;

/**
 * Test helper: attach one human-authored real eval result that is
 * eligibleForPromotion. Production mutations do not seed this.
 */
/** convex-test harness. Typed loosely on purpose: the generated mutation
 *  signature is generic and does not narrow to a plain (fn, args) call. */
type ConvexTestHarness = {
  run: (fn: (ctx: any) => Promise<any>) => Promise<any>;
  mutation: (...callArgs: any[]) => Promise<any>;
};

export async function seedPromotionEligibleEval(
  t: ConvexTestHarness,
  args: {
    agentId: string;
    agentVersionId: string;
    guardrailPassed?: boolean;
  },
) {
  const actor = {
    subject: "promotion-eval-human",
    issuer: "https://valid-collie-71.clerk.accounts.dev",
    name: "Promotion Eval Human",
  };
  const evidenceId = await t.run(async (ctx) => {
    const version = await ctx.db.get(args.agentVersionId);
    if (!version?.artifact?.declaredDigest) {
      throw new Error("seedPromotionEligibleEval requires a version artifact digest");
    }
    return await ctx.db.insert("evidence", {
      agentId: args.agentId,
      agentVersionId: args.agentVersionId,
      declaredArtifactDigest: version.artifact.declaredDigest,
      type: "run",
      source: "real",
      eligibleForEvaluation: true,
      eligibleForPromotion: true,
      runBy: actor,
      actorKind: "human",
      occurredAt: Date.now(),
    });
  });
  const evalSetId = await t.mutation(authorityApi.evalSets.createEvalSet, {
    agentId: args.agentId,
    name: "Promotion-eligible eval",
    version: evalSetVersion++,
    status: "draft",
    rubric: [
      {
        id: "quality",
        label: "Quality",
        maxScore: 1,
        conditional: false,
      },
    ],
    guardrails: [{ id: "no-secrets", label: "Contains no secrets" }],
  });
  const evalCaseId = await t.mutation(authorityApi.evalSets.createEvalCase, {
    evalSetId,
    name: "Promotion-eligible case",
    fixtureRef: "fixture://promotion-eligible",
    declaredFixtureDigest: "promotion-eligible-digest",
  });
  const evalResultId = await t.mutation(authorityApi.evalResults.recordEvalResult, {
    evalSetId,
    evalCaseId,
    agentVersionId: args.agentVersionId,
    evidenceId,
    criterionResults: [
      { criterionId: "quality", result: { kind: "score", score: 1 } },
    ],
    guardrailResults: [
      {
        guardrailId: "no-secrets",
        passed: args.guardrailPassed !== false,
      },
    ],
  });
  return { evidenceId, evalSetId, evalCaseId, evalResultId };
}

export async function approveWithPromotionEval(
  t: ConvexTestHarness,
  proposalId: string,
) {
  const proposal = await t.run(async (ctx) => {
    const row = await ctx.db.get(proposalId);
    if (!row?.candidateVersionId || !row?.agentId) {
      throw new Error("approveWithPromotionEval requires an open proposal");
    }
    return row;
  });
  await seedPromotionEligibleEval(t, {
    agentId: proposal.agentId,
    agentVersionId: proposal.candidateVersionId,
  });
  return t.mutation(authorityApi.reviews.approve, {
    proposalId,
    editCategory: "no-edit",
  });
}
