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
