// Two mechanical-compare experiments. Mixing them produces a perverse incentive:
// adding a check lowers the score on violating output, so a bare "did the score
// go up?" reading rewards deleting checks.
//
//   check_coverage  — SAME output, DIFFERENT check sets.
//                     Measures detection. Lower score = better coverage.
//                     Never presents a comparable output-quality delta.
//
//   output_quality  — DIFFERENT outputs (each from a different artifact prompt),
//                     SAME check set (the ruler).
//                     Measures whether the prompt change helped.
//                     This is the only experiment that answers "did improvement help".

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
    };
  }
  return {
    checkSetsDiffer: true,
    comparableAsOutputQualityWithoutRuler: false,
    note: "Not comparable — check set changed between these versions",
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

  return {
    experiment: EXPERIMENT_CHECK_COVERAGE,
    label: "check_coverage",
    measures: "check_coverage",
    interpretation:
      "Same output, different check sets. A lower mechanical check score means better detection, not worse output. Do not read this as output-quality progress.",
    caseId,
    outputSource,
    outputProvenance:
      outputSource === "canned" ? "canned_fixtures" : String(outputSource || "unknown"),
    answersDidImprovementHelp: false,
    findingKind: "check_coverage",
    checkSetsDiffer: comparability.checkSetsDiffer,
    ...(comparability.note ? { checkSetNote: comparability.note } : {}),
    // Explicitly absent — never invent a quality delta from coverage scores.
    outputQualityComparable: false,
    mechanicalCheckScoreDelta: null,
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

  const leftScore = left.mechanicalCheckScore;
  const rightScore = right.mechanicalCheckScore;
  const delta =
    leftScore == null || rightScore == null
      ? null
      : Math.round((rightScore - leftScore) * 10) / 10;

  const isLive = outputSource === "live";
  const isCanned = outputSource === "canned";

  return {
    experiment: EXPERIMENT_OUTPUT_QUALITY,
    label: "output_quality",
    measures: "output_quality",
    // Provenance on the result itself — never only in a tooltip.
    outputSource,
    outputProvenance: isLive
      ? "live_generation"
      : isCanned
        ? "canned_fixtures"
        : String(outputSource || "unknown"),
    answersDidImprovementHelp: isLive,
    findingKind: isLive ? "prompt_comparison" : "plumbing_verification",
    interpretation: isLive
      ? "Different outputs, each generated under its artifact prompt, scored with one shared check set (the ruler). A higher mechanical check score means the output satisfied more of that ruler — this live pair answers whether the prompt change helped."
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
    // Comparable under one ruler only as a number — whether that number is a
    // finding depends on answersDidImprovementHelp / findingKind.
    outputQualityComparable: true,
    mechanicalCheckScoreDelta: delta,
    left: {
      ...summarizeScore(left, leftArtifact),
      artifactVersion: leftArtifact.artifactVersion,
      artifactDigest: leftArtifact.artifactDigest,
      scoredWith: rulerVersion,
      outputSource,
      mechanicalCheckScore: left.mechanicalCheckScore,
      passed: [...left.passed],
      failed: [...left.failed],
      notScoreable: [...left.notScoreable],
      checkResults: left.checkResults.map((row) => ({
        checkId: row.checkId,
        family: row.family,
        status: row.status,
        ...(row.section ? { section: row.section } : {}),
      })),
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
      scoredWith: rulerVersion,
      outputSource,
      mechanicalCheckScore: right.mechanicalCheckScore,
      passed: [...right.passed],
      failed: [...right.failed],
      notScoreable: [...right.notScoreable],
      checkResults: right.checkResults.map((row) => ({
        checkId: row.checkId,
        family: row.family,
        status: row.status,
        ...(row.section ? { section: row.section } : {}),
      })),
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
    declaredChecks: [...(artifact.checks || [])],
    mechanicalCheckScore: score.mechanicalCheckScore,
    scoreableCount: score.scoreableCount,
    passed: [...score.passed],
    failed: [...score.failed],
    notScoreable: [...score.notScoreable],
    checkResults: score.checkResults.map((row) => ({
      checkId: row.checkId,
      family: row.family,
      status: row.status,
      ...(row.historicalImplementation
        ? { historicalImplementation: true }
        : {}),
      ...(row.section ? { section: row.section } : {}),
    })),
  };
}

function changedStatuses(left, right) {
  const ids = new Set([
    ...left.checkResults.map((r) => r.checkId),
    ...right.checkResults.map((r) => r.checkId),
  ]);
  const map = (score) =>
    Object.fromEntries(score.checkResults.map((r) => [r.checkId, r.status]));
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
  const leftFails = left.failed.filter(
    (id) => !id.startsWith("source_"),
  ).length;
  const rightFails = right.failed.filter(
    (id) => !id.startsWith("source_"),
  ).length;
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
