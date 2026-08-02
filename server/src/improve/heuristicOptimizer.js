// Heuristic reflective optimizer. Fully offline, no external calls, no cost.
// It reads real defect signals — reviewer feedback notes, failing-trace
// reasons, eval known issues — clusters the dominant one, and emits a
// concrete, human-reviewable proposal.
//
// It is deliberately the same INTERFACE as the GEPA adapter, so the loop is
// exercisable today and you can flip OPTIMIZER=gepa without touching callers.
//
// It has no template fallback. With no defect signal it refuses, because a
// proposal carries an Approve button and must never be backed by a sentence
// the optimizer wrote about itself.
const STOP = new Set(["the", "a", "an", "to", "of", "and", "or", "is", "in", "on", "for", "with", "without", "too", "not", "no"]);

function topSignal(texts) {
  const freq = new Map();
  for (const t of texts) {
    for (const w of String(t).toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []) {
      if (STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
}

export function createHeuristicOptimizer() {
  return {
    name: "heuristic",

    async health() { return { ok: true, detail: "offline reflective heuristic" }; },

    async propose(agent, evidence) {
      const {
        traces = [],
        failingTraces = [],
        feedback = [],
        lowRatings = [],
        defectSignals = [],
      } = evidence || {};

      const dominant = defectSignals.length ? mode(defectSignals) : "";
      if (!dominant) {
        // Belt and braces: the service refuses first, but an optimizer must
        // never be the component that invents a signal to fill a template.
        throw Object.assign(
          new Error(
            "Heuristic optimizer has no defect signal to propose against — refusing rather than emitting a placeholder",
          ),
          { status: 422 },
        );
      }

      const signals = topSignal(defectSignals);
      const ratedFeedback = feedback.filter((f) => typeof f.rating === "number");
      const gain = Math.min(
        25,
        6 + failingTraces.length * 2 + lowRatings.length * 3 + signals.length * 2,
      );

      const sources = [
        `${traces.length} trace(s) (${failingTraces.length} failing)`,
        `${feedback.length} feedback record(s)`,
        `${defectSignals.length} defect signal(s)`,
      ].join(", ");

      return {
        source: "heuristic",
        status: "proposed",
        date: new Date().toISOString().slice(0, 10),
        summary: `Prompt/skill revision targeting: ${dominant}`,
        detail:
          `Reviewed ${sources}.` +
          ` Dominant defect signal: "${dominant}"` +
          (signals.length ? ` (keywords: ${signals.join(", ")}).` : ".") +
          ` Proposed change: add an explicit guardrail + a check step to the prompt that addresses "${dominant}",` +
          ` and regenerate any output that trips the check. Re-run the eval set to confirm before approving.`,
        expectedGain: gain,
        evidence: {
          tracesReviewed: traces.length,
          failing: failingTraces.length,
          feedbackReviewed: feedback.length,
          lowRatings: lowRatings.length,
          averageRating: ratedFeedback.length
            ? Number(
                (
                  ratedFeedback.reduce((sum, f) => sum + f.rating, 0) /
                  ratedFeedback.length
                ).toFixed(2),
              )
            : undefined,
          signals,
          defectSignals: defectSignals.slice(0, 5),
        },
      };
    },
  };
}

function mode(arr) {
  const f = new Map();
  for (const x of arr) f.set(x, (f.get(x) || 0) + 1);
  return [...f.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
