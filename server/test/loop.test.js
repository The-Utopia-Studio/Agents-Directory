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
import { seed } from "../src/scripts/seed.js";
import { config } from "../src/config.js";
import { bumpVersion } from "../src/core/version.js";

async function freshService() {
  const dir = await mkdtemp(join(tmpdir(), "adir-"));
  const store = createStore(dir);
  await seed(store);
  const obs = getObservability(config, { store });
  const optimizer = getOptimizer(config);
  return createLoopService({ store, obs, optimizer });
}

test("seeds six agents and A2 failing traces", async () => {
  const svc = await freshService();
  const agents = await svc.listAgents();
  assert.equal(agents.length, 6);
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
  assert.equal(health.total, 6);
  assert.ok(health.coverage > 0);
});

test("recordTrace round-trips through observability", async () => {
  const svc = await freshService();
  await svc.recordTrace("A1", { status: "fail", score: 40, failureReason: "test", output: "x" });
  const traces = await svc.listTraces("A1");
  assert.ok(traces.some((t) => t.failureReason === "test"));
});
