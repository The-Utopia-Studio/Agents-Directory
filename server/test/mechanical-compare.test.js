import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { getMechanicalInventory } from "../src/eval/mechanicalInventory.js";
import {
  previewVersionComparability,
  runCheckCoverageCompare,
  runMechanicalCompare,
  runMechanicalScore,
  runOutputQualityCompare,
} from "../src/eval/runCompare.js";
import { createLoopService } from "../src/core/loopService.js";
import { createLocalObservability } from "../src/observability/localAdapter.js";
import { getOptimizer } from "../src/improve/index.js";
import { getMemory } from "../src/memory/index.js";
import { seed } from "../src/scripts/seed.js";

const V5 = "biocraft-singleshot-v5";
const V6 = "biocraft-singleshot-v6";
const CASE = "a7-mira-okonkwo-v1";

test("inventory states golden cases and verified versions", () => {
  const inv = getMechanicalInventory("A7");
  assert.equal(inv.goldenCaseCount, 2);
  assert.equal(inv.verifiedArtifactVersionCount, 5);
  assert.match(inv.summary, /2 golden cases/);
  assert.equal(inv.goldenCases.filter((c) => c.sealed).length, 1);
  assert.match(inv.summary, /5 digest-verified/);
  assert.equal(inv.feedsFleetHealth, false);
  assert.equal(inv.writesEvalHistory, false);
  assert.ok(inv.artifactVersions.every((v) => v.verification === "ok"));
});

test("preview refuses bare quality comparability when check sets differ", () => {
  const preview = previewVersionComparability(V5, V6);
  assert.equal(preview.checkSetsDiffer, true);
  assert.equal(preview.comparableAsOutputQualityWithoutRuler, false);
  assert.match(preview.note, /check set changed: \d+ checks → \d+ checks/);
  assert.equal(preview.experiments.output_quality.requiresRuler, true);
});

test("single-version canned score returns table fields and never evalHistory", async () => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-score-")));
  await seed(store);
  const before = await store.get("agents", "A7");
  const evalLen = (before.evalHistory || []).length;
  const result = await runMechanicalScore({
    caseId: CASE,
    artifactVersion: V6,
    outputSource: "canned",
    agentId: "A7",
    store,
  });
  assert.equal(result.ok, true);
  assert.equal(result.label, "mechanical_check_score");
  assert.equal(result.writesEvalHistory, false);
  assert.ok(result.artifactDigest);
  assert.ok(result.checkSetId);
  assert.match(result.checkSetId, /^[a-f0-9]{64}$/);
  assert.ok(result.guardrailGate);
  assert.equal(typeof result.guardrailGate.passed, "boolean");
  assert.equal(result.byCategory.grounding.category, "grounding");
  assert.equal(result.byCategory.style.category, "style");
  assert.ok(result.checkResults.every((r) => r.id && "passed" in r && r.category));
  assert.ok(result.checkResults.some((r) => r.passed === false && r.why));
  // Grounding-only, named so, and never a cross-category average. There is no
  // single field a reader can mistake for whole-agent quality.
  assert.equal(result.groundingPassRate, result.byCategory.grounding.passRate);
  assert.equal(result.stylePassRate, result.byCategory.style.passRate);
  assert.equal(result.mechanicalCheckScore, undefined);
  // Every rate carries the ids it was computed over.
  assert.deepEqual(
    result.groundingBasisCheckIds,
    result.byCategory.grounding.basisCheckIds,
  );
  assert.deepEqual(result.styleBasisCheckIds, result.byCategory.style.basisCheckIds);
  const after = await store.get("agents", "A7");
  assert.equal((after.evalHistory || []).length, evalLen);
  const mech = await store.all("mechanicalResults");
  assert.ok(mech.length >= 1);
  assert.equal(mech[0].outputSource, "canned");
  assert.ok(mech[0].checkSetId);
  assert.ok(mech[0].guardrailGate);
  assert.ok(mech[0].timestamp);
});

test("check_coverage never exposes a quality score delta", () => {
  const result = runCheckCoverageCompare({
    caseId: CASE,
    leftVersion: V5,
    rightVersion: V6,
  });
  assert.equal(result.experiment, "check_coverage");
  assert.equal(result.outputQualityComparable, false);
  assert.equal(result.scoreDelta.comparable, false);
  assert.match(result.scoreDelta.reason, /check set changed: 5 checks → 6 checks/);
  assert.equal(typeof result.groundingPassRateDelta, "object");
  assert.equal(result.groundingPassRateDelta.comparable, false);
  // The style rate is under the same denominator guard.
  assert.equal(typeof result.stylePassRateDelta, "object");
  assert.equal(result.measures, "check_coverage");
  assert.match(result.interpretation, /Category pass rates/);
  assert.equal(result.coverageReading.direction, "right_detects_more");
  // The v5 declared set finds nothing on output that carries a slash-delimited
  // keyword run and an en dash clause break; the v6 set finds both. That gap is
  // the whole point of the widening, and it is now exercised in the golden-case
  // path that gates promotion rather than only in the scorer-accuracy harness.
  assert.equal(result.left.byCategory.style.failed.length, 0);
  assert.deepEqual(result.right.byCategory.style.failed, [
    "about_has_no_delimiter_separated_keyword_run",
    "draft_has_no_em_dash",
  ]);
  // Detection changed, so the style rate is refused rather than differenced.
  assert.equal(result.stylePassRateDelta.comparable, false);
  assert.equal(result.stylePassRateDelta.denominatorChanged, true);
  assert.equal(result.stylePassRateDelta.value, undefined);
});

test("canned output_quality is plumbing verification, not a prompt finding", async () => {
  const result = await runOutputQualityCompare({
    caseId: CASE,
    leftVersion: V5,
    rightVersion: V6,
    rulerVersion: V6,
    outputSource: "canned",
  });
  assert.equal(result.experiment, "output_quality");
  assert.equal(result.outputSource, "canned");
  assert.equal(result.outputProvenance, "canned_fixtures");
  assert.equal(result.answersDidImprovementHelp, false);
  assert.equal(result.findingKind, "plumbing_verification");
  assert.match(result.interpretation, /verifies the scoring path, not the prompts/);
  assert.equal(result.left.outputSource, "canned");
  assert.equal(result.right.outputSource, "canned");
  assert.equal(result.left.checkSetId, result.right.checkSetId);
  assert.equal(result.left.rulerVersion, V6);
  assert.equal(result.right.rulerVersion, V6);
  assert.equal(result.left.artifactVersion, V5);
  assert.equal(result.right.artifactVersion, V6);
  assert.equal(result.scoreDelta.comparable, true);
  assert.ok(result.scoreDelta.value > 0);
  assert.equal(result.groundingPassRateDelta.comparable, true);
  assert.equal(result.promotionEligible, false);
  assert.equal(result.promotionEligibility.eligible, false);
  assert.match(result.promotionEligibility.reason, /canned/);
});

test("output_quality without ruler refuses", async () => {
  await assert.rejects(
    () =>
      runOutputQualityCompare({
        caseId: CASE,
        leftVersion: V5,
        rightVersion: V6,
        outputSource: "canned",
      }),
    (error) => {
      assert.match(error.message, /rulerVersion/);
      return true;
    },
  );
});

test("service refuses bare compare without experiment", async () => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-cmp-")));
  await seed(store);
  const config = {
    observability: { lowScoreThreshold: 70, truncateNotes: true, feedbackNotesMaxChars: 2000 },
    optimizer: { provider: "heuristic" },
    memory: { provider: "local", topK: 5 },
    loop: {},
  };
  const svc = createLoopService({
    store,
    obs: createLocalObservability({ store, lowScoreThreshold: 70 }),
    optimizer: getOptimizer(config),
    memory: getMemory(config, { store }),
    verifier: null,
    config,
  });
  await assert.rejects(
    () => svc.mechanicalCompare("A7", {}),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /experiment is required/);
      return true;
    },
  );

  const coverage = await svc.mechanicalCompare("A7", {
    experiment: "check_coverage",
    caseId: CASE,
    leftVersion: V5,
    rightVersion: V6,
    outputSource: "canned",
  });
  assert.equal(coverage.scoreDelta.comparable, false);
  assert.match(coverage.scoreDelta.reason, /check set changed/);

  const quality = await runMechanicalCompare(store, {
    experiment: "output_quality",
    caseId: CASE,
    leftVersion: V5,
    rightVersion: V6,
    rulerVersion: V6,
    outputSource: "canned",
    agentId: "A7",
  });
  assert.ok(quality.recorded?.leftId);
  assert.equal(quality.scoreDelta.comparable, true);
  assert.ok(quality.scoreDelta.value > 0);
  assert.equal(quality.answersDidImprovementHelp, false);
  assert.equal(quality.findingKind, "plumbing_verification");
});

test("live quality path uses historical system prompts (fake provider)", async () => {
  process.env.NODE_TEST_CONTEXT = "1";
  const responses = {
    [V5]: {
      output_text: "### LinkedIn About\nI help — badly.\n\n### Spoken event introduction\nMira sits at the intersection of x and y and founded Dextrum.\n\n### Suggested headline\nX",
      usage: { input_tokens: 10, output_tokens: 20 },
      model: "fake-v5",
    },
    [V6]: {
      output_text: `### LinkedIn About

As an Intern at Helix Labs I learned shipping. I worked for Dextrum Health as a contractor. I founded Northline Studio.

Open to advisory conversations by email.

### Spoken event introduction

Mira Okonkwo contracted for Dextrum and founded Northline Studio.

### Suggested headline

Designer`,
      usage: { input_tokens: 11, output_tokens: 22 },
      model: "fake-v6",
    },
  };

  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const version = body.instructions.match(/^artifact_version:\s*(\S+)/m)?.[1];
    const payload = responses[version];
    assert.ok(payload, `unexpected instructions artifact_version ${version}`);
    return {
      ok: true,
      async json() {
        return payload;
      },
    };
  };

  const result = await runOutputQualityCompare({
    caseId: CASE,
    leftVersion: V5,
    rightVersion: V6,
    rulerVersion: V6,
    outputSource: "live",
    config: {
      runtime: {
        openai: { apiKey: "test", fetch: fetchImpl, model: "fake" },
      },
    },
  });
  assert.equal(result.left.generation.provider, "openai");
  assert.equal(result.right.generation.modelId, "fake-v6");
  // Different model ids from the API payloads → not comparable as a quality delta.
  assert.equal(result.scoreDelta.comparable, false);
  assert.match(result.scoreDelta.reason, /model mismatch/);
  assert.equal(result.outputSource, "live");
  assert.equal(result.outputProvenance, "live_generation");
  assert.equal(result.answersDidImprovementHelp, true);
  assert.equal(result.findingKind, "prompt_comparison");
  assert.match(result.interpretation, /live pair answers whether the prompt change helped/);
  // Response must not include draft text
  assert.equal("output" in result.left, false);
  assert.equal(result.left.generation.output, undefined);
});

test("live quality path with one shared model yields a comparable delta", async () => {
  const body = {
    [V5]: "### LinkedIn About\nI help — badly.\n\n### Spoken event introduction\nMira sits at the intersection of x and y and founded Dextrum.\n\n### Suggested headline\nX",
    [V6]: `### LinkedIn About

As an Intern at Helix Labs I learned shipping. I worked for Dextrum Health as a contractor. I founded Northline Studio.

Open to advisory conversations by email.

### Spoken event introduction

Mira Okonkwo contracted for Dextrum and founded Northline Studio.

### Suggested headline

Designer`,
  };
  const fetchImpl = async (_url, init) => {
    const req = JSON.parse(init.body);
    const version = req.instructions.match(/^artifact_version:\s*(\S+)/m)?.[1];
    return {
      ok: true,
      async json() {
        return {
          output_text: body[version],
          usage: { input_tokens: 10, output_tokens: 20 },
          model: "gpt-5.6-terra",
        };
      },
    };
  };
  const result = await runOutputQualityCompare({
    caseId: CASE,
    leftVersion: V5,
    rightVersion: V6,
    rulerVersion: V6,
    outputSource: "live",
    config: {
      runtime: {
        openai: { apiKey: "test", fetch: fetchImpl, model: "gpt-5.6-terra" },
      },
    },
  });
  assert.equal(result.left.generation.provider, "openai");
  assert.equal(result.left.generation.modelId, "gpt-5.6-terra");
  assert.equal(result.right.generation.modelId, "gpt-5.6-terra");
  assert.equal(result.scoreDelta.comparable, true);
  assert.ok(result.scoreDelta.value > 0);
});
