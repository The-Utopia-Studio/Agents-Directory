/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import {
  APPROVED_IMPORT_MANIFEST_DIGEST,
  APPROVED_IMPORT_SPEC,
} from "./importSpec";
import schema from "./schema";
import { modules } from "./test.setup";
import { approveWithPromotionEval } from "./lib/seedPromotionEval";

const authorityApi = api as any;
const authorityInternal = internal as any;
const approverIdentity = {
  subject: "phase3_approver",
  issuer: "https://valid-collie-71.clerk.accounts.dev",
  name: "Phase 3 Approver",
  role: "approver",
};

async function importA7AndA8() {
  const t = convexTest(schema, modules).withIdentity(approverIdentity);
  const imported = await t.mutation(
    authorityApi.imports.executeApprovedCanonicalImport,
    { manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST },
  );
  await approveWithPromotionEval(t, imported.A7.proposalId);
  return { t, imported };
}

async function createEvalFixture(t: any, agentId: string) {
  const evalSetId = await t.mutation(authorityApi.evalSets.createEvalSet, {
    agentId,
    name: "Phase 3 synthetic-isolation rubric",
    version: 1,
    status: "draft",
    rubric: [
      {
        id: "grounded",
        label: "Output is grounded",
        maxScore: 1,
        conditional: false,
      },
    ],
    guardrails: [],
  });
  const evalCaseId = await t.mutation(authorityApi.evalSets.createEvalCase, {
    evalSetId,
    name: "Metadata-only fixture",
    fixtureRef: "fixture://phase3/a7",
    declaredFixtureDigest: "phase3-fixture-digest",
  });
  return { evalSetId, evalCaseId };
}

describe("Phase 3 demo evidence isolation", () => {
  test("A7 demo and mock rows are version-linked, metadata-only, and never eligible", async () => {
    const { t, imported } = await importA7AndA8();
    const demoId = await t.mutation(
      authorityInternal.evidence.recordDemoEvidence,
      {
        agentVersionId: imported.A7.versionId,
        type: "run",
      },
    );
    const mockId = await t.mutation(
      authorityInternal.evidence.recordMockEvidence,
      {
        agentVersionId: imported.A7.versionId,
        type: "run",
      },
    );

    const rows = await t.query(authorityApi.evidence.listForVersion, {
      agentVersionId: imported.A7.versionId,
    });
    const synthetic = rows.filter(
      (row: any) => row.source === "demo" || row.source === "mock",
    );
    expect(synthetic.map((row: any) => row._id)).toEqual([demoId, mockId]);
    for (const row of synthetic) {
      expect(row).toMatchObject({
        agentId: imported.A7.agentId,
        agentVersionId: imported.A7.versionId,
        declaredArtifactDigest:
          APPROVED_IMPORT_SPEC.imports.A7.version.artifact.declaredDigest,
        type: "run",
        eligibleForEvaluation: false,
        eligibleForPromotion: false,
      });
      for (const forbidden of [
        "prompt",
        "input",
        "output",
        "payload",
        "sourceMaterial",
        "fellowMaterial",
        "feedbackText",
        "notes",
        "credentials",
        "token",
      ]) {
        expect(row).not.toHaveProperty(forbidden);
      }
    }
    expect(synthetic.map((row: any) => row.source)).toEqual(["demo", "mock"]);
    const evaluationEligible = await t.query(
      authorityApi.evidence.listEligibleForEvaluation,
      { agentVersionId: imported.A7.versionId },
    );
    expect(
      evaluationEligible.every((row: any) => row.source === "real"),
    ).toBe(true);
    const promotionEligible = await t.query(
      authorityApi.evidence.listEligibleForPromotion,
      { agentVersionId: imported.A7.versionId },
    );
    expect(
      promotionEligible.every((row: any) => row.eligibleForPromotion === true),
    ).toBe(true);
    expect(
      await t.query(authorityApi.evalResults.listEligibleForPromotion, {
        agentVersionId: imported.A7.versionId,
      }),
    ).not.toEqual([]);
  });

  test("recordEvalResult rejects both demo and mock evidence", async () => {
    const { t, imported } = await importA7AndA8();
    const { evalSetId, evalCaseId } = await createEvalFixture(
      t,
      imported.A7.agentId,
    );
    const syntheticIds = await Promise.all([
      t.mutation(authorityInternal.evidence.recordDemoEvidence, {
        agentVersionId: imported.A7.versionId,
        type: "run",
      }),
      t.mutation(authorityInternal.evidence.recordMockEvidence, {
        agentVersionId: imported.A7.versionId,
        type: "run",
      }),
    ]);

    for (const evidenceId of syntheticIds) {
      await expect(
        t.mutation(authorityApi.evalResults.recordEvalResult, {
          evalSetId,
          evalCaseId,
          agentVersionId: imported.A7.versionId,
          evidenceId,
          criterionResults: [
            { criterionId: "grounded", result: { kind: "score", score: 1 } },
          ],
          guardrailResults: [],
        }),
      ).rejects.toThrow("Evidence is not eligible for evaluation");
    }
    const recorded = await t.query(authorityApi.evalResults.listForVersion, {
      agentVersionId: imported.A7.versionId,
    });
    expect(
      recorded.every((row: any) => !syntheticIds.includes(row.evidenceId)),
    ).toBe(true);
  });

  test("synthetic writers reject caller-supplied eligibility overrides", async () => {
    const { t, imported } = await importA7AndA8();
    for (const writer of [
      authorityInternal.evidence.recordDemoEvidence,
      authorityInternal.evidence.recordMockEvidence,
    ]) {
      await expect(
        t.mutation(writer, {
          agentVersionId: imported.A7.versionId,
          type: "run",
          eligibleForEvaluation: true,
          eligibleForPromotion: true,
        }),
      ).rejects.toThrow();
    }
    const remaining = await t.query(authorityApi.evidence.listForVersion, {
      agentVersionId: imported.A7.versionId,
    });
    expect(remaining.every((row: any) => row.source === "real")).toBe(true);
  });

  test("A8 cannot treat its Git commit source pin as evidence identity", async () => {
    const { t, imported } = await importA7AndA8();
    expect(APPROVED_IMPORT_SPEC.imports.A8.version.artifact).toBeNull();
    expect(APPROVED_IMPORT_SPEC.imports.A8.version.sourcePin).toMatchObject({
      kind: "git-commit",
      isContentDigest: false,
    });

    await expect(
      t.mutation(authorityInternal.evidence.recordDemoEvidence, {
        agentVersionId: imported.A8.versionId,
        type: "test-report",
      }),
    ).rejects.toThrow(
      "Foreign-runtime evidence is unavailable: a Git commit source pin is not an artifact content digest, and the evidence-identity model is not yet defined",
    );
    expect(
      await t.query(authorityApi.evidence.listForVersion, {
        agentVersionId: imported.A8.versionId,
      }),
    ).toEqual([]);
  });
});
