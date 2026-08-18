/// <reference types="vite/client" />
// The evidence door, the deliberate-act separation, and the fossil invariant.

import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { internal } from "./_generated/api";
const authorityInternal = internal as any;

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
    // The service records that it executed these bytes; the human then attests.
    await t.mutation(authorityInternal.executions.recordExecution, {
      displayId: g.displayId,
      artifactDigest: DIGEST,
      executionKind: "production",
    });
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
    await t.mutation(authorityInternal.executions.recordExecution, {
      displayId: g.displayId, artifactDigest: DIGEST, executionKind: "production",
    });
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

describe("evidence requires proof that an execution happened", () => {
  test("attesting a run nobody performed is refused", async () => {
    // The hole this closes: an approver who knew a digest could mint
    // promotion-eligible evidence without executing or reading anything.
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 30);
    await expect(
      base.withIdentity(HUMAN).mutation(
        authorityApi.evidence.recordVerifiedHumanRunEvidence,
        { displayId: g.displayId, artifactDigest: DIGEST },
      ),
    ).rejects.toThrow(/EXECUTION_PROOF_REQUIRED/);
    // And nothing was written.
    expect(await t.run(async (ctx: any) => (await ctx.db.query("evidence").collect()).length)).toBe(0);
  });

  test("one execution attests exactly one evidence row", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 31);
    await t.mutation(authorityInternal.executions.recordExecution, {
      displayId: g.displayId, artifactDigest: DIGEST, executionKind: "production",
    });
    await base.withIdentity(HUMAN).mutation(
      authorityApi.evidence.recordVerifiedHumanRunEvidence,
      { displayId: g.displayId, artifactDigest: DIGEST },
    );
    // The proof is consumed; a second attestation finds nothing unconsumed.
    // Deliberately NO second recordExecution here — that is the point.
    await expect(
      base.withIdentity(HUMAN).mutation(
        authorityApi.evidence.recordVerifiedHumanRunEvidence,
        { displayId: g.displayId, artifactDigest: DIGEST },
      ),
    ).rejects.toThrow(/already been attested/);
  });

  test("a production execution cannot attest a candidate preview", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 32);
    await t.mutation(authorityApi.proposals.createCandidateProposal, {
      agentId: g.agentId, candidateVersionId: g.versionId, summary: "kind check",
    });
    await t.mutation(authorityInternal.executions.recordExecution, {
      displayId: g.displayId, artifactDigest: DIGEST, executionKind: "production",
    });
    await expect(
      t.mutation(authorityApi.evidence.recordCandidatePreviewEvidence, {
        displayId: g.displayId, artifactDigest: DIGEST,
        previewSourceKind: "golden-fixture",
      }),
    ).rejects.toThrow(/EXECUTION_PROOF_REQUIRED/);
  });

  test("the service-measured cost wins over a caller-supplied figure", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 33);
    await t.mutation(authorityInternal.executions.recordExecution, {
      displayId: g.displayId, artifactDigest: DIGEST, executionKind: "production",
      cost: { amountUsd: 0.0104, provider: "openai", modelId: "gpt-5.6-terra" },
    });
    const evidenceId = await base.withIdentity(HUMAN).mutation(
      authorityApi.evidence.recordVerifiedHumanRunEvidence,
      {
        displayId: g.displayId, artifactDigest: DIGEST,
        cost: { amountUsd: 0, provider: "openai", modelId: "gpt-5.6-terra" },
      },
    );
    const row = await t.run(async (ctx: any) => await ctx.db.get(evidenceId));
    // A caller-supplied zero must not overwrite what the executor measured.
    expect(row.cost.amountUsd).toBe(0.0104);
  });

  test("execution proof is service-written and cannot be forged from a browser", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await governed(t, 34);
    await t.mutation(authorityInternal.executions.recordExecution, {
      displayId: g.displayId, artifactDigest: DIGEST, executionKind: "production",
    });
    const [rec] = await t.run(async (ctx: any) =>
      await ctx.db.query("executionRecords").collect());
    expect(rec.recordedBy).toEqual({
      subject: "agents-directory-loop",
      issuer: "service:agents-directory",
    });
    // recordExecution is an internalMutation, so a browser cannot call it.
    const src = readFileSync(new URL("./executions.ts", import.meta.url), "utf8");
    expect(src).toContain("export const recordExecution = internalMutation({");
    expect(src).not.toContain("export const recordExecution = mutation({");
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
    await t.mutation(authorityInternal.executions.recordExecution, {
      displayId: g.displayId, artifactDigest: DIGEST, executionKind: "production",
    });
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
    await t.mutation(authorityInternal.executions.recordExecution, {
      displayId: g.displayId, artifactDigest: DIGEST, executionKind: "production",
    });
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
    await t.mutation(authorityInternal.executions.recordExecution, {
      displayId: g.displayId, artifactDigest: DIGEST, executionKind: "production",
    });
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
        { displayId: g.displayId, artifactDigest: DIGEST, previewSourceKind: "golden-fixture" },
      ),
    ).rejects.toThrow(/approver|FORBIDDEN/i);
  });
});

describe("a blocking check failure refuses attestation", () => {
  async function previewable(t: any, base: any, seed: number) {
    const g = await governed(t, seed);
    await t.mutation(authorityApi.proposals.createCandidateProposal, {
      agentId: g.agentId, candidateVersionId: g.versionId, summary: "blocking",
    });
    await t.mutation(authorityInternal.executions.recordExecution, {
      displayId: g.displayId, artifactDigest: DIGEST, executionKind: "candidate-preview",
    });
    return g;
  }

  test("attesting output a blocking check failed is REFUSED, not warned", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await previewable(t, base, 40);
    await expect(
      t.mutation(authorityApi.evidence.recordCandidatePreviewEvidence, {
        displayId: g.displayId,
        artifactDigest: DIGEST,
        previewSourceKind: "golden-fixture",
        blockingCheckIds: ["draft_registered_ai_cliche_lemma"],
      }),
    ).rejects.toThrow(/BLOCKING_CHECK_FAILED/);
    expect(await t.run(async (ctx: any) => (await ctx.db.query("evidence").collect()).length)).toBe(0);
  });

  test("a deliberate override is recorded with its reason and the ids it covers", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await previewable(t, base, 41);
    const evidenceId = await t.mutation(
      authorityApi.evidence.recordCandidatePreviewEvidence,
      {
        displayId: g.displayId,
        artifactDigest: DIGEST,
        previewSourceKind: "pasted-source",
        blockingCheckIds: ["draft_registered_ai_cliche_lemma"],
        overrideReason: "the lemma appears inside a quoted client testimonial",
      },
    );
    const row = await t.run(async (ctx: any) => await ctx.db.get(evidenceId));
    expect(row.checkOverride.reason).toMatch(/quoted client testimonial/);
    expect(row.checkOverride.overriddenCheckIds).toEqual(["draft_registered_ai_cliche_lemma"]);
    // Which material was attested is on the row, not inferred.
    expect(row.previewSourceKind).toBe("pasted-source");
    expect(row.eligibleForPromotion).toBe(true);
  });

  test("an override naming nothing is refused", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await previewable(t, base, 42);
    await expect(
      t.mutation(authorityApi.evidence.recordCandidatePreviewEvidence, {
        displayId: g.displayId, artifactDigest: DIGEST,
        previewSourceKind: "golden-fixture",
        blockingCheckIds: [],
        overrideReason: "looks fine to me",
      }),
    ).rejects.toThrow(/OVERRIDE_WITHOUT_FAILURE/);
  });

  test("a clean preview records the source kind and no override", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity(APPROVER);
    const g = await previewable(t, base, 43);
    const evidenceId = await t.mutation(
      authorityApi.evidence.recordCandidatePreviewEvidence,
      { displayId: g.displayId, artifactDigest: DIGEST, previewSourceKind: "golden-fixture" },
    );
    const row = await t.run(async (ctx: any) => await ctx.db.get(evidenceId));
    expect(row.previewSourceKind).toBe("golden-fixture");
    expect(row.checkOverride).toBeUndefined();
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
