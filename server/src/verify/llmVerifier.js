// LLM verifier — a genuine second model grading the maker's work, the way
// Claude Code's /goal uses a fresh model to decide "done" rather than the model
// that did the work. Wired to an HTTP endpoint (your own judge service or a
// Claude call) that returns { verdict, confidence, reasons }. Gated on config;
// unconfigured => clear error and the factory falls back to heuristic.
export function createLlmVerifier({ endpoint, model }) {
  if (!endpoint) throw new Error("LLM verifier selected but VERIFIER_ENDPOINT is unset");

  return {
    name: "llm",

    async health() { return { ok: true, detail: `${endpoint} (${model || "default"})` }; },

    async assess(agent, proposal, traces = [], latestEval) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          task: "verify_improvement",
          instruction:
            "You are a skeptical reviewer, NOT the author. Decide whether this proposed change should ship, " +
            "hold for a human, or be rejected. Judge against the agent's objective, success criteria, and guardrails. " +
            "Return {verdict: ship|hold|reject, confidence: 0..1, reasons: []}.",
          agent: { objective: agent.objective, successCriteria: agent.successCriteria, guardrails: agent.guardrails, prompt: agent.prompt },
          proposal,
          failingTraces: traces.filter((t) => t.status !== "ok").slice(0, 20),
          latestEval,
        }),
      });
      if (!res.ok) throw new Error(`verifier endpoint ${res.status}`);
      const out = await res.json();
      return {
        verdict: out.verdict || "hold",
        confidence: typeof out.confidence === "number" ? out.confidence : 0.5,
        reasons: out.reasons || [],
        by: `llm:${model || "default"}`,
      };
    },
  };
}
