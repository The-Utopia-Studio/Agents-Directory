// Triage policy — decides which agents the loop should look at this cycle.
// Approval remains a human action; the retired guard below fails closed for
// compatibility with any caller that still asks about auto-application.
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
 * Auto-approval is retired. Keep this pure guard as defence-in-depth for any
 * caller not yet migrated: no verdict, confidence, autonomy level, or config
 * can turn a verifier opinion into a review decision.
 */
export function shouldAutoApply() {
  return false;
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
      "auto-approve any proposal; a verifier verdict is not a human decision",
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
