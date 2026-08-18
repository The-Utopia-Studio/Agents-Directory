/// <reference types="vite/client" />
// A7 v10 / A10 gapfill-v4: the release that reconciles Convex with the
// SKILL.md bytes edited on 2026-08-16 (check tiering + four widened detectors).
//
// The mistake these guard against is concrete: an earlier attempt edited
// A7_V9_RELEASE_SPEC's declaredDigest in place to point at the new bytes. A
// released version is immutable, so changed bytes are a NEW version chained to
// the old one — never a re-pin. These tests assert both halves of that.

import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { stableStringify } from "./importSpec";
import {
  A7_V9_RELEASE_SPEC,
  A7_V10_RELEASE_MANIFEST_DIGEST,
  A7_V10_RELEASE_SPEC,
  A10_V3_RELEASE_SPEC,
  A10_V4_RELEASE_MANIFEST_DIGEST,
  A10_V4_RELEASE_SPEC,
} from "./reimportSpec";

const authorityApi = api as any;

/** Digests Convex actually holds today, confirmed against the deployment. */
const DEPLOYED_A7_V9 =
  "e229c64f44bcf3b6e8f57ea7dc74c868b7987ddfc7f92379ad4723761fa4314e";
const DEPLOYED_A10_V3 =
  "8ccee5f24ac47dc16643954020309b85602109ca824a34cb54655bfaabd40fb4";
/** Live Railway bytes after the 2026-08-16 edits. */
const LIVE_A7 =
  "c1028caa64ef7965ff2ee052f3ac300509ea47e19346ab6c42aa9075aaacd7c1";
const LIVE_A10 =
  "7a3e5bc0a1531e34d04f33249c2e53c332a1d4f4e3f6fc7f9849242637b0bd11";

function specDigest(spec: unknown) {
  return createHash("sha256").update(stableStringify(spec)).digest("hex");
}

describe("v10 / gapfill-v4 release specs", () => {
  test("each manifest digest seals its exact spec", () => {
    expect(specDigest(A7_V10_RELEASE_SPEC)).toBe(A7_V10_RELEASE_MANIFEST_DIGEST);
    expect(specDigest(A10_V4_RELEASE_SPEC)).toBe(A10_V4_RELEASE_MANIFEST_DIGEST);
  });

  test("the seal is a spec digest, not a formatted-file byte hash", () => {
    for (const [spec, digest] of [
      [A7_V10_RELEASE_SPEC, A7_V10_RELEASE_MANIFEST_DIGEST],
      [A10_V4_RELEASE_SPEC, A10_V4_RELEASE_MANIFEST_DIGEST],
    ] as const) {
      const fileByteHash = createHash("sha256")
        .update(`${JSON.stringify(spec, null, 2)}\n`)
        .digest("hex");
      expect(digest).not.toBe(fileByteHash);
    }
  });

  test("the new versions carry the LIVE Railway bytes", () => {
    expect(A7_V10_RELEASE_SPEC.version.artifact.declaredDigest).toBe(LIVE_A7);
    expect(A10_V4_RELEASE_SPEC.version.artifact.declaredDigest).toBe(LIVE_A10);
    expect(A7_V10_RELEASE_SPEC.version.version).toBe("biocraft-singleshot-v10");
    expect(A10_V4_RELEASE_SPEC.version.version).toBe("biocraft-gapfill-v4");
  });

  test("the PRIOR versions are left at the digests Convex actually holds", () => {
    // The regression: v9's spec was edited in place to the new bytes. A
    // released version is immutable; if this drifts again, the release chain
    // no longer describes what was released.
    expect(A7_V9_RELEASE_SPEC.version.artifact.declaredDigest).toBe(DEPLOYED_A7_V9);
    expect(A10_V3_RELEASE_SPEC.version.artifact.declaredDigest).toBe(DEPLOYED_A10_V3);
  });

  test("each new version chains to its predecessor by exact digest", () => {
    expect(A7_V10_RELEASE_SPEC.priorVersion).toBe("biocraft-singleshot-v9");
    expect(A7_V10_RELEASE_SPEC.priorArtifactSha256).toBe(DEPLOYED_A7_V9);
    expect(A7_V10_RELEASE_SPEC.priorArtifactSha256).toBe(
      A7_V9_RELEASE_SPEC.version.artifact.declaredDigest,
    );

    expect(A10_V4_RELEASE_SPEC.priorVersion).toBe("biocraft-gapfill-v3");
    expect(A10_V4_RELEASE_SPEC.priorArtifactSha256).toBe(DEPLOYED_A10_V3);
    expect(A10_V4_RELEASE_SPEC.priorArtifactSha256).toBe(
      A10_V3_RELEASE_SPEC.version.artifact.declaredDigest,
    );
  });

  test("a new version never reuses its predecessor's bytes", () => {
    // If these were equal there would be nothing to release.
    expect(A7_V10_RELEASE_SPEC.version.artifact.declaredDigest).not.toBe(
      A7_V10_RELEASE_SPEC.priorArtifactSha256,
    );
    expect(A10_V4_RELEASE_SPEC.version.artifact.declaredDigest).not.toBe(
      A10_V4_RELEASE_SPEC.priorArtifactSha256,
    );
  });

  test("locators point at the governed artifact paths, digest algorithm pinned", () => {
    expect(A7_V10_RELEASE_SPEC.version.artifact.locator).toBe(
      "server/src/artifacts/biocraft/SKILL.md",
    );
    expect(A10_V4_RELEASE_SPEC.version.artifact.locator).toBe(
      "server/src/artifacts/biocraft-gapfill/SKILL.md",
    );
    for (const spec of [A7_V10_RELEASE_SPEC, A10_V4_RELEASE_SPEC]) {
      expect(spec.version.artifact.declaredDigestAlgorithm).toBe("sha256");
      expect(spec.version.state).toBe("candidate");
      expect(spec.version.artifact.scheme).toBe("git");
    }
  });

  test("each summary states that scores do not carry across the checkSetId change", () => {
    for (const spec of [A7_V10_RELEASE_SPEC, A10_V4_RELEASE_SPEC]) {
      expect(spec.proposalSummary).toMatch(/checkSetId/);
      expect(spec.proposalSummary).toMatch(/no score recorded under .* is comparable/i);
    }
  });
});

describe("the release mutations refuse before they write", () => {
  test("an altered manifest digest is refused", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "v10_approver",
      issuer: "https://valid-collie-71.clerk.accounts.dev",
      name: "Approver",
      role: "approver",
    });
    for (const fn of [
      authorityApi.reimports.executeApprovedA7V10Release,
      authorityApi.reimports.executeApprovedA10V4Release,
    ]) {
      await expect(
        t.mutation(fn, { releaseManifestDigest: "not-the-approved-digest" }),
      ).rejects.toThrow(/RELEASE_MANIFEST_NOT_APPROVED|altered or not approved/);
    }
  });

  test("an unauthenticated caller is refused before any digest check", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(authorityApi.reimports.executeApprovedA7V10Release, {
        releaseManifestDigest: A7_V10_RELEASE_MANIFEST_DIGEST,
      }),
    ).rejects.toThrow(/Authentication required|UNAUTHENTICATED/);
  });

  test("a non-approver identity is refused", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "v10_not_approver",
      issuer: "https://valid-collie-71.clerk.accounts.dev",
      name: "Not Approver",
    });
    await expect(
      t.mutation(authorityApi.reimports.executeApprovedA10V4Release, {
        releaseManifestDigest: A10_V4_RELEASE_MANIFEST_DIGEST,
      }),
    ).rejects.toThrow(/approver|FORBIDDEN/i);
  });

  test("the release creates a candidate and an open proposal — it does not move the pointer", () => {
    // Asserted structurally: the mutation's own contract says the pointer move
    // is a separate reviews.approve call, which applies the promotion-evidence
    // gate. Nothing in the release spec grants promotion.
    for (const spec of [A7_V10_RELEASE_SPEC, A10_V4_RELEASE_SPEC]) {
      expect(spec.version.state).toBe("candidate");
      expect(Object.keys(spec)).not.toContain("eligibleForPromotion");
    }
  });
});
