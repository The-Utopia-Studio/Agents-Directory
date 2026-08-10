// Live LLM-grounding calibration — human labels on real findings.
// Without this there is no false-positive rate; promotion cannot know whether
// the signal is measured.
//
// Traces stay digests-only. Privileged groundingEvidence keeps raw spans for
// reviewer calibration. Labels land in groundingCalibration (append-only).

import { createHash } from "node:crypto";

export const GROUNDING_VERDICT = Object.freeze({
  TRUE_POSITIVE: "true_positive",
  FALSE_POSITIVE: "false_positive",
});

export const GROUNDING_EVIDENCE_COLLECTION = "groundingEvidence";
export const GROUNDING_CALIBRATION_COLLECTION = "groundingCalibration";

function normalizeClaimText(text) {
  let out = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  out = out.replace(
    /^(?:i\s+have|i'?ve|with|including|claiming|stating)\s+/i,
    "",
  );
  return out.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export function digestSpan(text) {
  const normalized = normalizeClaimText(text);
  if (!normalized) return null;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Recover the substring whose normalised digest matches. Used when a reviewer
 * pastes draft/source after the fact (historical traces have digests only).
 */
export function findTextForDigest(haystack, digest) {
  const target = String(digest || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(target)) return null;
  const text = String(haystack || "");
  if (!text) return null;
  if (digestSpan(text) === target) return text.trim();

  // Prefer word windows (typical claimSpan), then character windows as fallback.
  const words = text.split(/(\s+)/).filter((part) => part.length);
  const tokens = [];
  for (const part of words) {
    if (/^\s+$/.test(part)) {
      if (tokens.length) tokens[tokens.length - 1].spaceAfter = part;
      continue;
    }
    tokens.push({ word: part, spaceAfter: "" });
  }
  for (let i = 0; i < tokens.length; i++) {
    let built = "";
    for (let j = i; j < tokens.length; j++) {
      built += (j === i ? "" : tokens[j - 1].spaceAfter || " ") + tokens[j].word;
      if (digestSpan(built) === target) return built.trim();
    }
  }
  const max = Math.min(text.length, 400);
  for (let len = Math.min(max, text.length); len >= 3; len--) {
    for (let i = 0; i + len <= text.length; i++) {
      const slice = text.slice(i, i + len);
      if (digestSpan(slice) === target) return slice.trim();
    }
  }
  return null;
}

export function summarizeCalibration(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let truePositive = 0;
  let falsePositive = 0;
  for (const row of list) {
    if (row?.verdict === GROUNDING_VERDICT.TRUE_POSITIVE) truePositive += 1;
    else if (row?.verdict === GROUNDING_VERDICT.FALSE_POSITIVE) falsePositive += 1;
  }
  const labeled = truePositive + falsePositive;
  const systematic = systematicFalsePositiveChecks(list);
  return {
    labeled,
    truePositive,
    falsePositive,
    falsePositiveRate:
      labeled > 0 ? Math.round((falsePositive / labeled) * 1000) / 1000 : null,
    truePositiveRate:
      labeled > 0 ? Math.round((truePositive / labeled) * 1000) / 1000 : null,
    systematicCheckProblems: systematic,
  };
}

/**
 * False-positive labels that apply to a specific finding (trace + check, or
 * matching digests). Used to strip that check id from defect collection.
 */
export function falsePositiveExclusions(calibrationRows, { agentId = null } = {}) {
  const out = [];
  for (const row of calibrationRows || []) {
    if (row?.verdict !== GROUNDING_VERDICT.FALSE_POSITIVE) continue;
    if (agentId && row.agentId && row.agentId !== agentId) continue;
    const checkId = String(row.checkId || "").trim();
    if (!checkId) continue;
    out.push({
      checkId,
      agentId: row.agentId || null,
      traceId: row.traceId || null,
      claimSpanDigest: row.claimSpanDigest || null,
      sourceSpanDigest: row.sourceSpanDigest || null,
    });
  }
  return out;
}

/** True when this check result on this trace is a calibrated false positive. */
export function isCalibratedFalsePositive(checkId, trace, exclusions = []) {
  const id = String(checkId || "").trim();
  if (!id || !exclusions.length) return false;
  const traceId = trace?.id || null;
  const results = Array.isArray(trace?.checkResults) ? trace.checkResults : [];
  const matchingRows = results.filter((row) => String(row?.checkId || "") === id);

  for (const ex of exclusions) {
    if (ex.checkId !== id) continue;
    // Exact finding: same trace (+ digests when present on both sides).
    if (ex.traceId && traceId && ex.traceId === traceId) {
      if (ex.claimSpanDigest || ex.sourceSpanDigest) {
        const digestHit = matchingRows.some(
          (row) =>
            (!ex.claimSpanDigest ||
              row.claimSpanDigest === ex.claimSpanDigest) &&
            (!ex.sourceSpanDigest ||
              row.sourceSpanDigest === ex.sourceSpanDigest),
        );
        // Trace-level FP with digests: require a digest match when the trace
        // still carries check rows; if rows were stripped, trust traceId+checkId.
        if (matchingRows.length && !digestHit) continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Same check id marked FP across distinct cases (traces) → checker problem,
 * not an agent defect. minCases defaults to 2.
 */
export function systematicFalsePositiveChecks(
  calibrationRows,
  { minCases = 2 } = {},
) {
  const byCheck = new Map();
  for (const row of calibrationRows || []) {
    if (row?.verdict !== GROUNDING_VERDICT.FALSE_POSITIVE) continue;
    const checkId = String(row.checkId || "").trim();
    if (!checkId) continue;
    const caseKey = row.traceId || row.id || row.claimSpanDigest || "unknown";
    if (!byCheck.has(checkId)) byCheck.set(checkId, new Set());
    byCheck.get(checkId).add(caseKey);
  }
  const problems = [];
  for (const [checkId, cases] of byCheck) {
    if (cases.size < minCases) continue;
    problems.push({
      checkId,
      falsePositiveCases: cases.size,
      message: `${checkId} marked false positive on ${cases.size} distinct cases — fix the checker, not the agent`,
    });
  }
  return problems;
}

/**
 * Drop calibrated-FP check ids from a failing trace's failureReason / checkResults
 * for maker consumption. Returns null if nothing actionable remains.
 */
export function sanitizeFailingTraceForMaker(trace, exclusions, systematicCheckIds = new Set()) {
  if (!trace) return null;
  const checkResults = Array.isArray(trace.checkResults) ? trace.checkResults : [];
  const keptResults = checkResults.filter((row) => {
    const id = String(row?.checkId || "").trim();
    if (!id) return true;
    if (systematicCheckIds.has(id)) return false;
    if (isCalibratedFalsePositive(id, trace, exclusions)) return false;
    return true;
  });
  const reasonTokens = String(trace.failureReason || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((token) => {
      if (systematicCheckIds.has(token)) return false;
      if (isCalibratedFalsePositive(token, trace, exclusions)) return false;
      return true;
    });
  if (!keptResults.length && !reasonTokens.length) {
    // Trace had only FP / systematic-check failures — not an agent defect.
    return null;
  }
  return {
    ...trace,
    failureReason: reasonTokens.length ? reasonTokens.join(", ") : null,
    checkResults: keptResults,
  };
}

/** First live finding — FP confirmed by reviewer 2026-08-10. Spans unrecovered. */
export const SEED_CALIBRATION_FINDINGS = Object.freeze([
  {
    id: "calib_msnd0b5e_gzoh_employer_frame",
    agentId: "A7",
    traceId: "traces_msnd0b5e_gzoh",
    checkId: "source_claim_employer_frame",
    claimKind: "employer_frame",
    claimSpanDigest:
      "1d5e0098eb27ce2c0a271ae55f8cb78c271ba3d578083e1db871ad948ed6f171",
    sourceSpanDigest:
      "7e75b27dabc537b045e234fc79359f06fd6800e11f6400e3bd7f7bb82e0b1ea9",
    verdict: GROUNDING_VERDICT.FALSE_POSITIVE,
    reviewedAt: "2026-08-10T15:05:00.000Z",
    notes:
      "Reviewer: draft line about Rock River Research / Pearlify / collaborating with Hutcheon Mearns was accurate (Hutcheon Mearns was client/collaborator while employed at Rock River). claimSpanDigest does not match the full quoted sentence — model likely flagged a shorter span (e.g. collaborated-with framing). sourceSpan text was not retained on this trace (pre-evidence store); unrecovered. Do not loosen the check on one FP.",
    spansRecovered: false,
    reviewerClaimSketch:
      "At Rock River Research, I worked on the Pearlify AI platform, collaborated with Hutcheon Mearns",
  },
]);
