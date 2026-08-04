/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import {
  assertDeclaredServiceActor,
  LOOP_SERVICE_ACTOR,
  LOOP_SERVICE_ISSUER,
} from "./lib/serviceActor";
import { A7_V6_RELEASE_SPEC } from "./reimportSpec";

const authorityApi = api as any;
const authorityInternal = internal as any;

const approver = {
  subject: "service_actor_approver",
  issuer: "https://valid-collie-71.clerk.accounts.dev",
  name: "Approver",
  role: "approver",
};

function registration(overrides: Record<string, unknown> = {}) {
  return {
    name: "Fixture Agent",
    tagline: "Tests service evidence",
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

async function registerDisplayId(t: any, displayId: string) {
  for (let i = 0; i < 20; i++) {
    const created = await t.mutation(
      authorityApi.agents.registerAgent,
      registration({ name: `Slot ${i}`, draftVersion: `0.1.${i}` }),
    );
    if (created.displayId === displayId) return created;
  }
  throw new Error(`Could not allocate ${displayId}`);
}

describe("declared service actor", () => {
  test("accepts the loop principal and refuses Clerk-shaped issuers", () => {
    expect(assertDeclaredServiceActor(LOOP_SERVICE_ACTOR)).toEqual(
      LOOP_SERVICE_ACTOR,
    );
    expect(() =>
      assertDeclaredServiceActor({
        subject: "user_x",
        issuer: "https://valid-collie-71.clerk.accounts.dev",
      }),
    ).toThrow(/Clerk-shaped issuer/);
    expect(() =>
      assertDeclaredServiceActor({
        subject: "agents-directory-loop",
        issuer: "https://example.clerk.accounts.dev",
      }),
    ).toThrow(/Clerk-shaped issuer/);
    expect(() =>
      assertDeclaredServiceActor({
        subject: "other-service",
        issuer: LOOP_SERVICE_ISSUER,
      }),
    ).toThrow(/must be/);
  });
});

describe("hosted-run evidence", () => {
  test("looks up the governed version by digest and never creates one", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const a7 = await registerDisplayId(t, "A7");
    const digest = A7_V6_RELEASE_SPEC.version.artifact.declaredDigest;
    await t.mutation(authorityApi.agentVersions.createCandidateVersion, {
      agentId: a7.agentId,
      version: "biocraft-singleshot-v6",
      basedOnVersionId: a7.draftVersionId,
      artifact: {
        scheme: "git",
        locator: "server/src/artifacts/biocraft/SKILL.md",
        declaredDigest: digest,
        declaredDigestAlgorithm: "sha256",
      },
    });
    const versionsBefore = await t.query(
      authorityApi.agentVersions.listForAgent,
      { agentId: a7.agentId },
    );

    await expect(
      t.mutation(authorityInternal.evidence.recordHostedRunEvidence, {
        displayId: "A1",
        artifactDigest: digest,
      }),
    ).rejects.toThrow(/limited to A7/);

    await expect(
      t.mutation(authorityInternal.evidence.recordHostedRunEvidence, {
        displayId: "A7",
        artifactDigest: "0".repeat(64),
      }),
    ).rejects.toThrow(/never creates/);

    const versionsAfter = await t.query(
      authorityApi.agentVersions.listForAgent,
      { agentId: a7.agentId },
    );
    expect(versionsAfter).toHaveLength(versionsBefore.length);
  });

  test("writes one service-authored real run row against the matching digest", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const a7 = await registerDisplayId(t, "A7");
    const digest = A7_V6_RELEASE_SPEC.version.artifact.declaredDigest;
    await t.mutation(authorityApi.agentVersions.createCandidateVersion, {
      agentId: a7.agentId,
      version: "biocraft-singleshot-v6",
      basedOnVersionId: a7.draftVersionId,
      artifact: {
        scheme: "git",
        locator: "server/src/artifacts/biocraft/SKILL.md",
        declaredDigest: digest,
        declaredDigestAlgorithm: "sha256",
      },
    });
    const versionsBefore = await t.query(
      authorityApi.agentVersions.listForAgent,
      { agentId: a7.agentId },
    );

    const evidenceId = await t.mutation(
      authorityInternal.evidence.recordHostedRunEvidence,
      {
        displayId: "A7",
        artifactDigest: digest,
        cost: {
          amountUsd: 0,
          provider: "anthropic",
          modelId: "claude-sonnet-4-6",
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      },
    );

    const versionsAfter = await t.query(
      authorityApi.agentVersions.listForAgent,
      { agentId: a7.agentId },
    );
    expect(versionsAfter).toHaveLength(versionsBefore.length);

    const rows = await t.query(authorityApi.evidence.listRecentForDisplayId, {
      displayId: "A7",
      limit: 5,
    });
    const row = rows.find((r: { _id: string }) => r._id === evidenceId);
    expect(row).toMatchObject({
      type: "run",
      source: "real",
      actorKind: "service",
      declaredArtifactDigest: digest,
      eligibleForEvaluation: true,
      eligibleForPromotion: false,
      runBy: {
        subject: "agents-directory-loop",
        issuer: "service:agents-directory",
      },
    });
    expect(row).not.toHaveProperty("input");
    expect(row).not.toHaveProperty("output");
  });
});
