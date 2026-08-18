// The preview path: how a candidate gets witnessed without serving fellows.
//
// The deadlock it breaks: witnessing production bytes cannot attest a
// candidate, because serving candidate bytes makes the served digest disagree
// with the approved one, which 409s the run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PreviewRefusal,
  assertFixtureMatchesCandidate,
} from "../src/eval/previewCandidate.js";
import { HISTORICAL_ARTIFACT_REGISTRY } from "../src/eval/historicalArtifacts.js";
import { getRuntimeArtifactDescriptor, snapshotArtifact } from "../src/invoke/runtimeArtifacts.js";

const V10 = "biocraft-singleshot-v10";
const V10_DIGEST = HISTORICAL_ARTIFACT_REGISTRY[V10].declaredDigest;

test("the fixture root is not the served root — fellows cannot reach a fixture", () => {
  // snapshotArtifact realpath-confines itself to server/src/artifacts/. Handing
  // it a fixture directory returns null rather than serving it.
  const fixtureDir = new URL("../src/eval-artifacts/biocraft/biocraft-singleshot-v10/", import.meta.url);
  assert.equal(snapshotArtifact(fixtureDir, "SKILL.md"), null,
    "the fellow-facing loader must refuse a path outside the artifact root");

  // And the two roots genuinely differ on disk.
  const served = fileURLToPath(new URL("../src/artifacts/", import.meta.url));
  const fixtures = fileURLToPath(new URL("../src/eval-artifacts/", import.meta.url));
  assert.notEqual(served, fixtures);
  assert.ok(!fixtures.startsWith(served));
});

test("run-time digest equality is checked, not assumed from CI", () => {
  // Matching fixture and candidate digests pass.
  assert.equal(
    assertFixtureMatchesCandidate({
      artifactVersion: V10,
      fixtureDigest: V10_DIGEST,
      candidateDeclaredDigest: V10_DIGEST,
    }),
    V10_DIGEST,
  );

  // A candidate declaring different bytes refuses BY NAME. This is the case CI
  // cannot catch: Convex and the registry are separate records.
  assert.throws(
    () =>
      assertFixtureMatchesCandidate({
        artifactVersion: V10,
        fixtureDigest: V10_DIGEST,
        candidateDeclaredDigest: "a".repeat(64),
      }),
    (error) => {
      assert.ok(error instanceof PreviewRefusal);
      assert.equal(error.code, "PREVIEW_FIXTURE_DIGEST_MISMATCH");
      assert.match(error.message, /attest output the candidate never produces/);
      return true;
    },
  );
});

test("a missing digest on either side refuses rather than skipping the check", () => {
  assert.throws(
    () => assertFixtureMatchesCandidate({ artifactVersion: V10, fixtureDigest: "", candidateDeclaredDigest: V10_DIGEST }),
    (e) => e.code === "PREVIEW_FIXTURE_DIGEST_MISSING",
  );
  assert.throws(
    () => assertFixtureMatchesCandidate({ artifactVersion: V10, fixtureDigest: V10_DIGEST, candidateDeclaredDigest: "" }),
    (e) => e.code === "PREVIEW_CANDIDATE_DIGEST_MISSING",
  );
  // A blank candidate digest must never be treated as "no opinion".
  assert.throws(
    () => assertFixtureMatchesCandidate({ artifactVersion: V10, fixtureDigest: V10_DIGEST, candidateDeclaredDigest: undefined }),
    (e) => e.code === "PREVIEW_CANDIDATE_DIGEST_MISSING",
  );
});

test("the v10 fixture on disk actually hashes to what the registry declares", () => {
  // The equality the preview relies on, asserted against real bytes.
  const bytes = readFileSync(
    fileURLToPath(new URL("../src/eval-artifacts/biocraft/biocraft-singleshot-v10/SKILL.md", import.meta.url)),
  );
  assert.equal(createHash("sha256").update(bytes).digest("hex"), V10_DIGEST);
});

test("previewing v10 executes different bytes than the live artifact serves", () => {
  // If these were equal there would be no deadlock and no need for a preview.
  const live = getRuntimeArtifactDescriptor("A7");
  assert.notEqual(
    V10_DIGEST,
    HISTORICAL_ARTIFACT_REGISTRY["biocraft-singleshot-v9"].declaredDigest,
    "v9 and v10 must be distinct or the preview proves nothing",
  );
  assert.ok(live.artifactDigest);
});

test("the preview route is absent from the fellow run contract", () => {
  const routes = readFileSync(new URL("../src/http/routes.js", import.meta.url), "utf8");
  assert.match(routes, /preview-candidate/);
  // It is approver-gated, not identity-gated like the fellow run path.
  const idx = routes.indexOf("preview-candidate");
  const block = routes.slice(idx, idx + 260);
  assert.match(block, /requireClerkApprover/);

  // And it is not advertised as a usability mode or invocation capability.
  const svc = readFileSync(new URL("../src/core/loopService.js", import.meta.url), "utf8");
  const capStart = svc.indexOf("getInvocationCapability");
  const capBlock = svc.slice(capStart, capStart + 2000);
  assert.doesNotMatch(capBlock, /preview/i);
});

test("cost is returned for persistence before any human decision", () => {
  const src = readFileSync(new URL("../src/eval/previewCandidate.js", import.meta.url), "utf8");
  assert.match(src, /costUsdFromUsage/);
  // Unpriced models must not fabricate a zero.
  assert.match(src, /never a fabricated zero/);
  assert.match(src, /costAttributable/);

  const svc = readFileSync(new URL("../src/core/loopService.js", import.meta.url), "utf8");
  const start = svc.indexOf("async previewCandidate(");
  const body = svc.slice(start, svc.indexOf("async findProposalByLoopBranch"));
  // The trace persists on its own terms — persistRuntime with via
  // "candidate-preview", never claiming via "runtime" to slip the gate.
  assert.match(body, /persistRuntime: true/);
  assert.match(body, /costUsd/);
  // And an unrecorded cost FAILS the preview rather than returning a warning:
  // spend nobody can audit is worse than a refused preview.
  assert.match(body, /PREVIEW_COST_NOT_RECORDED/);
  assert.match(body, /now untracked/);
});

test("the preview never writes evidence itself", () => {
  const svc = readFileSync(new URL("../src/core/loopService.js", import.meta.url), "utf8");
  const start = svc.indexOf("async previewCandidate(");
  const body = svc.slice(start, svc.indexOf("async findProposalByLoopBranch"));
  assert.doesNotMatch(body, /recordCandidatePreviewEvidence|recordVerifiedHumanRunEvidence/);
  assert.match(body, /evidenceRecorded: false/);
});

test("a sealed golden case can never be previewed", () => {
  const svc = readFileSync(new URL("../src/core/loopService.js", import.meta.url), "utf8");
  const start = svc.indexOf("async previewCandidate(");
  const body = svc.slice(start, svc.indexOf("async findProposalByLoopBranch"));
  assert.match(body, /sealed === true/);
  assert.match(body, /sealed and cannot be previewed/);
});

test("a golden case belonging to another agent is refused", async () => {
  // getGoldenCase is global. Previewing A7's candidate against A10's fixture
  // would record evidence claiming the candidate was exercised by input it
  // never saw. runMechanicalScore already refuses this; so must the preview.
  const { createLoopService } = await import("../src/core/loopService.js");
  const { createStore } = await import("../src/core/store.js");
  const { config } = await import("../src/config.js");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { seed } = await import("../src/scripts/seed.js");

  const store = createStore(await mkdtemp(join(tmpdir(), "adir-preview-")));
  await seed(store);
  const svc = createLoopService({
    store,
    obs: { recordTrace: async () => ({ id: "t1" }) },
    optimizer: {},
    memory: {},
    verifier: {},
    config,
  });

  await assert.rejects(
    () =>
      svc.previewCandidate("A7", {
        artifactVersion: "biocraft-singleshot-v10",
        candidateDeclaredDigest: "c".repeat(64),
        caseId: "a10-mira-okonkwo-v1",
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /belongs to A10, not A7/);
      return true;
    },
  );
});

test("the preview runs the SAME check set as mechanicalScore on the same bytes", async () => {
  // The defect underneath everything else: a preview that reported no check
  // results was strictly less informative than an existing scorer on identical
  // input. Both must derive the set from the artifact, not from a local list.
  const { previewCandidateVersion } = await import("../src/eval/previewCandidate.js");
  const src = readFileSync(fileURLToPath(new URL("../src/eval/previewCandidate.js", import.meta.url)), "utf8");
  const runCompare = readFileSync(fileURLToPath(new URL("../src/eval/runCompare.js", import.meta.url)), "utf8");

  // Both score through the same function with the artifact's declared checks.
  assert.match(src, /scoreMechanicalOutput\(/);
  assert.match(src, /const declaredChecks = \[\.\.\.\(artifact\.checks/);
  assert.match(runCompare, /declaredChecks: scoringArtifact\.checks/);

  // Same declared set for the same version, from each path's own loader.
  const { loadHistoricalArtifact } = await import("../src/eval/historicalArtifacts.js");
  const V10 = "biocraft-singleshot-v10";
  const previewChecks = [...loadHistoricalArtifact(V10).checks].sort();
  const scorerChecks = [...loadHistoricalArtifact(V10).checks].sort();
  assert.deepEqual(previewChecks, scorerChecks);
  assert.ok(previewChecks.length >= 5, "the shared set must be non-trivial");

  // And the preview reports them: results, tiers, and a blocking verdict.
  for (const field of ["checkResults", "blockingFailures", "attestable", "checkSetId"]) {
    assert.match(src, new RegExp(field), `preview must return ${field}`);
  }
  assert.equal(typeof previewCandidateVersion, "function");
});

test("a blocking failure makes the preview non-attestable", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/eval/previewCandidate.js", import.meta.url)), "utf8");
  // Scored fail or named_hit fail — the shared blocking predicate, not a
  // local re-derivation that could drift from the tier model.
  assert.match(src, /isBlockingCheckResult/);
  assert.match(src, /attestable: blocking\.length === 0/);
});

// ── Pasted source, executed end to end ────────────────────────────────────────
//
// The path had never been RUN by a test, only described: assertions checked that
// app.js contained a placeholder string and that a Convex row round-tripped
// "pasted-source". So 303 tests passed against a path that threw
// `Cannot read properties of null (reading 'agentId')` on its first real use,
// and that never sent the pasted text to the model at all.

const PASTED = [
  "Name: Jordan Reyes",
  "Role material:",
  "- Intern, Platform Engineering, Northwind Systems (2023)",
  "- Contract data work for Ridgeline Health",
  "Achievements: cut onboarding time from 9 days to 3 across 12 teams.",
].join("\n");

/** A stub standing in for the OpenAI Responses call. Records what it was sent. */
function stubOpenAi(draft) {
  const seen = { calls: 0, body: null };
  const fetchImpl = async (_url, init) => {
    seen.calls += 1;
    seen.body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          model: "gpt-5.6-terra",
          usage: { input_tokens: 1900, output_tokens: 300 },
          // Same shape the Responses API returns: extractOpenAiText requires
          // item.type === "message" before it reads content parts.
          output: [
            { type: "message", content: [{ type: "output_text", text: draft }] },
          ],
        };
      },
      async text() {
        return "";
      },
    };
  };
  return { seen, fetchImpl };
}

const CLEAN_DRAFT = [
  "### LinkedIn About",
  "",
  "I help platform teams cut onboarding time.",
  "",
  "At Northwind Systems I worked as an Intern on platform engineering.",
  "",
  "One delivery cut onboarding from 9 days to 3 across 12 teams.",
  "",
  "Reach out if your team needs a clearer path.",
  "",
  "### Spoken event introduction",
  "",
  "Jordan Reyes builds platform tooling for engineering teams.",
  "",
  "### Suggested headline",
  "",
  "Platform engineer",
].join("\n");

async function previewWithStub(body, draft = CLEAN_DRAFT) {
  const { previewCandidateVersion } = await import("../src/eval/previewCandidate.js");
  const { config } = await import("../src/config.js");
  const { seen, fetchImpl } = stubOpenAi(draft);
  const result = await previewCandidateVersion({
    agentId: "A7",
    artifactVersion: "biocraft-singleshot-v10",
    candidateDeclaredDigest:
      "c1028caa64ef7965ff2ee052f3ac300509ea47e19346ab6c42aa9075aaacd7c1",
    golden: null,
    config: { ...config, runtime: { ...config.runtime, openai: { ...config.runtime.openai, fetch: fetchImpl } } },
    ...body,
  });
  return { result, seen };
}

test("pasted source runs end to end with no golden case", async () => {
  const { result, seen } = await previewWithStub({ sourceText: PASTED, fellowName: "Jordan Reyes" });

  // It reached the model exactly once and did not throw on the null golden.
  assert.equal(seen.calls, 1);
  assert.ok(result.output.includes("Northwind"));
  assert.equal(result.executionKind, "candidate-preview");
  assert.equal(result.artifactDigest.length, 64);
});

test("the model receives the PASTED text, not the fixture's", async () => {
  // The bug behind the crash: sourceText was accepted and silently dropped, so
  // a "pasted source" preview would have generated from Mira Okonkwo's fixture.
  const { seen } = await previewWithStub({ sourceText: PASTED, fellowName: "Jordan Reyes" });
  const sent = JSON.stringify(seen.body);
  assert.match(sent, /Jordan Reyes/);
  assert.match(sent, /Northwind Systems/);
  assert.doesNotMatch(sent, /Mira Okonkwo/, "the fixture must not leak into a pasted-source preview");
  assert.doesNotMatch(sent, /Helix Labs/);
});

test("pasted source is still scored by the candidate's declared checks", async () => {
  const { result } = await previewWithStub({ sourceText: PASTED, fellowName: "Jordan Reyes" });
  assert.ok(Array.isArray(result.checkResults) && result.checkResults.length >= 5);
  assert.equal(typeof result.checkSetId, "string");
  assert.equal(typeof result.attestable, "boolean");
  // Grounding rules come from a golden case; with none, style still scores.
  assert.equal(typeof result.stylePassRate, "number");
});

test("a blocking failure on pasted output makes it non-attestable", async () => {
  const dirty = CLEAN_DRAFT.replace(
    "Jordan Reyes builds platform tooling for engineering teams.",
    "Jordan Reyes sits at the intersection of platform and product.",
  );
  const { result } = await previewWithStub(
    { sourceText: PASTED, fellowName: "Jordan Reyes" },
    dirty,
  );
  assert.equal(result.attestable, false);
  assert.ok(
    result.blockingFailures.some((f) => f.checkId.includes("cliche")),
    `expected a cliche blocking failure, got ${JSON.stringify(result.blockingFailures)}`,
  );
});

test("no source at all refuses by name rather than throwing a TypeError", async () => {
  await assert.rejects(
    () => previewWithStub({ sourceText: "" }),
    (error) => {
      assert.ok(!(error instanceof TypeError), "must not be a raw TypeError");
      assert.match(error.message, /No source material to generate from/);
      return true;
    },
  );
});

test("the service path accepts pasted source without touching a golden case", async () => {
  // The exact crash reported: previewCandidate dereferenced a null golden.
  const { createLoopService } = await import("../src/core/loopService.js");
  const { createStore } = await import("../src/core/store.js");
  const { config } = await import("../src/config.js");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { seed } = await import("../src/scripts/seed.js");
  const { fetchImpl } = stubOpenAi(CLEAN_DRAFT);

  const store = createStore(await mkdtemp(join(tmpdir(), "adir-paste-")));
  await seed(store);
  const svc = createLoopService({
    store,
    obs: { recordTrace: async () => ({ id: "trace_paste_1" }) },
    optimizer: {},
    memory: {},
    verifier: {},
    config: { ...config, runtime: { ...config.runtime, openai: { ...config.runtime.openai, fetch: fetchImpl } } },
  });

  const out = await svc.previewCandidate("A7", {
    artifactVersion: "biocraft-singleshot-v10",
    candidateDeclaredDigest:
      "c1028caa64ef7965ff2ee052f3ac300509ea47e19346ab6c42aa9075aaacd7c1",
    sourceMaterial: PASTED,
    fellowName: "Jordan Reyes",
  });

  assert.equal(out.previewSourceKind, "pasted-source");
  assert.equal(out.caseId, null, "a pasted preview must not attribute a golden case");
  assert.equal(out.evidenceRecorded, false);
  assert.ok(out.output.includes("Northwind"));
});

// ── The two bypasses found in review ─────────────────────────────────────────

test("a paste with no fellowName is refused, never generated under the fixture's fellow", async () => {
  // The old default was "Mira Okonkwo", so a paste submitted without a name
  // produced a draft attributed to the fixture's fellow — a materially
  // misattributed preview that would then be attested as real.
  await assert.rejects(
    () => previewWithStub({ sourceText: PASTED, fellowName: "" }),
    (error) => {
      assert.match(error.message, /needs a fellowName/);
      assert.match(error.message, /misattribute/);
      return true;
    },
  );
});

test("no request is sent when the fellow name is missing", async () => {
  // Refused before the model call, so a misattributed paste costs nothing.
  const { seen, fetchImpl } = stubOpenAi(CLEAN_DRAFT);
  const { previewCandidateVersion } = await import("../src/eval/previewCandidate.js");
  const { config } = await import("../src/config.js");
  await assert.rejects(() =>
    previewCandidateVersion({
      agentId: "A7",
      artifactVersion: "biocraft-singleshot-v10",
      candidateDeclaredDigest:
        "c1028caa64ef7965ff2ee052f3ac300509ea47e19346ab6c42aa9075aaacd7c1",
      golden: null,
      sourceText: PASTED,
      config: { ...config, runtime: { ...config.runtime, openai: { ...config.runtime.openai, fetch: fetchImpl } } },
    }),
  );
  assert.equal(seen.calls, 0, "no paid call for a refused preview");
});

test("the service refuses a pasted preview with no fellowName", async () => {
  const { createLoopService } = await import("../src/core/loopService.js");
  const { createStore } = await import("../src/core/store.js");
  const { config } = await import("../src/config.js");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { seed } = await import("../src/scripts/seed.js");

  const store = createStore(await mkdtemp(join(tmpdir(), "adir-noname-")));
  await seed(store);
  const svc = createLoopService({
    store, obs: { recordTrace: async () => ({ id: "t" }) },
    optimizer: {}, memory: {}, verifier: {}, config,
  });
  await assert.rejects(
    () =>
      svc.previewCandidate("A7", {
        artifactVersion: "biocraft-singleshot-v10",
        candidateDeclaredDigest:
          "c1028caa64ef7965ff2ee052f3ac300509ea47e19346ab6c42aa9075aaacd7c1",
        sourceMaterial: PASTED,
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /fellowName is required/);
      return true;
    },
  );
});

test("A10 gap answers actually reach the model request", async () => {
  // resolveRuntimeInputs returns ONLY the agent's declared contract fields, and
  // A10 declares fellowName/sourceMaterial/exclusions — no gapAnswers. Passing
  // them through it dropped them silently, so Call 2 never saw the operator's
  // facts. The live runtime adds them AFTER resolving, with a draft phase.
  const { buildGoldenUserPayload } = await import("../src/eval/invokeHistorical.js");
  const payload = buildGoldenUserPayload("A10", null, {
    fellowName: "Jordan Reyes",
    sourceMaterial: PASTED,
    gapAnswers: { "proudest-outcome": "Cut onboarding from 9 days to 3." },
  });
  assert.equal(payload.phase, "draft", "a draft phase is what makes Call 2 run");
  assert.ok(payload.gapAnswers, "gap answers must survive into the payload");
  assert.match(
    JSON.stringify(payload.gapAnswers),
    /Cut onboarding from 9 days to 3/,
  );
  assert.equal(payload.fellowName, "Jordan Reyes");
});

test("no gap answers means no draft phase — Call 1 still asks", async () => {
  const { buildGoldenUserPayload } = await import("../src/eval/invokeHistorical.js");
  const payload = buildGoldenUserPayload("A10", null, {
    fellowName: "Jordan Reyes",
    sourceMaterial: PASTED,
  });
  assert.equal(payload.phase, undefined);
  assert.equal(payload.gapAnswers, undefined);
});

test("resolveRuntimeInputs alone would have dropped the answers", async () => {
  // Guards the reasoning above: if A10 ever declares a gapAnswers field, this
  // fails and the merge below can be simplified.
  const { resolveRuntimeInputs } = await import("../src/invoke/runtimeArtifacts.js");
  const { values } = resolveRuntimeInputs("A10", {
    fellowName: "X", sourceMaterial: "Y", gapAnswers: { a: "b" },
  });
  assert.equal("gapAnswers" in values, false);
});

test("a fixture run still uses the fixture's own fellow", async () => {
  // The refusal is scoped to pastes. A fixture run legitimately defaults,
  // because the fixture IS that fellow's material.
  const { buildGoldenUserPayload } = await import("../src/eval/invokeHistorical.js");
  const { getGoldenCase } = await import("../src/eval/goldenCases.js");
  const payload = buildGoldenUserPayload("A7", getGoldenCase("a7-mira-okonkwo-v1"), {});
  assert.equal(payload.fellowName, "Mira Okonkwo");
  assert.match(payload.sourceMaterial, /Mira Okonkwo/);
});

test("KNOWN GAP: the fixture default misnames non-Mira sealed cases", async () => {
  // Documented, not fixed. buildGoldenUserPayload defaults every fixture run to
  // "Mira Okonkwo", so scoring a7-jonas-park-v1 generates under the wrong name.
  // Preview cannot hit this — sealed cases are refused — but runMechanicalScore
  // can. Fixing it changes the input to an existing scoring path and would move
  // recorded scores, so it is surfaced here rather than changed silently.
  const { buildGoldenUserPayload } = await import("../src/eval/invokeHistorical.js");
  const { getGoldenCase } = await import("../src/eval/goldenCases.js");
  const jonas = getGoldenCase("a7-jonas-park-v1");
  assert.equal(jonas.sealed, true, "still sealed, so preview cannot reach it");
  const payload = buildGoldenUserPayload("A7", jonas, {});
  assert.equal(
    payload.fellowName,
    "Mira Okonkwo",
    "if this changes, the gap was fixed and this test should assert the real name",
  );
  assert.match(payload.sourceMaterial, /Jonas Park/);
});
