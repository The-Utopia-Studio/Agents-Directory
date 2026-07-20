// The loop, as one service. Routes call these methods; the methods orchestrate
// the store + the (swappable) observability and optimizer providers. All the
// business rules of the eval -> improve -> approve cycle live here.
import { bumpVersion } from "./version.js";

export function createLoopService({ store, obs, optimizer, memory, verifier }) {
  const ns = (agentId) => `agent:${agentId}`;

  const svc = {
    // ── agents ──
    async listAgents() { return store.all("agents"); },
    async getAgent(id) { return store.get("agents", id); },
    async putAgent(agent) { return store.put("agents", agent); },

    // ── context / memory (the fourth pillar) ──
    async addContext(agentId, item) {
      if (!item?.content) throw httpError(400, "content required");
      return memory.ingest(ns(agentId), item);
    },
    async recallContext(agentId, query, opts) {
      return memory.search(ns(agentId), query, opts);
    },
    // Seed each agent's declared context[] into memory once (deterministic ids
    // so re-runs don't duplicate). Turns the static string list into recall.
    async seedContext() {
      const agents = await store.all("agents");
      let n = 0;
      for (const a of agents) {
        for (const [i, c] of (a.context || []).entries()) {
          await memory.ingest(ns(a.id), { id: `seed_${a.id}_${i}`, content: c, metadata: { agentId: a.id, seeded: true } });
          n++;
        }
      }
      return n;
    },

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

    // Attach a verifier verdict to the pending proposal (maker/checker split).
    async attachVerdict(agentId, verdict) {
      const agent = await store.get("agents", agentId);
      if (!agent?.proposedImprovement) return null;
      agent.proposedImprovement.verdict = verdict;
      await store.put("agents", agent);
      return agent.proposedImprovement;
    },

    // ── the loop's state: triage inbox + run history ──
    async listInbox() {
      const agents = await store.all("agents");
      return agents
        .filter((a) => a.proposedImprovement?.status === "proposed")
        .map((a) => ({ agentId: a.id, name: a.name, version: a.version, proposal: a.proposedImprovement }));
    },
    async recordLoopRun(run) {
      const saved = await store.append("loopRuns", { ...run, ts: run.ts || new Date().toISOString() });
      return saved;
    },
    async recentLoopRuns(limit = 20) {
      const runs = await store.all("loopRuns");
      return runs.sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, limit);
    },

    // ── learnings: append-only memory of what failed / was blocked (SPF) ──
    // "The agent forgets, the repo doesn't." Also feeds the Context pillar.
    async recordLearning(entry) {
      const saved = await store.append("learnings", { date: new Date().toISOString().slice(0, 10), ...entry });
      // Mirror into the agent's memory so future runs recall the block.
      if (entry.agentId && memory) {
        await memory.ingest(ns(entry.agentId), {
          id: `learning_${saved.id}`,
          content: `LEARNING (${entry.loop}): ${entry.learning}${entry.doNot ? ` — Do not: ${entry.doNot}` : ""}`,
          metadata: { kind: "learning", agentId: entry.agentId },
        }).catch(() => {});
      }
      return saved;
    },
    async recentLearnings(limit = 20) {
      const rows = await store.all("learnings");
      return rows.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
    },
    // Has this agent already been blocked on this failure signal? (don't retry forever)
    async isBlockedSignal(agentId, signal) {
      if (!signal) return false;
      const rows = await store.query("learnings", (l) => l.agentId === agentId && l.signal === signal);
      return rows.length > 0;
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
        memory: { provider: memory.name, ...(await memory.health()) },
        verifier: verifier ? { provider: verifier.name, ...(await verifier.health()) } : null,
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
