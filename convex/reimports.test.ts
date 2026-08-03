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
});
