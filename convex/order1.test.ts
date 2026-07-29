/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import agentVersionsSource from "./agentVersions.ts?raw";
import schema from "./schema";
import { modules } from "./test.setup";

const authorityApi = api as any;
const authorityInternal = internal as any;

function registration(overrides: Record<string, unknown> = {}) {
  return {
    name: "Fixture Agent",
    tagline: "Tests authority invariants",
    platform: "Claude" as const,
    status: "Experimental" as const,
    category: "Other" as const,
    owner: "Studio Test",
    runner: "native" as const,
    usabilityModes: ["hosted-run"] as const,
    invocation: { type: "mock" as const, configRef: "fixture-v1" },
    executionContract: {
      inputs: [{ key: "fixtureId", required: true }],
      runnerConfig: [{ key: "fixture-only", value: "true" }],
    },
    evidenceContract: {
      acceptedTypes: ["run", "feedback"] as const,
      requiredReturnArtifact: false,
    },
    outcomeContract: {
      successCriteria: [{ id: "useful", label: "Output is useful" }],
      evalSetId: null,
    },
    guardrails: [{ id: "no-secrets", label: "Contains no secrets" }],
    draftVersion: "0.1.0",
    draftArtifact: {
      scheme: "external" as const,
      locator: "fixture://agent-v0.1.0",
      declaredDigest: "draft-digest-claim",
      declaredDigestAlgorithm: "sha256" as const,
    },
    ...overrides,
  };
}

describe("Order 1 authority model", () => {
  test("authority writes have no development fallback actor", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(authorityApi.agents.registerAgent, registration()),
    ).rejects.toThrow("Authentication required");
  });

  test("registration stores a declared digest and creates an unreleased draft", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Operator" });
    const created = await t.mutation(
      authorityApi.agents.registerAgent,
      registration(),
    );

    const agent = await t.query(authorityApi.agents.getAgent, {
      id: created.agentId,
    });
    const version = await t.query(authorityApi.agentVersions.getVersion, {
      versionId: created.draftVersionId,
    });
    expect(agent?.currentApprovedVersionId).toBeUndefined();
    expect(version).toMatchObject({
      agentId: created.agentId,
      state: "draft",
      version: "0.1.0",
      artifact: {
        declaredDigest: "draft-digest-claim",
        declaredDigestAlgorithm: "sha256",
      },
    });
    expect(version?.artifact).not.toHaveProperty("hash");
  });

  test("agent versions expose insert-only mutations and reject replacement", async () => {
    expect(agentVersionsSource).not.toMatch(
      /\bctx\.db\.(?:patch|replace|delete)\s*\(/,
    );
    const mutationExports = [
      ...agentVersionsSource.matchAll(
        /export const (\w+)\s*=\s*mutation\s*\(/g,
      ),
    ].map((match) => match[1]);
    expect(mutationExports).toEqual([
      "createDraftVersion",
      "createCandidateVersion",
    ]);

    const t = convexTest(schema, modules).withIdentity({ name: "Operator" });
    const created = await t.mutation(
      authorityApi.agents.registerAgent,
      registration(),
    );
    await expect(
      t.mutation(authorityApi.agentVersions.createDraftVersion, {
        agentId: created.agentId,
        version: "0.1.0",
        artifact: {
          scheme: "external",
          locator: "fixture://replacement",
          declaredDigest: "replacement-digest-claim",
          declaredDigestAlgorithm: "sha256",
        },
      }),
    ).rejects.toThrow("Version 0.1.0 already exists");

    const original = await t.query(authorityApi.agentVersions.getVersion, {
      versionId: created.draftVersionId,
    });
    expect(original?.artifact?.declaredDigest).toBe("draft-digest-claim");
  });

  test("runner and invocation cannot become conflicting truths", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Operator" });
    await expect(
      t.mutation(
        authorityApi.agents.registerAgent,
        registration({
          runner: "api",
          invocation: { type: "runtime" },
        }),
      ),
    ).rejects.toThrow("incompatible with runner api");
  });

  test("mock evidence is excluded while real evidence can support normalized evals", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Operator" });
    const created = await t.mutation(
      authorityApi.agents.registerAgent,
      registration(),
    );
    const candidateVersionId = await t.mutation(
      authorityApi.agentVersions.createCandidateVersion,
      {
        agentId: created.agentId,
        version: "0.2.0",
        basedOnVersionId: created.draftVersionId,
        artifact: {
          scheme: "external",
          locator: "fixture://agent-v0.2.0",
          declaredDigest: "candidate-digest-claim",
          declaredDigestAlgorithm: "sha256",
        },
      },
    );

    await t.mutation(authorityInternal.evidence.recordMockEvidence, {
      agentVersionId: candidateVersionId,
      type: "run",
    });
    await t.mutation(authorityInternal.evidence.recordDemoEvidence, {
      agentVersionId: candidateVersionId,
      type: "run",
    });
    const recorded = await t.query(authorityApi.evidence.listForVersion, {
      agentVersionId: candidateVersionId,
    });
    expect(recorded[0]).toMatchObject({
      declaredArtifactDigest: "candidate-digest-claim",
      source: "mock",
      eligibleForEvaluation: false,
      eligibleForPromotion: false,
    });
    expect(recorded[0]).not.toHaveProperty("input");
    expect(recorded[0]).not.toHaveProperty("output");
    expect(recorded[0]).not.toHaveProperty("payload");
    expect(recorded[1]).toMatchObject({
      source: "demo",
      eligibleForEvaluation: false,
      eligibleForPromotion: false,
    });
    expect(
      await t.query(authorityApi.evidence.listEligibleForEvaluation, {
        agentVersionId: candidateVersionId,
      }),
    ).toEqual([]);
    expect(
      await t.query(authorityApi.evidence.listEligibleForPromotion, {
        agentVersionId: candidateVersionId,
      }),
    ).toEqual([]);

    const realEvidenceId = await t.mutation(
      authorityInternal.evidence.recordRealExecutionEvidence,
      {
        agentVersionId: candidateVersionId,
        type: "run",
        cost: {
          amountUsd: 0.02,
          provider: "fixture-provider",
          modelId: "fixture-model",
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      },
    );
    const evalSetId = await t.mutation(
      authorityApi.evalSets.createEvalSet,
      {
        agentId: created.agentId,
        name: "Fixture rubric",
        version: 1,
        status: "draft",
        rubric: [
          {
            id: "required",
            label: "Required criterion",
            maxScore: 4,
            conditional: false,
          },
          {
            id: "conditional",
            label: "Conditional criterion",
            maxScore: 6,
            conditional: true,
          },
        ],
        guardrails: [{ id: "no-secrets", label: "Contains no secrets" }],
      },
    );
    const evalCaseId = await t.mutation(
      authorityApi.evalSets.createEvalCase,
      {
        evalSetId,
        name: "Approved fixture",
        fixtureRef: "fixture://case-1",
        declaredFixtureDigest: "fixture-digest-claim",
      },
    );
    const resultId = await t.mutation(
      authorityApi.evalResults.recordEvalResult,
      {
        evalSetId,
        evalCaseId,
        agentVersionId: candidateVersionId,
        evidenceId: realEvidenceId,
        criterionResults: [
          {
            criterionId: "required",
            result: { kind: "score", score: 3 },
          },
          {
            criterionId: "conditional",
            result: { kind: "n/a" },
          },
        ],
        guardrailResults: [{ guardrailId: "no-secrets", passed: true }],
      },
    );
    const result = await t.run(async (ctx) => await ctx.db.get(resultId));
    expect(result).toMatchObject({
      earnedMaximum: 3,
      applicableMaximum: 4,
      normalizedScore: 75,
      eligibleForPromotion: true,
    });
  });
});
