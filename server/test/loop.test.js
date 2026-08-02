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
  return (await freshServiceWithStore()).svc;
}

async function freshServiceWithStore() {
  const dir = await mkdtemp(join(tmpdir(), "adir-"));
  const store = createStore(dir);
  await seed(store);
  await store.seedIfEmpty("traces", SEED_TRACES);
  const obs = getObservability(config, { store });
  const optimizer = getOptimizer(config);
  const memory = getMemory(config, { store });
  return { svc: createLoopService({ store, obs, optimizer, memory, config }), store };
}

/**
 * Mirror the real A7 state: successful metadata-only runs plus reviewer
 * feedback. Feedback must attach to a real trace, so the trace is seeded here
 * rather than relaxing that check.
 */
async function serviceWithA7Feedback(feedback) {
  const { svc, store } = await freshServiceWithStore();
  const trace = await store.append("traces", {
    agentId: "A7",
    status: "ok",
    source: "real",
    ts: new Date().toISOString(),
    metadata: { via: "runtime" },
  });
  await svc.recordFeedback("A7", trace.id, feedback);
  return svc;
}

test("loads eight agents and historical A2 trace fixtures", async () => {
  const svc = await freshService();
  const agents = await svc.listAgents();
  assert.equal(agents.length, 8);
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

// A7 has no seeded traces, evals, or feedback: the exact state that used to
// yield a templated proposal with an Approve button behind it.
test("maker refuses with no evidence and names what is missing", async () => {
  const svc = await freshService();
  await assert.rejects(
    () => svc.runImprovement("A7"),
    (e) => {
      assert.equal(e.status, 422);
      assert.match(e.message, /without evidence of a defect/);
      assert.match(e.message, /0 trace\(s\) \(0 failing\)/);
      assert.match(e.message, /0 feedback record\(s\)/);
      assert.match(e.message, /no eval history/);
      assert.match(e.message, /Supply at least one of/);
      return true;
    },
  );
  const a7 = await svc.getAgent("A7");
  assert.equal(a7.proposedImprovement, null, "refusal must not queue a proposal");
});

test("no proposal ever renders an unresolved placeholder", async () => {
  const svc = await freshService();
  const placeholder = /the most frequent failure in recent (runs|traces)/i;

  await assert.rejects(() => svc.runImprovement("A7"), (e) => e.status === 422);

  // The one agent that does have evidence must resolve the signal from it.
  const proposal = await svc.runImprovement("A2");
  assert.doesNotMatch(proposal.summary, placeholder);
  assert.doesNotMatch(proposal.detail, placeholder);
  assert.doesNotMatch(JSON.stringify(proposal.evidence), placeholder);
});

test("reviewer feedback notes count as evidence without any failing trace", async () => {
  // Four stars, so no low rating and no failing trace — only the notes.
  const svc = await serviceWithA7Feedback({
    rating: 4,
    notes: "em dash in the hook; AI cliche 'sits at the intersection of'",
  });

  const proposal = await svc.runImprovement("A7");
  assert.equal(proposal.status, "proposed");
  assert.match(proposal.summary, /em dash/i);
  assert.equal(proposal.evidence.failing, 0, "no failing trace was needed");
  assert.equal(proposal.evidence.feedbackReviewed, 1);
  assert.equal(proposal.evidence.averageRating, 4);
  assert.ok(proposal.evidence.defectSignals.some((s) => /intersection of/.test(s)));
});

test("a proposal records the artifact it was derived against", async () => {
  const svc = await serviceWithA7Feedback({
    rating: 2,
    notes: "fabricated a character count",
  });
  const proposal = await svc.runImprovement("A7");
  assert.equal(proposal.targetArtifactVersion, "biocraft-singleshot-v4");
  assert.match(proposal.targetArtifactDigest, /^[a-f0-9]{64}$/);
  assert.equal(proposal.targetArtifactDigestAlgorithm, "sha256");
  assert.equal(proposal.targetAgentVersion, (await svc.getAgent("A7")).version);
});

test("approval is refused when the targeted artifact has moved", async () => {
  const svc = await serviceWithA7Feedback({
    rating: 2,
    notes: "fabricated a character count",
  });
  const proposal = await svc.runImprovement("A7");

  const agent = await svc.getAgent("A7");
  agent.proposedImprovement = {
    ...proposal,
    targetArtifactVersion: "biocraft-singleshot-v1",
    targetArtifactDigest: "0".repeat(64),
  };
  await svc.putAgent(agent);

  await assert.rejects(
    () => svc.approveImprovement("A7", proposal.id),
    (e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /but the live artifact is biocraft-singleshot-v4/);
      return true;
    },
  );
  assert.ok(
    (await svc.getAgent("A7")).proposedImprovement,
    "a refused approval must leave the proposal pending",
  );
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
  assert.equal(health.total, 8);
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
