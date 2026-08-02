/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { APPROVED_IMPORT_MANIFEST_DIGEST } from "./importSpec";
import schema from "./schema";
import { modules } from "./test.setup";

const authorityApi = api as any;
const approverIdentity = {
  subject: "phase4_approver",
  issuer: "https://valid-collie-71.clerk.accounts.dev",
  name: "Phase 4 Approver",
  role: "approver",
};

describe("Phase 4 read-only directory query", () => {
  test("returns only imported A7/A8 with governed artifact identities", async () => {
    const t = convexTest(schema, modules).withIdentity(approverIdentity);
    const imported = await t.mutation(
      authorityApi.imports.executeApprovedCanonicalImport,
      { manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST },
    );
    await t.mutation(authorityApi.reviews.approve, {
      proposalId: imported.A7.proposalId,
      editCategory: "no-edit",
    });

    const rows = await t.query(
      authorityApi.agents.listGovernedDirectoryPilot,
      {},
    );
    expect(rows.map((row: any) => row.agent.displayId)).toEqual(["A7", "A8"]);
    expect(rows[0].version).toMatchObject({
      version: "biocraft-singleshot-v4",
      artifact: {
        declaredDigest:
          "991cadea10401307215254098644342ccb551f7f498eb64994e328eafdf0b6f9",
        declaredDigestAlgorithm: "sha256",
      },
    });
    expect(rows[1].version).toMatchObject({
      version: "0.1.0",
      sourcePin: {
        kind: "git-commit",
        commitSha: "2a8f2b9562c4d4569c156e2ae7559ab04a54b883",
        isContentDigest: false,
      },
    });
    expect(rows[1].version).not.toHaveProperty("artifact");
  });

  test("does not seed missing pilot agents", async () => {
    const t = convexTest(schema, modules);
    expect(
      await t.query(authorityApi.agents.listGovernedDirectoryPilot, {}),
    ).toEqual([]);
    expect(
      await t.run(async (ctx) => await ctx.db.query("agents").collect()),
    ).toEqual([]);
  });
});
