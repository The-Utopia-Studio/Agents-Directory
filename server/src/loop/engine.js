// The Loop Engine — the heartbeat that turns the directory's parts into an
// actual loop (Osmani, "Loop Engineering"), governed by SPF's loop doctrine:
// every run carries a Loop Contract (goal / done-when / max-iters / forbidden
// moves / artifacts / human-gate), verifier ships still wait for a human review
// decision, and a repeated failure STOPS and writes a learning instead of
// retrying forever ("the agent forgets, the repo doesn't").
//
// Entry points:
//   runCycle() — one heartbeat across the fleet (Automations)
//   runGoal(agentId, …) — run-until-done on one agent (the /goal primitive)
import { selectForTriage, scoreResearchCandidate, createBudget, defaultContract } from "./policy.js";
import { pendingProposals } from "../core/proposals.js";
import {
  falsePositiveExclusions,
  sanitizeFailingTraceForMaker,
  systematicFalsePositiveChecks,
} from "../eval/groundingCalibration.js";

const dominantSignal = (proposal, agent) =>
  proposal?.evidence?.signalKeys?.[0] ||
  proposal?.evidence?.changeTargets?.[0] ||
  (proposal?.changes?.[0]
    ? `${proposal.changes[0].surface}:${proposal.changes[0].target}`
    : "") ||
  (agent?.evalHistory?.at(-1)?.knownIssues || "").toLowerCase().split(/\W+/).find((w) => w.length > 4) ||
  "unknown";

/** Honest cycle counts — never treat a refusal as an improvement. */
export function summarizeCycleJobs(jobs = []) {
  let attempted = 0;
  let proposed = 0;
  let refused = 0;
  let verifierRejected = 0;
  for (const job of jobs) {
    if (!job || job.action === "skipped:budget") continue;
    attempted += 1;
    if (String(job.action || "").startsWith("refused:")) {
      refused += 1;
      continue;
    }
    proposed += Number(job.proposals) || 0;
    verifierRejected += Number(job.rejected) || 0;
  }
  return { attempted, proposed, refused, verifierRejected };
}

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
    // Selection is evidence-first: actionable failing traces the maker can use.
    // Catalog eval is a secondary score bump only — never the eligibility gate.
    async runResearch() {
      const agents = await svc.listAgents();
      await svc.ensureGroundingCalibrationSeed();
      const calibration = await svc.listCalibrationRows();

      const evidenceByAgent = {};
      for (const agent of agents) {
        if (pendingProposals(agent).length) {
          evidenceByAgent[agent.id] = { actionableFailingCount: 0 };
          continue;
        }
        const rawFailing = await obs
          .getFailingTraces(agent.id, { limit: 100 })
          .catch(() => []);
        const agentCalib = calibration.filter(
          (row) => !row.agentId || row.agentId === agent.id,
        );
        const exclusions = falsePositiveExclusions(agentCalib, {
          agentId: agent.id,
        });
        const systematicIds = new Set(
          systematicFalsePositiveChecks(agentCalib).map((p) => p.checkId),
        );
        const actionable = rawFailing
          .map((trace) =>
            sanitizeFailingTraceForMaker(trace, exclusions, systematicIds),
          )
          .filter(Boolean);
        evidenceByAgent[agent.id] = {
          actionableFailingCount: actionable.length,
          focusReason: actionable
            .map((t) => t.failureReason)
            .filter(Boolean)[0],
        };
      }

      const candidates = selectForTriage(agents, {
        lowScore: loopCfg.lowScore,
        evidenceByAgent,
      });
      let n = 0;
      for (const agent of candidates) {
        const evidence = evidenceByAgent[agent.id] || {};
        const focus =
          (evidence.focusReason || "")
            .toLowerCase()
            .split(/\W+/)
            .find((w) => w.length > 3) || (await candidateSignal(agent));
        const learningBlocked = await svc.isBlockedSignal(agent.id, focus);
        const e = agent.evalHistory?.at(-1);
        const score = scoreResearchCandidate({
          actionableFailingCount: evidence.actionableFailingCount || 0,
          evalRecord: e,
          lowScore: loopCfg.lowScore,
        });
        // in-progress while a proposal is pending in the inbox; else open.
        // Blocked learnings stay blocked. Reopen churn is also refused in
        // upsertResearchItem when the same focus was already refused.
        const status = learningBlocked
          ? "blocked"
          : pendingProposals(agent).length
            ? "in-progress"
            : "open";
        await svc.upsertResearchItem({
          agentId: agent.id,
          focus,
          title: `${agent.name}: ${focus}`,
          score,
          why: evidence.actionableFailingCount
            ? `${evidence.actionableFailingCount} actionable failing trace(s)${e ? ` · eval ${e.score} · ${e.status}` : ""}`
            : e
              ? `eval ${e.score} · ${e.status}`
              : "unevaluated",
          evidence: `${agent.id} failing traces + latest eval`,
          next: "runImprovement",
          estimate: "S",
          status,
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
        let proposals;
        try {
          proposals = await svc.runImprovement(item.agentId);          // maker
        } catch (e) {
          if (e?.status !== 422) throw e;
          const reason = String(e.message || "maker refused");
          await svc.setResearchStatus(item.id, "blocked", reason);
          jobs.push({
            agentId: item.agentId,
            item: item.id,
            action: "refused:no-evidence",
            reason,
            proposals: 0,
            rejected: 0,
          });
          continue;
        }

        // One defect per proposal, so one verdict per proposal. Grading the set
        // as a unit would let one weak defect reject three well-evidenced ones.
        const verdicts = [];
        let rejected = 0;
        for (const proposal of proposals) {
          const signal = dominantSignal(proposal, agent);
          const verdict = await verify(agent, proposal);               // checker
          await svc.attachVerdict(item.agentId, verdict, proposal.id);
          verdicts.push({ proposalId: proposal.id, signal, verdict });
          if (verdict.verdict === "reject") {
            await svc.markVerifierRejected(item.agentId, proposal.id);
            await learn("runCycle", agent, signal,
              `Verifier marked the fix for "${signal}" rejected: ${verdict.reasons?.[0] || "no evidence"}.`,
              "keep it visible for human review; reopen only with a reason");
            rejected += 1;
          }
        }

        // Only a fully rejected item is blocked; anything still pending is a
        // live decision waiting on a human.
        const allRejected = rejected === proposals.length;
        const action = allRejected ? "rejected:verifier→learning" : "queued:inbox";
        const nextStatus = allRejected ? "blocked" : "in-progress";
        await svc.setResearchStatus(item.id, nextStatus);
        jobs.push({
          agentId: item.agentId,
          item: item.id,
          action,
          proposals: proposals.length,
          rejected,
          verdicts,
        });
      }

      const q = await svc.listResearchQueue();
      const count = (s) => q.filter((x) => x.status === s).length;
      const outcomes = summarizeCycleJobs(jobs);
      return svc.recordLoopRun({
        ts: now(), contract,
        scanned: (await svc.listAgents()).length,
        // selected kept as attempted for older readers; UI must use outcomes.
        selected: outcomes.attempted,
        outcomes,
        jobs,
        budget: budget.report(),
        queue: { open: count("open"), inProgress: count("in-progress"), blocked: count("blocked"), done: count("done") },
      });
    },

    async runGoal(
      agentId,
      { targetScore = 80, maxIterations, reevaluate: _ignoredReevaluate, ...overrides } = {},
    ) {
      const contract = defaultContract({
        goal: `Raise ${agentId} to score ${targetScore}`,
        doneWhen: `latest eval score ≥ ${targetScore}`,
        maxIterations: maxIterations || 3,
        ...overrides,
      });
      const steps = [];
      let lastSignal = null, lastWasReject = false;

      for (let i = 0; i < contract.maxIterations; i++) {
        let agent = await svc.getAgent(agentId);
        const score = latestEval(agent)?.score;
        if (typeof score === "number" && score >= targetScore) {
          return { done: true, reason: "target-met", contract, iterations: i, finalScore: score, steps };
        }
        let proposals;
        try {
          proposals = await svc.runImprovement(agentId);               // maker
        } catch (e) {
          if (e?.status !== 422) throw e;
          return { done: false, reason: "no-evidence", detail: e.message, contract, iterations: i, steps };
        }
        // The identical-attempt guard compares the whole set: re-proposing the
        // same defects in the same order is the same attempt, even split across
        // several proposals.
        const signal = proposals
          .map((proposal) => dominantSignal(proposal, agent))
          .join(" + ");

        // SPF: never recurse after a failed identical attempt — stop when the
        // same rejected signal repeats. Verified proposals stop at the human
        // gate on their first iteration and are never applied here.
        if (signal === lastSignal && lastWasReject) {
          await learn("runGoal", agent, signal,
            `Same failure "${signal}" recurred with no progress toward score ${targetScore}.`,
            "keep iterating on this signal — needs a human or a different approach");
          return { done: false, reason: "repeated-failure", contract, iterations: i, steps };
        }

        const verdicts = [];
        let rejected = 0;
        for (const proposal of proposals) {
          const verdict = await verify(agent, proposal);              // checker
          await svc.attachVerdict(agentId, verdict, proposal.id);
          verdicts.push({ proposalId: proposal.id, verdict });
          if (verdict.verdict === "reject") {
            await svc.markVerifierRejected(agentId, proposal.id);
            rejected += 1;
          }
        }

        if (rejected === proposals.length) {
          await learn("runGoal", agent, signal, `Verifier marked "${signal}" rejected.`, "keep it visible for human review; reopen only with a reason");
          steps.push({ i, action: "rejected", verdicts });
          lastSignal = signal; lastWasReject = true;
          continue;
        }
        // Both hold and ship are verifier opinions, not review decisions.
        // Leave surviving proposals pending and stop at the human gate.
        steps.push({
          i,
          action: verdicts.some(({ verdict }) => verdict.verdict === "ship")
            ? "verified:ship-awaiting-human"
            : "held-for-human",
          verdicts,
        });
        return {
          done: false,
          reason: "held-for-human",
          contract,
          iterations: i + 1,
          steps,
        };
      }
      const finalScore = latestEval(await svc.getAgent(agentId))?.score ?? null;
      return { done: typeof finalScore === "number" && finalScore >= targetScore, reason: "max-iterations", contract, iterations: contract.maxIterations, finalScore, steps };
    },
  };
  return engine;
}
