/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { getRuntimeArtifactDescriptor } from "../server/src/invoke/runtimeArtifacts.js";
import { api } from "./_generated/api";
import {
  APPROVED_IMPORT_MANIFEST_DIGEST,
  APPROVED_IMPORT_SPEC,
  stableStringify,
} from "./importSpec";
import schema from "./schema";
import { modules } from "./test.setup";

const authorityApi = api as any;
const approverIdentity = {
  subject: "user_import_approver",
  issuer: "https://valid-collie-71.clerk.accounts.dev",
  name: "Import Approver",
  role: "approver",
};

describe("Phase 2.5B narrow canonical import", () => {
  test("the approved digest seals the exact server-owned import spec", () => {
    expect(
      createHash("sha256")
        .update(stableStringify(APPROVED_IMPORT_SPEC))
        .digest("hex"),
    ).toBe(APPROVED_IMPORT_MANIFEST_DIGEST);
    expect(APPROVED_IMPORT_SPEC.scope).toEqual(["A7", "A8"]);
    expect(APPROVED_IMPORT_SPEC.exclusions.agents).toEqual([
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
    ]);
  });

  test("the approved gate is an import-spec digest, not the formatted-file byte hash", () => {
    const specDigest = createHash("sha256")
      .update(stableStringify(APPROVED_IMPORT_SPEC))
      .digest("hex");
    const formattedFileByteHash = createHash("sha256")
      .update(`${JSON.stringify(APPROVED_IMPORT_SPEC, null, 2)}\n`)
      .digest("hex");
    // The gate binds to the canonical spec, so reformatting the JSON file must
    // not change it. If these were equal the "spec digest" would really be a
    // file byte hash, which is the wording/meaning this test guards against.
    expect(APPROVED_IMPORT_MANIFEST_DIGEST).toBe(specDigest);
    expect(APPROVED_IMPORT_MANIFEST_DIGEST).not.toBe(formattedFileByteHash);
  });

  test("A7 custody: content digest + repo-relative locator, and no Git commit pin", () => {
    const a7 = APPROVED_IMPORT_SPEC.imports.A7.version;
    // The SHA-256 identifies the exact imported bytes.
    expect(a7.artifact.declaredDigestAlgorithm).toBe("sha256");
    expect(/^[a-f0-9]{64}$/.test(a7.artifact.declaredDigest)).toBe(true);
    // The locator is a repo-relative path, not a canonical storage location.
    expect(a7.artifact.locator).toBe("server/src/artifacts/biocraft/SKILL.md");
    // A7 has no Git commit pin — unlike A8, which carries one and marks it as
    // explicitly not a content digest.
    expect("sourcePin" in a7).toBe(false);
    expect(APPROVED_IMPORT_SPEC.imports.A8.version.sourcePin.isContentDigest).toBe(
      false,
    );
  });

  test("A7 import identity exactly matches the live server artifact", () => {
    const live = getRuntimeArtifactDescriptor("A7");
    const approved = APPROVED_IMPORT_SPEC.imports.A7.version;
    expect(live).not.toBeNull();
    expect(approved.version).toBe(live!.artifactVersion);
    expect(approved.artifact.declaredDigest).toBe(live!.artifactDigest);
    expect(approved.artifact.declaredDigestAlgorithm).toBe(
      live!.artifactDigestAlgorithm,
    );
    expect(approved.artifact.locator).toBe(
      "server/src/artifacts/biocraft/SKILL.md",
    );
  });

  test("preview and execute require the signed approver role and exact digest", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(authorityApi.imports.previewApprovedCanonicalImport, {
        manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST,
      }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "UNAUTHENTICATED", status: 401 }),
    });

    await expect(
      t
        .withIdentity({
          subject: "user_operator",
          issuer: approverIdentity.issuer,
          role: "operator",
        })
        .mutation(authorityApi.imports.executeApprovedCanonicalImport, {
          manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST,
        }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({ code: "FORBIDDEN", status: 403 }),
    });

    await expect(
      t
        .withIdentity(approverIdentity)
        .query(authorityApi.imports.previewApprovedCanonicalImport, {
          manifestDigest: "altered-manifest",
        }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        code: "MANIFEST_NOT_APPROVED",
        status: 403,
      }),
    });
  });

  test("dry-run previews only A7/A8 and performs no writes", async () => {
    const t = convexTest(schema, modules).withIdentity(approverIdentity);
    const preview = await t.query(
      authorityApi.imports.previewApprovedCanonicalImport,
      { manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST },
    );
    expect(preview.creates.agents).toEqual(["A7", "A8"]);
    expect(preview.creates.versions).toEqual([
      "A7:biocraft-singleshot-v4",
      "A8:0.1.0",
    ]);
    expect(preview.creates.evidence).toEqual([]);
    expect(preview.creates.evalResults).toEqual([]);
    expect(preview.creates.requests).toEqual([]);
    expect(await t.query(authorityApi.agents.listAgents, {})).toEqual([]);
  });

  test("execute, review, and rerun create one canonical A7/A8 set", async () => {
    const t = convexTest(schema, modules).withIdentity(approverIdentity);
    const first = await t.mutation(
      authorityApi.imports.executeApprovedCanonicalImport,
      { manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST },
    );
    expect(first.A7).toMatchObject({
      agentCreated: true,
      versionCreated: true,
      proposalCreated: true,
      proposalStatus: "open",
    });
    expect(first.A8).toMatchObject({
      agentCreated: true,
      versionCreated: true,
    });

    const decision = await t.mutation(authorityApi.reviews.approve, {
      proposalId: first.A7.proposalId,
      editCategory: "no-edit",
    });
    expect(decision).toMatchObject({
      decision: "approve",
      status: "approved",
      resultingVersionId: first.A7.versionId,
    });

    const second = await t.mutation(
      authorityApi.imports.executeApprovedCanonicalImport,
      { manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST },
    );
    expect(second.A7).toMatchObject({
      agentId: first.A7.agentId,
      versionId: first.A7.versionId,
      proposalId: first.A7.proposalId,
      agentCreated: false,
      versionCreated: false,
      proposalCreated: false,
      proposalStatus: "approved",
    });
    expect(second.A8).toMatchObject({
      agentId: first.A8.agentId,
      versionId: first.A8.versionId,
      agentCreated: false,
      versionCreated: false,
    });

    // The review endpoint itself is idempotent for the same terminal decision.
    const repeatedDecision = await t.mutation(authorityApi.reviews.approve, {
      proposalId: first.A7.proposalId,
      editCategory: "no-edit",
    });
    expect(repeatedDecision.reviewEventId).toBe(decision.reviewEventId);

    const state = await t.run(async (ctx) => ({
      agents: await ctx.db.query("agents").collect(),
      versions: await ctx.db.query("agentVersions").collect(),
      proposals: await ctx.db.query("proposals").collect(),
      reviews: await ctx.db.query("reviewEvents").collect(),
      evidence: await ctx.db.query("evidence").collect(),
      evalResults: await ctx.db.query("evalResults").collect(),
      requests: await ctx.db.query("requests").collect(),
    }));
    expect(state.agents).toHaveLength(2);
    expect(state.versions).toHaveLength(2);
    expect(state.proposals).toHaveLength(1);
    expect(state.reviews).toHaveLength(1);
    expect(state.evidence).toHaveLength(0);
    expect(state.evalResults).toHaveLength(0);
    expect(state.requests).toHaveLength(0);

    const a7 = state.agents.find((agent) => agent.displayId === "A7")!;
    const a8 = state.agents.find((agent) => agent.displayId === "A8")!;
    const a7Version = state.versions.find(
      (version) => version.agentId === a7._id,
    )!;
    const a8Version = state.versions.find(
      (version) => version.agentId === a8._id,
    )!;

    expect(a7.currentApprovedVersionId).toBe(a7Version._id);
    expect(a7.usabilityModes).toEqual(["hosted-run", "download-install"]);
    expect(a7.executionContract.inputs).toEqual([
      { key: "fellowName", required: true },
      { key: "sourceMaterial", required: true },
      { key: "interviewAnswers", required: false },
    ]);
    expect(a7Version.artifact).toMatchObject({
      declaredDigest:
        "991cadea10401307215254098644342ccb551f7f498eb64994e328eafdf0b6f9",
      declaredDigestAlgorithm: "sha256",
    });

    expect(a8.runner).toBe("foreign-runtime-handoff");
    expect(a8.usabilityModes).toEqual(["prepared-handoff"]);
    expect(a8.invocation).toBeUndefined();
    expect(a8Version.artifact).toBeUndefined();
    expect(a8Version.sourcePin).toEqual({
      kind: "git-commit",
      repoUrl: "https://github.com/aiden150/ux-qa-agent",
      commitSha: "2a8f2b9562c4d4569c156e2ae7559ab04a54b883",
      isContentDigest: false,
    });

    for (const imported of [...state.agents, ...state.versions]) {
      expect(imported.createdBy).toMatchObject({
        subject: approverIdentity.subject,
        issuer: approverIdentity.issuer,
      });
      expect(imported.importProvenance).toMatchObject({
        manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST,
        sourceExportDigest:
          "cf7a313d0dc42d54e6e6567baca0653aa4ac3f5e15dbeed78f1d7c5143b227e1",
        legacyCreatorClaimed: false,
      });
      expect(imported.createdAt).toBe(imported.importProvenance!.importedAt);
    }

    const inspection = await t.query(
      authorityApi.imports.inspectApprovedCanonicalImport,
      { manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST },
    );
    expect(inspection.counts).toEqual({
      agents: 2,
      agentVersions: 2,
      proposals: 1,
      reviewEvents: 1,
      evidence: 0,
      evalResults: 0,
      requests: 0,
    });
  });
});
