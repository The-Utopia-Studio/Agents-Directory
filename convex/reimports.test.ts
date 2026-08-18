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
  A7_V8_RELEASE_MANIFEST_DIGEST,
  A7_V8_RELEASE_SPEC,
  A7_V9_RELEASE_MANIFEST_DIGEST,
  A7_V9_RELEASE_SPEC,
  A10_V1_RELEASE_MANIFEST_DIGEST,
  A10_V1_RELEASE_SPEC,
  A10_V3_RELEASE_MANIFEST_DIGEST,
  A10_V3_RELEASE_SPEC,
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

  test("the sealed v7 release spec binds the v7 artifact and rating boundary", () => {
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

  test("the sealed v8 release spec binds the Terra artifact and rating boundary", () => {
    expect(
      createHash("sha256")
        .update(stableStringify(A7_V8_RELEASE_SPEC))
        .digest("hex"),
    ).toBe(A7_V8_RELEASE_MANIFEST_DIGEST);
    expect(A7_V8_RELEASE_SPEC.version.artifact.declaredDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(A7_V8_RELEASE_SPEC.priorVersion).toBe("biocraft-singleshot-v7");
    expect(A7_V8_RELEASE_SPEC.priorArtifactSha256).toBe(
      A7_V7_RELEASE_SPEC.version.artifact.declaredDigest,
    );
    expect(A7_V8_RELEASE_SPEC.proposalSummary).toMatch(
      /not comparable to v8-on-Terra/,
    );
  });

  test("the sealed v9 release spec binds the employer-frame artifact and rating boundary", () => {
    expect(
      createHash("sha256")
        .update(stableStringify(A7_V9_RELEASE_SPEC))
        .digest("hex"),
    ).toBe(A7_V9_RELEASE_MANIFEST_DIGEST);
    expect(A7_V9_RELEASE_SPEC.priorVersion).toBe("biocraft-singleshot-v8");
    expect(A7_V9_RELEASE_SPEC.version.version).toBe("biocraft-singleshot-v9");
    expect(A7_V9_RELEASE_SPEC.version.artifact.declaredDigest).toBe(
      "e229c64f44bcf3b6e8f57ea7dc74c868b7987ddfc7f92379ad4723761fa4314e",
    );
    expect(A7_V9_RELEASE_SPEC.proposalSummary).toMatch(/not comparable to v9/);
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
      repoUrl: "https://github.com/The-Utopia-Studio/utopia-agents/tree/main/biocraft",
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

  test("creates exact v8 from current v7 and releases only through reviews", async () => {
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
    const v7 = await t.mutation(
      authorityApi.reimports.executeApprovedA7V7Release,
      { releaseManifestDigest: A7_V7_RELEASE_MANIFEST_DIGEST },
    );
    await t.mutation(authorityApi.reviews.approve, {
      proposalId: v7.proposalId,
      editCategory: "no-edit",
    });
    const release = await t.mutation(
      authorityApi.reimports.executeApprovedA7V8Release,
      { releaseManifestDigest: A7_V8_RELEASE_MANIFEST_DIGEST },
    );
    const beforeApproval = await t.run(async (ctx) => ({
      agent: await ctx.db.get(release.agentId),
      version: await ctx.db.get(release.versionId),
      proposal: await ctx.db.get(release.proposalId),
    }));
    expect((beforeApproval.agent as any)?.currentApprovedVersionId).not.toBe(release.versionId);
    expect((beforeApproval.agent as any)?.invocation?.configRef).toBe(
      "server-owned:biocraft-singleshot-v8",
    );
    expect(beforeApproval.version).toMatchObject({
      version: "biocraft-singleshot-v8",
      state: "candidate",
      basedOnVersionId: v7.versionId,
      artifact: A7_V8_RELEASE_SPEC.version.artifact,
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
      authorityApi.reimports.executeApprovedA7V8Release,
      { releaseManifestDigest: A7_V8_RELEASE_MANIFEST_DIGEST },
    );
    expect(rerun.versionId).toBe(release.versionId);
    expect(rerun.proposalId).toBe(release.proposalId);
  });

  test("the sealed A10 v1 release spec binds gap-fill and leaves A9 out of scope", () => {
    expect(
      createHash("sha256")
        .update(stableStringify(A10_V1_RELEASE_SPEC))
        .digest("hex"),
    ).toBe(A10_V1_RELEASE_MANIFEST_DIGEST);
    expect(A10_V1_RELEASE_SPEC.agentDisplayId).toBe("A10");
    expect(A10_V1_RELEASE_SPEC.agent.name).toBe("Biocraft gap-fill");
    expect(A10_V1_RELEASE_SPEC.agent.platform).toBe("OpenAI");
    expect(A10_V1_RELEASE_SPEC.agent.model).toBe("gpt-5.6-terra");
    expect(
      A10_V1_RELEASE_SPEC.agent.executionContract.runnerConfig,
    ).toEqual(
      expect.arrayContaining([
        { key: "runtimeProvider", value: "openai" },
        { key: "runtimeModel", value: "gpt-5.6-terra" },
        { key: "mode", value: "gap-fill" },
      ]),
    );
    expect(A10_V1_RELEASE_SPEC.version.version).toBe("biocraft-gapfill-v2");
    expect(A10_V1_RELEASE_SPEC.version.artifact.declaredDigest).toBe(
      "2aa5470f9daeccb39f83d609c67618c64992ae4a024a0627fd9a9a928b61f1fd",
    );
    expect(A10_V1_RELEASE_SPEC.proposalSummary).toMatch(/A9 \/ Con stays untouched/);
    expect(A10_V1_RELEASE_SPEC).not.toHaveProperty("priorVersion");
  });

  test("the sealed A10 v3 release spec binds employer-frame gap-fill and leaves A9 out of scope", () => {
    expect(
      createHash("sha256")
        .update(stableStringify(A10_V3_RELEASE_SPEC))
        .digest("hex"),
    ).toBe(A10_V3_RELEASE_MANIFEST_DIGEST);
    expect(A10_V3_RELEASE_SPEC.priorVersion).toBe("biocraft-gapfill-v2");
    expect(A10_V3_RELEASE_SPEC.version.version).toBe("biocraft-gapfill-v3");
    expect(A10_V3_RELEASE_SPEC.version.artifact.declaredDigest).toBe(
      "8ccee5f24ac47dc16643954020309b85602109ca824a34cb54655bfaabd40fb4",
    );
    expect(A10_V3_RELEASE_SPEC.proposalSummary).toMatch(/stays untouched/);
  });

  test("creates A10 agent + candidate with no prior, releases only through reviews", async () => {
    const t = convexTest(schema, modules).withIdentity(approverIdentity);
    // Pre-existing A9 "Con" must remain untouched by the A10 release path.
    const con = await t.run(async (ctx) => {
      const actor = {
        subject: "con_owner",
        issuer: approverIdentity.issuer,
        name: "Con Owner",
      };
      const agentId = await ctx.db.insert("agents", {
        displayId: "A9",
        name: "Con",
        tagline: "Untouched collision occupant",
        platform: "Other",
        status: "Experimental",
        category: "Other",
        owner: "Con",
        initials: "CO",
        runner: "none",
        usabilityModes: ["download-install"],
        executionContract: { inputs: [], runnerConfig: [] },
        evidenceContract: {
          acceptedTypes: ["feedback"],
          requiredReturnArtifact: false,
        },
        outcomeContract: { successCriteria: [], evalSetId: null },
        guardrails: [],
        skills: [],
        tools: [],
        context: [],
        createdBy: actor,
        createdAt: Date.now(),
      } as any);
      const versionId = await ctx.db.insert("agentVersions", {
        agentId,
        version: "0.1.0",
        state: "draft",
        createdBy: actor,
        createdAt: Date.now(),
      } as any);
      return { agentId, versionId };
    });

    const release = await t.mutation(
      authorityApi.reimports.executeApprovedA10V1Release,
      { releaseManifestDigest: A10_V1_RELEASE_MANIFEST_DIGEST },
    );
    expect(release.displayId).toBe("A10");
    expect(release.artifactDigest).toBe(
      A10_V1_RELEASE_SPEC.version.artifact.declaredDigest,
    );

    const beforeApproval = await t.run(async (ctx) => ({
      a10: await ctx.db.get(release.agentId),
      version: await ctx.db.get(release.versionId),
      proposal: await ctx.db.get(release.proposalId),
      a9: await ctx.db.get(con.agentId),
      a9Version: await ctx.db.get(con.versionId),
    }));
    expect((beforeApproval.a10 as any)?.displayId).toBe("A10");
    expect((beforeApproval.a10 as any)?.currentApprovedVersionId).toBeUndefined();
    expect((beforeApproval.a10 as any)?.platform).toBe("OpenAI");
    expect((beforeApproval.a10 as any)?.model).toBe("gpt-5.6-terra");
    expect(beforeApproval.version).toMatchObject({
      version: "biocraft-gapfill-v2",
      state: "candidate",
      artifact: A10_V1_RELEASE_SPEC.version.artifact,
    });
    expect((beforeApproval.version as any)?.basedOnVersionId).toBeUndefined();
    expect(beforeApproval.proposal).toMatchObject({
      status: "open",
      summary: A10_V1_RELEASE_SPEC.proposalSummary,
    });
    expect((beforeApproval.proposal as any)?.priorApprovedVersionId).toBeUndefined();
    expect((beforeApproval.a9 as any)?.name).toBe("Con");
    expect((beforeApproval.a9Version as any)?.version).toBe("0.1.0");

    const approved = await t.mutation(authorityApi.reviews.approve, {
      proposalId: release.proposalId,
      editCategory: "no-edit",
    });
    expect(approved.resultingVersionId).toBe(release.versionId);
    const afterApproval = await t.run(async (ctx) => ({
      a10: await ctx.db.get(release.agentId),
      a9: await ctx.db.get(con.agentId),
    }));
    expect((afterApproval.a10 as any)?.currentApprovedVersionId).toBe(
      release.versionId,
    );
    expect((afterApproval.a9 as any)?.name).toBe("Con");

    const rerun = await t.mutation(
      authorityApi.reimports.executeApprovedA10V1Release,
      { releaseManifestDigest: A10_V1_RELEASE_MANIFEST_DIGEST },
    );
    expect(rerun.versionId).toBe(release.versionId);
    expect(rerun.proposalId).toBe(release.proposalId);
  });
});
