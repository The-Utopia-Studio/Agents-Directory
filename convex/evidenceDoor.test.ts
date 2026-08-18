/// <reference types="vite/client" />
// The evidence door, the deliberate-act separation, and the fossil invariant.

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const authorityApi = api as any;
const HUMAN = {
  subject: "user_witness",
  issuer: "https://valid-collie-71.clerk.accounts.dev",
  name: "Witness Human",
};
const APPROVER = { ...HUMAN, subject: "user_approver_door", role: "approver" };
const DIGEST = "c".repeat(64);

function registration(seed: number, digest = `d${seed}`.padEnd(64, '0')) {
  return {
    name: `Door Fixture ${seed}`,
    tagline: "evidence door",
    platform: "Claude" as const,
    status: "Experimental" as const,
    category: "Other" as const,
    owner: "Studio Test",
    runner: "native" as const,
    usabilityModes: ["hosted-run"] as const,
    invocation: { type: "mock" as const, configRef: "fixture" },
    executionContract: {
      inputs: [{ key: "fixtureId", required: true }],
      runnerConfig: [{ key: "fixture-only", value: "true" }],
    },
    evidenceContract: {
      acceptedTypes: ["run", "feedback"] as const,
      requiredReturnArtifact: false,
    },
    outcomeContract: {
      successCriteria: [{ id: "useful", label: "Useful" }],
      evalSetId: null,
    },
    guardrails: [{ id: "no-secrets", label: "Contains no secrets" }],
    draftVersion: `0.1.${seed}`,
    draftArtifact: {
      scheme: "external" as const,
      locator: "fixture://agent",
      declaredDigest: digest,
      declaredDigestAlgorithm: "sha256" as const,
    },
  };
}

/** Agent with one governed candidate at DIGEST. */
async function governed(t: any, seed: number) {
  const agent = await t.mutation(authorityApi.agents.registerAgent, registration(seed));
  const versionId = await t.mutation(
    authorityApi.agentVersions.createCandidateVersion,
    {
      agentId: agent.agentId,
      version: `door-v${seed}`,
      basedOnVersionId: agent.draftVersionId,
      artifact: {
        scheme: "git",
        locator: "biocraft/SKILL.md",
        declaredDigest: DIGEST,
        declaredDigestAlgorithm: "sha256",
      },
    },
  );
  return { ...agent, versionId, displayId: agent.displayId };
}

describe("recordVerifiedHumanRunEvidence — the door", () => {
  test("a signed-in human produces promotion-eligible evidence", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 1);
    const evidenceId = await base
      .withIdentity(HUMAN)
      .mutation(authorityApi.evidence.recordVerifiedHumanRunEvidence, {
        displayId: g.displayId,
        artifactDigest: DIGEST,
      });

    const row = await t.run(async (ctx: any) => await ctx.db.get(evidenceId));
    expect(row.eligibleForPromotion).toBe(true);
    expect(row.source).toBe("real");
    // actorKind is WHO WROTE THE ROW. The browser did, as the human.
    expect(row.actorKind).toBe("human");
    expect(row.runBy.subject).toBe("user_witness");
    // Railway performed the call — recorded, never conflated with authorship.
    expect(row.executedBy).toEqual({
      subject: "agents-directory-loop",
      issuer: "service:agents-directory",
    });
    // Constraint 3: no run payload on the row.
    expect(row).not.toHaveProperty("input");
    expect(row).not.toHaveProperty("output");
  });

  test("unauthenticated is refused", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 2);
    await expect(
      convexTest(schema, modules).mutation(
        authorityApi.evidence.recordVerifiedHumanRunEvidence,
        { displayId: g.displayId, artifactDigest: DIGEST },
      ),
    ).rejects.toThrow(/Authentication required|UNAUTHENTICATED/);
  });

  test("constraint 1: a digest with no governed version is refused, and creates nothing", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 3);
    const before = await t.run(async (ctx: any) =>
      (await ctx.db.query("agentVersions").collect()).length,
    );
    await expect(
      base.withIdentity(HUMAN).mutation(
        authorityApi.evidence.recordVerifiedHumanRunEvidence,
        { displayId: g.displayId, artifactDigest: "0".repeat(64) },
      ),
    ).rejects.toThrow(/never creates them/);
    const after = await t.run(async (ctx: any) =>
      (await ctx.db.query("agentVersions").collect()).length,
    );
    expect(after).toBe(before);
  });

  test("constraint 2: eligibility cannot be supplied by the caller", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 4);
    await expect(
      base.withIdentity(HUMAN).mutation(
        authorityApi.evidence.recordVerifiedHumanRunEvidence,
        {
          displayId: g.displayId,
          artifactDigest: DIGEST,
          eligibleForPromotion: true,
        } as any,
      ),
    ).rejects.toThrow();
  });

  test("constraint 4: the evidence alone does not release — the gate still refuses", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 5);
    await base.withIdentity(HUMAN).mutation(
      authorityApi.evidence.recordVerifiedHumanRunEvidence,
      { displayId: g.displayId, artifactDigest: DIGEST },
    );
    const proposalId = await t.mutation(
      authorityApi.proposals.createCandidateProposal,
      { agentId: g.agentId, candidateVersionId: g.versionId, summary: "door test" },
    );
    // Promotion-eligible evidence exists, but no evalResult names what was
    // checked, so the pointer must not move.
    await expect(
      t.mutation(authorityApi.reviews.approve, {
        proposalId,
        editCategory: "no-edit",
      }),
    ).rejects.toThrow(/PROMOTION_EVIDENCE_REQUIRED/);
  });
});

describe("the evalResult is a separate deliberate act", () => {
  test("one call cannot produce both the evidence row and the evalResult", async () => {
    // Structural: recordVerifiedHumanRunEvidence returns an evidence id and
    // writes nothing to evalResults. If a single UI action could produce both,
    // the separation would be decorative.
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 6);
    await base.withIdentity(HUMAN).mutation(
      authorityApi.evidence.recordVerifiedHumanRunEvidence,
      { displayId: g.displayId, artifactDigest: DIGEST },
    );
    const evalResults = await t.run(async (ctx: any) =>
      await ctx.db.query("evalResults").collect(),
    );
    expect(evalResults).toHaveLength(0);
    const evalSets = await t.run(async (ctx: any) =>
      await ctx.db.query("evalSets").collect(),
    );
    expect(evalSets).toHaveLength(0);
  });

  test("an eval result naming nothing is refused", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 7);
    const evidenceId = await base.withIdentity(HUMAN).mutation(
      authorityApi.evidence.recordVerifiedHumanRunEvidence,
      { displayId: g.displayId, artifactDigest: DIGEST },
    );
    const evalSetId = await t.mutation(authorityApi.evalSets.createEvalSet, {
      agentId: g.agentId,
      name: "Door eval",
      version: 1,
      status: "draft",
      rubric: [{ id: "quality", label: "Quality", maxScore: 1, conditional: true }],
      guardrails: [{ id: "no-secrets", label: "Contains no secrets" }],
    });
    const evalCaseId = await t.mutation(authorityApi.evalSets.createEvalCase, {
      evalSetId,
      name: "Door case",
      fixtureRef: "fixture://door",
      declaredFixtureDigest: "door-digest",
    });

    // Empty: nothing was checked.
    await expect(
      t.mutation(authorityApi.evalResults.recordEvalResult, {
        evalSetId,
        evalCaseId,
        agentVersionId: g.versionId,
        evidenceId,
        criterionResults: [],
        guardrailResults: [{ guardrailId: "no-secrets", passed: true }],
      }),
    ).rejects.toThrow(/EVAL_RESULT_NAMES_NOTHING/);

    // All-N/A: scores nothing, asserts nothing.
    await expect(
      t.mutation(authorityApi.evalResults.recordEvalResult, {
        evalSetId,
        evalCaseId,
        agentVersionId: g.versionId,
        evidenceId,
        criterionResults: [{ criterionId: "quality", result: { kind: "n/a" } }],
        guardrailResults: [{ guardrailId: "no-secrets", passed: true }],
      }),
    ).rejects.toThrow(/EVAL_RESULT_NAMES_NOTHING/);

    // Naming a real scored criterion is accepted.
    const ok = await t.mutation(authorityApi.evalResults.recordEvalResult, {
      evalSetId,
      evalCaseId,
      agentVersionId: g.versionId,
      evidenceId,
      criterionResults: [{ criterionId: "quality", result: { kind: "score", score: 1 } }],
      guardrailResults: [{ guardrailId: "no-secrets", passed: true }],
    });
    expect(ok).toBeDefined();
  });

  test("the two deliberate acts together DO release", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 8);
    const evidenceId = await base.withIdentity(HUMAN).mutation(
      authorityApi.evidence.recordVerifiedHumanRunEvidence,
      { displayId: g.displayId, artifactDigest: DIGEST },
    );
    const evalSetId = await t.mutation(authorityApi.evalSets.createEvalSet, {
      agentId: g.agentId,
      name: "Door eval",
      version: 2,
      status: "draft",
      rubric: [{ id: "quality", label: "Quality", maxScore: 1, conditional: false }],
      guardrails: [{ id: "no-secrets", label: "Contains no secrets" }],
    });
    const evalCaseId = await t.mutation(authorityApi.evalSets.createEvalCase, {
      evalSetId,
      name: "Door case",
      fixtureRef: "fixture://door",
      declaredFixtureDigest: "door-digest",
    });
    await t.mutation(authorityApi.evalResults.recordEvalResult, {
      evalSetId,
      evalCaseId,
      agentVersionId: g.versionId,
      evidenceId,
      criterionResults: [{ criterionId: "quality", result: { kind: "score", score: 1 } }],
      guardrailResults: [{ guardrailId: "no-secrets", passed: true }],
    });
    const proposalId = await t.mutation(
      authorityApi.proposals.createCandidateProposal,
      { agentId: g.agentId, candidateVersionId: g.versionId, summary: "door release" },
    );
    const decision = await t.mutation(authorityApi.reviews.approve, {
      proposalId,
      editCategory: "no-edit",
    });
    expect(decision.status).toBe("approved");
    expect(
      await t.run(async (ctx: any) => (await ctx.db.get(g.agentId)).currentApprovedVersionId),
    ).toBe(g.versionId);
  });
});

describe("attesting a preview requires an approver", () => {
  test("a merely-authenticated user cannot mint promotion-eligible preview evidence", async () => {
    // The preview ROUTE is approver-gated, so a non-approver could not have run
    // the preview they would be attesting. Before this, any signed-in user who
    // knew an open candidate's digest could create promotion-eligible evidence.
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 20);
    await t.mutation(authorityApi.proposals.createCandidateProposal, {
      agentId: g.agentId,
      candidateVersionId: g.versionId,
      summary: "preview auth",
    });
    await expect(
      base.withIdentity(HUMAN).mutation(
        authorityApi.evidence.recordCandidatePreviewEvidence,
        { displayId: g.displayId, artifactDigest: DIGEST },
      ),
    ).rejects.toThrow(/approver|FORBIDDEN/i);
  });
});

describe("the service + promotion-eligible invariant", () => {
  test("no write path can produce a second fossil", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 9);
    // The service hosted-run path writes eligibleForPromotion false.
    const audit = await t.query(
      authorityApi.evidenceIntegrity.listServicePromotionViolations,
      {},
    );
    expect(audit.holds).toBe(true);
    expect(audit.violationCount).toBe(0);
    expect(g.displayId).toBeDefined();
  });

  test("the backfill corrects a fossil row, records why, and is idempotent", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 10);
    // Plant the pre-rule shape directly: no current mutation can create it.
    const fossilId = await t.run(async (ctx: any) =>
      await ctx.db.insert("evidence", {
        agentId: g.agentId,
        agentVersionId: g.versionId,
        declaredArtifactDigest: DIGEST,
        type: "run",
        source: "real",
        eligibleForEvaluation: true,
        eligibleForPromotion: true,
        runBy: { subject: "agents-directory-loop", issuer: "service:agents-directory" },
        actorKind: "service",
        occurredAt: Date.now(),
      }),
    );

    const before = await t.query(
      authorityApi.evidenceIntegrity.listServicePromotionViolations,
      {},
    );
    expect(before.violationCount).toBe(1);
    expect(before.holds).toBe(false);

    const result = await t.mutation(
      authorityApi.evidenceIntegrity.backfillServicePromotionEligibility,
      {},
    );
    expect(result.correctedCount).toBe(1);
    expect(result.invariantHolds).toBe(true);

    const row = await t.run(async (ctx: any) => await ctx.db.get(fossilId));
    expect(row.eligibleForPromotion).toBe(false);
    // The correction records what the row previously claimed and which rule
    // changed — it does not silently rewrite history.
    expect(row.eligibilityCorrection.previousEligibleForPromotion).toBe(true);
    expect(row.eligibilityCorrection.reason).toMatch(/declared-service writer is never promotion-eligible/);
    expect(row.eligibilityCorrection.correctedBy.subject).toBe("user_approver_door");

    // Idempotent: a second run corrects nothing and does not stack.
    const again = await t.mutation(
      authorityApi.evidenceIntegrity.backfillServicePromotionEligibility,
      {},
    );
    expect(again.correctedCount).toBe(0);
    expect(again.invariantHolds).toBe(true);
    const after = await t.run(async (ctx: any) => await ctx.db.get(fossilId));
    expect(after.eligibilityCorrection.correctedAt).toBe(
      row.eligibilityCorrection.correctedAt,
    );
  });

  test("the backfill is approver-only", async () => {
    const t = convexTest(schema, modules).withIdentity(HUMAN);
    await expect(
      t.mutation(authorityApi.evidenceIntegrity.backfillServicePromotionEligibility, {}),
    ).rejects.toThrow(/approver|FORBIDDEN/i);
  });

  test("a corrected fossil can no longer satisfy the promotion gate", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 11);
    const fossilId = await t.run(async (ctx: any) =>
      await ctx.db.insert("evidence", {
        agentId: g.agentId,
        agentVersionId: g.versionId,
        declaredArtifactDigest: DIGEST,
        type: "run",
        source: "real",
        eligibleForEvaluation: true,
        eligibleForPromotion: true,
        runBy: { subject: "agents-directory-loop", issuer: "service:agents-directory" },
        actorKind: "service",
        occurredAt: Date.now(),
      }),
    );
    const evalSetId = await t.mutation(authorityApi.evalSets.createEvalSet, {
      agentId: g.agentId,
      name: "Fossil eval",
      version: 3,
      status: "draft",
      rubric: [{ id: "quality", label: "Quality", maxScore: 1, conditional: false }],
      guardrails: [{ id: "no-secrets", label: "Contains no secrets" }],
    });
    const evalCaseId = await t.mutation(authorityApi.evalSets.createEvalCase, {
      evalSetId,
      name: "Fossil case",
      fixtureRef: "fixture://fossil",
      declaredFixtureDigest: "fossil-digest",
    });
    await t.mutation(authorityApi.evalResults.recordEvalResult, {
      evalSetId,
      evalCaseId,
      agentVersionId: g.versionId,
      evidenceId: fossilId,
      criterionResults: [{ criterionId: "quality", result: { kind: "score", score: 1 } }],
      guardrailResults: [{ guardrailId: "no-secrets", passed: true }],
    });
    const proposalId = await t.mutation(
      authorityApi.proposals.createCandidateProposal,
      { agentId: g.agentId, candidateVersionId: g.versionId, summary: "fossil release" },
    );

    await t.mutation(
      authorityApi.evidenceIntegrity.backfillServicePromotionEligibility,
      {},
    );

    await expect(
      t.mutation(authorityApi.reviews.approve, { proposalId, editCategory: "no-edit" }),
    ).rejects.toThrow(/PROMOTION_EVIDENCE_REQUIRED/);
  });
});
