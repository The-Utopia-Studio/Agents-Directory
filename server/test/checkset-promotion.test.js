import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSetEntriesFromInputs,
  computeCheckSetId,
} from "../src/eval/checkSetId.js";
import {
  REASON_PRE_CHECKSET_VERSIONING,
  groundingScoreDelta,
} from "../src/eval/compareExperiments.js";
import { evaluateGuardrailGate } from "../src/eval/guardrailGate.js";
import { evaluatePromotionGate } from "../src/eval/promotionGate.js";
import { scoreMechanicalOutput } from "../src/eval/scoreMechanicalOutput.js";

test("checkSetId includes tier so pre-tier scores are non-comparable", () => {
  const withoutTierShape = computeCheckSetId([
    { id: "about_closing_has_cta", category: "style" },
  ]);
  const withExplicitTier = computeCheckSetId([
    { id: "about_closing_has_cta", category: "style", tier: "advisory" },
  ]);
  assert.equal(withoutTierShape, withExplicitTier);
  const scoredTwin = computeCheckSetId([
    { id: "about_closing_has_cta", category: "style", tier: "scored" },
  ]);
  assert.notEqual(withExplicitTier, scoredTwin);
});

test("checkSetId is stable over sorted id+category and ignores artifact version", () => {
  const a = computeCheckSetId([
    { id: "b", category: "style" },
    { id: "a", category: "grounding" },
  ]);
  const b = computeCheckSetId([
    { id: "a", category: "grounding" },
    { id: "b", category: "style" },
  ]);
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("identical checks across prompt versions are comparable via checkSetId", () => {
  const checkSetId = computeCheckSetId(
    checkSetEntriesFromInputs(["about_closing_has_cta"], [
      { checkId: "source_preserves_intern_near_helix" },
    ]),
  );
  const left = {
    checkSetId,
    artifactVersion: "biocraft-singleshot-v5",
    outputSource: "live",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    byCategory: { grounding: { passRate: 0 } },
    checkResults: [
      { id: "about_closing_has_cta", passed: true, category: "style" },
      { id: "source_preserves_intern_near_helix", passed: false, category: "grounding" },
    ],
  };
  const right = {
    checkSetId,
    artifactVersion: "biocraft-singleshot-v6",
    outputSource: "live",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    byCategory: { grounding: { passRate: 100 } },
    checkResults: left.checkResults.map((row) =>
      row.id.startsWith("source_") ? { ...row, passed: true } : row,
    ),
  };
  const delta = groundingScoreDelta(left, right);
  assert.equal(delta.comparable, true);
  assert.equal(delta.value, 100);
});

test("live scores without model identity refuse with an explicit reason", () => {
  const checkSetId = computeCheckSetId([{ id: "g", category: "grounding" }]);
  const delta = groundingScoreDelta(
    {
      checkSetId,
      outputSource: "live",
      byCategory: { grounding: { passRate: 40 } },
      checkResults: [{ id: "g", passed: true, category: "grounding" }],
    },
    {
      checkSetId,
      outputSource: "live",
      byCategory: { grounding: { passRate: 80 } },
      checkResults: [{ id: "g", passed: true, category: "grounding" }],
    },
  );
  assert.equal(delta.comparable, false);
  assert.equal(delta.reason, "recorded before model identity");
});

test("model mismatch refuses even when checkSetId and ruler match", () => {
  const checkSetId = computeCheckSetId([{ id: "g", category: "grounding" }]);
  const delta = groundingScoreDelta(
    {
      checkSetId,
      rulerVersion: "ruler-v1",
      outputSource: "live",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      byCategory: { grounding: { passRate: 40 } },
      checkResults: [{ id: "g", passed: true, category: "grounding" }],
    },
    {
      checkSetId,
      rulerVersion: "ruler-v1",
      outputSource: "live",
      provider: "openai",
      modelId: "gpt-5.6-terra",
      byCategory: { grounding: { passRate: 80 } },
      checkResults: [{ id: "g", passed: true, category: "grounding" }],
    },
    { requireRulerMatch: true },
  );
  assert.equal(delta.comparable, false);
  assert.match(delta.reason, /model mismatch/);
});

test("missing checkSetId refuses with migration reason — no backfill guess", () => {
  const delta = groundingScoreDelta(
    {
      artifactVersion: "biocraft-singleshot-v5",
      checkSetVersion: "biocraft-singleshot-v5",
      byCategory: { grounding: { passRate: 0 } },
      checkResults: [{ id: "x", passed: true }],
    },
    {
      artifactVersion: "biocraft-singleshot-v6",
      checkSetVersion: "biocraft-singleshot-v6",
      byCategory: { grounding: { passRate: 100 } },
      checkResults: [{ id: "x", passed: true }],
    },
  );
  assert.equal(delta.comparable, false);
  assert.equal(delta.reason, REASON_PRE_CHECKSET_VERSIONING);
});

test("ruler mismatch refuses even when checkSetId matches", () => {
  const checkSetId = computeCheckSetId([{ id: "a", category: "style" }]);
  const delta = groundingScoreDelta(
    {
      checkSetId,
      rulerVersion: "biocraft-singleshot-v6",
      byCategory: { grounding: { passRate: 0 } },
      checkResults: [{ id: "a", passed: true }],
    },
    {
      checkSetId,
      rulerVersion: "biocraft-singleshot-v7",
      byCategory: { grounding: { passRate: 100 } },
      checkResults: [{ id: "a", passed: true }],
    },
    { requireRulerMatch: true },
  );
  assert.equal(delta.comparable, false);
  assert.equal(delta.reason, "ruler version mismatch");
});

test("guardrail gate is binary and separate from score arithmetic", () => {
  const score = scoreMechanicalOutput({
    output: "### LinkedIn About\nI utilize synergy — badly!\n\n### Spoken event introduction\nHi\n\n### Suggested headline\nX",
    artifactVersion: "test",
    artifactDigest: "a".repeat(64),
    declaredChecks: ["about_closing_has_cta"],
    sourceGroundingRules: [],
    guardrails: [
      "Do not use an em dash or a double hyphen as an em-dash substitute.",
      "Remove AI cliche and these terms on sight: utilize, leverage",
    ],
  });
  assert.ok(score.guardrailGate);
  assert.equal(score.guardrailGate.passed, false);
  assert.ok(score.guardrailGate.coverage);
  assert.equal(score.guardrailGate.coverage.total, 2);
  assert.equal(score.guardrailGate.coverage.evaluated, 2);
  assert.equal(score.guardrailGate.coverage.skipped, 0);
  assert.match(score.guardrailGate.coverage.summary, /2 of 2 evaluated/);
  assert.ok(
    score.guardrailGate.results.some((row) => row.passed === false),
  );
  // Gate is its own field — never folded into the headline score object.
  assert.notEqual(score.mechanicalCheckScore, score.guardrailGate);
});

test("guardrail coverage reports skips without failing the gate", () => {
  const gate = evaluateGuardrailGate({
    output: "### LinkedIn About\nClean prose with a CTA by email.\n\nOpen to chat.\n\n### Spoken event introduction\nHello\n\n### Suggested headline\nDesigner",
    guardrails: [
      "Never fabricate or alter a metric, achievement, employer relationship.",
      "Do not use an em dash or a double hyphen as an em-dash substitute.",
      "If a supplied quote is not grounded clearly enough to attribute, omit it.",
    ],
    groundingResults: [
      { id: "source_preserves_intern_near_helix", passed: true },
    ],
  });
  assert.equal(gate.passed, true);
  assert.equal(gate.coverage.total, 3);
  assert.equal(gate.coverage.evaluated, 1);
  assert.equal(gate.coverage.skipped, 2);
  assert.equal(
    gate.coverage.summary,
    "1 of 3 evaluated, 1 passed, 2 not executable",
  );
});

test("grounding failure fails the guardrail gate without changing how style is counted", () => {
  const gate = evaluateGuardrailGate({
    output: "ok",
    guardrails: [],
    groundingResults: [
      { id: "source_preserves_intern_near_helix", passed: false, why: "missing" },
    ],
  });
  assert.equal(gate.passed, false);
  assert.equal(gate.results[0].source, "source-grounding");
});

test("promotion gate requires live + guardrails + non-negative comparable delta", () => {
  const checkSetId = computeCheckSetId([{ id: "g", category: "grounding" }]);
  const coverage = {
    total: 1,
    evaluated: 1,
    skipped: 0,
    passed: 1,
    failed: 0,
    summary: "1 of 1 evaluated, all passed",
  };
  const incumbent = {
    checkSetId,
    rulerVersion: "ruler-v1",
    outputSource: "live",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    byCategory: { grounding: { passRate: 50 } },
    checkResults: [{ id: "g", passed: true, category: "grounding" }],
    guardrailGate: { passed: true, results: [], coverage },
  };
  const candidate = {
    checkSetId,
    rulerVersion: "ruler-v1",
    outputSource: "live",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    byCategory: { grounding: { passRate: 80 } },
    checkResults: [{ id: "g", passed: true, category: "grounding" }],
    guardrailGate: { passed: true, results: [], coverage },
  };
  const ok = evaluatePromotionGate({
    incumbentScore: incumbent,
    candidateScore: candidate,
    outputSource: "live",
  });
  assert.equal(ok.eligible, true);

  const canned = evaluatePromotionGate({
    incumbentScore: incumbent,
    candidateScore: candidate,
    outputSource: "canned",
  });
  assert.equal(canned.eligible, false);
  assert.ok(canned.failures.some((f) => f.code === "output_source"));

  const blocked = evaluatePromotionGate({
    incumbentScore: incumbent,
    candidateScore: {
      ...candidate,
      guardrailGate: { passed: false, results: [{ id: "g", passed: false }], coverage },
    },
    outputSource: "live",
  });
  assert.equal(blocked.eligible, false);
  assert.ok(blocked.failures.some((f) => f.code === "guardrails"));

  const zeroCoverage = evaluatePromotionGate({
    incumbentScore: incumbent,
    candidateScore: {
      ...candidate,
      guardrailGate: {
        passed: true,
        results: [{ id: "guardrail:0:unmapped", passed: null, source: "frontmatter-unmapped" }],
        coverage: {
          total: 5,
          evaluated: 0,
          skipped: 5,
          passed: 0,
          failed: 0,
          summary: "0 of 5 evaluated, 5 not executable",
        },
      },
    },
    outputSource: "live",
  });
  assert.equal(zeroCoverage.eligible, false);
  assert.ok(
    zeroCoverage.failures.some((f) => f.code === "guardrail_coverage"),
  );
});
