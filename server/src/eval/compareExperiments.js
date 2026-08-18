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
// Deltas are only produced when both sides share the same checkSetId (and, when
// a ruler is involved, the same rulerVersion). Nothing overwrites a recorded
// version to manufacture comparability.

import { loadHistoricalArtifact } from "./historicalArtifacts.js";
import {
  readGroundingPassRate,
  readGroundingScoreableCount,
} from "./scoreMechanicalOutput.js";

export const EXPERIMENT_CHECK_COVERAGE = "check_coverage";
export const EXPERIMENT_OUTPUT_QUALITY = "output_quality";

export const EXPERIMENTS = Object.freeze([
  EXPERIMENT_CHECK_COVERAGE,
  EXPERIMENT_OUTPUT_QUALITY,
]);

export const REASON_PRE_CHECKSET_VERSIONING =
  "recorded before check-set versioning";

export const REASON_PRE_MODEL_IDENTITY =
  "recorded before model identity";

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

/**
 * Refuse a rate comparison whose denominators were built from different checks.
 *
 * checkSetId already refuses a changed *declared* set. This refuses a changed
 * *contributing* set — the pool that actually produced the rate. They are not
 * the same thing: retiering two checks out of the scored style pool left the
 * declared set intact while the style pass rate rose 57.1 → 80 on byte-identical
 * output with identical defects. Labelling that "non-comparable" is not enough;
 * a number that cannot be compared must not be handed back as a delta at all.
 *
 * @param {{passRate?: number|null, scoreableCount?: number, basisCheckIds?: string[]}} left
 * @param {{passRate?: number|null, scoreableCount?: number, basisCheckIds?: string[]}} right
 */
export function rateDelta(left, right, label = "rate") {
  const leftIds = Array.isArray(left?.basisCheckIds) ? [...left.basisCheckIds].sort() : null;
  const rightIds = Array.isArray(right?.basisCheckIds) ? [...right.basisCheckIds].sort() : null;
  const meta = {
    label,
    leftScoreableCount: left?.scoreableCount ?? null,
    rightScoreableCount: right?.scoreableCount ?? null,
    leftBasisCheckIds: leftIds,
    rightBasisCheckIds: rightIds,
  };

  // A rate with no recorded basis cannot be shown to be comparable. Rows
  // written before the basis was recorded are "not measured", never "equal".
  if (!leftIds || !rightIds) {
    return {
      comparable: false,
      reason: `${label}: rate basis not recorded on one or both sides — cannot show the denominators match`,
      ...meta,
    };
  }

  const added = rightIds.filter((id) => !leftIds.includes(id));
  const removed = leftIds.filter((id) => !rightIds.includes(id));
  if (added.length || removed.length) {
    const parts = [];
    if (removed.length) parts.push(`removed ${removed.join(", ")}`);
    if (added.length) parts.push(`added ${added.join(", ")}`);
    return {
      comparable: false,
      reason:
        `${label}: denominator changed (${leftIds.length} → ${rightIds.length} checks; ${parts.join("; ")}). ` +
        `A rate over a different check set is not a delta.`,
      denominatorChanged: true,
      addedCheckIds: added,
      removedCheckIds: removed,
      ...meta,
    };
  }

  if (typeof left.passRate !== "number" || typeof right.passRate !== "number") {
    return {
      comparable: false,
      reason: `${label}: one or both sides have no measurement`,
      ...meta,
    };
  }

  return {
    comparable: true,
    value: Math.round((right.passRate - left.passRate) * 10) / 10,
    ...meta,
  };
}

/** Style pass-rate delta, under the same denominator guard as grounding. */
export function styleRateDelta(leftScore, rightScore) {
  return rateDelta(
    {
      passRate: leftScore?.stylePassRate ?? leftScore?.byCategory?.style?.passRate ?? null,
      scoreableCount:
        leftScore?.styleScoreableCount ?? leftScore?.byCategory?.style?.scoreableCount ?? null,
      basisCheckIds:
        leftScore?.styleBasisCheckIds ?? leftScore?.byCategory?.style?.basisCheckIds ?? null,
    },
    {
      passRate: rightScore?.stylePassRate ?? rightScore?.byCategory?.style?.passRate ?? null,
      scoreableCount:
        rightScore?.styleScoreableCount ?? rightScore?.byCategory?.style?.scoreableCount ?? null,
      basisCheckIds:
        rightScore?.styleBasisCheckIds ?? rightScore?.byCategory?.style?.basisCheckIds ?? null,
    },
    "style pass rate",
  );
}

export function checkSetsEqual(leftChecks = [], rightChecks = []) {
  const a = [...leftChecks].sort();
  const b = [...rightChecks].sort();
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function scoreableCheckCount(score) {
  return (score.checkResults || []).filter((r) => {
    const tier = r.tier;
    if (tier && tier !== "scored") return false;
    if (r.status === "observation" || r.status === "no_hit") return false;
    return (
      r.passed === true ||
      r.passed === false ||
      r.status === "pass" ||
      r.status === "fail"
    );
  }).length;
}

/**
 * Explicit delta state — never a bare null.
 * Comparability is checkSetId + model identity (+ optional rulerVersion),
 * never artifactVersion alone.
 *
 * @param {object} left
 * @param {object} right
 * @param {{ requireRulerMatch?: boolean }} [opts]
 */
export function groundingScoreDelta(left, right, opts = {}) {
  const requireRulerMatch = Boolean(opts.requireRulerMatch);
  const leftCount = scoreableCheckCount(left);
  const rightCount = scoreableCheckCount(right);
  const leftId = left.checkSetId || null;
  const rightId = right.checkSetId || null;
  const leftRuler = left.rulerVersion || null;
  const rightRuler = right.rulerVersion || null;
  const leftModel = left.modelId || null;
  const rightModel = right.modelId || null;
  const leftProvider = left.provider || null;
  const rightProvider = right.provider || null;
  const eitherLive =
    left.outputSource === "live" || right.outputSource === "live";
  const leftRealModel =
    leftProvider && leftProvider !== "fixture" && leftModel
      ? true
      : false;
  const rightRealModel =
    rightProvider && rightProvider !== "fixture" && rightModel
      ? true
      : false;
  const eitherRealModel = leftRealModel || rightRealModel;

  const baseMeta = {
    leftCheckCount: leftCount,
    rightCheckCount: rightCount,
    leftCheckSetId: leftId,
    rightCheckSetId: rightId,
    leftRulerVersion: leftRuler,
    rightRulerVersion: rightRuler,
    leftModelId: leftModel,
    rightModelId: rightModel,
    leftProvider,
    rightProvider,
  };

  if (!leftId || !rightId) {
    return {
      comparable: false,
      reason: REASON_PRE_CHECKSET_VERSIONING,
      ...baseMeta,
    };
  }

  if (leftId !== rightId) {
    return {
      comparable: false,
      reason: `check set changed: ${leftCount} checks → ${rightCount} checks`,
      ...baseMeta,
    };
  }

  if (requireRulerMatch || leftRuler || rightRuler) {
    if (!leftRuler || !rightRuler || leftRuler !== rightRuler) {
      return {
        comparable: false,
        reason: "ruler version mismatch",
        ...baseMeta,
      };
    }
  }

  // Live scores (and any row that already carries a real model pin) must match
  // on provider + modelId. Fixture/canned plumbing stays comparable without a
  // model. Missing pins on live rows get an explicit migration reason.
  if (eitherLive || eitherRealModel) {
    if (!leftModel || !rightModel || !leftProvider || !rightProvider || leftProvider === "fixture" || rightProvider === "fixture") {
      return {
        comparable: false,
        reason: REASON_PRE_MODEL_IDENTITY,
        ...baseMeta,
      };
    }
    if (leftProvider !== rightProvider || leftModel !== rightModel) {
      return {
        comparable: false,
        reason: `model mismatch: ${leftProvider}/${leftModel} → ${rightProvider}/${rightModel}`,
        ...baseMeta,
      };
    }
  }

  const leftScore = left.byCategory?.grounding?.passRate;
  const rightScore = right.byCategory?.grounding?.passRate;
  const groundingScoreable = (score) => {
    const fromCat = score.byCategory?.grounding?.scoreableCount;
    if (typeof fromCat === "number") return fromCat;
    return (score.checkResults || []).filter(
      (row) =>
        row.category === "grounding" &&
        (row.passed === true || row.passed === false),
    ).length;
  };
  const leftScoreable = groundingScoreable(left);
  const rightScoreable = groundingScoreable(right);
  if (
    typeof leftScore !== "number" ||
    typeof rightScore !== "number" ||
    leftScoreable <= 0 ||
    rightScoreable <= 0
  ) {
    return {
      comparable: false,
      reason:
        "no grounding delta — one or both sides have no grounding measurement",
      ...baseMeta,
    };
  }

  // Same denominator guard the style rate gets. A matching checkSetId means the
  // declared set matched; it does not prove the contributing pool did.
  const basis = rateDelta(
    {
      passRate: leftScore,
      scoreableCount: leftScoreable,
      basisCheckIds:
        left.groundingBasisCheckIds ?? left.byCategory?.grounding?.basisCheckIds ?? null,
    },
    {
      passRate: rightScore,
      scoreableCount: rightScoreable,
      basisCheckIds:
        right.groundingBasisCheckIds ?? right.byCategory?.grounding?.basisCheckIds ?? null,
    },
    "grounding pass rate",
  );
  if (basis.denominatorChanged) {
    return {
      comparable: false,
      reason: basis.reason,
      denominatorChanged: true,
      addedCheckIds: basis.addedCheckIds,
      removedCheckIds: basis.removedCheckIds,
      ...baseMeta,
    };
  }

  return {
    comparable: true,
    value: Math.round((rightScore - leftScore) * 10) / 10,
    leftBasisCheckIds: basis.leftBasisCheckIds,
    rightBasisCheckIds: basis.rightBasisCheckIds,
    ...baseMeta,
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
    groundingPassRateDelta: delta,
    // Under the same denominator guard: a style rate over a different
    // contributing check set is refused, not reported as an improvement.
    stylePassRateDelta: styleRateDelta(left, right),
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

  const leftForDelta = {
    ...left,
    outputSource,
    provider: leftGeneration?.provider || left.provider || null,
    modelId: leftGeneration?.modelId || left.modelId || null,
  };
  const rightForDelta = {
    ...right,
    outputSource,
    provider: rightGeneration?.provider || right.provider || null,
    modelId: rightGeneration?.modelId || right.modelId || null,
  };

  const leftArtifact = loadHistoricalArtifact(leftArtifactVersion);
  const rightArtifact = loadHistoricalArtifact(rightArtifactVersion);
  const comparability = comparabilityForVersions(leftArtifact, rightArtifact);

  // Ruler + model are part of comparison identity — never overwrite recorded
  // fields to force a match.
  const delta = groundingScoreDelta(leftForDelta, rightForDelta, {
    requireRulerMatch: true,
  });

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
    groundingPassRateDelta: delta,
    stylePassRateDelta: styleRateDelta(left, right),
    // Comparable plumbing deltas are real numbers; they are not promotion
    // evidence. Callers must not show a delta beside a silent promotion block.
    promotionEligible: isLive && delta.comparable,
    promotionEligibility: isLive
      ? delta.comparable
        ? {
            eligible: true,
            reason: null,
          }
        : {
            eligible: false,
            reason: delta.reason || "grounding delta not comparable",
          }
      : {
          eligible: false,
          reason:
            'Comparable delta is real but not promotion-eligible — outputSource is "canned"; only "live" may support promotion.',
        },
    left: {
      ...summarizeScore(left, leftArtifact),
      artifactVersion: leftArtifact.artifactVersion,
      artifactDigest: leftArtifact.artifactDigest,
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
    checkSetId: score.checkSetId || null,
    checkSetVersion: score.checkSetVersion || null,
    rulerVersion: score.rulerVersion || null,
    scoredWith: score.rulerVersion || score.artifactVersion || null,
    declaredChecks: [...(artifact.checks || [])],
    groundingPassRate: readGroundingPassRate(score),
    groundingScoreableCount: readGroundingScoreableCount(score),
    groundingBasisCheckIds:
      score.groundingBasisCheckIds ?? score.byCategory?.grounding?.basisCheckIds ?? null,
    stylePassRate: score.stylePassRate,
    styleScoreableCount: score.styleScoreableCount,
    styleBasisCheckIds:
      score.styleBasisCheckIds ?? score.byCategory?.style?.basisCheckIds ?? null,
    byCategory: score.byCategory
      ? {
          grounding: { ...score.byCategory.grounding },
          style: { ...score.byCategory.style },
        }
      : null,
    guardrailGate: score.guardrailGate
      ? {
          passed: score.guardrailGate.passed,
          results: (score.guardrailGate.results || []).map((row) => ({
            id: row.id,
            passed: row.passed,
            why: row.why == null ? null : row.why,
            source: row.source,
          })),
          coverage: score.guardrailGate.coverage
            ? { ...score.guardrailGate.coverage }
            : null,
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
