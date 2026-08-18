// Holdout split: sealed golden cases never reach the maker. Scoring may use
// every case but must report sealed and unsealed separately — never one average.

import { getGoldenCase, listGoldenCases } from "./goldenCases.js";
import {
  readGroundingPassRate,
  readGroundingScoreableCount,
} from "./scoreMechanicalOutput.js";

export function isSealedGoldenCase(caseOrId) {
  if (!caseOrId) return false;
  if (typeof caseOrId === "object") {
    if (caseOrId.sealed === true) return true;
    return isSealedGoldenCaseId(caseOrId.id || caseOrId.goldenCaseId);
  }
  return isSealedGoldenCaseId(caseOrId);
}

export function isSealedGoldenCaseId(caseId) {
  const id = String(caseId || "").trim();
  if (!id) return false;
  return getGoldenCase(id)?.sealed === true;
}

export function holdoutSplitForCase(caseId) {
  return isSealedGoldenCaseId(caseId) ? "sealed" : "unsealed";
}

/** Mechanical rows the maker may see — live only, never a sealed holdout. */
export function mechanicalResultsForMaker(rows = []) {
  return rows.filter((row) => {
    if (row?.outputSource !== "live") return false;
    if (row?.sealed === true) return false;
    if (isSealedGoldenCaseId(row?.goldenCaseId)) return false;
    return true;
  });
}

function sealedLeaksInMakerEvidence(evidence = {}) {
  const leaks = [];
  for (const row of evidence.mechanicalResults || []) {
    if (row?.sealed === true || isSealedGoldenCaseId(row?.goldenCaseId)) {
      leaks.push(row.goldenCaseId || "(mechanicalResult)");
    }
  }
  for (const id of evidence.goldenCaseIds || []) {
    if (isSealedGoldenCaseId(id)) leaks.push(id);
  }
  for (const row of evidence.goldenCases || []) {
    if (isSealedGoldenCase(row)) leaks.push(row.id || row.goldenCaseId || "(goldenCase)");
  }
  if (isSealedGoldenCaseId(evidence.goldenCaseId)) {
    leaks.push(evidence.goldenCaseId);
  }
  if (isSealedGoldenCase(evidence.goldenCase)) {
    leaks.push(evidence.goldenCase.id || "(goldenCase)");
  }
  return [...new Set(leaks.filter(Boolean))];
}

/**
 * Throw if a sealed holdout case is present in maker evidence.
 * Call this where the maker assembles or consumes its input.
 */
export function assertNoSealedGoldenCasesForMaker(evidence = {}) {
  const leaks = sealedLeaksInMakerEvidence(evidence);
  if (!leaks.length) return;
  throw Object.assign(
    new Error(
      `Sealed golden cases cannot reach the maker: ${leaks.join(", ")}`,
    ),
    { status: 422 },
  );
}

/**
 * Partition scored results. Never returns a combined average, and never a
 * field called "scores" — that name invited reading a grounding-only rate as
 * whole-agent quality. Each rate is named for what it measures and carries its
 * denominator and the check ids that produced it.
 *
 * @param {Array<{ sealed?: boolean, caseId?: string }>} results
 */
function rateSideFor(rows) {
  return {
    caseIds: rows.map((r) => r.caseId),
    groundingPassRates: rows.map((r) => ({
      caseId: r.caseId,
      passRate: readGroundingPassRate(r),
      scoreableCount: readGroundingScoreableCount(r),
      basisCheckIds:
        r.groundingBasisCheckIds ?? r.byCategory?.grounding?.basisCheckIds ?? null,
    })),
    stylePassRates: rows.map((r) => ({
      caseId: r.caseId,
      passRate: r.stylePassRate ?? r.byCategory?.style?.passRate ?? null,
      scoreableCount:
        r.styleScoreableCount ?? r.byCategory?.style?.scoreableCount ?? null,
      basisCheckIds: r.styleBasisCheckIds ?? r.byCategory?.style?.basisCheckIds ?? null,
    })),
    results: rows,
  };
}

export function scoresByHoldout(results = []) {
  const sealed = [];
  const unsealed = [];
  for (const row of results) {
    if (row?.sealed === true) sealed.push(row);
    else unsealed.push(row);
  }
  return {
    unsealed: rateSideFor(unsealed),
    sealed: rateSideFor(sealed),
    averaged: false,
    // Sealed and unsealed are different cases with different grounding
    // anchors, so they never shared a denominator to begin with.
    sealedAndUnsealedComparable: false,
  };
}

export function listGoldenCasesByHoldout(agentId) {
  const cases = listGoldenCases(agentId);
  return {
    unsealed: cases.filter((c) => c.sealed !== true),
    sealed: cases.filter((c) => c.sealed === true),
  };
}
