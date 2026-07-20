// Triage policy — decides which agents the loop should look at this cycle, and
// whether a verified proposal may auto-apply. Pure functions so the policy is
// easy to reason about, test, and later swap.
const latestEval = (a) => (a.evalHistory || []).at(-1);

/**
 * Discovery + triage: pick agents that need attention and aren't already
 * sitting in the human inbox (a pending proposal).
 */
export function selectForTriage(agents, { lowScore = 70 } = {}) {
  return agents.filter((a) => {
    if (a.proposedImprovement?.status === "proposed") return false; // already queued
    const e = latestEval(a);
    if (!e) return false; // nothing evaluated to improve against yet
    return e.status === "Needs improvement" || (typeof e.score === "number" && e.score < lowScore);
  });
}

/**
 * Should a verified proposal ship without a human? Keyed off the AGENT'S declared
 * autonomy level (SPF eval-first spec) rather than one global flag — promotion is
 * earned per agent. The `autoApply` master switch is a kill-switch on top.
 *   L0/L1 — never auto-apply (assist / suggest+confirm)
 *   L2    — auto-apply only high-confidence ships (act narrow + audit)
 *   L3/L4 — auto-apply ships (act broad / autonomous)
 * Everything not auto-applied waits in the human triage inbox.
 */
export function shouldAutoApply(verdict, agent, { autoApply, autoApplyConfidence }) {
  if (!autoApply) return false;                       // master kill-switch
  if (verdict.verdict !== "ship") return false;
  const level = agent?.autonomyLevel || "L1";
  if (level === "L0" || level === "L1") return false;
  if (level === "L2") return verdict.confidence >= Math.max(autoApplyConfidence, 0.85);
  return verdict.confidence >= autoApplyConfidence;   // L3 / L4
}

/**
 * The default loop contract — every cycle/goal declares one (SPF: no exit
 * condition => busywork). Forbidden moves are inherited by any child step.
 */
export function defaultContract(overrides = {}) {
  return {
    goal: "Raise an agent's eval score toward its success criteria",
    doneWhen: "score ≥ target, or budget/iterations exhausted, or blocked with a learning",
    maxIterations: 3,
    forbiddenMoves: [
      "weaken or remove a guardrail",
      "auto-apply above the agent's declared autonomy level",
      "retry an identical proposal after it was rejected",
      "exceed the token/cost budget",
    ],
    artifacts: ["proposedImprovement", "loopRun", "learning"],
    humanGate: "irreversible",
    ...overrides,
  };
}

/** A tiny token/cost budget — Osmani's caveat made concrete. */
export function createBudget({ budgetUsd = 1, costPerJobUsd = 0.05, maxJobs = 3 }) {
  let jobs = 0, spentUsd = 0;
  return {
    canRun() { return jobs < maxJobs && spentUsd + costPerJobUsd <= budgetUsd; },
    spend() { jobs += 1; spentUsd = Number((spentUsd + costPerJobUsd).toFixed(4)); },
    report() { return { jobs, spentUsd, budgetUsd, maxJobs }; },
  };
}
