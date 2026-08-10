// Immutable metadata-only mechanical-result records.
// Per run: artifact version, digest, check-set version, category-separated
// results with stored why text. Never output text. Does not feed fleet health.

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

const CHECK_RESULT_FACT_KEYS = Object.freeze([
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
  "sourceAllowsEmployer",
  "employerFramed",
  "markedNonEmployerCount",
  "framedNonEmployerCount",
]);

function cleanCheckResult(row) {
  const id = row.id || row.checkId;
  if (!id) return null;
  const clean = {
    id,
    checkId: id,
    passed:
      typeof row.passed === "boolean"
        ? row.passed
        : row.status === "pass"
          ? true
          : row.status === "fail"
            ? false
            : null,
    why: row.why == null ? null : String(row.why),
    severity: row.severity == null ? null : String(row.severity),
    category:
      row.category === "grounding" || row.category === "style"
        ? row.category
        : row.family === "source-grounding"
          ? "grounding"
          : "style",
    status:
      row.status ||
      (row.passed === true
        ? "pass"
        : row.passed === false
          ? "fail"
          : "not_scoreable"),
    family: row.family || undefined,
  };
  for (const key of CHECK_RESULT_FACT_KEYS) {
    if (row[key] !== undefined) clean[key] = row[key];
  }
  return clean;
}

function cloneCategorySummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  return {
    category: summary.category,
    passed: Array.isArray(summary.passed) ? [...summary.passed] : [],
    failed: Array.isArray(summary.failed) ? [...summary.failed] : [],
    notScoreable: Array.isArray(summary.notScoreable)
      ? [...summary.notScoreable]
      : [],
    scoreableCount:
      typeof summary.scoreableCount === "number" ? summary.scoreableCount : null,
    passRate:
      typeof summary.passRate === "number" ? summary.passRate : null,
  };
}

/**
 * Build a persistable record from a scoreMechanicalOutput result.
 * Strips anything that could carry draft text — status + structural facts + why.
 */
export function buildMechanicalResultRecord({
  agentId,
  goldenCaseId,
  score,
  outputSource = "canned",
  experiment = null,
  comparedTo = null,
  generation = null,
}) {
  if (!score?.artifactVersion || !score?.artifactDigest) {
    throw Object.assign(
      new Error("mechanical result requires artifactVersion and artifactDigest"),
      { status: 500 },
    );
  }
  const canonicalSource =
    outputSource === "live" || String(outputSource).startsWith("live")
      ? "live"
      : outputSource === "canned" || String(outputSource).startsWith("canned")
        ? "canned"
        : null;
  if (canonicalSource !== "live" && canonicalSource !== "canned") {
    throw Object.assign(
      new Error('outputSource must be "live" or "canned"'),
      { status: 500 },
    );
  }

  // Preserve experiment tag for reconstruct-from-store without stuffing it into
  // outputSource (which must stay live|canned).
  let resolvedExperiment = experiment;
  if (!resolvedExperiment && String(outputSource).includes(":")) {
    resolvedExperiment = String(outputSource).split(":")[1] || null;
  }

  const checkResults = (score.checkResults || [])
    .map(cleanCheckResult)
    .filter(Boolean);

  const gen = generation || score.generation || null;
  const provider =
    gen?.provider != null
      ? String(gen.provider)
      : score.provider != null
        ? String(score.provider)
        : canonicalSource === "canned"
          ? "fixture"
          : null;
  const modelId =
    gen?.modelId != null
      ? String(gen.modelId)
      : score.modelId != null
        ? String(score.modelId)
        : null;

  return {
    agentId,
    goldenCaseId: goldenCaseId || null,
    artifactVersion: score.artifactVersion,
    artifactDigest: score.artifactDigest,
    artifactDigestAlgorithm: "sha256",
    checkSetId: score.checkSetId || null,
    // Legacy field — never used for comparability once checkSetId is present.
    checkSetVersion: score.checkSetVersion || null,
    ...(score.rulerVersion ? { rulerVersion: score.rulerVersion } : {}),
    // Model identity — required for live delta comparability.
    ...(provider ? { provider } : {}),
    ...(modelId ? { modelId } : {}),
    outputSource: canonicalSource,
    ...(resolvedExperiment ? { experiment: resolvedExperiment } : {}),
    passed: [...(score.passed || [])],
    failed: [...(score.failed || [])],
    notScoreable: [...(score.notScoreable || [])],
    byCategory: {
      grounding: cloneCategorySummary(score.byCategory?.grounding),
      style: cloneCategorySummary(score.byCategory?.style),
    },
    guardrailGate: score.guardrailGate
      ? {
          passed: Boolean(score.guardrailGate.passed),
          results: (score.guardrailGate.results || []).map((row) => ({
            id: row.id,
            passed: row.passed,
            why: row.why == null ? null : String(row.why),
            source: row.source || null,
          })),
          coverage: score.guardrailGate.coverage
            ? { ...score.guardrailGate.coverage }
            : null,
        }
      : null,
    // Headline = grounding pass rate only.
    mechanicalCheckScore: score.mechanicalCheckScore,
    scoreableCount: score.scoreableCount,
    stylePassRate: score.stylePassRate,
    styleScoreableCount: score.styleScoreableCount,
    checkResults,
    ...(comparedTo ? { comparedTo } : {}),
    label: "mechanical_check_score",
    timestamp: new Date().toISOString(),
  };
}

export async function recordMechanicalResult(store, record) {
  assertMechanicalResultsImmutable();
  const toStore = { ...record };
  if (!toStore.timestamp) toStore.timestamp = new Date().toISOString();
  // Prefer timestamp; keep ts as the same value for older readers.
  toStore.ts = toStore.timestamp;
  return store.append(MECHANICAL_RESULTS_COLLECTION, toStore);
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
    .filter((row) => row.passed === false || row.status === "fail")
    .map((row) => {
      const family = row.family || row.category || "style";
      const id = row.id || row.checkId;
      return `mechanical:${family}:${id}`;
    });
}

/** True when a stored record has the post-category-split schema. */
export function isModernMechanicalRecord(rec) {
  if (!rec || typeof rec !== "object") return false;
  // Prefer checkSetId; legacy rows with only checkSetVersion still hydrate UI
  // but are non-comparable for deltas.
  if (!rec.checkSetId && !rec.checkSetVersion) return false;
  if (rec.outputSource !== "live" && rec.outputSource !== "canned") return false;
  if (!Array.isArray(rec.checkResults) || !rec.checkResults.length) return false;
  return rec.checkResults.every(
    (row) =>
      row &&
      (row.id || row.checkId) &&
      (row.category === "grounding" || row.category === "style") &&
      ("passed" in row),
  );
}
