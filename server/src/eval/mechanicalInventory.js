// Inventory of golden cases + digest-verified historical versions for the
// mechanical-check UI. Does not write evalHistory or feed fleet health.

import {
  HISTORICAL_ARTIFACT_REGISTRY,
  listHistoricalArtifactVersions,
  loadHistoricalArtifact,
} from "./historicalArtifacts.js";
import { listGoldenCases } from "./goldenCases.js";

/**
 * What the product can score today for an agent — cases, versions, digests.
 * A fixture whose digest does not match is reported as verification_failed,
 * never as a scoreable version.
 */
export function getMechanicalInventory(agentId) {
  const cases = listGoldenCases(agentId).map((c) => ({
    id: c.id,
    label: c.label,
    source: c.source,
    synthetic: String(c.source || "").startsWith("synthetic"),
    sourceGroundingCheckCount: (c.sourceGroundingRules || []).length,
  }));

  const versions = [];
  for (const entry of listHistoricalArtifactVersions(agentId)) {
    try {
      const loaded = loadHistoricalArtifact(entry.artifactVersion);
      versions.push({
        artifactVersion: loaded.artifactVersion,
        artifactDigest: loaded.artifactDigest,
        artifactDigestAlgorithm: "sha256",
        declaredDigest: entry.declaredDigest,
        digestVerified: loaded.artifactDigest === entry.declaredDigest,
        verification: "ok",
        checks: [...loaded.checks],
        checkCount: loaded.checks.length,
        fixtureRelativePath: entry.fixtureRelativePath,
      });
    } catch (error) {
      versions.push({
        artifactVersion: entry.artifactVersion,
        artifactDigest: null,
        declaredDigest: entry.declaredDigest,
        digestVerified: false,
        verification: "failed",
        verificationError: error.message,
        checks: [],
        checkCount: 0,
        fixtureRelativePath: entry.fixtureRelativePath,
      });
    }
  }

  const verified = versions.filter((v) => v.verification === "ok");
  return {
    agentId,
    label: "mechanical_check_inventory",
    feedsFleetHealth: false,
    writesEvalHistory: false,
    goldenCaseCount: cases.length,
    goldenCases: cases,
    artifactVersionCount: versions.length,
    verifiedArtifactVersionCount: verified.length,
    artifactVersions: versions,
    summary:
      cases.length === 0 && versions.length === 0
        ? "No golden cases or historical artifact versions registered."
        : `${cases.length} golden case${cases.length === 1 ? "" : "s"}` +
          (cases.some((c) => c.synthetic) ? " (synthetic)" : "") +
          `, ${verified.length} digest-verified artifact version${verified.length === 1 ? "" : "s"}` +
          (versions.some((v) => v.verification === "failed")
            ? ` (${versions.filter((v) => v.verification === "failed").length} failed verification)`
            : "") +
          ".",
    knownRegistryKeys: Object.keys(HISTORICAL_ARTIFACT_REGISTRY),
  };
}
