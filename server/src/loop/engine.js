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
    // DISCOVERY — scan the fleet and write scored items to the research queue.
    // Structured evidence, not open-ended browsing (SPF). Nothing auto-merges.
    async runResearch() {
      const agents = await svc.listAgents();
      const candidates = selectForTriage(agents, { lowScore: loopCfg.lowScore });
      let n = 0;
      for (const agent of candidates) {
        const focus = await candidateSignal(agent);
        const blocked = await svc.isBlockedSignal(agent.id, focus);
        const e = agent.evalHistory?.at(-1);
        const score = e && typeof e.score === "number" && e.score < 60 ? 3
          : e && e.status === "Needs improvement" ? 2 : 1;
        // in-progress while a proposal is pending in the inbox; else open.
        const status = blocked ? "blocked" : agent.proposedImprovement ? "in-progress" : "open";
        await svc.upsertResearchItem({
          agentId: agent.id, focus,
          title: `${agent.name}: ${focus}`,
          score,
          why: e ? `eval ${e.score} · ${e.status}` : "unevaluated",
          evidence: `${agent.id} failing traces + latest eval`,
          next: "runImprovement", estimate: "S", status,
        });
        n++;
      }
      return n;
    },

    // IMPROVE — one heartbeat: refresh the queue, then consume the top OPEN
    // items (highest score first) up to budget. Blocked items are skipped.
    async runCycle(contractOverrides = {}) {
      const contract = defaultContract({ goal: "Discover gaps, then improve the top items", ...contractOverrides });
      await this.runResearch();
      const open = await svc.listResearchQueue("open");
      const budget = createBudget(loopCfg);
      const jobs = [];

      for (const item of open) {
        if (!budget.canRun()) { jobs.push({ agentId: item.agentId, item: item.id, action: "skipped:budget" }); continue; }
        const agent = await svc.getAgent(item.agentId);
        if (!agent) { await svc.setResearchStatus(item.id, "blocked", "agent removed"); continue; }
        budget.spend();

        // A refusal is a valid maker outcome, not a crash: block the item and
        // keep the cycle moving rather than aborting the whole run.
        let proposal;
        try {
          proposal = await svc.runImprovement(item.agentId);          // maker
        } catch (e) {
          if (e?.status !== 422) throw e;
          await svc.setResearchStatus(item.id, "blocked", e.message);
          jobs.push({ agentId: item.agentId, item: item.id, action: "refused:no-evidence" });
          continue;
        }
        const verdict = await verify(agent, proposal);                // checker
        await svc.attachVerdict(item.agentId, verdict);

        let action = "queued:inbox", nextStatus = "in-progress";
        if (verdict.verdict === "reject") {
          await svc.rejectImprovement(item.agentId);
          await learn("runCycle", agent, dominantSignal(proposal, agent),
            `Verifier rejected the fix for "${dominantSignal(proposal, agent)}": ${verdict.reasons?.[0] || "no evidence"}.`,
            "re-propose the same fix without new evidence");
          action = "rejected:verifier→learning"; nextStatus = "blocked";
        } else if (shouldAutoApply(verdict, agent, loopCfg)) {
          const { version } = await svc.approveImprovement(item.agentId);
          action = `auto-approved:v${version}`; nextStatus = "done";
        }
        await svc.setResearchStatus(item.id, nextStatus);
        jobs.push({ agentId: item.agentId, item: item.id, action, verdict });
      }

      const q = await svc.listResearchQueue();
      const count = (s) => q.filter((x) => x.status === s).length;
      return svc.recordLoopRun({
        ts: now(), contract,
        scanned: (await svc.listAgents()).length, selected: jobs.length, jobs,
        budget: budget.report(),
        queue: { open: count("open"), inProgress: count("in-progress"), blocked: count("blocked"), done: count("done") },
      });
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
        let proposal;
        try {
          proposal = await svc.runImprovement(agentId);               // maker
        } catch (e) {
          if (e?.status !== 422) throw e;
          return { done: false, reason: "no-evidence", detail: e.message, contract, iterations: i, steps };
        }
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
