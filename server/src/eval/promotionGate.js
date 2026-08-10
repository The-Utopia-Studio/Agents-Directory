// Evidence gate for Railway proposal promotion (approveImprovement).
// Human approval remains required on top of this — this is an additional bar.
// Does not touch Convex release / digest promotion.

import { groundingScoreDelta } from "./compareExperiments.js";
import { LLM_GROUNDING_STATUS } from "./llmGroundingCheck.js";

export const PROMOTION_FAILURE = Object.freeze({
  GUARDRAILS: "guardrails",
  GUARDRAIL_COVERAGE: "guardrail_coverage",
  COMPARABLE_DELTA: "comparable_delta",
  GROUNDING_DELTA: "grounding_delta",
  LLM_GROUNDING: "llm_grounding",
  LLM_GROUNDING_NOT_RUN: "llm_grounding_not_run",
  OUTPUT_SOURCE: "output_source",
  MISSING_EVIDENCE: "missing_evidence",
});

/**
 * @param {{
 *   incumbentScore: object|null,
 *   candidateScore: object|null,
 *   outputSource?: string|null,
 *   scoreDelta?: object|null,
 *   llmGroundingEnabled?: boolean,
 * }} args
 */
export function evaluatePromotionGate({
  incumbentScore,
  candidateScore,
  outputSource = null,
  scoreDelta = null,
  llmGroundingEnabled = false,
}) {
  const failures = [];

  if (outputSource !== "live") {
    failures.push({
      code: PROMOTION_FAILURE.OUTPUT_SOURCE,
      message:
        outputSource == null
          ? 'No live evidence — promotion requires outputSource "live" (canned is excluded).'
          : `Evidence outputSource is "${outputSource}"; only "live" may support promotion.`,
    });
  }

  if (!candidateScore) {
    failures.push({
      code: PROMOTION_FAILURE.MISSING_EVIDENCE,
      message: "No candidate mechanical score record for promotion.",
    });
  } else if (
    !candidateScore.guardrailGate ||
    candidateScore.guardrailGate.passed !== true
  ) {
    const failed = (candidateScore.guardrailGate?.results || [])
      .filter((row) => row.passed === false)
      .map((row) => row.id);
    failures.push({
      code: PROMOTION_FAILURE.GUARDRAILS,
      message: failed.length
        ? `Guardrail gate failed: ${failed.join(", ")}`
        : "Guardrail gate did not pass on the candidate score.",
    });
  } else {
    // 0 executable guardrails is not a pass — skips must not trivially clear
    // the gate. Coverage reporting stays on guardrailGate.coverage.
    const evaluated = Number(
      candidateScore.guardrailGate?.coverage?.evaluated ?? 0,
    );
    if (!Number.isFinite(evaluated) || evaluated <= 0) {
      const summary =
        candidateScore.guardrailGate?.coverage?.summary ||
        "0 of N evaluated (none executable)";
      failures.push({
        code: PROMOTION_FAILURE.GUARDRAIL_COVERAGE,
        message: `Guardrail coverage is zero executable — not promotion-eligible (${summary}).`,
      });
    }
  }

  // LLM grounding: findings are a hard gate; "not run" is never evidence of pass.
  const llmStatus = candidateScore?.llmGroundingStatus || null;
  const llmFindings = [
    ...(candidateScore?.llmGroundingFindings || []),
    ...(candidateScore?.checkResults || []).filter(
      (row) =>
        row?.category === "grounding" &&
        row?.family === "source-grounding-llm" &&
        row?.status === "fail",
    ),
  ];
  if (llmFindings.length || llmStatus === LLM_GROUNDING_STATUS.FAILED) {
    const ids = [
      ...new Set(llmFindings.map((row) => row.checkId || row.claimKind).filter(Boolean)),
    ];
    failures.push({
      code: PROMOTION_FAILURE.LLM_GROUNDING,
      message: ids.length
        ? `LLM grounding checker found contradictions: ${ids.join(", ")}`
        : "LLM grounding checker found contradictions on the candidate.",
    });
  } else if (
    llmGroundingEnabled &&
    llmStatus !== LLM_GROUNDING_STATUS.PASSED
  ) {
    // When LLM grounding is on, only an explicit pass counts. Missing,
    // skipped, or unavailable must not be treated as passed.
    const detail =
      llmStatus === LLM_GROUNDING_STATUS.UNAVAILABLE
        ? "LLM grounding did not run (unavailable)"
        : llmStatus === LLM_GROUNDING_STATUS.SKIPPED
          ? "LLM grounding did not run (skipped)"
          : llmStatus
            ? `LLM grounding status is "${llmStatus}"`
            : "LLM grounding did not run (no status recorded)";
    failures.push({
      code: PROMOTION_FAILURE.LLM_GROUNDING_NOT_RUN,
      message: `${detail}; cannot treat as evidence that grounding passed.`,
    });
  } else if (llmStatus === LLM_GROUNDING_STATUS.UNAVAILABLE) {
    // Feature may be off at approval time, but a score that recorded
    // unavailable still is not a grounding pass.
    failures.push({
      code: PROMOTION_FAILURE.LLM_GROUNDING_NOT_RUN,
      message:
        "LLM grounding did not run (unavailable); cannot treat as evidence that grounding passed.",
    });
  }

  if (!incumbentScore || !candidateScore) {
    if (!incumbentScore) {
      failures.push({
        code: PROMOTION_FAILURE.MISSING_EVIDENCE,
        message: "No incumbent mechanical score record for promotion.",
      });
    }
    return {
      eligible: false,
      failures,
      scoreDelta: scoreDelta || null,
    };
  }

  const requireRulerMatch = Boolean(
    incumbentScore.rulerVersion || candidateScore.rulerVersion,
  );
  const delta =
    scoreDelta && typeof scoreDelta.comparable === "boolean"
      ? scoreDelta
      : groundingScoreDelta(incumbentScore, candidateScore, {
          requireRulerMatch,
        });

  if (!delta.comparable) {
    failures.push({
      code: PROMOTION_FAILURE.COMPARABLE_DELTA,
      message: `No comparable grounding delta: ${delta.reason || "not comparable"}`,
    });
  } else if (typeof delta.value !== "number" || delta.value < 0) {
    failures.push({
      code: PROMOTION_FAILURE.GROUNDING_DELTA,
      message: `Grounding delta is ${delta.value}; promotion requires a non-negative grounding delta.`,
    });
  }

  // Deduplicate by code while preserving order.
  const seen = new Set();
  const unique = [];
  for (const failure of failures) {
    if (seen.has(failure.code)) continue;
    seen.add(failure.code);
    unique.push(failure);
  }

  return {
    eligible: unique.length === 0,
    failures: unique,
    scoreDelta: delta,
  };
}

/**
 * Find a live incumbent/candidate pair that could support promotion.
 * Prefers explicit output_quality pairs (matched via comparedTo), else two
 * live singles that share checkSetId (+ rulerVersion when present).
 */
export function resolveLivePromotionPair(
  rows,
  { incumbentVersion, challengerVersion = null } = {},
) {
  const live = (rows || []).filter(
    (row) =>
      row &&
      row.outputSource === "live" &&
      row.checkSetId &&
      row.artifactVersion &&
      row.provider &&
      row.modelId,
  );
  if (!live.length || !incumbentVersion) return null;

  // Paired compare rows first.
  for (const right of live) {
    if (challengerVersion && right.artifactVersion !== challengerVersion) {
      continue;
    }
    if (right.artifactVersion === incumbentVersion) continue;
    if (right.experiment && right.experiment !== "output_quality") continue;
    if (!right.comparedTo) continue;
    const left = live.find(
      (row) =>
        row.artifactVersion === incumbentVersion &&
        row.comparedTo === right.artifactVersion &&
        row.checkSetId === right.checkSetId &&
        (row.rulerVersion || null) === (right.rulerVersion || null) &&
        row.provider === right.provider &&
        row.modelId === right.modelId &&
        row.experiment === right.experiment,
    );
    if (!left) continue;
    return {
      incumbentScore: left,
      candidateScore: right,
      outputSource: "live",
      source: "compare_pair",
    };
  }

  // Fallback: latest live single per version with matching identity.
  const incumbents = live
    .filter((row) => row.artifactVersion === incumbentVersion && !row.comparedTo)
    .sort((a, b) => String(b.timestamp || b.ts).localeCompare(String(a.timestamp || a.ts)));
  const incumbent = incumbents[0];
  if (!incumbent) return null;

  const challengers = live
    .filter(
      (row) =>
        row.artifactVersion !== incumbentVersion &&
        (!challengerVersion || row.artifactVersion === challengerVersion) &&
        !row.comparedTo &&
        row.checkSetId === incumbent.checkSetId &&
        (row.rulerVersion || null) === (incumbent.rulerVersion || null) &&
        row.provider === incumbent.provider &&
        row.modelId === incumbent.modelId,
    )
    .sort((a, b) => String(b.timestamp || b.ts).localeCompare(String(a.timestamp || a.ts)));

  const candidate = challengers[0];
  if (!candidate) return null;

  return {
    incumbentScore: incumbent,
    candidateScore: candidate,
    outputSource: "live",
    source: "single_scores",
  };
}
