// End-to-end test of the loop against a temp store, with the default
// (offline) providers. No network, no keys.
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
import { seed, SEED_TRACES } from "../src/scripts/seed.js";
import { config } from "../src/config.js";
import { bumpVersion } from "../src/core/version.js";

async function freshService() {
  const dir = await mkdtemp(join(tmpdir(), "adir-"));
  const store = createStore(dir);
  await seed(store);
  await store.seedIfEmpty("traces", SEED_TRACES);
  const obs = getObservability(config, { store });
  const optimizer = getOptimizer(config);
  const memory = getMemory(config, { store });
  return createLoopService({ store, obs, optimizer, memory, config });
}

test("loads seven agents and historical A2 trace fixtures", async () => {
  const svc = await freshService();
  const agents = await svc.listAgents();
  assert.equal(agents.length, 7);
  const failing = await svc.listTraces("A2");
  assert.ok(failing.length >= 5);
});

test("runImprovement derives a proposal from failing signal", async () => {
  const svc = await freshService();
  const proposal = await svc.runImprovement("A2");
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.source, "heuristic");
  assert.ok(proposal.evidence.failing >= 3, "should see the failing traces");
  assert.match(proposal.summary, /voice mismatch|aggressive/i);
  const a2 = await svc.getAgent("A2");
  assert.equal(a2.proposedImprovement.id, proposal.id);
});

test("approve cuts a new version and clears the proposal", async () => {
  const svc = await freshService();
  const before = await svc.getAgent("A2");
  const proposal = await svc.runImprovement("A2");
  const { version } = await svc.approveImprovement("A2", proposal.id);
  assert.equal(version, bumpVersion(before.version));
  const a2 = await svc.getAgent("A2");
  assert.equal(a2.proposedImprovement, null);
  assert.ok(a2.changelog.some((c) => c.version === version));
});

test("reject clears the proposal without a version bump", async () => {
  const svc = await freshService();
  const before = await svc.getAgent("A2");
  const proposal = await svc.runImprovement("A2");
  await svc.rejectImprovement("A2", proposal.id);
  const a2 = await svc.getAgent("A2");
  assert.equal(a2.proposedImprovement, null);
  assert.equal(a2.version, before.version);
});

test("logEval appends to history and moves fleet health", async () => {
  const svc = await freshService();
  await svc.logEval("A4", { status: "Performing well", score: 90, notes: "good" });
  const a4 = await svc.getAgent("A4");
  assert.equal(a4.evalHistory.at(-1).score, 90);
  const health = await svc.fleetHealth();
  assert.equal(health.total, 7);
  assert.ok(health.coverage > 0);
});

test("recordTrace does not write to disabled file observability", async () => {
  const svc = await freshService();
  const result = await svc.recordTrace("A1", {
    status: "fail",
    source: "real",
    provider: "anthropic",
    metadata: { via: "runtime" },
    score: 40,
    failureReason: "test",
    output: "x",
  });
  const traces = await svc.listTraces("A1");
  assert.equal(result.persisted, false);
  assert.ok(!traces.some((t) => t.failureReason === "test"));
});

test("runAgent invokes a runnable agent without file trace persistence", async () => {
  const svc = await freshService();
  const before = (await svc.listTraces("A2")).length;
  const r = await svc.runAgent("A2", { bio: "founder, warm voice" });
  assert.equal(r.status, "ok");
  assert.equal(r.via, "mock");
  assert.ok(r.output.includes("Bio Generator"));
  assert.equal(r.traceId, null);
  assert.equal(r.tracePersisted, false);
  assert.equal((await svc.listTraces("A2")).length, before);
});

test("mock runs remain explicitly distinguishable from real runtime traces", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adir-mock-source-"));
  const store = createStore(dir);
  await seed(store);
  let recorded;
  const baseObs = getObservability(config, { store });
  const obs = {
    ...baseObs,
    async recordTrace(trace) {
      recorded = trace;
      return { ...trace, id: "mock-trace", persisted: true };
    },
  };
  const svc = createLoopService({
    store,
    obs,
    optimizer: getOptimizer(config),
    memory: getMemory(config, { store }),
    config,
  });
  await svc.runAgent("A2", { bio: "founder" });
  assert.equal(recorded.source, "mock");
  assert.equal(recorded.metadata.via, "mock");
  assert.equal("provider" in recorded, false);
  assert.equal("modelId" in recorded, false);
  assert.equal("input" in recorded, false);
  assert.equal("output" in recorded, false);
  assert.match(recorded.outputDigest, /^[a-f0-9]{64}$/);
});

// Same wiring as freshService, but every trace write throws — the case where
// the observability adapter itself is broken, not merely write-disabled.
async function serviceWithFailingTraceWriter() {
  const dir = await mkdtemp(join(tmpdir(), "adir-tracefail-"));
  const store = createStore(dir);
  await seed(store);
  const obs = getObservability(config, { store });
  const brokenObs = {
    ...obs,
    async recordTrace() {
      throw new Error("trace store unavailable");
    },
  };
  return createLoopService({
    store,
    obs: brokenObs,
    optimizer: getOptimizer(config),
    memory: getMemory(config, { store }),
    config,
  });
}

test("failed run reports the invocation error when trace persistence throws", async () => {
  const svc = await serviceWithFailingTraceWriter();
  const a2 = await svc.getAgent("A2");
  await svc.putAgent({
    ...a2,
    invocation: { type: "http", url: "http://127.0.0.1/private" },
  });
  await assert.rejects(
    () => svc.runAgent("A2", {}),
    (error) => {
      assert.match(error.message, /local address|non-public address/);
      assert.doesNotMatch(error.message, /trace store unavailable/);
      assert.equal(error.status, 400);
      assert.equal(error.runStatus, "error");
      // No trace exists, and the response must not imply one does.
      assert.equal(error.traceId, null);
      assert.equal(error.tracePersisted, false);
      return true;
    },
  );
});

test("successful run keeps its output when trace persistence throws", async () => {
  const svc = await serviceWithFailingTraceWriter();
  const r = await svc.runAgent("A2", { bio: "founder, warm voice" });
  assert.equal(r.status, "ok");
  assert.equal(r.via, "mock");
  // The output surviving a trace failure is the whole point of this test.
  assert.ok(r.output.includes("Bio Generator"));
  assert.equal(r.traceId, null);
  assert.equal(r.tracePersisted, false);
});

test("runAgent refuses link/prompt agents (open them where they live)", async () => {
  const svc = await freshService();
  const a1 = await svc.getAgent("A1");
  await svc.putAgent({ ...a1, invocation: { type: "link", url: "https://claude.ai/project/x" } });
  await assert.rejects(() => svc.runAgent("A1", {}), /open it where it lives/);
});

test("context: ingest then recall (the fourth pillar)", async () => {
  const svc = await freshService();
  await svc.addContext("A2", { content: "The fellow's brand voice is warm, concise, and understated." });
  await svc.addContext("A2", { content: "Avoid buzzwords like synergy and thought leader." });
  const hits = await svc.recallContext("A2", "what is the fellow's voice?");
  assert.ok(hits.length > 0, "should recall relevant memory");
  assert.match(hits[0].content, /voice|warm|concise/i);
  // namespaced — A1 shouldn't see A2's memory
  const other = await svc.recallContext("A1", "voice");
  assert.ok(!other.some((h) => /warm, concise/.test(h.content)));
});

test("seedContext turns declared context[] into recall", async () => {
  const svc = await freshService();
  const n = await svc.seedContext();
  assert.ok(n >= 6, "seeds context items across agents");
  const hits = await svc.recallContext("A2", "voice glossary");
  assert.ok(hits.some((h) => /glossary/i.test(h.content)));
});
