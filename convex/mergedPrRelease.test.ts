/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { seedPromotionEligibleEval } from "./lib/seedPromotionEval";
import {
  assertGithubApproverIdentity,
  assertServiceReviewIdentity,
} from "./lib/serviceActor";

const authorityApi = api as any;
const authorityInternal = internal as any;

const approver = {
  subject: "merged_pr_release_approver",
  issuer: "https://valid-collie-71.clerk.accounts.dev",
  name: "Approver",
  role: "approver",
};

const MERGING_HUMAN = {
  subject: "github:4242",
  issuer: "https://github.com",
  name: "haniyahumair",
};

function trigger(overrides: Record<string, unknown> = {}) {
  return {
    kind: "merged-loop-pull-request" as const,
    repo: "The-Utopia-Studio/utopia-agents",
    pullRequestNumber: 17,
    headRef: "loop/biocraft-imp_test_0",
    mergeCommitSha: "a".repeat(40),
    approverAllowlist: ["haniyahumair"],
    observedAt: 1_760_000_000_000,
    ...overrides,
  };
}

function registration(overrides: Record<string, unknown> = {}) {
  return {
    name: "Merge Release Fixture",
    tagline: "Tests merged-PR release",
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

/** Agent + candidate version + open proposal, with no evidence attached yet. */
async function openProposal(t: any, seed: number) {
  const agent = await t.mutation(
    authorityApi.agents.registerAgent,
    registration({ draftVersion: `0.1.${seed}` }),
  );
  const candidateVersionId = await t.mutation(
    authorityApi.agentVersions.createCandidateVersion,
    {
      agentId: agent.agentId,
      version: `candidate-v${seed}`,
      basedOnVersionId: agent.draftVersionId,
      artifact: {
        scheme: "git",
        locator: "biocraft/SKILL.md",
        declaredDigest: `${seed}`.padStart(64, "b"),
        declaredDigestAlgorithm: "sha256",
      },
    },
  );
  const proposalId = await t.mutation(
    authorityApi.proposals.createCandidateProposal,
    {
      agentId: agent.agentId,
      candidateVersionId,
      summary: `Merged-PR release fixture ${seed}`,
    },
  );
  return { agentId: agent.agentId, candidateVersionId, proposalId };
}

async function pointerFor(t: any, agentId: string) {
  return await t.run(
    async (ctx: any) => (await ctx.db.get(agentId))?.currentApprovedVersionId ?? null,
  );
}

async function eventsFor(t: any, proposalId: string) {
  return await t.query(authorityApi.reviews.listForProposal, { proposalId });
}

describe("merged-PR identity guards", () => {
  test("a GitHub approver must be github:<numeric id> at https://github.com", () => {
    expect(assertGithubApproverIdentity(MERGING_HUMAN)).toMatchObject({
      subject: "github:4242",
      issuer: "https://github.com",
      name: "haniyahumair",
    });
    // A login is not an identity — logins are renameable and reusable.
    expect(() =>
      assertGithubApproverIdentity({
        subject: "haniyahumair",
        issuer: "https://github.com",
      }),
    ).toThrow(/github:<numeric id>/);
    expect(() =>
      assertGithubApproverIdentity({
        subject: "github:4242",
        issuer: "https://valid-collie-71.clerk.accounts.dev",
      }),
    ).toThrow(/issuer must be/);
    expect(() => assertGithubApproverIdentity(null)).toThrow(/refusing the release/);
  });

  test("a service approval with no onBehalfOf fails validation and cannot persist", () => {
    expect(() =>
      assertServiceReviewIdentity({ decision: "approve", onBehalfOf: null }),
    ).toThrow(/requires onBehalfOf/);
    const ok = assertServiceReviewIdentity({
      decision: "approve",
      onBehalfOf: MERGING_HUMAN,
    });
    // actor is the service; the human rides on onBehalfOf. A service act is
    // recorded as a service act.
    expect(ok.actor).toEqual({
      subject: "agents-directory-loop",
      issuer: "service:agents-directory",
    });
    expect(ok.onBehalfOf).toMatchObject({ subject: "github:4242" });
    // A refusal may omit it — that row records that identity resolution failed.
    expect(
      assertServiceReviewIdentity({ decision: "release-refused", onBehalfOf: null })
        .onBehalfOf,
    ).toBeUndefined();
  });
});

describe("releaseFromMergedLoopPr", () => {
  test("moves the pointer and records a service act on behalf of the merger", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await openProposal(t, 1);
    await seedPromotionEligibleEval(t, { agentId, agentVersionId: candidateVersionId });

    expect(await pointerFor(t, agentId)).not.toBe(candidateVersionId);

    const result = await t.mutation(
      authorityInternal.reviews.releaseFromMergedLoopPr,
      { proposalId, onBehalfOf: MERGING_HUMAN, releaseTrigger: trigger() },
    );

    expect(result.status).toBe("approved");
    expect(await pointerFor(t, agentId)).toBe(candidateVersionId);

    const [event] = await eventsFor(t, proposalId);
    expect(event).toMatchObject({
      decision: "approve",
      actorKind: "service",
      actor: {
        subject: "agents-directory-loop",
        issuer: "service:agents-directory",
      },
      onBehalfOf: {
        subject: "github:4242",
        issuer: "https://github.com",
        name: "haniyahumair",
      },
      resultingVersionId: candidateVersionId,
    });
    // The merge event is the primary evidence; the identity is derived from it.
    expect(event.releaseTrigger).toMatchObject({
      pullRequestNumber: 17,
      mergeCommitSha: "a".repeat(40),
      headRef: "loop/biocraft-imp_test_0",
      // The rule in force at release time, so widening the env var later
      // cannot rewrite what governed this release.
      approverAllowlist: ["haniyahumair"],
    });
    // No Clerk principal anywhere on the row.
    expect(JSON.stringify(event)).not.toMatch(/clerk/i);
  });

  test("a candidate with no promotion-eligible evidence does not move the pointer", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await openProposal(t, 2);
    const before = await pointerFor(t, agentId);

    await expect(
      t.mutation(authorityInternal.reviews.releaseFromMergedLoopPr, {
        proposalId,
        onBehalfOf: MERGING_HUMAN,
        releaseTrigger: trigger(),
      }),
    ).rejects.toThrow(/PROMOTION_EVIDENCE_REQUIRED/);

    expect(await pointerFor(t, agentId)).toBe(before);
    expect(await pointerFor(t, agentId)).not.toBe(candidateVersionId);
    // The failed release rolls back entirely — including any row it wrote.
    expect(await eventsFor(t, proposalId)).toHaveLength(0);
  });

  test("a failed guardrail does not move the pointer", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await openProposal(t, 3);
    await seedPromotionEligibleEval(t, {
      agentId,
      agentVersionId: candidateVersionId,
      guardrailPassed: false,
    });
    const before = await pointerFor(t, agentId);

    await expect(
      t.mutation(authorityInternal.reviews.releaseFromMergedLoopPr, {
        proposalId,
        onBehalfOf: MERGING_HUMAN,
        releaseTrigger: trigger(),
      }),
    ).rejects.toThrow(/failed guardrail/);
    expect(await pointerFor(t, agentId)).toBe(before);
  });

  test("an empty approver allowlist is never permissive", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await openProposal(t, 4);
    await seedPromotionEligibleEval(t, { agentId, agentVersionId: candidateVersionId });

    await expect(
      t.mutation(authorityInternal.reviews.releaseFromMergedLoopPr, {
        proposalId,
        onBehalfOf: MERGING_HUMAN,
        releaseTrigger: trigger({ approverAllowlist: [] }),
      }),
    ).rejects.toThrow(/RELEASE_ALLOWLIST_EMPTY/);
    expect(await pointerFor(t, agentId)).not.toBe(candidateVersionId);
  });

  test("a non-loop branch cannot release even if it reaches the mutation", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await openProposal(t, 5);
    await seedPromotionEligibleEval(t, { agentId, agentVersionId: candidateVersionId });

    await expect(
      t.mutation(authorityInternal.reviews.releaseFromMergedLoopPr, {
        proposalId,
        onBehalfOf: MERGING_HUMAN,
        releaseTrigger: trigger({ headRef: "hotfix/manual-edit" }),
      }),
    ).rejects.toThrow(/RELEASE_BRANCH_NOT_LOOP/);
    expect(await pointerFor(t, agentId)).not.toBe(candidateVersionId);
  });

  test("a missing merge commit SHA refuses — the merge event is the evidence", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await openProposal(t, 6);
    await seedPromotionEligibleEval(t, { agentId, agentVersionId: candidateVersionId });

    await expect(
      t.mutation(authorityInternal.reviews.releaseFromMergedLoopPr, {
        proposalId,
        onBehalfOf: MERGING_HUMAN,
        releaseTrigger: trigger({ mergeCommitSha: "  " }),
      }),
    ).rejects.toThrow(/RELEASE_TRIGGER_INCOMPLETE/);
    expect(await pointerFor(t, agentId)).not.toBe(candidateVersionId);
  });

  test("an unresolved merger cannot persist a service approval", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await openProposal(t, 7);
    await seedPromotionEligibleEval(t, { agentId, agentVersionId: candidateVersionId });

    await expect(
      t.mutation(authorityInternal.reviews.releaseFromMergedLoopPr, {
        proposalId,
        onBehalfOf: { subject: "", issuer: "" },
        releaseTrigger: trigger(),
      }),
    ).rejects.toThrow(/resolved GitHub approver/);
    expect(await pointerFor(t, agentId)).not.toBe(candidateVersionId);
  });

  test("releasing twice is idempotent, not a second pointer move", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await openProposal(t, 8);
    await seedPromotionEligibleEval(t, { agentId, agentVersionId: candidateVersionId });

    const first = await t.mutation(authorityInternal.reviews.releaseFromMergedLoopPr, {
      proposalId,
      onBehalfOf: MERGING_HUMAN,
      releaseTrigger: trigger(),
    });
    const second = await t.mutation(authorityInternal.reviews.releaseFromMergedLoopPr, {
      proposalId,
      onBehalfOf: MERGING_HUMAN,
      releaseTrigger: trigger({ pullRequestNumber: 18 }),
    });

    expect(second.reviewEventId).toBe(first.reviewEventId);
    expect(await pointerFor(t, agentId)).toBe(candidateVersionId);
    expect(
      (await eventsFor(t, proposalId)).filter((e: any) => e.decision === "approve"),
    ).toHaveLength(1);
  });
});

describe("recordReleaseRefusal", () => {
  test("a refusal is visible in Convex and leaves the pointer alone", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await openProposal(t, 9);
    const before = await pointerFor(t, agentId);

    await t.mutation(authorityInternal.reviews.recordReleaseRefusal, {
      proposalId,
      refusalCode: "loop_release_approver_not_allowed",
      refusalMessage: "GitHub user drive-by merged PR #17 but is not in LOOP_RELEASE_APPROVERS",
      onBehalfOf: { subject: "github:99", issuer: "https://github.com", name: "drive-by" },
      releaseTrigger: trigger({ approverAllowlist: ["haniyahumair"] }),
    });

    const [event] = await eventsFor(t, proposalId);
    expect(event).toMatchObject({
      decision: "release-refused",
      actorKind: "service",
      refusalCode: "loop_release_approver_not_allowed",
      onBehalfOf: { subject: "github:99", name: "drive-by" },
    });
    expect(event.refusalMessage).toMatch(/not in LOOP_RELEASE_APPROVERS/);
    // Non-terminal: the pointer stays put and the proposal stays open.
    expect(await pointerFor(t, agentId)).toBe(before);
    expect(await pointerFor(t, agentId)).not.toBe(candidateVersionId);
    expect(
      await t.run(async (ctx: any) => (await ctx.db.get(proposalId))?.status),
    ).toBe("open");
  });

  test("a refusal without a reason is itself refused", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { proposalId } = await openProposal(t, 10);
    await expect(
      t.mutation(authorityInternal.reviews.recordReleaseRefusal, {
        proposalId,
        refusalCode: "  ",
        refusalMessage: "  ",
        releaseTrigger: trigger(),
      }),
    ).rejects.toThrow(/requires a code and a message/);
  });

  test("a refusal after an unresolvable merger records without onBehalfOf", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { proposalId } = await openProposal(t, 11);
    await t.mutation(authorityInternal.reviews.recordReleaseRefusal, {
      proposalId,
      refusalCode: "loop_release_merger_unresolved",
      refusalMessage: "merged_by reported no numeric id; refusing rather than attributing to the service",
      releaseTrigger: trigger(),
    });
    const [event] = await eventsFor(t, proposalId);
    expect(event.decision).toBe("release-refused");
    expect(event.onBehalfOf).toBeUndefined();
    // Critically: the actor is still the service, never a stand-in human.
    expect(event.actor).toEqual({
      subject: "agents-directory-loop",
      issuer: "service:agents-directory",
    });
  });
});

describe("the human UI approve path still works and is labelled human", () => {
  test("reviews.approve records actorKind human and no service fields", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await openProposal(t, 12);
    await seedPromotionEligibleEval(t, { agentId, agentVersionId: candidateVersionId });

    await t.mutation(authorityApi.reviews.approve, {
      proposalId,
      editCategory: "no-edit",
    });

    const [event] = await eventsFor(t, proposalId);
    expect(event.actorKind).toBe("human");
    expect(event.onBehalfOf).toBeUndefined();
    expect(event.releaseTrigger).toBeUndefined();
    expect(await pointerFor(t, agentId)).toBe(candidateVersionId);
  });
});
