// The Loop Engine — the heartbeat that turns the directory's parts into an
// actual loop (Osmani, "Loop Engineering"), governed by SPF's loop doctrine:
// every run carries a Loop Contract (goal / done-when / max-iters / forbidden
// moves / artifacts / human-gate), auto-apply is keyed off each agent's declared
// autonomy level, and a repeated failure STOPS and writes a learning instead of
// retrying forever ("the agent forgets, the repo doesn't").
//
// Entry points:
//   runCycle() — one heartbeat across the fleet (Automations)
//   runGoal(agentId, …) — run-until-done on one agent (the /goal primitive)
import { selectForTriage, shouldAutoApply, createBudget, defaultContract } from "./policy.js";

const dominantSignal = (proposal, agent) =>
  proposal?.evidence?.signals?.[0] ||
  (agent?.evalHistory?.at(-1)?.knownIssues || "").toLowerCase().split(/\W+/).find((w) => w.length > 4) ||
  "unknown";

export function createLoopEngine({ svc, obs, verifier, config, now = () => new Date().toISOString() }) {
  const loopCfg = config.loop;
  const latestEval = (a) => (a.evalHistory || []).at(-1);

  async function verify(agent, proposal) {
    const traces = await obs.getFailingTraces(agent.id, { limit: 100 }).catch(() => []);
    return verifier.assess(agent, proposal, traces, latestEval(agent));
  }

  // Cheap guess of an agent's current failure signal, before we spend on the
  // optimizer — so we can skip an agent we've already learned is blocked.
  async function candidateSignal(agent) {
    const traces = await obs.getFailingTraces(agent.id, { limit: 20 }).catch(() => []);
    const reason = traces.map((t) => t.failureReason).filter(Boolean)[0];
    if (reason) return reason.toLowerCase().split(/\W+/).find((w) => w.length > 3) || reason;
    return dominantSignal(null, agent);
  }

  async function learn(loop, agent, signal, learning, doNot) {
    return svc.recordLearning({
      loop, agentId: agent.id, signal,
      title: `${agent.id} · ${signal}`,
      context: `${loop} on ${agent.name} (v${agent.version})`,
      learning, doNot,
    });
  }

  const engine = {
    async runCycle(contractOverrides = {}) {
      const contract = defaultContract({ goal: "Triage the fleet and propose fixes", ...contractOverrides });
      const agents = await svc.listAgents();
      const selected = selectForTriage(agents, { lowScore: loopCfg.lowScore });
      const budget = createBudget(loopCfg);
      const jobs = [];

      for (const agent of selected) {
        // Don't retry a failure we've already been blocked on (SPF rule).
        const signal = await candidateSignal(agent);
        if (await svc.isBlockedSignal(agent.id, signal)) {
          jobs.push({ agentId: agent.id, action: "skipped:blocked-learning", signal });
          continue;
        }
        if (!budget.canRun()) { jobs.push({ agentId: agent.id, action: "skipped:budget" }); continue; }
        budget.spend();

        const proposal = await svc.runImprovement(agent.id);          // maker
        const verdict = await verify(agent, proposal);                // checker
        await svc.attachVerdict(agent.id, verdict);

        let action = "queued:inbox";
        if (verdict.verdict === "reject") {
          await svc.rejectImprovement(agent.id);
          await learn("runCycle", agent, dominantSignal(proposal, agent),
            `Verifier rejected the fix for "${dominantSignal(proposal, agent)}": ${verdict.reasons?.[0] || "no evidence"}.`,
            "re-propose the same fix without new evidence");
          action = "rejected:verifier→learning";
        } else if (shouldAutoApply(verdict, agent, loopCfg)) {
          const { version } = await svc.approveImprovement(agent.id);
          action = `auto-approved:v${version}`;
        }
        jobs.push({ agentId: agent.id, action, verdict });
      }

      return svc.recordLoopRun({ ts: now(), contract, scanned: agents.length, selected: selected.length, jobs, budget: budget.report() });
    },

    async runGoal(agentId, { targetScore = 80, maxIterations, reevaluate, ...overrides } = {}) {
      const contract = defaultContract({
        goal: `Raise ${agentId} to score ${targetScore}`,
        doneWhen: `latest eval score ≥ ${targetScore}`,
        maxIterations: maxIterations || 3,
        ...overrides,
      });
      const steps = [];
      let lastSignal = null, lastWasReject = false, prevShipScore = null;

      for (let i = 0; i < contract.maxIterations; i++) {
        let agent = await svc.getAgent(agentId);
        const score = latestEval(agent)?.score;
        if (typeof score === "number" && score >= targetScore) {
          return { done: true, reason: "target-met", contract, iterations: i, finalScore: score, steps };
        }
        const proposal = await svc.runImprovement(agentId);           // maker
        const signal = dominantSignal(proposal, agent);

        // SPF: never recurse after a failed identical attempt — stop when the
        // same signal repeats AND the last attempt made no progress (a rejection,
        // or a shipped change that didn't raise the score).
        const noProgress = prevShipScore !== null && typeof score === "number" && score <= prevShipScore;
        if (signal === lastSignal && (lastWasReject || noProgress)) {
          await learn("runGoal", agent, signal,
            `Same failure "${signal}" recurred with no progress toward score ${targetScore}.`,
            "keep iterating on this signal — needs a human or a different approach");
          return { done: false, reason: "repeated-failure", contract, iterations: i, steps };
        }

        const verdict = await verify(agent, proposal);                // checker
        await svc.attachVerdict(agentId, verdict);

        if (verdict.verdict === "reject") {
          await svc.rejectImprovement(agentId);
          await learn("runGoal", agent, signal, `Verifier rejected "${signal}".`, "re-propose without new evidence");
          steps.push({ i, action: "rejected", verdict });
          lastSignal = signal; lastWasReject = true;
          continue;
        }
        if (verdict.verdict === "hold") {
          steps.push({ i, action: "held-for-human", verdict });
          return { done: false, reason: "held-for-human", contract, iterations: i + 1, steps };
        }
        const { version } = await svc.approveImprovement(agentId);    // ship
        prevShipScore = typeof score === "number" ? score : prevShipScore;
        lastSignal = signal; lastWasReject = false;
        let newScore = null;
        if (reevaluate) {
          const r = await reevaluate(agentId, proposal);
          newScore = r.score;
          await svc.logEval(agentId, {
            status: newScore >= targetScore ? "Performing well" : "Needs improvement",
            score: newScore, notes: `Auto-eval after v${version} (goal loop)`, by: "loop",
          });
        }
        steps.push({ i, action: `shipped:v${version}`, verdict, newScore });
        if (!reevaluate) return { done: false, reason: "needs-evaluator", contract, iterations: i + 1, steps };
      }
      const finalScore = latestEval(await svc.getAgent(agentId))?.score ?? null;
      return { done: typeof finalScore === "number" && finalScore >= targetScore, reason: "max-iterations", contract, iterations: contract.maxIterations, finalScore, steps };
    },
  };
  return engine;
}
