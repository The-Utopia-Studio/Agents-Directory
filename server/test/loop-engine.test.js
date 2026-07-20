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

async function freshStack(loopOverrides = {}, { verifier: verifierOverride } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "adir-loop-"));
  const store = createStore(dir);
  await seed(store);
  const obs = getObservability(config, { store });
  const optimizer = getOptimizer(config);
  const memory = getMemory(config, { store });
  const verifier = verifierOverride || getVerifier(config);
  const svc = createLoopService({ store, obs, optimizer, memory, verifier });
  const cfg = { ...config, loop: { ...config.loop, ...loopOverrides } };
  const engine = createLoopEngine({ svc, obs, verifier, config: cfg });
  return { svc, engine, verifier, obs };
}

const REJECT_ALL = {
  name: "reject-all",
  async health() { return { ok: true }; },
  async assess() { return { verdict: "reject", confidence: 0.9, reasons: ["forced"], by: "test" }; },
};

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

test("auto-apply is gated by the agent's autonomy level, not just the flag", async () => {
  const { svc, engine } = await freshStack({ autoApply: true, autoApplyConfidence: 0.8 });
  // A2 seeds at L1 → must NOT auto-apply even with the master switch on.
  const run1 = await engine.runCycle();
  assert.equal(run1.jobs.find((j) => j.agentId === "A2").action, "queued:inbox");

  // Promote to L3 and it auto-applies.
  const a2 = await svc.getAgent("A2");
  await svc.putAgent({ ...a2, autonomyLevel: "L3", proposedImprovement: null });
  const before = await svc.getAgent("A2");
  const run2 = await engine.runCycle();
  assert.match(run2.jobs.find((j) => j.agentId === "A2").action, /^auto-approved:v/);
  assert.notEqual((await svc.getAgent("A2")).version, before.version);
});

test("runGoal carries a loop contract with forbidden moves", async () => {
  const { engine } = await freshStack();
  const result = await engine.runGoal("A2", { targetScore: 80, maxIterations: 2 });
  assert.ok(result.contract);
  assert.ok(result.contract.forbiddenMoves.length >= 3);
  assert.ok(result.contract.doneWhen.includes("80"));
});

test("a verifier rejection writes a learning, then the signal is skipped next cycle", async () => {
  const { svc, engine } = await freshStack({}, { verifier: REJECT_ALL });

  const run1 = await engine.runCycle();
  const a2job1 = run1.jobs.find((j) => j.agentId === "A2");
  assert.equal(a2job1.action, "rejected:verifier→learning");

  const learnings = await svc.recentLearnings();
  assert.ok(learnings.some((l) => l.agentId === "A2"), "a learning was written");
  assert.ok(await svc.isBlockedSignal("A2", "voice"));

  // Second cycle: A2's failure is now a known block — don't retry forever.
  const run2 = await engine.runCycle();
  assert.equal(run2.jobs.find((j) => j.agentId === "A2").action, "skipped:blocked-learning");
});

test("runGoal stops with a learning on repeated failure (no evaluator progress)", async () => {
  const { svc, engine } = await freshStack();
  // reevaluate that never improves the score -> repeated signal, no progress -> stop.
  const flat = async () => ({ score: 58 });
  const result = await engine.runGoal("A2", { targetScore: 80, maxIterations: 4, reevaluate: flat });
  assert.equal(result.done, false);
  assert.equal(result.reason, "repeated-failure");
  assert.ok((await svc.recentLearnings()).some((l) => l.agentId === "A2"));
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
