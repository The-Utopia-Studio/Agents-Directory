// Immutable metadata-only mechanical-result records.
// Per run: artifact version, digest, which checks passed/failed, normalised
// mechanical check score. Never output text. Does not feed fleet health.

import { IMMUTABLE_COLLECTIONS } from "../core/store.js";

export const MECHANICAL_RESULTS_COLLECTION = "mechanicalResults";

/** Ensure store treats mechanicalResults as append-only. */
export function assertMechanicalResultsImmutable() {
  if (!IMMUTABLE_COLLECTIONS.includes(MECHANICAL_RESULTS_COLLECTION)) {
    throw new Error(
      `${MECHANICAL_RESULTS_COLLECTION} must be listed in IMMUTABLE_COLLECTIONS`,
    );
  }
}

/**
 * Build a persistable record from a scoreMechanicalOutput result.
 * Strips anything that could carry draft text — status + structural facts only.
 */
export function buildMechanicalResultRecord({
  agentId,
  goldenCaseId,
  score,
  outputSource = "canned",
  comparedTo = null,
}) {
  if (!score?.artifactVersion || !score?.artifactDigest) {
    throw Object.assign(
      new Error("mechanical result requires artifactVersion and artifactDigest"),
      { status: 500 },
    );
  }
  return {
    agentId,
    goldenCaseId: goldenCaseId || null,
    artifactVersion: score.artifactVersion,
    artifactDigest: score.artifactDigest,
    artifactDigestAlgorithm: "sha256",
    outputSource, // canned | live — never the text
    passed: [...(score.passed || [])],
    failed: [...(score.failed || [])],
    notScoreable: [...(score.notScoreable || [])],
    mechanicalCheckScore: score.mechanicalCheckScore,
    scoreableCount: score.scoreableCount,
    checkResults: (score.checkResults || []).map((row) => {
      const clean = {
        checkId: row.checkId,
        family: row.family,
        status: row.status,
      };
      for (const key of [
        "sectionFound",
        "paragraphCount",
        "hookChars",
        "aboutChars",
        "headlineChars",
        "limit",
        "windowParagraphs",
        "windowChars",
        "hasContactChannel",
        "hasImperativeOpener",
        "hasInvitationFrame",
        "delimiter",
        "segmentCount",
        "section",
        "windowWords",
        "anchorPresent",
        "partnerPresent",
        "near",
        "directed",
        "historicalImplementation",
        "reason",
      ]) {
        if (row[key] !== undefined) clean[key] = row[key];
      }
      return clean;
    }),
    ...(comparedTo ? { comparedTo } : {}),
    label: "mechanical_check_score",
    ts: new Date().toISOString(),
  };
}

export async function recordMechanicalResult(store, record) {
  assertMechanicalResultsImmutable();
  return store.append(MECHANICAL_RESULTS_COLLECTION, record);
}

export async function listMechanicalResults(store, { agentId, goldenCaseId } = {}) {
  return store.query(MECHANICAL_RESULTS_COLLECTION, (row) => {
    if (agentId && row.agentId !== agentId) return false;
    if (goldenCaseId && row.goldenCaseId !== goldenCaseId) return false;
    return true;
  });
}

/**
 * Closed-vocabulary defect signals from failed mechanical checks — safe to
 * hand the maker. Prefixed so style vs source-grounding stay distinguishable.
 */
export function mechanicalFailuresAsDefectSignals(score) {
  return (score.checkResults || [])
    .filter((row) => row.status === "fail")
    .map((row) => {
      const family = row.family || "style";
      return `mechanical:${family}:${row.checkId}`;
    });
}
