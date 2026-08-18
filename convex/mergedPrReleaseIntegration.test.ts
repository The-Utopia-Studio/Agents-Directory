/// <reference types="vite/client" />
// Integrated proof of steps 6 and the negative case: the REAL Railway webhook
// handler driven against the REAL Convex mutations, with nothing stubbed
// between them but the GitHub payload itself.
//
// This is the whole merge → release path except deployment: signature
// verification and HTTP transport are covered separately in
// server/test/webhook-route.test.js.

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { seedPromotionEligibleEval } from "./lib/seedPromotionEval";
import { handleMergedLoopPullRequest } from "../server/src/github/loopMergeRelease.js";

const authorityApi = api as any;
const authorityInternal = internal as any;

const approver = {
  subject: "integration_approver",
  issuer: "https://valid-collie-71.clerk.accounts.dev",
  name: "Approver",
  role: "approver",
};

const BRANCH = "loop/biocraft-imp_integration_0";

function mergedPayload(overrides: Record<string, any> = {}) {
  return {
    action: "closed",
    repository: { full_name: "The-Utopia-Studio/utopia-agents" },
    ...overrides,
    pull_request: {
      number: 42,
      merged: true,
      merge_commit_sha: "c".repeat(40),
      head: { ref: BRANCH },
      merged_by: { id: 4242, login: "haniyahumair" },
      ...(overrides.pull_request || {}),
    },
  };
}

function registration(seed: number) {
  return {
    name: `Integration Fixture ${seed}`,
    tagline: "Merged-PR release integration",
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
    draftVersion: `0.1.${seed}`,
    draftArtifact: {
      scheme: "external" as const,
      locator: "fixture://agent",
      declaredDigest: "draft-digest-claim",
      declaredDigestAlgorithm: "sha256" as const,
    },
  };
}

async function scenario(t: any, seed: number, { withEvidence }: { withEvidence: boolean }) {
  const agent = await t.mutation(authorityApi.agents.registerAgent, registration(seed));
  const candidateVersionId = await t.mutation(
    authorityApi.agentVersions.createCandidateVersion,
    {
      agentId: agent.agentId,
      version: `biocraft-singleshot-v${10 + seed}`,
      basedOnVersionId: agent.draftVersionId,
      artifact: {
        scheme: "git",
        locator: "biocraft/SKILL.md",
        declaredDigest: `${seed}`.padStart(64, "d"),
        declaredDigestAlgorithm: "sha256",
      },
    },
  );
  const proposalId = await t.mutation(authorityApi.proposals.createCandidateProposal, {
    agentId: agent.agentId,
    candidateVersionId,
    summary: `Integration proposal ${seed}`,
  });
  if (withEvidence) {
    await seedPromotionEligibleEval(t, {
      agentId: agent.agentId,
      agentVersionId: candidateVersionId,
    });
  }
  return { agentId: agent.agentId, candidateVersionId, proposalId };
}

/** Wire the real handler to the real Convex mutations. */
function wire(t: any, proposalId: string, allowlist = ["haniyahumair"]) {
  const logs: string[] = [];
  return {
    logs,
    args: {
      approverAllowlist: allowlist,
      findProposalByBranch: async (branch: string) =>
        branch === BRANCH
          ? { agentId: "A7", proposalId: "imp_integration_0", convexProposalId: proposalId }
          : null,
      release: (a: any) =>
        t.mutation(authorityInternal.reviews.releaseFromMergedLoopPr, a),
      recordRefusal: (a: any) =>
        t.mutation(authorityInternal.reviews.recordReleaseRefusal, a),
      log: (m: string) => logs.push(m),
      now: () => 1_760_000_000_000,
    },
  };
}

async function pointerFor(t: any, agentId: string) {
  return await t.run(
    async (ctx: any) => (await ctx.db.get(agentId))?.currentApprovedVersionId ?? null,
  );
}

describe("merge → release, real handler against real Convex", () => {
  test("STEP 6: a merged loop/ PR moves the pointer with no second human click", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await scenario(t, 1, {
      withEvidence: true,
    });
    const pointerBefore = await pointerFor(t, agentId);
    expect(pointerBefore).not.toBe(candidateVersionId);

    const w = wire(t, proposalId);
    const out = await handleMergedLoopPullRequest({
      eventName: "pull_request",
      payload: mergedPayload(),
      ...w.args,
    });

    expect(out.released).toBe(true);
    const pointerAfter = await pointerFor(t, agentId);
    expect(pointerAfter).toBe(candidateVersionId);
    expect(pointerAfter).not.toBe(pointerBefore);

    const [event] = await t.query(authorityApi.reviews.listForProposal, { proposalId });
    expect(event.decision).toBe("approve");
    expect(event.actorKind).toBe("service");
    expect(event.actor.issuer).toBe("service:agents-directory");
    expect(event.onBehalfOf).toMatchObject({
      subject: "github:4242",
      name: "haniyahumair",
    });
    expect(event.releaseTrigger.mergeCommitSha).toBe("c".repeat(40));
    expect(event.releaseTrigger.pullRequestNumber).toBe(42);
    expect(w.logs.some((l) => /RELEASED PR #42/.test(l))).toBe(true);
  });

  test("NEGATIVE CASE: a merged loop/ PR with no promotion-eligible evidence does not move the pointer", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await scenario(t, 2, {
      withEvidence: false,
    });
    const pointerBefore = await pointerFor(t, agentId);

    const w = wire(t, proposalId);
    await expect(
      handleMergedLoopPullRequest({
        eventName: "pull_request",
        payload: mergedPayload(),
        ...w.args,
      }),
    ).rejects.toMatchObject({ code: "loop_release_promotion_evidence_required" });

    // The pointer did not move.
    expect(await pointerFor(t, agentId)).toBe(pointerBefore);
    expect(await pointerFor(t, agentId)).not.toBe(candidateVersionId);
    // The proposal stays open — release-refused is not terminal.
    expect(await t.run(async (ctx: any) => (await ctx.db.get(proposalId))?.status)).toBe(
      "open",
    );

    // The refusal is visible in Convex, not only in a log.
    const events = await t.query(authorityApi.reviews.listForProposal, { proposalId });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      decision: "release-refused",
      actorKind: "service",
      refusalCode: "loop_release_promotion_evidence_required",
      onBehalfOf: { subject: "github:4242", name: "haniyahumair" },
    });
    expect(events[0].refusalMessage).toMatch(/PROMOTION_EVIDENCE_REQUIRED/);
    expect(events[0].refusalMessage).toMatch(/was NOT moved/);
    // And it is loud in the logs.
    expect(w.logs.some((l) => /REFUSED/.test(l) && /PROMOTION_EVIDENCE/.test(l))).toBe(
      true,
    );
  });

  test("a login off the allowlist is refused and recorded, pointer untouched", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await scenario(t, 3, {
      withEvidence: true,
    });
    const w = wire(t, proposalId, ["someone-else"]);
    await expect(
      handleMergedLoopPullRequest({
        eventName: "pull_request",
        payload: mergedPayload(),
        ...w.args,
      }),
    ).rejects.toMatchObject({ code: "loop_release_approver_not_allowed" });

    expect(await pointerFor(t, agentId)).not.toBe(candidateVersionId);
    const [event] = await t.query(authorityApi.reviews.listForProposal, { proposalId });
    expect(event.refusalCode).toBe("loop_release_approver_not_allowed");
    // The allowlist in force is recorded on the refusal too.
    expect(event.releaseTrigger.approverAllowlist).toEqual(["someone-else"]);
  });

  test("a hand-merged non-loop branch releases nothing and writes nothing", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await scenario(t, 4, {
      withEvidence: true,
    });
    const w = wire(t, proposalId);
    const out = await handleMergedLoopPullRequest({
      eventName: "pull_request",
      payload: mergedPayload({ pull_request: { head: { ref: "hotfix/hand-merged" } } }),
      ...w.args,
    });
    expect(out.released).toBe(false);
    expect(out.ignored).toBe(true);
    expect(await pointerFor(t, agentId)).not.toBe(candidateVersionId);
    expect(await t.query(authorityApi.reviews.listForProposal, { proposalId })).toHaveLength(
      0,
    );
  });

  test("a re-delivered merge webhook does not move the pointer twice", async () => {
    const t = convexTest(schema, modules).withIdentity(approver);
    const { agentId, candidateVersionId, proposalId } = await scenario(t, 5, {
      withEvidence: true,
    });
    const w = wire(t, proposalId);
    const payload = mergedPayload();
    const first: any = await handleMergedLoopPullRequest({
      eventName: "pull_request",
      payload,
      ...w.args,
    });
    const second: any = await handleMergedLoopPullRequest({
      eventName: "pull_request",
      payload,
      ...w.args,
    });
    expect(first.released).toBe(true);
    expect(second.reviewEventId).toBe(first.reviewEventId);
    expect(await pointerFor(t, agentId)).toBe(candidateVersionId);
    expect(
      (await t.query(authorityApi.reviews.listForProposal, { proposalId })).filter(
        (e: any) => e.decision === "approve",
      ),
    ).toHaveLength(1);
  });
});
