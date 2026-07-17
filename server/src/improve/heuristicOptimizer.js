// Heuristic reflective optimizer. Fully offline, no external calls, no cost.
// It reads the failing traces + the latest eval's known issues, clusters the
// dominant failure signal, and emits a concrete, human-reviewable proposal.
//
// It is deliberately the same INTERFACE as the GEPA adapter, so the loop is
// exercisable today and you can flip OPTIMIZER=gepa without touching callers.
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

    async propose(agent, traces, latestEval) {
      const reasons = traces.map((t) => t.failureReason).filter(Boolean);
      const outputs = traces.filter((t) => t.status !== "ok").map((t) => t.output).filter(Boolean);
      const corpus = [...reasons, latestEval?.knownIssues, latestEval?.notes].filter(Boolean);
      const signals = topSignal([...reasons, ...corpus]);
      const dominant = reasons.length
        ? mode(reasons)
        : latestEval?.knownIssues || "the most frequent failure in recent runs";

      const n = traces.length;
      const failing = traces.filter((t) => t.status !== "ok").length;
      const gain = Math.min(25, 6 + failing * 2 + signals.length * 2);

      return {
        source: "heuristic",
        status: "proposed",
        date: new Date().toISOString().slice(0, 10),
        summary: `Prompt/skill revision targeting: ${dominant}`,
        detail:
          `Reviewed ${n} recent trace(s), ${failing} failing. Dominant failure signal: "${dominant}"` +
          (signals.length ? ` (keywords: ${signals.join(", ")}).` : ".") +
          ` Proposed change: add an explicit guardrail + a check step to the prompt that addresses "${dominant}",` +
          ` and regenerate any output that trips the check. Re-run the eval set to confirm before approving.`,
        expectedGain: gain,
        evidence: { tracesReviewed: n, failing, signals, sampleOutputs: outputs.slice(0, 2) },
      };
    },
  };
}

function mode(arr) {
  const f = new Map();
  for (const x of arr) f.set(x, (f.get(x) || 0) + 1);
  return [...f.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
