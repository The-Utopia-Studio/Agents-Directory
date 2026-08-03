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
  // Four stars, so no low rating and no failing trace — only the notes.
  const svc = await serviceWithA7Feedback({
    rating: 4,
    notes: "em dash in the hook; AI cliche 'sits at the intersection of'",
  });

  const [proposal] = await svc.runImprovement("A7");
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.changes.length, 1);
  assert.equal(proposal.changes[0].evidence.length, 1);
  assert.equal(proposal.evidence.failing, 0, "no failing trace was needed");
  assert.equal(proposal.evidence.feedbackReviewed, 1);
  assert.equal(proposal.evidence.averageRating, 4);
  assert.doesNotMatch(
    JSON.stringify(proposal),
    /em dash in the hook; AI cliche/,
    "feedback is cited by id, not copied into proposal text",
  );
});

// The reviewer's real note. It mentions an em dash (a genuine defect) and
// praises the absence of fabricated character counts. The maker used to emit a
// character-count guardrail the artifact already contains, and to drop the em
// dash entirely because another sentence in the same note set a note-level
// "asks for a prompt change" flag.
const REVIEWER_NOTE =
  "The hook still uses an em dash. Good that it no longer invents character " +
  "counts. The prompt should also say something about generic positioning.";

test("the maker verifies current state against the artifact before claiming it", async () => {
  const svc = await serviceWithA7Feedback({ rating: 3, notes: REVIEWER_NOTE });
  const proposals = await svc.runImprovement("A7");
  const targets = proposals.flatMap((p) => p.changes.map((c) => c.target));

  // Routing: the em dash is its own defect and cannot be vetoed by a flag set
  // by an unrelated sentence in the same note.
  assert.ok(
    targets.includes("draft_has_no_em_dash"),
    `expected an em-dash change, got ${JSON.stringify(targets)}`,
  );

  // Verification: SKILL.md already carries "Do not report or annotate
  // character counts", so asserting it is missing would be a false claim.
  assert.equal(
    proposals.some((p) => /character count/i.test(JSON.stringify(p.changes))),
    false,
    "an artifact rule that already exists must not be proposed as missing",
  );

  // Every claim about current state is checked against the live bytes.
  const artifact = await readFile(
    new URL("../src/artifacts/biocraft/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(artifact, /Do not report or annotate character counts/);
});

// Polarity is NOT solved, and the code says so. The gate above suppresses this
// instance only because the guardrail happens to be present; praise about a
// rule that is absent would still be read as a defect.
test("praise and defect are indistinguishable once the artifact rule is absent", async () => {
  const svc = await serviceWithA7Feedback({
    rating: 5,
    notes: "No em dashes anywhere this time, which is a real improvement.",
  });
  const proposals = await svc.runImprovement("A7");
  assert.deepEqual(
    proposals.flatMap((p) => p.changes.map((c) => c.target)),
    ["draft_has_no_em_dash"],
    "keyword matching cannot tell praise from a defect; only a real maker can",
  );
});

// Two defects in one note are two separately approvable proposals. Bundling
// them would render two rows behind a single verdict.
test("one feedback note produces separate checker and prompt proposals", async () => {
  const note =
    "Defect one: the AI cliche checker treats its phrase list as a word list. " +
    "Fix the detector at phrase level. Defect two: the draft claims a job title " +
    "the fellow never held; it says founder for a company she interned at.";
  const svc = await serviceWithA7Feedback({ rating: 3, notes: note });

  const proposals = await svc.runImprovement("A7");
  assert.equal(proposals.length, 2);
  assert.ok(proposals.every((p) => p.changes.length === 1));
  const changes = proposals.map((p) => p.changes[0]);
  const checker = changes.find((change) => change.surface === "check");
  const prompt = changes.find((change) => change.surface === "prompt");
  assert.equal(checker.target, "draft_has_no_ai_cliche_phrase");
  // Derived from the edit: a final-cut instruction targets Method, not the
  // Guardrails section a single hardcoded constant used to name.
  assert.equal(prompt.target, "server/src/artifacts/biocraft/SKILL.md#method");
  assert.deepEqual(checker.evidence, prompt.evidence);
  assert.equal(JSON.stringify(proposals).includes(note), false);
});

test("a proposal records the artifact it was derived against", async () => {
  const svc = await serviceWithA7Feedback({
    rating: 2,
    notes: "the hook uses an em dash",
  });
  const [proposal] = await svc.runImprovement("A7");
  assert.equal(proposal.targetArtifactVersion, "biocraft-singleshot-v4");
  assert.match(proposal.targetArtifactDigest, /^[a-f0-9]{64}$/);
  assert.equal(proposal.targetArtifactDigestAlgorithm, "sha256");
  assert.equal(proposal.targetAgentVersion, (await svc.getAgent("A7")).version);
});

test("approval is refused when the targeted artifact has moved", async () => {
  const svc = await serviceWithA7Feedback({
    rating: 2,
    notes: "the hook uses an em dash",
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
    () => svc.approveImprovement("A7", proposal.id),
    (e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /but the live artifact is biocraft-singleshot-v4/);
      return true;
    },
  );
  assert.equal(
    (await svc.getAgent("A7")).proposedImprovements.length,
    1,
    "a refused approval must leave the proposal pending",
  );
});

test("approve resolves one proposal and leaves the others pending", async () => {
  const svc = await freshService();
  const before = await svc.getAgent("A2");
  const proposals = await svc.runImprovement("A2");
  assert.equal(proposals.length, 2);

  const { version } = await svc.approveImprovement("A2", proposals[0].id);
  assert.equal(version, bumpVersion(before.version));
  const a2 = await svc.getAgent("A2");
  assert.deepEqual(
    a2.proposedImprovements.map((p) => p.id),
    [proposals[1].id],
    "a decision on one defect must not silently discard the other",
  );
  assert.ok(a2.changelog.some((c) => c.version === version));
});

test("an unnamed decision is refused while several proposals are pending", async () => {
  const svc = await freshService();
  const proposals = await svc.runImprovement("A2");
  assert.ok(proposals.length > 1);
  await assert.rejects(
    () => svc.approveImprovement("A2"),
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

  await svc.approveImprovement("A2", proposal.id);
  const a2 = await svc.getAgent("A2");
  assert.deepEqual(a2.proposedImprovements, []);
  assert.equal(a2.proposedImprovement, null);
});

test("approval refuses a legacy proposal with no structured changes", async () => {
  const { svc } = await freshServiceWithStore();
  const [proposal] = await svc.runImprovement("A2");
  const agent = await svc.getAgent("A2");
  agent.proposedImprovements = [{ ...proposal, changes: undefined }];
  await svc.putAgent(agent);

  await assert.rejects(
    () => svc.approveImprovement("A2", proposal.id),
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
