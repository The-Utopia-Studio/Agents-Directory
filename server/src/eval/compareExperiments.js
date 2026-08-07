// Two mechanical-compare experiments. Mixing them produces a perverse incentive:
// adding a check lowers the score on violating output, so a bare "did the score
// go up?" reading rewards deleting checks.
//
//   check_coverage  — SAME output, DIFFERENT check sets.
//                     Measures detection. Never invents a quality delta.
//
//   output_quality  — DIFFERENT outputs (each from a different artifact prompt),
//                     SAME check set (the ruler).
//                     Measures whether the prompt change helped.
//                     This is the only experiment that answers "did improvement help".
//
// Deltas are only produced when both sides ran the identical check set.
// Otherwise the result carries an explicit non-comparable state — never null,
// never a number that pretends to be a quality change.

import { loadHistoricalArtifact } from "./historicalArtifacts.js";

export const EXPERIMENT_CHECK_COVERAGE = "check_coverage";
export const EXPERIMENT_OUTPUT_QUALITY = "output_quality";

export const EXPERIMENTS = Object.freeze([
  EXPERIMENT_CHECK_COVERAGE,
  EXPERIMENT_OUTPUT_QUALITY,
]);

function refuse(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export function assertExperiment(experiment) {
  if (!EXPERIMENTS.includes(experiment)) {
    refuse(
      `Unknown experiment "${experiment}". Use ${EXPERIMENTS.join(" or ")}. ` +
        `A bare score delta across versions is refused.`,
    );
  }
  return experiment;
}

export function checkSetsEqual(leftChecks = [], rightChecks = []) {
  const a = [...leftChecks].sort();
  const b = [...rightChecks].sort();
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function scoreableCheckIds(score) {
  return (score.checkResults || [])
    .filter((r) => r.passed === true || r.passed === false || r.status === "pass" || r.status === "fail")
    .map((r) => r.id || r.checkId)
    .sort();
}

/**
 * Explicit delta state — never a bare null.
 * @returns {{
 *   comparable: boolean,
 *   value?: number,
 *   reason?: string,
 *   leftCheckCount?: number,
 *   rightCheckCount?: number,
 *   leftCheckSetVersion?: string|null,
 *   rightCheckSetVersion?: string|null,
 * }}
 */
export function groundingScoreDelta(left, right) {
  const leftVersion = left.checkSetVersion || left.artifactVersion || null;
  const rightVersion = right.checkSetVersion || right.artifactVersion || null;
  const leftIds = scoreableCheckIds(left);
  const rightIds = scoreableCheckIds(right);
  const leftCount = leftIds.length;
  const rightCount = rightIds.length;
  const sameIds =
    leftCount === rightCount && leftIds.every((id, i) => id === rightIds[i]);
  const sameVersion =
    leftVersion != null &&
    rightVersion != null &&
    leftVersion === rightVersion;

  if (!sameIds || leftCount !== rightCount || !sameVersion) {
    return {
      comparable: false,
      reason: `check set changed: ${leftCount} checks → ${rightCount} checks`,
      leftCheckCount: leftCount,
      rightCheckCount: rightCount,
      leftCheckSetVersion: leftVersion,
      rightCheckSetVersion: rightVersion,
    };
  }

  const leftScore = left.byCategory?.grounding?.passRate;
  const rightScore = right.byCategory?.grounding?.passRate;
  if (typeof leftScore !== "number" || typeof rightScore !== "number") {
    return {
      comparable: false,
      reason: "grounding pass rate missing on one or both sides",
      leftCheckCount: leftCount,
      rightCheckCount: rightCount,
      leftCheckSetVersion: leftVersion,
      rightCheckSetVersion: rightVersion,
    };
  }

  return {
    comparable: true,
    value: Math.round((rightScore - leftScore) * 10) / 10,
    leftCheckCount: leftCount,
    rightCheckCount: rightCount,
    leftCheckSetVersion: leftVersion,
    rightCheckSetVersion: rightVersion,
  };
}

/**
 * When declared check sets differ, a single comparable number is dishonest.
 * Callers must pick an experiment; coverage may proceed, quality must use a
 * ruler rather than each version's own declared set.
 */
export function comparabilityForVersions(leftArtifact, rightArtifact) {
  const sameChecks = checkSetsEqual(leftArtifact.checks, rightArtifact.checks);
  if (sameChecks) {
    return {
      checkSetsDiffer: false,
      comparableAsOutputQualityWithoutRuler: true,
      note: null,
      leftCheckCount: leftArtifact.checks.length,
      rightCheckCount: rightArtifact.checks.length,
    };
  }
  return {
    checkSetsDiffer: true,
    comparableAsOutputQualityWithoutRuler: false,
    note: `check set changed: ${leftArtifact.checks.length} checks → ${rightArtifact.checks.length} checks`,
    leftCheckCount: leftArtifact.checks.length,
    rightCheckCount: rightArtifact.checks.length,
  };
}

/** Build the coverage experiment response (same output, two rulers). */
export function buildCheckCoverageResult({
  caseId,
  left,
  right,
  leftVersion,
  rightVersion,
  outputSource,
}) {
  const leftArtifact = loadHistoricalArtifact(leftVersion);
  const rightArtifact = loadHistoricalArtifact(rightVersion);
  const comparability = comparabilityForVersions(leftArtifact, rightArtifact);
  const delta = groundingScoreDelta(left, right);

  return {
    experiment: EXPERIMENT_CHECK_COVERAGE,
    label: "check_coverage",
    measures: "check_coverage",
    interpretation:
      "Same output, different check sets. Category pass rates are shown side by side; a lower style rate with more failures means stronger detection, not worse output. Do not read this as output-quality progress.",
    caseId,
    outputSource,
    outputProvenance:
      outputSource === "canned" ? "canned_fixtures" : String(outputSource || "unknown"),
    answersDidImprovementHelp: false,
    findingKind: "check_coverage",
    checkSetsDiffer: comparability.checkSetsDiffer,
    ...(comparability.note ? { checkSetNote: comparability.note } : {}),
    outputQualityComparable: false,
    // Explicit state — never null, never a pretending number.
    scoreDelta: delta,
    // Legacy key kept as the explicit object so callers that still read
    // mechanicalCheckScoreDelta never treat a missing number as 0.
    mechanicalCheckScoreDelta: delta,
    left: summarizeScore(left, leftArtifact),
    right: summarizeScore(right, rightArtifact),
    changed: changedStatuses(left, right),
    coverageReading: coverageReading(left, right),
  };
}

/** Build the quality experiment response (two outputs, one ruler). */
export function buildOutputQualityResult({
  caseId,
  left,
  right,
  leftArtifactVersion,
  rightArtifactVersion,
  rulerVersion,
  rulerChecks,
  outputSource,
  leftGeneration,
  rightGeneration,
}) {
  if (!rulerVersion || !Array.isArray(rulerChecks) || !rulerChecks.length) {
    refuse(
      "output_quality requires an explicit rulerVersion whose check set scores both outputs",
    );
  }

  const leftArtifact = loadHistoricalArtifact(leftArtifactVersion);
  const rightArtifact = loadHistoricalArtifact(rightArtifactVersion);
  const comparability = comparabilityForVersions(leftArtifact, rightArtifact);

  // Both sides scored with the same ruler → stamp identical checkSetVersion.
  const leftForDelta = {
    ...left,
    checkSetVersion: rulerVersion,
  };
  const rightForDelta = {
    ...right,
    checkSetVersion: rulerVersion,
  };
  const delta = groundingScoreDelta(leftForDelta, rightForDelta);

  const isLive = outputSource === "live";
  const isCanned = outputSource === "canned";

  return {
    experiment: EXPERIMENT_OUTPUT_QUALITY,
    label: "output_quality",
    measures: "output_quality",
    outputSource,
    outputProvenance: isLive
      ? "live_generation"
      : isCanned
        ? "canned_fixtures"
        : String(outputSource || "unknown"),
    answersDidImprovementHelp: isLive,
    findingKind: isLive ? "prompt_comparison" : "plumbing_verification",
    interpretation: isLive
      ? "Different outputs, each generated under its artifact prompt, scored with one shared check set (the ruler). The grounding headline (and style line) are per-category; a higher grounding rate means fewer falsehoods under that ruler — this live pair answers whether the prompt change helped."
      : "Fixture comparison — verifies the scoring path, not the prompts. Outputs were hand-authored canned fixtures, not model runs under v5/v6. Do not read the score delta as evidence that an improvement helped.",
    caseId,
    rulerVersion,
    rulerChecks: [...rulerChecks],
    checkSetsDiffer: comparability.checkSetsDiffer,
    ...(comparability.checkSetsDiffer
      ? {
          checkSetNote:
            "Artifact check sets differ; both outputs were scored with the ruler, not with each artifact's declared set.",
        }
      : {}),
    outputQualityComparable: delta.comparable,
    scoreDelta: delta,
    mechanicalCheckScoreDelta: delta,
    left: {
      ...summarizeScore(left, leftArtifact),
      artifactVersion: leftArtifact.artifactVersion,
      artifactDigest: leftArtifact.artifactDigest,
      checkSetVersion: rulerVersion,
      scoredWith: rulerVersion,
      outputSource,
      ...(leftGeneration
        ? {
            generation: {
              artifactVersion: leftGeneration.artifactVersion,
              artifactDigest: leftGeneration.artifactDigest,
              provider: leftGeneration.provider,
              modelId: leftGeneration.modelId || null,
              latencyMs: leftGeneration.latencyMs || null,
              inputTokens: leftGeneration.inputTokens || null,
              outputTokens: leftGeneration.outputTokens || null,
            },
          }
        : {}),
    },
    right: {
      ...summarizeScore(right, rightArtifact),
      artifactVersion: rightArtifact.artifactVersion,
      artifactDigest: rightArtifact.artifactDigest,
      checkSetVersion: rulerVersion,
      scoredWith: rulerVersion,
      outputSource,
      ...(rightGeneration
        ? {
            generation: {
              artifactVersion: rightGeneration.artifactVersion,
              artifactDigest: rightGeneration.artifactDigest,
              provider: rightGeneration.provider,
              modelId: rightGeneration.modelId || null,
              latencyMs: rightGeneration.latencyMs || null,
              inputTokens: rightGeneration.inputTokens || null,
              outputTokens: rightGeneration.outputTokens || null,
            },
          }
        : {}),
    },
    changed: changedStatuses(left, right),
  };
}

function summarizeScore(score, artifact) {
  return {
    artifactVersion: score.artifactVersion,
    artifactDigest: score.artifactDigest,
    checkSetVersion: score.checkSetVersion || score.artifactVersion || null,
    declaredChecks: [...(artifact.checks || [])],
    mechanicalCheckScore: score.mechanicalCheckScore,
    scoreableCount: score.scoreableCount,
    stylePassRate: score.stylePassRate,
    styleScoreableCount: score.styleScoreableCount,
    byCategory: score.byCategory
      ? {
          grounding: { ...score.byCategory.grounding },
          style: { ...score.byCategory.style },
        }
      : null,
    passed: [...score.passed],
    failed: [...score.failed],
    notScoreable: [...score.notScoreable],
    checkResults: score.checkResults.map((row) => ({
      id: row.id || row.checkId,
      checkId: row.id || row.checkId,
      passed: row.passed,
      why: row.why == null ? null : row.why,
      severity: row.severity == null ? null : row.severity,
      category: row.category,
      status: row.status,
      family: row.family,
      ...(row.historicalImplementation
        ? { historicalImplementation: true }
        : {}),
      ...(row.section ? { section: row.section } : {}),
    })),
  };
}

function changedStatuses(left, right) {
  const ids = new Set([
    ...left.checkResults.map((r) => r.id || r.checkId),
    ...right.checkResults.map((r) => r.id || r.checkId),
  ]);
  const map = (score) =>
    Object.fromEntries(
      score.checkResults.map((r) => [r.id || r.checkId, r.status]),
    );
  const leftMap = map(left);
  const rightMap = map(right);
  const changed = [];
  for (const id of [...ids].sort()) {
    const from = leftMap[id] || "absent";
    const to = rightMap[id] || "absent";
    if (from !== to) changed.push({ checkId: id, from, to });
  }
  return changed;
}

function coverageReading(left, right) {
  const styleFails = (side) => {
    if (side.byCategory?.style?.failed) {
      return side.byCategory.style.failed.length;
    }
    return (side.failed || []).filter((id) => !String(id).startsWith("source_"))
      .length;
  };
  const leftFails = styleFails(left);
  const rightFails = styleFails(right);
  if (rightFails > leftFails) {
    return {
      direction: "right_detects_more",
      detail:
        "Right check set failed more style checks on the same output — stronger coverage, not worse quality.",
    };
  }
  if (rightFails < leftFails) {
    return {
      direction: "left_detects_more",
      detail:
        "Left check set failed more style checks on the same output — stronger coverage on the left.",
    };
  }
  return {
    direction: "equal_style_detection",
    detail: "Style failure counts match on this output.",
  };
}
