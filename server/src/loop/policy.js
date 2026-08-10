// Triage policy — decides which agents the loop should look at this cycle.
// Approval remains a human action; the retired guard below fails closed for
// compatibility with any caller that still asks about auto-application.
import { pendingProposals } from "../core/proposals.js";

const latestEval = (a) => (a.evalHistory || []).at(-1);

/**
 * Discovery + triage: pick agents that have actionable failing-trace evidence
 * the maker can use, and aren't already sitting in the human inbox.
 *
 * Catalog eval score is a secondary ranking signal only — never the gate.
 * An agent with real failing checks and no evalHistory must still be eligible.
 *
 * @param {object[]} agents
 * @param {{
 *   lowScore?: number,
 *   evidenceByAgent?: Record<string, { actionableFailingCount: number }>,
 * }} [opts]
 */
export function selectForTriage(
  agents,
  { lowScore = 70, evidenceByAgent = null } = {},
) {
  return agents.filter((a) => {
    if (pendingProposals(a).length) return false; // already queued
    if (evidenceByAgent && typeof evidenceByAgent === "object") {
      const evidence = evidenceByAgent[a.id];
      return Boolean(evidence && evidence.actionableFailingCount > 0);
    }
    // Legacy sync path (tests without evidence map): eval-only fallback.
    const e = latestEval(a);
    if (!e) return false;
    return (
      e.status === "Needs improvement" ||
      (typeof e.score === "number" && e.score < lowScore)
    );
  });
}

/**
 * Research-queue score 1–3. Evidence volume is primary; catalog eval bumps.
 */
export function scoreResearchCandidate({
  actionableFailingCount = 0,
  evalRecord = null,
  lowScore = 70,
} = {}) {
  const e = evalRecord;
  const evalNeedsWork = Boolean(
    e &&
      (e.status === "Needs improvement" ||
        (typeof e.score === "number" && e.score < lowScore)),
  );
  if (actionableFailingCount <= 0) return 0;
  if (actionableFailingCount >= 3 && evalNeedsWork) return 3;
  if (actionableFailingCount >= 1 && evalNeedsWork) return 3;
  if (actionableFailingCount >= 3) return 2;
  return 2;
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
    artifacts: ["proposedImprovements", "loopRun", "learning"],
    humanGate: "irreversible",
    ...overrides,
  };
}

/**
 * Job-slot budget only. There is no measured token spend on the heuristic path,
 * so this never invents a dollar figure — callers report "N of M jobs".
 * `budgetUsd` / `costPerJobUsd` are ignored if still present in config.
 */
export function createBudget({ maxJobs = 3 } = {}) {
  let jobs = 0;
  const limit = Math.max(0, Number(maxJobs) || 0);
  return {
    canRun() { return jobs < limit; },
    spend() { jobs += 1; },
    report() { return { jobs, maxJobs: limit }; },
  };
}
