// End-to-end test of the loop against a temp store, with the default
// (offline) providers. No network, no keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { createLoopService } from "../src/core/loopService.js";
import { getObservability } from "../src/observability/index.js";
import { getOptimizer } from "../src/improve/index.js";
import { getMemory } from "../src/memory/index.js";
import { seed, SEED_TRACES } from "../src/scripts/seed.js";
import { config } from "../src/config.js";

const TEST_APPROVER = Object.freeze({
  subject: "user_test_approver",
  issuer: "https://valid-collie-71.clerk.accounts.dev",
  role: "approver",
  name: "Test Approver",
});

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

test("runImprovement derives one proposal per defect from failing signal", async () => {
  const svc = await freshService();
  const proposals = await svc.runImprovement("A2");
  assert.equal(proposals.length, 2, "two distinct trace defects, two proposals");
  // Approval is a proposal-level decision, so a proposal must never bundle
  // defects it renders as separately reviewable rows.
  assert.ok(proposals.every((p) => p.changes.length === 1));
  assert.ok(proposals.every((p) => p.status === "proposed"));
  assert.ok(proposals.every((p) => p.source === "heuristic"));
  assert.ok(new Set(proposals.map((p) => p.id)).size === 2, "ids are distinct");
  const first = proposals[0];
  assert.ok(first.evidence.failing >= 3, "should see the failing traces");
  const references = proposals.flatMap((p) => p.changes.flatMap((c) => c.evidence));
  assert.ok(references.length >= 3);
  assert.ok(references.every((id) => /^t_a2_/.test(id)));
  assert.doesNotMatch(first.summary + first.detail, /results-driven|10x/i);
  const a2 = await svc.getAgent("A2");
  assert.deepEqual(
    a2.proposedImprovements.map((p) => p.id),
    proposals.map((p) => p.id),
  );
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
  assert.deepEqual(
    a7.proposedImprovements || [],
    [],
    "refusal must not queue a proposal",
  );
  assert.equal(
    a7.latestProposalAttempt?.outcome,
    "maker-refused-no-evidence",
    "the agent page needs a durable structural reason for no proposal",
  );
});

test("no proposal ever renders an unresolved placeholder", async () => {
  const svc = await freshService();
  const placeholder = /the most frequent failure in recent (runs|traces)/i;

  await assert.rejects(() => svc.runImprovement("A7"), (e) => e.status === 422);

  // The one agent that does have evidence must resolve the signal from it.
  for (const proposal of await svc.runImprovement("A2")) {
    assert.doesNotMatch(proposal.summary, placeholder);
    assert.doesNotMatch(proposal.detail, placeholder);
    assert.doesNotMatch(JSON.stringify(proposal.evidence), placeholder);
  }
});

test("reviewer feedback notes count as evidence without any failing trace", async () => {
  // Relationship-and-title is now in the live artifact final cut, so founder/
  // intern feedback alone is suppressed. Voice mismatch is still open and is
  // delivered here as a failing-trace signal that does not need a low rating.
  const { svc, store } = await freshServiceWithStore();
  await store.append("traces", {
    agentId: "A7",
    status: "fail",
    source: "real",
    failureReason: "voice mismatch",
    ts: new Date().toISOString(),
    metadata: { via: "runtime" },
  });
  // Four-star feedback alone would not be a low rating; the failing trace is
  // the defect signal. Attach feedback so averageRating is still populated.
  const okTrace = await store.append("traces", {
    agentId: "A7",
    status: "ok",
    source: "real",
    ts: new Date().toISOString(),
    metadata: { via: "runtime" },
  });
  await svc.recordFeedback("A7", okTrace.id, {
    rating: 4,
    notes: "tone felt slightly off but no specific grounding miss",
  });

  const [proposal] = await svc.runImprovement("A7");
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.changes.length, 1);
  assert.equal(proposal.changes[0].surface, "prompt");
  assert.match(proposal.changes[0].target, /#method$/);
  assert.ok(proposal.evidence.failing >= 1);
  assert.equal(proposal.evidence.feedbackReviewed, 1);
  assert.equal(proposal.evidence.averageRating, 4);
});

// The reviewer's note names defects whose checks/rules are now present in v7.
const REVIEWER_NOTE =
  "The hook still uses an em dash. Good that it no longer invents character " +
  "counts. It also calls her founder of a company where she was an intern.";

test("the maker verifies current state against the artifact before claiming it", async () => {
  const svc = await serviceWithA7Feedback({ rating: 3, notes: REVIEWER_NOTE });
  // Every named defect in REVIEWER_NOTE is already covered by v7 bytes, so the
  // maker must refuse rather than re-propose closed gaps.
  await assert.rejects(
    () => svc.runImprovement("A7"),
    (e) => e.status === 422 && /already addressed/i.test(e.message),
  );

  const artifact = await readFile(
    new URL("../src/artifacts/biocraft/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(artifact, /Do not report or annotate character counts/);
  assert.match(artifact, /Compare every\s+company relationship and role title/);
  assert.match(artifact, /draft_has_no_em_dash/);
});

// Polarity is still not solved generally, but a rule already present in the
// artifact must never be proposed again even when keyword matching sees it.
test("praise about a registered check does not create a duplicate proposal", async () => {
  const svc = await serviceWithA7Feedback({
    rating: 5,
    notes: "No em dashes anywhere this time, which is a real improvement.",
  });
  await assert.rejects(
    () => svc.runImprovement("A7"),
    (e) => e.status === 422 && /already addressed/i.test(e.message),
  );
});

test("a registered checker defect is suppressed while an unresolved prompt defect remains", async () => {
  // Phrase-list feedback would have proposed a cliche check; that check is
  // registered in v7. Pair it with a still-open voice-mismatch failing trace.
  const { svc, store } = await freshServiceWithStore();
  const okTrace = await store.append("traces", {
    agentId: "A7",
    status: "ok",
    source: "real",
    ts: new Date().toISOString(),
    metadata: { via: "runtime" },
  });
  await store.append("traces", {
    agentId: "A7",
    status: "fail",
    source: "real",
    failureReason: "voice mismatch",
    ts: new Date().toISOString(),
    metadata: { via: "runtime" },
  });
  await svc.recordFeedback("A7", okTrace.id, {
    rating: 3,
    notes:
      "Defect one: the AI cliche checker treats its phrase list as a word list. " +
      "Fix the detector at phrase level.",
  });

  const proposals = await svc.runImprovement("A7");
  assert.equal(proposals.length, 1);
  assert.ok(proposals.every((p) => p.changes.length === 1));
  const changes = proposals.map((p) => p.changes[0]);
  assert.equal(changes.some((change) => change.surface === "check"), false);
  const prompt = changes.find((change) => change.surface === "prompt");
  assert.equal(prompt.target, "server/src/artifacts/biocraft/SKILL.md#method");
  assert.equal(JSON.stringify(proposals).includes("phrase list"), false);
});

test("a proposal records the artifact it was derived against", async () => {
  const { svc, store } = await freshServiceWithStore();
  await store.append("traces", {
    agentId: "A7",
    status: "fail",
    source: "real",
    failureReason: "voice mismatch",
    ts: new Date().toISOString(),
    metadata: { via: "runtime" },
  });
  const [proposal] = await svc.runImprovement("A7");
  assert.equal(proposal.targetArtifactVersion, "biocraft-singleshot-v7");
  assert.match(proposal.targetArtifactDigest, /^[a-f0-9]{64}$/);
  assert.equal(proposal.targetArtifactDigestAlgorithm, "sha256");
  assert.equal(proposal.targetAgentVersion, (await svc.getAgent("A7")).version);
});

test("approval is refused when the targeted artifact has moved", async () => {
  const { svc, store } = await freshServiceWithStore();
  await store.append("traces", {
    agentId: "A7",
    status: "fail",
    source: "real",
    failureReason: "voice mismatch",
    ts: new Date().toISOString(),
    metadata: { via: "runtime" },
  });
  const [proposal] = await svc.runImprovement("A7");

  const agent = await svc.getAgent("A7");
  agent.proposedImprovements = [
    {
      ...proposal,
      targetArtifactVersion: "biocraft-singleshot-v1",
      targetArtifactDigest: "0".repeat(64),
    },
  ];
  await svc.putAgent(agent);

  await assert.rejects(
    () => svc.approveImprovement("A7", proposal.id, TEST_APPROVER),
    (e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /but the live artifact is biocraft-singleshot-v7/);
      return true;
    },
  );
  assert.equal(
    (await svc.getAgent("A7")).proposedImprovements.length,
    1,
    "a refused approval must leave the proposal pending",
  );
});

test("approval retains the decided proposal without moving the Railway catalog version", async () => {
  const svc = await freshService();
  const before = await svc.getAgent("A2");
  const proposals = await svc.runImprovement("A2");
  assert.equal(proposals.length, 2);

  const { version, proposal: approved } = await svc.approveImprovement(
    "A2",
    proposals[0].id,
    TEST_APPROVER,
  );
  assert.equal(version, before.version);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedBy.subject, TEST_APPROVER.subject);
  assert.match(approved.patch, /--- current[\s\S]*\+\+\+ proposed/);
  const a2 = await svc.getAgent("A2");
  assert.deepEqual(
    a2.proposedImprovements.map((p) => [p.id, p.status]),
    [[proposals[0].id, "approved"], [proposals[1].id, "proposed"]],
    "a decision must retain both its audit record and the pending sibling",
  );
  assert.deepEqual(a2.changelog, before.changelog);
});

test("approval refuses missing or unverified human identity", async () => {
  const svc = await freshService();
  const [proposal] = await svc.runImprovement("A2");
  await assert.rejects(
    () => svc.approveImprovement("A2", proposal.id),
    (error) => error.status === 403,
  );
  await assert.rejects(
    () => svc.approveImprovement("A2", proposal.id, { ...TEST_APPROVER, role: "member" }),
    (error) => error.status === 403,
  );
});

test("an unnamed decision is refused while several proposals are pending", async () => {
  const svc = await freshService();
  const proposals = await svc.runImprovement("A2");
  assert.ok(proposals.length > 1);
  await assert.rejects(
    () => svc.approveImprovement("A2", null, TEST_APPROVER),
    (e) => e.status === 409,
  );
  assert.equal((await svc.getAgent("A2")).proposedImprovements.length, 2);
});

test("a record written before the split is still approvable", async () => {
  const svc = await freshService();
  const [proposal] = await svc.runImprovement("A2");
  const agent = await svc.getAgent("A2");
  // The legacy singular shape, exactly as older stores hold it.
  agent.proposedImprovements = undefined;
  agent.proposedImprovement = proposal;
  await svc.putAgent(agent);

  await svc.approveImprovement("A2", proposal.id, TEST_APPROVER);
  const a2 = await svc.getAgent("A2");
  assert.deepEqual(a2.proposedImprovements.map((item) => item.status), ["approved"]);
  assert.equal(a2.proposedImprovement, null);
});

test("approval refuses a legacy proposal with no structured changes", async () => {
  const { svc } = await freshServiceWithStore();
  const [proposal] = await svc.runImprovement("A2");
  const agent = await svc.getAgent("A2");
  agent.proposedImprovements = [{ ...proposal, changes: undefined }];
  await svc.putAgent(agent);

  await assert.rejects(
    () => svc.approveImprovement("A2", proposal.id, TEST_APPROVER),
    (error) => {
      assert.equal(error.status, 422);
      assert.match(error.message, /changes\[\] must contain/);
      return true;
    },
  );
  assert.equal((await svc.getAgent("A2")).version, agent.version);
});

test("reject clears one proposal without a version bump", async () => {
  const svc = await freshService();
  const before = await svc.getAgent("A2");
  const proposals = await svc.runImprovement("A2");
  await svc.rejectImprovement("A2", proposals[0].id);
  const a2 = await svc.getAgent("A2");
  assert.deepEqual(
    a2.proposedImprovements.map((p) => p.id),
    [proposals[1].id],
  );
  assert.equal(a2.version, before.version);
});

test("verifier rejection retains the proposal and a human can reopen it", async () => {
  const svc = await freshService();
  const [proposal] = await svc.runImprovement("A2");
  const verdict = {
    verdict: "reject",
    confidence: 0.7,
    reasons: ["forced verifier finding"],
    by: "test-verifier",
  };

  await svc.attachVerdict("A2", verdict, proposal.id);
  await svc.markVerifierRejected("A2", proposal.id);
  let agent = await svc.getAgent("A2");
  const retained = agent.proposedImprovements.find((item) => item.id === proposal.id);
  assert.equal(retained.status, "rejected");
  assert.deepEqual(retained.changes, proposal.changes);
  assert.deepEqual(retained.verdict, verdict);
  assert.equal(retained.autoRejection.by, "verifier");
  assert.equal(agent.latestProposalAttempt.outcome, "verifier-rejected");

  await svc.reopenVerifierRejectedImprovement("A2", proposal.id);
  agent = await svc.getAgent("A2");
  const reopened = agent.proposedImprovements.find((item) => item.id === proposal.id);
  assert.equal(reopened.status, "proposed");
  assert.deepEqual(reopened.verdict, verdict, "the earlier verifier opinion remains visible");
  assert.equal(reopened.autoRejection, undefined);
  assert.equal(agent.latestProposalAttempt.outcome, "reopened-for-human-review");
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
