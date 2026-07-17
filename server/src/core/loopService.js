// The loop, as one service. Routes call these methods; the methods orchestrate
// the store + the (swappable) observability and optimizer providers. All the
// business rules of the eval -> improve -> approve cycle live here.
import { bumpVersion } from "./version.js";

export function createLoopService({ store, obs, optimizer }) {
  const svc = {
    // ── agents ──
    async listAgents() { return store.all("agents"); },
    async getAgent(id) { return store.get("agents", id); },
    async putAgent(agent) { return store.put("agents", agent); },

    // ── traces (observability) ──
    async recordTrace(agentId, trace) {
      return obs.recordTrace({ ...trace, agentId });
    },
    async listTraces(agentId, opts) { return obs.listTraces(agentId, opts); },

    // ── evals (append-only history on the agent) ──
    async logEval(agentId, record) {
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);
      const entry = { date: new Date().toISOString().slice(0, 10), ...record };
      agent.evalHistory = [...(agent.evalHistory || []), entry];
      await store.put("agents", agent);
      return entry;
    },

    // ── the loop: run the optimizer on failing signal ──
    async runImprovement(agentId) {
      const agent = await store.get("agents", agentId);
      if (!agent) throw httpError(404, `No agent ${agentId}`);
      const traces = await obs.getFailingTraces(agentId, { limit: 100 });
      const latestEval = (agent.evalHistory || []).at(-1);
      const proposal = await optimizer.propose(agent, traces, latestEval);
      proposal.id = `imp_${Date.now().toString(36)}`;
      agent.proposedImprovement = proposal;
      await store.put("agents", agent);
      return proposal;
    },

    async approveImprovement(agentId, proposalId) {
      const agent = await store.get("agents", agentId);
      const prop = agent?.proposedImprovement;
      if (!agent || !prop) throw httpError(404, "No pending improvement");
      if (proposalId && prop.id !== proposalId) throw httpError(409, "Proposal id mismatch");
      const nv = bumpVersion(agent.version);
      agent.changelog = [...(agent.changelog || []), {
        version: nv, date: new Date().toISOString().slice(0, 10),
        note: `Approved improvement (${prop.source}): ${prop.summary}`,
      }];
      agent.version = nv;
      agent.proposedImprovement = null;
      await store.put("agents", agent);
      return { version: nv, agent };
    },

    async rejectImprovement(agentId, proposalId) {
      const agent = await store.get("agents", agentId);
      if (!agent?.proposedImprovement) throw httpError(404, "No pending improvement");
      if (proposalId && agent.proposedImprovement.id !== proposalId) throw httpError(409, "Proposal id mismatch");
      agent.proposedImprovement = null;
      await store.put("agents", agent);
      return { ok: true };
    },

    // ── fleet health roll-up ──
    async fleetHealth() {
      const agents = await store.all("agents");
      const latest = (a) => (a.evalHistory || []).at(-1);
      const evaluated = agents.filter(latest);
      const scores = evaluated.map((a) => latest(a).score).filter((n) => typeof n === "number");
      const avg = scores.length ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) : 0;
      const needsReview = agents.filter((a) => {
        const e = latest(a);
        return !e || e.status === "Needs improvement" || (typeof e.score === "number" && e.score < 70);
      }).length;
      const proposals = agents.filter((a) => a.proposedImprovement?.status === "proposed").length;
      return {
        total: agents.length,
        evaluated: evaluated.length,
        coverage: agents.length ? Math.round((evaluated.length / agents.length) * 100) : 0,
        avgScore: avg,
        needsReview,
        pendingImprovements: proposals,
      };
    },

    async health() {
      return {
        ok: true,
        observability: { provider: obs.name, ...(await obs.health()) },
        optimizer: { provider: optimizer.name, ...(await optimizer.health()) },
      };
    },
  };
  return svc;
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
