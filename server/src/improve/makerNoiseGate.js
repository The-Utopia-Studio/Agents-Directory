// The maker's noise gate.
//
// A proposal carries an Approve button, and approving one now moves the Convex
// pointer when the PR merges. So the bar for proposing at all is: at least one
// CLASSIFIED, NON-ADVISORY defect observed on the CURRENT live artifact.
//
// This exists because the maker previously emitted a proposal off a stale
// seeded trace — pinned to biocraft-singleshot-v5 under anthropic/claude, two
// artifact generations behind live — whose only tokens were an unregistered
// runtime string and an advisory CTA observation. Neither is a defect. The
// proposal looked exactly like a real one.
//
// Every rejection is named. Refusing without saying which rule fired is the
// same silent-skip failure the whole system is built to avoid.

import { resolveCheckDefect, parseFailureReasonTokens } from "./checkDefectRegistry.js";
import { FEEDBACK_DEFECTS, TRACE_DEFECTS } from "./heuristicOptimizer.js";
import { TIER_ADVISORY, tierForCheck } from "../eval/checkTiers.js";

export const MAKER_REFUSAL = Object.freeze({
  NO_EVIDENCE: "MAKER_NO_EVIDENCE",
  FIXTURE_EVIDENCE_ONLY: "MAKER_FIXTURE_EVIDENCE_ONLY",
  UNCLASSIFIED_ONLY: "MAKER_UNCLASSIFIED_ONLY",
  ADVISORY_ONLY: "MAKER_ADVISORY_ONLY",
});

export class MakerNoiseGateError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "MakerNoiseGateError";
    this.code = code;
    this.status = 422;
    this.detail = detail;
  }
}

/**
 * Is this evidence row a live observation of the artifact that runs today?
 *
 * Pinned to the current artifact digest, from a real hosted run. A seeded
 * fixture, a canned plumbing row, or a trace against a superseded artifact all
 * fail this — they describe something other than what is deployed.
 */
function livenessOf(row, liveDigest) {
  const digest = String(row?.artifactDigest || "").trim();
  if (!digest) return { live: false, why: "no artifact digest recorded" };
  if (!liveDigest) return { live: false, why: "live artifact digest unknown" };
  if (digest !== liveDigest) {
    return {
      live: false,
      why: `pinned to superseded artifact ${row.artifactVersion || digest.slice(0, 7)}`,
    };
  }
  const outputSource = String(row?.outputSource || "").trim();
  if (outputSource && outputSource !== "live") {
    return { live: false, why: `outputSource ${outputSource}, not live` };
  }
  return { live: true, why: null };
}

/**
 * Classify one token from a live row.
 * @returns {{ kind: "qualifying"|"unclassified"|"advisory", checkId: string, category?: string }}
 */
function classifyToken(token) {
  const checkId = String(token || "").replace(/^mechanical:/, "").trim();
  const entry = resolveCheckDefect(checkId);
  if (!entry) return { kind: "unclassified", checkId };
  if (tierForCheck(checkId) === TIER_ADVISORY) {
    return { kind: "advisory", checkId, category: entry.category };
  }
  return { kind: "qualifying", checkId, category: entry.category };
}

/**
 * Decide whether the maker may propose.
 *
 * @param {object} args
 * @param {object} args.evidence      from collectImprovementEvidence
 * @param {string|null} args.liveArtifactDigest  digest of the artifact running now
 * @returns {{ ok: boolean, refusal: object|null, qualifying: object[], rejected: object[], sawAnyEvidence: boolean, sawLiveEvidence: boolean }}
 */
export function evaluateMakerDefectGate({ evidence = {}, liveArtifactDigest = null } = {}) {
  // Scope: agents with a runtime artifact. Those are the ones whose proposals
  // become a utopia-agents PR and move the Convex pointer on merge, and the
  // only ones for which "observed on the artifact running now" has a meaning.
  // A catalog-defined agent has no artifact bytes and no PR path; gating it on
  // an artifact digest it can never have would refuse every legitimate
  // proposal. Reported as a skip with its reason, never as a silent pass.
  if (!liveArtifactDigest) {
    return {
      ok: true,
      skipped: true,
      skipReason:
        "agent has no runtime artifact — no live digest to observe against, and no PR/pointer path from its proposals",
      refusal: null,
      qualifying: [],
      rejected: [],
      sawAnyEvidence: true,
      sawLiveEvidence: false,
    };
  }

  const failingTraces = evidence.failingTraces || [];
  const mechanicalResults = evidence.mechanicalResults || [];
  const feedback = evidence.feedback || [];

  const sawAnyEvidence =
    failingTraces.length > 0 ||
    mechanicalResults.length > 0 ||
    feedback.length > 0 ||
    (evidence.defectSignals || []).length > 0;

  const qualifying = [];
  const rejected = [];
  let sawLiveEvidence = false;

  // Sources that can carry a check id. Reviewer prose is deliberately not one:
  // a note is human judgement, not an observation of a named check firing.
  const rows = [
    ...failingTraces.map((t) => ({
      kind: "trace",
      id: t.id,
      artifactDigest: t.artifactDigest,
      artifactVersion: t.artifactVersion,
      outputSource: t.outputSource,
      reason: t.failureReason,
      tokens: parseFailureReasonTokens(t.failureReason),
    })),
    ...mechanicalResults.map((r) => ({
      kind: "mechanicalResult",
      id: r.id,
      artifactDigest: r.artifactDigest,
      artifactVersion: r.artifactVersion,
      outputSource: r.outputSource,
      tokens: (r.failed || []).map(String),
    })),
  ];

  for (const row of rows) {
    const liveness = livenessOf(row, liveArtifactDigest);
    if (!liveness.live) {
      rejected.push({
        source: `${row.kind} ${row.id || "(unidentified)"}`,
        reason: "not-live",
        detail: liveness.why,
        tokens: row.tokens,
      });
      continue;
    }
    sawLiveEvidence = true;
    if (!row.tokens.length && row.kind === "mechanicalResult") {
      // A live row that failed nothing is a clean observation, not a defect
      // and not noise. Recorded so the count is visible, never as a rejection.
      rejected.push({
        source: `${row.kind} ${row.id || "(unidentified)"}`,
        reason: "clean",
        detail: "live row with no failing check — nothing to propose against",
        tokens: [],
      });
    } else if (!row.tokens.length) {
      // No check id, but the closed trace-defect catalogue may still classify
      // the prose. "Classified" means resolves in SOME closed vocabulary — the
      // thing being excluded is the maker's own `unclassified:<token>`
      // fallback for a string nothing recognises, which is what produced the
      // bad proposal. A catalogued reviewer defect is a real defect.
      const matched = TRACE_DEFECTS.filter((d) => d.matches(String(row.reason || "")));
      if (matched.length) {
        for (const definition of matched) {
          qualifying.push({
            checkId: `trace-defect:${definition.key}`,
            category: "style",
            source: `${row.kind} ${row.id || "(unidentified)"}`,
            artifactDigest: row.artifactDigest,
          });
        }
      } else {
        rejected.push({
          source: `${row.kind} ${row.id || "(unidentified)"}`,
          reason: "prose",
          detail:
            "failureReason matches no registered check id and no trace-defect catalogue entry",
          tokens: [],
        });
      }
    }
    for (const token of row.tokens) {
      const verdict = classifyToken(token);
      if (verdict.kind === "qualifying") {
        qualifying.push({
          checkId: verdict.checkId,
          category: verdict.category,
          source: `${row.kind} ${row.id || "(unidentified)"}`,
          artifactDigest: row.artifactDigest,
        });
      } else {
        rejected.push({
          source: `${row.kind} ${row.id || "(unidentified)"}`,
          reason: verdict.kind,
          detail:
            verdict.kind === "advisory"
              ? `${verdict.checkId} is advisory — an observation, never a defect`
              : `${verdict.checkId} is not in the check registry`,
          tokens: [token],
        });
      }
    }
  }

  // Reviewer notes that match the closed feedback catalogue. A human saying
  // "it used an em dash" is a classified defect; a human saying something the
  // catalogue does not recognise is judgement the maker must not act on alone.
  const liveTraceIds = new Set(
    rows
      .filter((row) => row.kind === "trace" && livenessOf(row, liveArtifactDigest).live)
      .map((row) => row.id),
  );
  for (const record of feedback) {
    const note = String(record?.notes || "").trim();
    if (!note) continue;
    // A reviewer note is only about the artifact running now if the run it was
    // attached to is. Seeded feedback on a superseded trace is fixture data.
    if (!liveTraceIds.has(record.traceId)) {
      rejected.push({
        source: `feedback ${record.id || "(unidentified)"}`,
        reason: "not-live",
        detail: record.traceId
          ? `attached to trace ${record.traceId}, which is not a live run of the current artifact`
          : "not attached to any run, so it cannot be tied to the current artifact",
        tokens: [],
      });
      continue;
    }
    const matched = FEEDBACK_DEFECTS.filter((d) => d.matches(note));
    for (const definition of matched) {
      qualifying.push({
        checkId: `feedback-defect:${definition.key}`,
        category: "style",
        source: `feedback ${record.id || "(unidentified)"}`,
        artifactDigest: null,
      });
    }
    if (!matched.length) {
      rejected.push({
        source: `feedback ${record.id || "(unidentified)"}`,
        reason: "prose",
        detail: "reviewer note matches no entry in the closed feedback-defect catalogue",
        tokens: [],
      });
    }
  }

  if (qualifying.length) {
    return { ok: true, refusal: null, qualifying, rejected, sawAnyEvidence, sawLiveEvidence };
  }

  const refusal = refusalFor({
    sawAnyEvidence,
    sawLiveEvidence,
    rejected,
    rowCount: rows.length,
  });
  return { ok: false, refusal, qualifying, rejected, sawAnyEvidence, sawLiveEvidence };
}

function refusalFor({ sawAnyEvidence, sawLiveEvidence, rejected, rowCount }) {
  if (!sawAnyEvidence) {
    return {
      code: MAKER_REFUSAL.NO_EVIDENCE,
      message:
        "Maker refused: no evidence at all. There is nothing to propose against, " +
        "and a proposal with no defect behind it is a placeholder with an Approve button.",
    };
  }
  // Only call it fixture evidence when there actually were check-carrying rows
  // and every one of them was stale. Zero such rows is a different failure.
  if (!sawLiveEvidence && rowCount > 0) {
    const why = [...new Set(rejected.map((r) => r.detail).filter(Boolean))];
    return {
      code: MAKER_REFUSAL.FIXTURE_EVIDENCE_ONLY,
      message:
        "Maker refused: every piece of evidence is fixture or superseded, none observed on the artifact running now" +
        (why.length ? ` (${why.join("; ")})` : "") +
        ". Seeded and canned rows describe something other than what is deployed.",
    };
  }
  if (rowCount === 0) {
    return {
      code: MAKER_REFUSAL.UNCLASSIFIED_ONLY,
      message:
        "Maker refused: no live run or mechanical row carrying a check id. Reviewer prose " +
        "and eval notes are human judgement, not a classified defect — they cannot by " +
        "themselves justify a prompt change that will move the approved version.",
    };
  }
  const kinds = new Set(rejected.filter((r) => r.reason !== "not-live").map((r) => r.reason));
  if (kinds.size === 1 && kinds.has("advisory")) {
    return {
      code: MAKER_REFUSAL.ADVISORY_ONLY,
      message:
        "Maker refused: the only live signals are advisory observations. Advisory checks " +
        "are untrustworthy in both directions and never constitute a defect.",
    };
  }
  const tokens = [
    ...new Set(
      rejected
        .filter((r) => r.reason === "unclassified")
        .flatMap((r) => r.tokens || []),
    ),
  ];
  return {
    code: MAKER_REFUSAL.UNCLASSIFIED_ONLY,
    message:
      "Maker refused: live evidence carries no classified defect" +
      (tokens.length ? `; unregistered token(s): ${tokens.join(", ")}` : "") +
      ". An unregistered runtime string is a registry gap to reconcile, not a prompt defect to fix.",
  };
}

/** Throwing form. Status 422, `.code` is one of MAKER_REFUSAL. */
export function assertMakerDefectGate(args) {
  const verdict = evaluateMakerDefectGate(args);
  if (verdict.ok) return verdict;
  throw new MakerNoiseGateError(verdict.refusal.code, verdict.refusal.message, {
    qualifying: verdict.qualifying,
    rejected: verdict.rejected,
  });
}
