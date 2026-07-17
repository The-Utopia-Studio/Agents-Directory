// Heuristic verifier — the CHECKER in the maker/checker split. Deliberately a
// different perspective from the optimizer (the maker): the optimizer wants to
// ship a fix; the verifier's job is to be skeptical before a proposal reaches a
// human or gets auto-applied. Offline, no external calls.
//
// Returns { verdict: "ship"|"hold"|"reject", confidence: 0..1, reasons[] }.
//   ship   — addresses a real, evidenced failure with meaningful expected gain
//   hold   — plausible but needs a human (low evidence or small gain)
//   reject — no evidence, or looks like a no-op / guardrail risk
export function createHeuristicVerifier({ minGain = 8, shipGain = 15 } = {}) {
  return {
    name: "heuristic",

    async health() { return { ok: true, detail: "offline skeptic" }; },

    async assess(agent, proposal, traces = [], latestEval) {
      const reasons = [];
      const failing = traces.filter((t) => t.status !== "ok").length;
      const gain = proposal.expectedGain ?? 0;
      const dominant = (proposal.evidence?.signals || [])[0] || latestEval?.knownIssues || "";
      const addressesEvidence = dominant && new RegExp(dominant.slice(0, 6), "i").test(proposal.summary + " " + proposal.detail);

      // Guardrail safety: a proposal must not contradict a stated guardrail.
      const guardrailRisk = (agent.guardrails || []).some((g) =>
        /never|no |avoid/i.test(g) && new RegExp(g.replace(/never|no |avoid/i, "").trim().slice(0, 8), "i").test(proposal.detail || "")
      );
      if (guardrailRisk) reasons.push("may conflict with a guardrail");

      let verdict, confidence;
      if (!failing && !latestEval?.knownIssues) {
        verdict = "reject"; confidence = 0.7;
        reasons.push("no failing signal to justify a change");
      } else if (gain < minGain) {
        verdict = "reject"; confidence = 0.6;
        reasons.push(`expected gain ${gain} below floor ${minGain}`);
      } else if (guardrailRisk) {
        verdict = "hold"; confidence = 0.55;
      } else if (gain >= shipGain && failing >= 2 && addressesEvidence) {
        verdict = "ship"; confidence = Math.min(0.95, 0.6 + failing * 0.08);
        reasons.push(`addresses "${dominant}" across ${failing} failing traces (gain ${gain})`);
      } else {
        verdict = "hold"; confidence = 0.5;
        reasons.push("plausible but under-evidenced — send to a human");
      }

      return { verdict, confidence: Number(confidence.toFixed(2)), reasons, by: "heuristic" };
    },
  };
}
