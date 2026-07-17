// The Loop Engine — the heartbeat that turns the directory's parts into an
// actual loop (Osmani, "Loop Engineering"). It finds the work, hands it to the
// maker (optimizer), has a separate checker (verifier) grade it, routes the
// result to the human triage inbox or auto-applies within policy, respects a
// token budget, and writes every cycle to state so tomorrow's run knows what
// today's did.
//
// Two entry points:
//   runCycle() — one heartbeat across the whole fleet (the Automations tab)
//   runGoal(agentId, …) — run-until-done on one agent (the /goal primitive),
//     stop condition = the agent's own success criteria (an eval score target)
import { selectForTriage, shouldAutoApply, createBudget } from "./policy.js";

export function createLoopEngine({ svc, obs, verifier, config, now = () => new Date().toISOString() }) {
  const loopCfg = config.loop;
  const latestEval = (a) => (a.evalHistory || []).at(-1);

  async function verify(agent, proposal) {
    const traces = await obs.getFailingTraces(agent.id, { limit: 100 }).catch(() => []);
    return verifier.assess(agent, proposal, traces, latestEval(agent));
  }

  const engine = {
    // ── one heartbeat across the fleet ──
    async runCycle() {
      const agents = await svc.listAgents();
      const selected = selectForTriage(agents, { lowScore: loopCfg.lowScore });
      const budget = createBudget(loopCfg);
      const jobs = [];

      for (const agent of selected) {
        if (!budget.canRun()) { jobs.push({ agentId: agent.id, action: "skipped:budget" }); continue; }
        budget.spend();
        const proposal = await svc.runImprovement(agent.id);          // maker
        const verdict = await verify(agent, proposal);                // checker
        await svc.attachVerdict(agent.id, verdict);

        let action = "queued:inbox";
        if (verdict.verdict === "reject") {
          await svc.rejectImprovement(agent.id);
          action = "rejected:verifier";
        } else if (shouldAutoApply(verdict, loopCfg)) {
          const { version } = await svc.approveImprovement(agent.id);
          action = `auto-approved:v${version}`;
        }
        jobs.push({ agentId: agent.id, action, verdict });
      }

      const run = {
        ts: now(),
        scanned: agents.length,
        selected: selected.length,
        jobs,
        budget: budget.report(),
      };
      return svc.recordLoopRun(run);
    },

    // ── run-until-done on a single agent ──
    // reevaluate(agentId, proposal) -> { score } is where a REAL eval run plugs
    // in. Without it, the loop ships one verified change and stops (it can't
    // verify progress toward the stop condition on its own).
    async runGoal(agentId, { targetScore = 80, maxIterations = 3, reevaluate } = {}) {
      const steps = [];
      for (let i = 0; i < maxIterations; i++) {
        let agent = await svc.getAgent(agentId);
        const score = latestEval(agent)?.score;
        if (typeof score === "number" && score >= targetScore) {
          return { done: true, reason: "target-met", iterations: i, finalScore: score, steps };
        }
        const proposal = await svc.runImprovement(agentId);           // maker
        const verdict = await verify(agent, proposal);                // checker
        await svc.attachVerdict(agentId, verdict);

        if (verdict.verdict === "reject") { steps.push({ i, action: "rejected", verdict }); continue; }
        if (verdict.verdict === "hold") {
          steps.push({ i, action: "held-for-human", verdict });
          return { done: false, reason: "held-for-human", iterations: i + 1, steps };
        }
        const { version } = await svc.approveImprovement(agentId);    // ship
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
        if (!reevaluate) {
          return { done: false, reason: "needs-evaluator", iterations: i + 1, steps };
        }
      }
      const finalScore = latestEval(await svc.getAgent(agentId))?.score ?? null;
      return { done: typeof finalScore === "number" && finalScore >= targetScore, reason: "max-iterations", iterations: maxIterations, finalScore, steps };
    },
  };
  return engine;
}
