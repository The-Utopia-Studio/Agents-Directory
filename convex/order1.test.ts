/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import agentVersionsSource from "./agentVersions.ts?raw";
import schema from "./schema";
import { modules } from "./test.setup";

const authorityApi = api as any;
const authorityInternal = internal as any;
/** Production Convex modules only — dynamically enumerated, no hardcoded module list. */
const authoritySources = import.meta.glob(
  [
    "./**/*.ts",
    "!./**/*.test.ts",
    "!./test.setup.ts",
    "!./_generated/**",
  ],
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
) as Record<string, string>;

function scannedAuthorityPaths(): string[] {
  return Object.keys(authoritySources).sort();
}

function lineOfOffset(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function findDbMutations(
  source: string,
): Array<{ method: string; arg: string; line: number; index: number }> {
  const found: Array<{
    method: string;
    arg: string;
    line: number;
    index: number;
  }> = [];
  const re = /\bctx\.db\.(patch|replace|delete)\s*\(\s*([^,\n)]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    found.push({
      method: match[1],
      arg: match[2].trim(),
      line: lineOfOffset(source, match.index),
      index: match.index,
    });
  }
  return found;
}

/**
 * Convex patches by opaque document id, so the target table cannot be known
 * from the call alone. This heuristic flags call sites whose first argument
 * or nearby preceding context strongly implicates an agentVersions row.
 */
function looksLikeAgentVersionsMutation(
  source: string,
  mutation: { arg: string; index: number },
): boolean {
  if (
    /Id\s*<\s*["']agentVersions["']\s*>/.test(mutation.arg) ||
    /\b(?:\w*[Vv]ersionId|version\._id)\b/.test(mutation.arg)
  ) {
    return true;
  }
  const windowStart = Math.max(0, mutation.index - 800);
  const preceding = source.slice(windowStart, mutation.index);
  return (
    /query\s*\(\s*["']agentVersions["']\s*\)/.test(preceding) ||
    /Id\s*<\s*["']agentVersions["']\s*>/.test(preceding) ||
    /v\.id\s*\(\s*["']agentVersions["']\s*\)/.test(preceding)
  );
}

function findAgentVersionsMutationViolations(): string[] {
  const violations: string[] = [];
  for (const [path, source] of Object.entries(authoritySources)) {
    for (const mutation of findDbMutations(source)) {
      if (looksLikeAgentVersionsMutation(source, mutation)) {
        violations.push(
          `${path}:${mutation.line} ctx.db.${mutation.method}(${mutation.arg}, …) looks like an agentVersions row mutation`,
        );
      }
    }
  }
  return violations;
}

function findApprovedVersionWritersOutsideReviews(): string[] {
  const violations: string[] = [];
  // Object-key writes / assignments only — not property reads such as
  // `agent.currentApprovedVersionId` copied into priorApprovedVersionId.
  const keyOrAssign =
    /(?:(?<![\w.])currentApprovedVersionId\s*:|\.currentApprovedVersionId\s*=)/g;
  for (const [path, source] of Object.entries(authoritySources)) {
    if (path === "./reviews.ts" || path.endsWith("/reviews.ts")) continue;
    let match: RegExpExecArray | null;
    keyOrAssign.lastIndex = 0;
    while ((match = keyOrAssign.exec(source))) {
      const line = lineOfOffset(source, match.index);
      const lineText = source.split("\n")[line - 1] ?? "";
      // Schema field declarations are not runtime writes.
      if (/\bv\./.test(lineText)) continue;
      violations.push(
        `${path}:${line} writes currentApprovedVersionId outside reviews.ts: ${lineText.trim()}`,
      );
    }
  }
  return violations;
}

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

async function createProposalFixture(
  t: any,
  {
    version = "0.2.0",
    digest = "candidate-digest-claim",
  }: { version?: string; digest?: string } = {},
) {
  const created = await t.mutation(
    authorityApi.agents.registerAgent,
    registration(),
  );
  const candidateVersionId = await t.mutation(
    authorityApi.agentVersions.createCandidateVersion,
    {
      agentId: created.agentId,
      version,
      basedOnVersionId: created.draftVersionId,
      artifact: {
        scheme: "external",
        locator: `fixture://agent-v${version}`,
        declaredDigest: digest,
        declaredDigestAlgorithm: "sha256",
      },
    },
  );
  const proposalId = await t.mutation(
    authorityApi.proposals.createCandidateProposal,
    {
      agentId: created.agentId,
      candidateVersionId,
      summary: "Review fixture candidate",
    },
  );
  return { ...created, candidateVersionId, proposalId };
}

describe("Order 1 authority model", () => {
  test("authority writes have no development fallback actor", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(authorityApi.agents.registerAgent, registration()),
    ).rejects.toThrow("Authentication required");
  });

  test("request reads, creation and update require identity", async () => {
    const base = convexTest(schema, modules);
    const request = {
      title: "Authenticated request",
      desc: "Proves the intake write boundary",
      requestedBy: "Studio Test",
      priority: "Important" as const,
    };

    await expect(
      base.mutation(authorityApi.requests.createRequest, request),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ status: 401 }),
    });
    await expect(
      base.query(authorityApi.requests.listRequests, {}),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ status: 401 }),
    });

    const authenticated = base.withIdentity({
      name: "Operator",
      role: "operator",
    });
    const requestId = await authenticated.mutation(
      authorityApi.requests.createRequest,
      request,
    );
    expect(await authenticated.query(authorityApi.requests.listRequests, {})).toHaveLength(1);
    await expect(
      base.mutation(authorityApi.requests.updateRequest, {
        id: requestId,
        status: "Approved",
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ status: 401 }),
    });
    await expect(
      authenticated.mutation(authorityApi.requests.updateRequest, {
        id: requestId,
        status: "Approved",
      }),
    ).resolves.toBe(requestId);
  });

  test("the signed top-level role claim alone controls release approval", async () => {
    const base = convexTest(schema, modules);
    const operator = base.withIdentity({ name: "Operator", role: "operator" });
    const fixture = await createProposalFixture(operator);

    await expect(
      operator.mutation(authorityApi.reviews.approve, {
        proposalId: fixture.proposalId,
        editCategory: "no-edit",
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ status: 403 }),
    });
    expect(
      await base.query(authorityApi.reviews.listForProposal, {
        proposalId: fixture.proposalId,
      }),
    ).toEqual([]);

    const approver = base.withIdentity({
      name: "Release Approver",
      role: "approver",
    });
    await expect(
      approver.mutation(authorityApi.reviews.approve, {
        proposalId: fixture.proposalId,
        editCategory: "no-edit",
      }),
    ).resolves.toMatchObject({
      decision: "approve",
      status: "approved",
    });
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
    // Narrow module-local guard (kept): agentVersions.ts itself has no
    // patch/replace/delete and only exposes create* mutations.
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

    // Expanded codebase-wide guard: every production convex/**/*.ts module
    // (excluding _generated and tests) is scanned for db mutations that look
    // like they target agentVersions rows. Convex patches by opaque id, so
    // this cannot prove table identity from the call alone — it flags first
    // args / preceding context that implicate an agentVersions document.
    const scanned = scannedAuthorityPaths();
    const versionMutations = findAgentVersionsMutationViolations();
    expect(
      versionMutations,
      [
        "agentVersions row mutations must not appear outside insert-only version creation.",
        `Scanned files (${scanned.length}): ${scanned.join(", ")}`,
        ...versionMutations,
      ].join("\n"),
    ).toEqual([]);

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

  test("only the approval module writes currentApprovedVersionId", () => {
    // Narrow path check (kept): patch payloads mentioning the field.
    const writers = Object.entries(authoritySources)
      .filter(([, source]) =>
        /ctx\.db\.patch\([\s\S]*?currentApprovedVersionId/.test(source),
      )
      .map(([path]) => path);
    expect(writers).toEqual(["./reviews.ts"]);

    // Expanded: any insert/replace/patch write of the field outside reviews.ts
    // fails with file:line. Schema field declarations are not matched because
    // they are not inside ctx.db.(patch|replace|insert)(...).
    const scanned = scannedAuthorityPaths();
    const outsiders = findApprovedVersionWritersOutsideReviews();
    expect(
      outsiders,
      [
        "currentApprovedVersionId may be written only in reviews.ts.",
        `Scanned files (${scanned.length}): ${scanned.join(", ")}`,
        ...outsiders,
      ].join("\n"),
    ).toEqual([]);
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

  test("registration rejects an empty usabilityModes array without writing an agent", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Operator" });
    await expect(
      t.mutation(
        authorityApi.agents.registerAgent,
        registration({ usabilityModes: [] }),
      ),
    ).rejects.toThrow("At least one usability mode is required");
    expect(await t.query(authorityApi.agents.listAgents, {})).toEqual([]);
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
    await expect(
      t.mutation(authorityApi.evalResults.recordEvalResult, {
        evalSetId,
        evalCaseId,
        agentVersionId: candidateVersionId,
        evidenceId: recorded[0]._id,
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
      }),
    ).rejects.toThrow("Evidence is not eligible for evaluation");
    await expect(
      t.mutation(authorityApi.evalResults.recordEvalResult, {
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
        guardrailResults: [
          {
            guardrailId: "no-secrets",
            passed: true,
            evidenceId: recorded[0]._id,
          },
        ],
      }),
    ).rejects.toThrow("Guardrail evidence must be eligible");
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

  // Closest trustworthy concurrency substitute under convex-test:
  // top-level mutations are serialized by TransactionManager.begin(), so a
  // mid-handler pause cannot overlap a second approve after the same open read.
  // This proves the post-terminal identical-call path the harness can exercise.
  test("identical re-approval returns the canonical result without a second event", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Approver", role: "approver" });
    const fixture = await createProposalFixture(t);
    const versionsBefore = await t.query(
      authorityApi.agentVersions.listForAgent,
      { agentId: fixture.agentId },
    );

    const firstResult = await t.mutation(authorityApi.reviews.approve, {
      proposalId: fixture.proposalId,
      editCategory: "no-edit",
    });
    const secondResult = await t.mutation(authorityApi.reviews.approve, {
      proposalId: fixture.proposalId,
      editCategory: "no-edit",
    });

    expect(secondResult).toEqual(firstResult);
    const events = await t.query(authorityApi.reviews.listForProposal, {
      proposalId: fixture.proposalId,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      decision: "approve",
      resultingVersionId: fixture.candidateVersionId,
    });
    const versionsAfter = await t.query(
      authorityApi.agentVersions.listForAgent,
      { agentId: fixture.agentId },
    );
    expect(versionsAfter).toHaveLength(versionsBefore.length);
    const agent = await t.query(authorityApi.agents.getAgent, {
      id: fixture.agentId,
    });
    expect(agent?.currentApprovedVersionId).toBe(fixture.candidateVersionId);
  });

  test.skip(
    "concurrent approvals under real OCC — requires deployed staging with two authenticated identities; convex-test serializes top-level mutations",
    async () => {
      // Deployed proof (not runnable under convex-test):
      // 1. Start approve A; pause after open-proposal read, before any write.
      // 2. Start identical approve B while A is paused.
      // 3. Release A; both must return one canonical result, one reviewEvent,
      //    one currentApprovedVersionId, and no duplicate version snapshot.
      throw new Error(
        "OCC overlap cannot be forced under convex-test serialization",
      );
    },
  );

  test("reject after terminal approval throws conflict without changing release or audit", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Approver", role: "approver" });
    const fixture = await createProposalFixture(t);
    await t.mutation(authorityApi.reviews.approve, {
      proposalId: fixture.proposalId,
      editCategory: "no-edit",
    });
    const eventsBefore = await t.query(authorityApi.reviews.listForProposal, {
      proposalId: fixture.proposalId,
    });

    await expect(
      t.mutation(authorityApi.reviews.reject, {
        proposalId: fixture.proposalId,
        editCategory: "policy-safety",
      }),
    ).rejects.toThrow("already has terminal decision approve");

    const agent = await t.query(authorityApi.agents.getAgent, {
      id: fixture.agentId,
    });
    expect(agent?.currentApprovedVersionId).toBe(fixture.candidateVersionId);
    expect(
      await t.query(authorityApi.reviews.listForProposal, {
        proposalId: fixture.proposalId,
      }),
    ).toHaveLength(eventsBefore.length);
    expect(
      await t.query(authorityApi.proposals.getProposal, {
        proposalId: fixture.proposalId,
      }),
    ).toMatchObject({ status: "approved" });
  });

  test("approval succeeds normally after a non-terminal defer", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Approver", role: "approver" });
    const fixture = await createProposalFixture(t);
    const deferred = await t.mutation(authorityApi.reviews.defer, {
      proposalId: fixture.proposalId,
      editCategory: "missing-context",
    });
    expect(deferred).toMatchObject({
      decision: "defer",
      status: "deferred",
    });

    const approved = await t.mutation(authorityApi.reviews.approve, {
      proposalId: fixture.proposalId,
      editCategory: "no-edit",
    });
    expect(approved).toMatchObject({
      decision: "approve",
      status: "approved",
      resultingVersionId: fixture.candidateVersionId,
    });
    expect(
      await t.query(authorityApi.reviews.listForProposal, {
        proposalId: fixture.proposalId,
      }),
    ).toHaveLength(2);
  });

  test("approve reject and defer decisions are all audited", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Approver", role: "approver" });
    const approvedFixture = await createProposalFixture(t, {
      version: "0.2.0",
    });
    await t.mutation(authorityApi.reviews.defer, {
      proposalId: approvedFixture.proposalId,
      editCategory: "missing-context",
    });
    await t.mutation(authorityApi.reviews.approve, {
      proposalId: approvedFixture.proposalId,
      editCategory: "no-edit",
    });

    const rejectedFixture = await createProposalFixture(t, {
      version: "0.3.0",
    });
    await t.mutation(authorityApi.reviews.reject, {
      proposalId: rejectedFixture.proposalId,
      editCategory: "policy-safety",
    });

    const decisions = (
      await t.run(async (ctx) => await ctx.db.query("reviewEvents").collect())
    ).map((event) => event.decision);
    expect(decisions.sort()).toEqual(["approve", "defer", "reject"]);
  });

  test("approve-with-edit fails closed when artifact storage is unavailable", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Approver", role: "approver" });
    const fixture = await createProposalFixture(t);
    await expect(
      t.mutation(authorityApi.reviews.approveWithEdit, {
        proposalId: fixture.proposalId,
        editCategory: "factual-correction",
      }),
    ).rejects.toThrow("artifact storage not configured");
    expect(
      await t.query(authorityApi.reviews.listForProposal, {
        proposalId: fixture.proposalId,
      }),
    ).toEqual([]);
  });

  test("unchanged approval refuses a candidate without artifact reference or digest", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Approver", role: "approver" });
    const created = await t.mutation(
      authorityApi.agents.registerAgent,
      registration(),
    );
    const proposalIds = await t.run(async (ctx) => {
      const actor = {
        subject: "fixture-operator",
        issuer: "fixture",
        name: "Fixture Operator",
      };
      const missingArtifactVersionId = await ctx.db.insert("agentVersions", {
        agentId: created.agentId,
        version: "0.2.0",
        state: "candidate",
        basedOnVersionId: created.draftVersionId,
        createdBy: actor,
        createdAt: Date.now(),
      });
      const missingArtifactProposalId = await ctx.db.insert("proposals", {
        agentId: created.agentId,
        candidateVersionId: missingArtifactVersionId,
        status: "open",
        summary: "Missing artifact fixture",
        createdBy: actor,
        createdAt: Date.now(),
      });
      const missingDigestVersionId = await ctx.db.insert("agentVersions", {
        agentId: created.agentId,
        version: "0.3.0",
        state: "candidate",
        basedOnVersionId: created.draftVersionId,
        artifact: {
          scheme: "external",
          locator: "fixture://missing-digest",
          declaredDigest: "",
          declaredDigestAlgorithm: "sha256",
        },
        createdBy: actor,
        createdAt: Date.now(),
      });
      const missingDigestProposalId = await ctx.db.insert("proposals", {
        agentId: created.agentId,
        candidateVersionId: missingDigestVersionId,
        status: "open",
        summary: "Missing digest fixture",
        createdBy: actor,
        createdAt: Date.now(),
      });
      return [missingArtifactProposalId, missingDigestProposalId];
    });

    for (const proposalId of proposalIds) {
      await expect(
        t.mutation(authorityApi.reviews.approve, {
          proposalId,
          editCategory: "no-edit",
        }),
      ).rejects.toThrow(
        "requires an immutable artifact reference and declared digest",
      );
    }
    const agent = await t.query(authorityApi.agents.getAgent, {
      id: created.agentId,
    });
    expect(agent?.currentApprovedVersionId).toBeUndefined();
  });

  test("failed guardrails block promotion", async () => {
    const t = convexTest(schema, modules).withIdentity({ name: "Approver", role: "approver" });
    const fixture = await createProposalFixture(t);
    const evidenceId = await t.mutation(
      authorityInternal.evidence.recordRealExecutionEvidence,
      {
        agentVersionId: fixture.candidateVersionId,
        type: "run",
      },
    );
    const evalSetId = await t.mutation(
      authorityApi.evalSets.createEvalSet,
      {
        agentId: fixture.agentId,
        name: "Guardrail fixture",
        version: 1,
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
      },
    );
    const evalCaseId = await t.mutation(
      authorityApi.evalSets.createEvalCase,
      {
        evalSetId,
        name: "Guardrail case",
        fixtureRef: "fixture://guardrail",
        declaredFixtureDigest: "guardrail-fixture-digest",
      },
    );
    await t.mutation(authorityApi.evalResults.recordEvalResult, {
      evalSetId,
      evalCaseId,
      agentVersionId: fixture.candidateVersionId,
      evidenceId,
      criterionResults: [
        { criterionId: "quality", result: { kind: "score", score: 1 } },
      ],
      guardrailResults: [{ guardrailId: "no-secrets", passed: false }],
    });

    await expect(
      t.mutation(authorityApi.reviews.approve, {
        proposalId: fixture.proposalId,
        editCategory: "no-edit",
      }),
    ).rejects.toThrow("Promotion blocked by a failed guardrail");
    const agent = await t.query(authorityApi.agents.getAgent, {
      id: fixture.agentId,
    });
    expect(agent?.currentApprovedVersionId).toBeUndefined();
  });

  test("unauthenticated review mutations fail closed with 401 and write no audit", async () => {
    const base = convexTest(schema, modules);
    const authenticated = base.withIdentity({ name: "Operator" });
    const fixture = await createProposalFixture(authenticated);
    const calls = [
      authorityApi.reviews.approve,
      authorityApi.reviews.reject,
      authorityApi.reviews.defer,
      authorityApi.reviews.approveWithEdit,
    ];
    for (const reviewMutation of calls) {
      await expect(
        base.mutation(reviewMutation, {
          proposalId: fixture.proposalId,
          editCategory:
            reviewMutation === authorityApi.reviews.approve
              ? "no-edit"
              : "policy-safety",
        }),
      ).rejects.toMatchObject({
        data: expect.objectContaining({ status: 401 }),
      });
    }
    expect(
      await authenticated.query(authorityApi.reviews.listForProposal, {
        proposalId: fixture.proposalId,
      }),
    ).toEqual([]);
  });
});
