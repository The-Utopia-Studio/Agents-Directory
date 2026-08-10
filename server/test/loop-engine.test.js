// The heartbeat: verifier (checker), runCycle (fleet triage), runGoal
// (run-until-done). Offline, default providers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
import { shouldAutoApply } from "../src/loop/policy.js";
import { seed, SEED_TRACES } from "../src/scripts/seed.js";
import { config } from "../src/config.js";

async function freshStack(loopOverrides = {}, { verifier: verifierOverride } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "adir-loop-"));
  const store = createStore(dir);
  await seed(store);
  await store.seedIfEmpty("traces", SEED_TRACES);
  const obs = getObservability(config, { store });
  const optimizer = getOptimizer(config);
  const memory = getMemory(config, { store });
  const verifier = verifierOverride || getVerifier(config);
  const svc = createLoopService({ store, obs, optimizer, memory, verifier, config });
  const cfg = { ...config, loop: { ...config.loop, ...loopOverrides } };
  const engine = createLoopEngine({ svc, obs, verifier, config: cfg });
  return { svc, engine, verifier, obs };
}

const REJECT_ALL = {
  name: "reject-all",
  async health() { return { ok: true }; },
  async assess() { return { verdict: "reject", confidence: 0.9, reasons: ["forced"], by: "test" }; },
};

test("LOOP_AUTOAPPLY=true fails boot instead of enabling approval", () => {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", "import('./src/config.js')"],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, LOOP_AUTOAPPLY: "true" },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LOOP_AUTOAPPLY is disabled/);
});

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
  const [proposal] = await svc.runImprovement("A2");         // real proposal from failing traces
  const traces = await svc.listTraces("A2");
  const agent = await svc.getAgent("A2");
  const v = await verifier.assess(agent, proposal, traces, agent.evalHistory.at(-1));
  assert.equal(v.verdict, "ship");
  assert.ok(v.confidence >= 0.85);
});

test("runCycle triages the fleet and queues to the inbox (no auto-apply)", async () => {
  const { svc, engine } = await freshStack({ autoApply: false });
  const run = await engine.runCycle();
  assert.ok(run.selected >= 1, "A2 with seed failing traces should be selected");
  assert.equal(run.outcomes.attempted, run.selected);
  assert.ok(run.outcomes.proposed >= 1, "at least one proposal must be counted");
  assert.equal(run.outcomes.refused, 0);
  assert.equal(run.budget.spentUsd, undefined);
  assert.ok(run.budget.jobs >= 1);
  assert.equal(run.budget.maxJobs, 3);
  const a2job = run.jobs.find((j) => j.agentId === "A2");
  assert.equal(a2job.action, "queued:inbox");
  // One verdict per proposal: grading the set as a unit would let one weak
  // defect reject the well-evidenced ones alongside it.
  assert.equal(a2job.verdicts.length, a2job.proposals);
  assert.ok(a2job.verdicts.every((entry) => entry.verdict && entry.proposalId));
  const inbox = await svc.listInbox();
  const a2Inbox = inbox.filter((x) => x.agentId === "A2");
  assert.equal(a2Inbox.length, a2job.proposals - a2job.rejected);
  assert.ok(a2Inbox.every((x) => x.proposal.verdict));
  const runs = await svc.recentLoopRuns();
  assert.equal(runs.length, 1);
});

test("auto-approval is structurally disabled even with stale enabling config", async () => {
  assert.equal(
    shouldAutoApply(
      { verdict: "ship", confidence: 1 },
      { autonomyLevel: "L4" },
      { autoApply: true, autoApplyConfidence: 0 },
    ),
    false,
  );
  const { svc, engine } = await freshStack({ autoApply: true, autoApplyConfidence: 0.8 });
  // Even a stale true flag plus maximum autonomy cannot approve.
  const a2 = await svc.getAgent("A2");
  await svc.putAgent({ ...a2, autonomyLevel: "L3", proposedImprovements: [] });
  const before = await svc.getAgent("A2");
  const run = await engine.runCycle();
  assert.equal(run.jobs.find((j) => j.agentId === "A2").action, "queued:inbox");
  assert.equal((await svc.getAgent("A2")).version, before.version);
});

test("runGoal carries a loop contract with forbidden moves", async () => {
  const { engine } = await freshStack();
  const result = await engine.runGoal("A2", { targetScore: 80, maxIterations: 2 });
  assert.ok(result.contract);
  assert.ok(result.contract.forbiddenMoves.length >= 3);
  assert.ok(result.contract.doneWhen.includes("80"));
});

test("runResearch writes a scored queue that runCycle consumes", async () => {
  const { svc, engine } = await freshStack();
  const n = await engine.runResearch();
  assert.ok(n >= 1);
  const open = await svc.listResearchQueue("open");
  assert.ok(open.some((x) => x.agentId === "A2"), "A2 is queued");
  assert.ok(open[0].score >= 1 && open[0].score <= 3, "items are scored 1–3");
});

test("a verifier rejection blocks the queue item and isn't retried next cycle", async () => {
  const { svc, engine } = await freshStack({}, { verifier: REJECT_ALL });

  const run1 = await engine.runCycle();
  assert.equal(run1.jobs.find((j) => j.agentId === "A2").action, "rejected:verifier→learning");
  const learning = (await svc.recentLearnings()).find((l) => l.agentId === "A2");
  assert.ok(learning, "a learning was written");
  assert.ok(["voice", "aggressive", "aggressive-cta"].includes(learning.signal));
  assert.ok(await svc.isBlockedSignal("A2", learning.signal));
  assert.ok((await svc.listResearchQueue()).some((x) => x.agentId === "A2" && x.status === "blocked"));
  const rejected = (await svc.getAgent("A2")).proposedImprovements;
  assert.ok(rejected.length > 0, "verifier rejection must retain the maker output");
  assert.ok(rejected.every((proposal) => proposal.status === "rejected"));
  assert.ok(rejected.every((proposal) => proposal.autoRejection?.by === "verifier"));
  assert.ok(rejected.every((proposal) => proposal.verdict?.reasons?.includes("forced")));

  // Second cycle: the blocked signal is not retried.
  const run2 = await engine.runCycle();
  assert.ok(!run2.jobs.some((j) => j.agentId === "A2"), "blocked signal is not retried");
});

test("maker refusal does not reopen the same research-queue focus next cycle", async () => {
  const { svc, engine } = await freshStack();
  // First cycle creates proposals. Clear them and block RQ so the next
  // research pass would have previously reopened the same focus.
  await engine.runCycle();
  const openBefore = await svc.listResearchQueue("open");
  assert.equal(openBefore.length, 0);
  const items = await svc.listResearchQueue();
  const a2 = items.find((x) => x.agentId === "A2");
  assert.ok(a2);
  // Simulate a refused item with the same focus the next research would write.
  await svc.setResearchStatus(a2.id, "blocked", "maker refused (test)");
  await svc.upsertResearchItem({
    agentId: "A2",
    focus: a2.focus,
    title: a2.title,
    score: 2,
    why: "should stay blocked",
    evidence: "test",
    next: "runImprovement",
    estimate: "S",
    status: "open",
  });
  const after = await svc.listResearchQueue();
  const again = after.find((x) => x.id === a2.id);
  assert.equal(again.status, "blocked", "same focus must not reopen after refusal");
});

test("triage selects agents with failing traces even without catalog evalHistory", async () => {
  const { selectForTriage, scoreResearchCandidate } = await import(
    "../src/loop/policy.js"
  );
  const agents = [
    { id: "A7", evalHistory: [], proposedImprovements: [] },
    { id: "A2", evalHistory: [{ status: "Needs improvement", score: 58 }], proposedImprovements: [] },
    { id: "AX", evalHistory: [{ status: "Needs improvement", score: 40 }], proposedImprovements: [] },
  ];
  const evidenceByAgent = {
    A7: { actionableFailingCount: 2 },
    A2: { actionableFailingCount: 3 },
    AX: { actionableFailingCount: 0 },
  };
  const selected = selectForTriage(agents, { evidenceByAgent });
  assert.deepEqual(
    selected.map((a) => a.id).sort(),
    ["A2", "A7"],
  );
  assert.equal(
    scoreResearchCandidate({
      actionableFailingCount: 2,
      evalRecord: null,
    }),
    2,
  );
  assert.equal(
    scoreResearchCandidate({
      actionableFailingCount: 2,
      evalRecord: { status: "Needs improvement", score: 58 },
    }),
    3,
  );
});

test("runGoal stops at the human gate on a verifier ship", async () => {
  const { svc, engine } = await freshStack();
  const before = await svc.getAgent("A2");
  const result = await engine.runGoal("A2", { targetScore: 80, maxIterations: 4 });
  assert.equal(result.done, false);
  assert.equal(result.reason, "held-for-human");
  assert.equal(result.steps[0].action, "verified:ship-awaiting-human");
  const after = await svc.getAgent("A2");
  assert.equal(after.version, before.version);
  assert.ok(after.proposedImprovements.length);
});

test("runCycle respects the token budget", async () => {
  const { engine } = await freshStack({ maxJobs: 0 });
  const run = await engine.runCycle();
  assert.ok(run.jobs.every((j) => j.action === "skipped:budget"));
  assert.equal(run.budget.jobs, 0);
});

test("runGoal never calls a supplied re-evaluator before human approval", async () => {
  const { engine } = await freshStack();
  let calls = 0;
  const result = await engine.runGoal("A2", {
    targetScore: 80,
    maxIterations: 4,
    reevaluate: async () => {
      calls += 1;
      return { score: 100 };
    },
  });
  assert.equal(result.reason, "held-for-human");
  assert.equal(calls, 0);
});
