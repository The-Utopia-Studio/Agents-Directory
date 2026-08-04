/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import {
  APPROVED_IMPORT_MANIFEST_DIGEST,
  stableStringify,
} from "./importSpec";
import {
  A7_V6_RELEASE_MANIFEST_DIGEST,
  A7_V6_RELEASE_SPEC,
  A7_V7_RELEASE_MANIFEST_DIGEST,
  A7_V7_RELEASE_SPEC,
  MERGED_REIMPORT_MANIFEST_DIGEST,
  MERGED_REIMPORT_SPEC,
} from "./reimportSpec";
import schema from "./schema";
import { modules } from "./test.setup";

const authorityApi = api as any;
const approverIdentity = {
  subject: "merged_reimport_approver",
  issuer: "https://valid-collie-71.clerk.accounts.dev",
  role: "approver",
};

async function importedV4() {
  const t = convexTest(schema, modules).withIdentity(approverIdentity);
  const initial = await t.mutation(
    authorityApi.imports.executeApprovedCanonicalImport,
    { manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST },
  );
  await t.mutation(authorityApi.reviews.approve, {
    proposalId: initial.A7.proposalId,
    editCategory: "no-edit",
  });
  return { t, initial };
}

describe("approved A7/A8 merged re-import", () => {
  test("the sealed spec records all sources and the v4/v5 rating boundary", () => {
    expect(
      createHash("sha256")
        .update(stableStringify(MERGED_REIMPORT_SPEC))
        .digest("hex"),
    ).toBe(MERGED_REIMPORT_MANIFEST_DIGEST);
    expect(MERGED_REIMPORT_SPEC.sources).toMatchObject({
      safariBrowserExportSha256: /^[a-f0-9]{64}$/,
      chromeBrowserExportSha256: /^[a-f0-9]{64}$/,
      authoredA8RecordSha256: /^[a-f0-9]{64}$/,
    });
    expect(MERGED_REIMPORT_SPEC.imports.A7.release.proposalSummary).toMatch(
      /Ratings against v4 are not comparable to v5/,
    );
  });

  test("the sealed v6 release spec binds the new artifact and rating boundary", () => {
    expect(
      createHash("sha256")
        .update(stableStringify(A7_V6_RELEASE_SPEC))
        .digest("hex"),
    ).toBe(A7_V6_RELEASE_MANIFEST_DIGEST);
    expect(A7_V6_RELEASE_SPEC.version.artifact.declaredDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(A7_V6_RELEASE_SPEC.proposalSummary).toMatch(
      /Ratings against v5 are not comparable to v6/,
    );
  });

  test("the sealed v7 release spec binds the live artifact and rating boundary", () => {
    expect(
      createHash("sha256")
        .update(stableStringify(A7_V7_RELEASE_SPEC))
        .digest("hex"),
    ).toBe(A7_V7_RELEASE_MANIFEST_DIGEST);
    expect(A7_V7_RELEASE_SPEC.version.artifact.declaredDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(A7_V7_RELEASE_SPEC.proposalSummary).toMatch(
      /Ratings against v6 are not comparable to v7/,
    );
  });

  test("updates authorised A7/A8 metadata, creates v5, then releases only through reviews", async () => {
    const { t } = await importedV4();
    const preview = await t.query(
      authorityApi.reimports.previewApprovedMergedReimport,
      { manifestDigest: MERGED_REIMPORT_MANIFEST_DIGEST },
    );
    expect(preview.writes.releasePointer).toMatch(/reviews\.approve/);
    expect(preview.ratings).toMatch(/not comparable/);
    expect(preview.fieldSources.A8.guardrails).toMatch(/authored-a8-record/);

    const merged = await t.mutation(
      authorityApi.reimports.executeApprovedMergedReimport,
      { manifestDigest: MERGED_REIMPORT_MANIFEST_DIGEST },
    );
    expect(merged.A7.versionCreated).toBe(true);
    expect(merged.A7.proposalCreated).toBe(true);
    expect(merged.ratings).toMatch(/not comparable/);

    const stateBeforeReview = await t.run(async (ctx) => ({
      agents: await ctx.db.query("agents").collect(),
      versions: await ctx.db.query("agentVersions").collect(),
    }));
    const a7 = stateBeforeReview.agents.find((agent) => agent.displayId === "A7")!;
    const a8 = stateBeforeReview.agents.find((agent) => agent.displayId === "A8")!;
    const v4 = stateBeforeReview.versions.find(
      (version) => version.agentId === a7._id && version.version === "biocraft-singleshot-v4",
    )!;
    const v5 = stateBeforeReview.versions.find(
      (version) => version.agentId === a7._id && version.version === "biocraft-singleshot-v5",
    )!;

    expect(a7.currentApprovedVersionId).toBe(v4._id);
    expect(a7).toMatchObject({
      initials: "SA",
      category: "Personal Branding",
      repoUrl: "https://github.com/haniyahumair19/utopia-agents/tree/main/biocraft",
      objective: MERGED_REIMPORT_SPEC.imports.A7.agent.objective,
      whenToUse: MERGED_REIMPORT_SPEC.imports.A7.agent.whenToUse,
      sop: MERGED_REIMPORT_SPEC.imports.A7.agent.sop,
      outputs: MERGED_REIMPORT_SPEC.imports.A7.agent.outputs,
    });
    expect(v5.artifact).toMatchObject(MERGED_REIMPORT_SPEC.imports.A7.version.artifact);

    expect(a8).toMatchObject({
      name: "UX&QA Agent",
      platform: "Codex",
      objective: MERGED_REIMPORT_SPEC.imports.A8.agent.objective,
      whenToUse: MERGED_REIMPORT_SPEC.imports.A8.agent.whenToUse,
      sop: MERGED_REIMPORT_SPEC.imports.A8.agent.sop,
      outputs: MERGED_REIMPORT_SPEC.imports.A8.agent.outputs,
    });
    expect(a8.model).toBeUndefined();
    expect(a8.guardrails).toHaveLength(17);
    expect(a8.outcomeContract.successCriteria).toHaveLength(5);
    expect(a8.executionContract.inputs).toHaveLength(6);
    expect(a8.tools).toHaveLength(8);

    const review = await t.mutation(authorityApi.reviews.approve, {
      proposalId: merged.A7.proposalId,
      editCategory: "no-edit",
    });
    expect(review.resultingVersionId).toBe(v5._id);

    const rerun = await t.mutation(
      authorityApi.reimports.executeApprovedMergedReimport,
      { manifestDigest: MERGED_REIMPORT_MANIFEST_DIGEST },
    );
    expect(rerun.A7.versionCreated).toBe(false);
    expect(rerun.A7.proposalCreated).toBe(false);
  });

  test("creates exact v6 from current v5 and releases only through reviews", async () => {
    const { t } = await importedV4();
    const merged = await t.mutation(
      authorityApi.reimports.executeApprovedMergedReimport,
      { manifestDigest: MERGED_REIMPORT_MANIFEST_DIGEST },
    );
    await t.mutation(authorityApi.reviews.approve, {
      proposalId: merged.A7.proposalId,
      editCategory: "no-edit",
    });
    const release = await t.mutation(
      authorityApi.reimports.executeApprovedA7V6Release,
      { releaseManifestDigest: A7_V6_RELEASE_MANIFEST_DIGEST },
    );
    const beforeApproval = await t.run(async (ctx) => ({
      agent: await ctx.db.get(release.agentId),
      version: await ctx.db.get(release.versionId),
      proposal: await ctx.db.get(release.proposalId),
    }));
    expect((beforeApproval.agent as any)?.currentApprovedVersionId).not.toBe(release.versionId);
    expect(beforeApproval.version).toMatchObject({
      version: "biocraft-singleshot-v6",
      state: "candidate",
      basedOnVersionId: merged.A7.versionId,
      artifact: A7_V6_RELEASE_SPEC.version.artifact,
    });
    expect(beforeApproval.proposal).toMatchObject({ status: "open" });
    const approved = await t.mutation(authorityApi.reviews.approve, {
      proposalId: release.proposalId,
      editCategory: "no-edit",
    });
    expect(approved.resultingVersionId).toBe(release.versionId);
    const afterApproval = await t.run(async (ctx) => await ctx.db.get(release.agentId));
    expect((afterApproval as any)?.currentApprovedVersionId).toBe(release.versionId);
    const rerun = await t.mutation(
      authorityApi.reimports.executeApprovedA7V6Release,
      { releaseManifestDigest: A7_V6_RELEASE_MANIFEST_DIGEST },
    );
    expect(rerun.versionId).toBe(release.versionId);
    expect(rerun.proposalId).toBe(release.proposalId);
  });

  test("creates exact v7 from current v6 and releases only through reviews", async () => {
    const { t } = await importedV4();
    const merged = await t.mutation(
      authorityApi.reimports.executeApprovedMergedReimport,
      { manifestDigest: MERGED_REIMPORT_MANIFEST_DIGEST },
    );
    await t.mutation(authorityApi.reviews.approve, {
      proposalId: merged.A7.proposalId,
      editCategory: "no-edit",
    });
    const v6 = await t.mutation(
      authorityApi.reimports.executeApprovedA7V6Release,
      { releaseManifestDigest: A7_V6_RELEASE_MANIFEST_DIGEST },
    );
    await t.mutation(authorityApi.reviews.approve, {
      proposalId: v6.proposalId,
      editCategory: "no-edit",
    });
    const release = await t.mutation(
      authorityApi.reimports.executeApprovedA7V7Release,
      { releaseManifestDigest: A7_V7_RELEASE_MANIFEST_DIGEST },
    );
    const beforeApproval = await t.run(async (ctx) => ({
      agent: await ctx.db.get(release.agentId),
      version: await ctx.db.get(release.versionId),
      proposal: await ctx.db.get(release.proposalId),
    }));
    expect((beforeApproval.agent as any)?.currentApprovedVersionId).not.toBe(release.versionId);
    expect(beforeApproval.version).toMatchObject({
      version: "biocraft-singleshot-v7",
      state: "candidate",
      basedOnVersionId: v6.versionId,
      artifact: A7_V7_RELEASE_SPEC.version.artifact,
    });
    expect(beforeApproval.proposal).toMatchObject({ status: "open" });
    const approved = await t.mutation(authorityApi.reviews.approve, {
      proposalId: release.proposalId,
      editCategory: "no-edit",
    });
    expect(approved.resultingVersionId).toBe(release.versionId);
    const afterApproval = await t.run(async (ctx) => await ctx.db.get(release.agentId));
    expect((afterApproval as any)?.currentApprovedVersionId).toBe(release.versionId);
    const rerun = await t.mutation(
      authorityApi.reimports.executeApprovedA7V7Release,
      { releaseManifestDigest: A7_V7_RELEASE_MANIFEST_DIGEST },
    );
    expect(rerun.versionId).toBe(release.versionId);
    expect(rerun.proposalId).toBe(release.proposalId);
  });
});
