// The heartbeat: verifier (checker), runCycle (fleet triage), runGoal
// (run-until-done). Offline, default providers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { createLoopService } from "../src/core/loopService.js";
import { getObservability } from "../src/observability/index.js";
import { getOptimizer } from "../src/improve/index.js";
import { getMemory } from "../src/memory/index.js";
import { getVerifier } from "../src/verify/index.js";
import { createLoopEngine } from "../src/loop/engine.js";
import { seed } from "../src/scripts/seed.js";
import { config } from "../src/config.js";

async function freshStack(loopOverrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "adir-loop-"));
  const store = createStore(dir);
  await seed(store);
  const obs = getObservability(config, { store });
  const optimizer = getOptimizer(config);
  const memory = getMemory(config, { store });
  const verifier = getVerifier(config);
  const svc = createLoopService({ store, obs, optimizer, memory, verifier });
  const cfg = { ...config, loop: { ...config.loop, ...loopOverrides } };
  const engine = createLoopEngine({ svc, obs, verifier, config: cfg });
  return { svc, engine, verifier };
}

test("verifier rejects a proposal with no failing signal", async () => {
  const { verifier } = await freshStack();
  const v = await verifier.assess(
    { id: "X", guardrails: [] },
    { expectedGain: 3, summary: "tweak", detail: "tweak", evidence: { signals: [] } },
    [], { knownIssues: "" }
  );
  assert.equal(v.verdict, "reject");
});

test("verifier ships a well-evidenced, high-gain proposal", async () => {
  const { svc, verifier } = await freshStack();
  const proposal = await svc.runImprovement("A2");           // real proposal from failing traces
  const traces = await svc.listTraces("A2");
  const agent = await svc.getAgent("A2");
  const v = await verifier.assess(agent, proposal, traces, agent.evalHistory.at(-1));
  assert.equal(v.verdict, "ship");
  assert.ok(v.confidence >= 0.85);
});

test("runCycle triages the fleet and queues to the inbox (no auto-apply)", async () => {
  const { svc, engine } = await freshStack({ autoApply: false });
  const run = await engine.runCycle();
  assert.ok(run.selected >= 1, "A2 (score 58) should be selected");
  const a2job = run.jobs.find((j) => j.agentId === "A2");
  assert.equal(a2job.action, "queued:inbox");
  assert.ok(a2job.verdict);
  const { inbox } = { inbox: await svc.listInbox() };
  assert.ok(inbox.some((x) => x.agentId === "A2" && x.proposal.verdict));
  const runs = await svc.recentLoopRuns();
  assert.equal(runs.length, 1);
});

test("runCycle auto-applies a high-confidence ship when policy allows", async () => {
  const { svc, engine } = await freshStack({ autoApply: true, autoApplyConfidence: 0.8 });
  const before = await svc.getAgent("A2");
  const run = await engine.runCycle();
  const a2job = run.jobs.find((j) => j.agentId === "A2");
  assert.match(a2job.action, /^auto-approved:v/);
  const after = await svc.getAgent("A2");
  assert.notEqual(after.version, before.version);
  assert.equal(after.proposedImprovement, null);
});

test("runCycle respects the token budget", async () => {
  const { engine } = await freshStack({ maxJobs: 0 });
  const run = await engine.runCycle();
  assert.ok(run.jobs.every((j) => j.action === "skipped:budget"));
  assert.equal(run.budget.jobs, 0);
});

test("runGoal converges to the target with a re-evaluator", async () => {
  const { svc, engine } = await freshStack();
  let score = 58;
  const reevaluate = async () => { score = Math.min(100, score + 18); return { score }; };
  const result = await engine.runGoal("A2", { targetScore: 80, maxIterations: 4, reevaluate });
  assert.equal(result.done, true);
  assert.ok(result.finalScore >= 80);
  assert.ok(result.steps.some((s) => /shipped/.test(s.action || "")));
});

test("runGoal ships once then stops when no evaluator is wired", async () => {
  const { engine } = await freshStack();
  const result = await engine.runGoal("A2", { targetScore: 80, maxIterations: 4 });
  assert.equal(result.done, false);
  assert.equal(result.reason, "needs-evaluator");
});
