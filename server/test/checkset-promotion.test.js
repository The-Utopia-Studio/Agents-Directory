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
    byCategory: { grounding: { passRate: 0 } },
    checkResults: [
      { id: "about_closing_has_cta", passed: true, category: "style" },
      { id: "source_preserves_intern_near_helix", passed: false, category: "grounding" },
    ],
  };
  const right = {
    checkSetId,
    artifactVersion: "biocraft-singleshot-v6",
    byCategory: { grounding: { passRate: 100 } },
    checkResults: left.checkResults.map((row) =>
      row.id.startsWith("source_") ? { ...row, passed: true } : row,
    ),
  };
  const delta = groundingScoreDelta(left, right);
  assert.equal(delta.comparable, true);
  assert.equal(delta.value, 100);
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
  assert.ok(
    score.guardrailGate.results.some((row) => row.passed === false),
  );
  // Gate is its own field — never folded into the headline score object.
  assert.notEqual(score.mechanicalCheckScore, score.guardrailGate);
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
  const incumbent = {
    checkSetId,
    rulerVersion: "ruler-v1",
    byCategory: { grounding: { passRate: 50 } },
    checkResults: [{ id: "g", passed: true, category: "grounding" }],
    guardrailGate: { passed: true, results: [] },
  };
  const candidate = {
    checkSetId,
    rulerVersion: "ruler-v1",
    byCategory: { grounding: { passRate: 80 } },
    checkResults: [{ id: "g", passed: true, category: "grounding" }],
    guardrailGate: { passed: true, results: [] },
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
      guardrailGate: { passed: false, results: [{ id: "g", passed: false }] },
    },
    outputSource: "live",
  });
  assert.equal(blocked.eligible, false);
  assert.ok(blocked.failures.some((f) => f.code === "guardrails"));
});
