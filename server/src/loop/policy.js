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
 * Should a verified proposal ship without a human? Conservative by default —
 * only high-confidence "ship" verdicts, and only when auto-apply is enabled.
 * "Stay the engineer": everything else waits in the inbox.
 */
export function shouldAutoApply(verdict, { autoApply, autoApplyConfidence }) {
  return !!autoApply && verdict.verdict === "ship" && verdict.confidence >= autoApplyConfidence;
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
