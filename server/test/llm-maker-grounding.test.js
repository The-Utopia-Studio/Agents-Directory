import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLlmOptimizer,
} from "../src/improve/llmMaker.js";
import { evaluatePromotionGate, PROMOTION_FAILURE } from "../src/eval/promotionGate.js";
import {
  toTraceSafeGroundingResult,
  digestSpan,
  groundingIdentityKey,
} from "../src/eval/llmGroundingCheck.js";

const ARTIFACT = `---
name: test
---

## Method

1. Draft carefully.
2. Close the About somehow.

## Guardrails

1. Never fabricate.
2. Do not use an em dash.
3. Close the About with a CTA.
`;

test("LLM maker emits a real Method section replacement for CTA defects", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            section: "Method",
            replacement:
              "1. Draft carefully.\n2. End the LinkedIn About with one explicit call to action naming how to reach the fellow or what they are open to.\n",
            rationale:
              "about_closing_has_cta failed because the About closed without inviting contact.",
          }),
        };
      },
    };
  };

  const optimizer = createLlmOptimizer({
    openai: { apiKey: "test", model: "gpt-5.6-terra", fetch: fetchImpl },
  });
  const proposals = await optimizer.propose(
    { id: "A7", guardrails: ["Never fabricate"], successCriteria: [] },
    {
      traces: [{ id: "t1" }],
      failingTraces: [
        {
          id: "t1",
          failureReason: "about_closing_has_cta",
          checkResults: [{ checkId: "about_closing_has_cta" }],
        },
      ],
      feedback: [],
      lowRatings: [],
      defectSignals: ["about_closing_has_cta"],
      artifact: { text: ARTIFACT, checks: ["about_closing_has_cta"] },
    },
  );
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].provider, "openai");
  assert.equal(proposals[0].modelId, "gpt-5.6-terra");
  assert.equal(proposals[0].changes[0].surface, "prompt");
  assert.match(proposals[0].changes[0].target, /#method$/i);
  assert.notEqual(
    proposals[0].changes[0].current,
    proposals[0].changes[0].proposed,
  );
  assert.match(proposals[0].changes[0].proposed, /## Method/);
  assert.doesNotMatch(proposals[0].changes[0].proposed, /trailing two paragraphs/i);
  assert.doesNotMatch(proposals[0].changes[0].proposed, /Strengthen the artifact/);
  assert.ok(calls >= 1);
});

test("LLM maker rejects detection-mechanics and Guardrails procedure", async () => {
  const replies = [
    {
      section: "Method",
      replacement:
        "1. Draft carefully.\n2. Put the CTA in the trailing two paragraphs so the check passes.\n",
      rationale: "about_closing_has_cta needs a detectable CTA path.",
    },
    {
      section: "Method",
      replacement:
        "1. Draft carefully.\n2. Put the CTA in the trailing two paragraphs so the check passes.\n",
      rationale: "about_closing_has_cta needs a detectable CTA path.",
    },
  ];
  let i = 0;
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { output_text: JSON.stringify(replies[i++] || replies[0]) };
    },
  });
  const optimizer = createLlmOptimizer({
    openai: { apiKey: "test", fetch: fetchImpl },
  });
  await assert.rejects(
    () =>
      optimizer.propose(
        { id: "A7" },
        {
          traces: [{ id: "t1" }],
          failingTraces: [
            {
              id: "t1",
              failureReason: "about_closing_has_cta",
              checkResults: [{ checkId: "about_closing_has_cta" }],
            },
          ],
          feedback: [],
          defectSignals: ["about_closing_has_cta"],
          artifact: { text: ARTIFACT, checks: [] },
        },
      ),
    (e) =>
      e.status === 422 &&
      /detection mechanics/i.test(e.message),
  );
});

test("LLM maker refuses a no-op restatement after two attempts", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        output_text: JSON.stringify({
          section: "Method",
          replacement: "1. Draft carefully.\n2. Close the About somehow.\n",
          rationale: "about_closing_has_cta needs a CTA.",
        }),
      };
    },
  });
  const optimizer = createLlmOptimizer({
    openai: { apiKey: "test", fetch: fetchImpl },
  });
  await assert.rejects(
    () =>
      optimizer.propose(
        { id: "A7" },
        {
          traces: [],
          failingTraces: [
            {
              id: "t1",
              failureReason: "about_closing_has_cta",
              checkResults: [{ checkId: "about_closing_has_cta" }],
            },
          ],
          feedback: [],
          defectSignals: ["about_closing_has_cta"],
          artifact: { text: ARTIFACT, checks: [] },
        },
      ),
    (e) => e.status === 422 && /refused/i.test(e.message),
  );
});

test("normalised claim digests ignore punctuation and case jitter", () => {
  assert.equal(
    digestSpan("8 years of experience in production AI."),
    digestSpan("8 Years of Experience in Production AI"),
  );
  assert.equal(
    groundingIdentityKey("tenure_years", "  8 years of AI!!! "),
    groundingIdentityKey("tenure_years", "8 years of AI"),
  );
});

test("promotion gate fails closed on LLM grounding findings", () => {
  const gate = evaluatePromotionGate({
    outputSource: "live",
    incumbentScore: {
      grounding: { passRate: 0.5 },
      checkSetId: "abc",
      guardrailGate: { passed: true, coverage: { evaluated: 2 } },
    },
    candidateScore: {
      grounding: { passRate: 0.6 },
      checkSetId: "abc",
      guardrailGate: { passed: true, coverage: { evaluated: 2 } },
      llmGroundingFindings: [
        toTraceSafeGroundingResult({
          checkId: "source_claim_tenure_years",
          claimKind: "tenure_years",
          family: "source-grounding-llm",
          claimSpanDigest: digestSpan("8 years of AI"),
          sourceSpanDigest: digestSpan("8 years at Al Jazeera"),
        }),
      ],
    },
  });
  assert.equal(gate.eligible, false);
  assert.ok(
    gate.failures.some((f) => f.code === PROMOTION_FAILURE.LLM_GROUNDING),
  );
});

test("promotion gate does not treat grounding-not-run as a pass when enabled", () => {
  const coverage = {
    total: 1,
    evaluated: 1,
    skipped: 0,
    passed: 1,
    failed: 0,
    summary: "1 of 1 evaluated, all passed",
  };
  const incumbentScore = {
    checkSetId: "abc",
    rulerVersion: "ruler-v1",
    outputSource: "live",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    byCategory: { grounding: { passRate: 50, scoreableCount: 2 } },
    checkResults: [{ id: "g", passed: true, category: "grounding" }],
    guardrailGate: { passed: true, results: [], coverage },
  };
  for (const status of [undefined, "skipped", "unavailable"]) {
    const gate = evaluatePromotionGate({
      outputSource: "live",
      llmGroundingEnabled: true,
      incumbentScore,
      candidateScore: {
        ...incumbentScore,
        byCategory: { grounding: { passRate: 80, scoreableCount: 2 } },
        ...(status ? { llmGroundingStatus: status } : {}),
      },
    });
    assert.equal(gate.eligible, false, `status=${status}`);
    assert.ok(
      gate.failures.some((f) => f.code === PROMOTION_FAILURE.LLM_GROUNDING_NOT_RUN),
      `status=${status}`,
    );
  }
});

test("promotion gate accepts explicit llmGroundingStatus=passed when enabled", () => {
  const coverage = {
    total: 1,
    evaluated: 1,
    skipped: 0,
    passed: 1,
    failed: 0,
    summary: "1 of 1 evaluated, all passed",
  };
  const base = {
    checkSetId: "abc",
    rulerVersion: "ruler-v1",
    outputSource: "live",
    provider: "openai",
    modelId: "gpt-5.6-terra",
    checkResults: [{ id: "g", passed: true, category: "grounding" }],
    guardrailGate: { passed: true, results: [], coverage },
  };
  const gate = evaluatePromotionGate({
    outputSource: "live",
    llmGroundingEnabled: true,
    incumbentScore: {
      ...base,
      byCategory: { grounding: { passRate: 50, scoreableCount: 2 } },
    },
    candidateScore: {
      ...base,
      byCategory: { grounding: { passRate: 80, scoreableCount: 2 } },
      llmGroundingStatus: "passed",
    },
  });
  assert.equal(gate.eligible, true);
});

test("LLM grounding returns unavailable (not empty pass) when key is missing", async () => {
  const { runLlmGroundingCheck, LLM_GROUNDING_STATUS } = await import(
    "../src/eval/llmGroundingCheck.js"
  );
  const result = await runLlmGroundingCheck({
    output: "Draft about someone.",
    sourceText: "Source about someone.",
    config: { grounding: { llmEnabled: true }, runtime: { openai: { apiKey: "" } } },
  });
  assert.equal(result.status, LLM_GROUNDING_STATUS.UNAVAILABLE);
  assert.equal(result.findings.length, 0);
  assert.equal(result.reason, "missing_api_key");
});

test("LLM grounding returns unavailable on API error (not empty pass)", async () => {
  const { runLlmGroundingCheck, LLM_GROUNDING_STATUS } = await import(
    "../src/eval/llmGroundingCheck.js"
  );
  const result = await runLlmGroundingCheck({
    output: "Draft about someone.",
    sourceText: "Source about someone.",
    config: {
      grounding: { llmEnabled: true },
      runtime: {
        openai: {
          apiKey: "sk-test",
          fetch: async () => ({ ok: false, status: 500, async text() { return "boom"; } }),
        },
      },
    },
  });
  assert.equal(result.status, LLM_GROUNDING_STATUS.UNAVAILABLE);
  assert.equal(result.findings.length, 0);
  assert.match(result.reason, /^http_500/);
});

test("LLM grounding skipped when disabled is distinct from passed", async () => {
  const { runLlmGroundingCheck, LLM_GROUNDING_STATUS } = await import(
    "../src/eval/llmGroundingCheck.js"
  );
  const result = await runLlmGroundingCheck({
    output: "Draft",
    sourceText: "Source",
    config: { grounding: { llmEnabled: false } },
  });
  assert.equal(result.status, LLM_GROUNDING_STATUS.SKIPPED);
  assert.notEqual(result.status, LLM_GROUNDING_STATUS.PASSED);
});
