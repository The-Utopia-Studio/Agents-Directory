import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIOCRAFT_EXCLUSIONS_QUESTION,
  BIOCRAFT_GAP_BANK,
  normalizeGapAnswers,
  parseGapResponse,
  unansweredGaps,
} from "../src/invoke/gapFill.js";
import {
  getRuntimeArtifactMode,
  getRuntimeInputContract,
  hasRuntimeArtifact,
  validateRuntimeArtifactOutput,
} from "../src/invoke/runtimeArtifacts.js";
import { runtimeInvoker } from "../src/invoke/index.js";
import { costUsdFromUsage } from "../src/invoke/llm/pricing.js";
import { KNOWN_FAILURE_CODES } from "../src/core/traceSafety.js";

const DRAFT = `### LinkedIn About

I help venture teams turn complex ideas into practical tools.

I have spent two years building workflow systems for early-stage teams.

One delivery validated 167 acceptance criteria across five working screens.

If your venture team needs a clearer path from idea to build, reach out.

### Spoken event introduction

Mira Okonkwo builds grounded workflow systems for venture teams.

### Suggested headline

Workflow builder for venture teams`;

function bankGap(id, reason = "not present in source") {
  const item = BIOCRAFT_GAP_BANK.find((g) => g.id === id);
  return { id, question: item.question, reason };
}

function openaiResponse({ text, input_tokens = 10, output_tokens = 10 }) {
  return {
    model: "gpt-5.6-terra",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    usage: {
      input_tokens,
      output_tokens,
      total_tokens: input_tokens + output_tokens,
    },
  };
}

function openaiRuntime(fetch) {
  return {
    runtime: {
      provider: "openai",
      openai: { apiKey: "test-key", fetch },
    },
  };
}

test("gap bank has five detectable items and exclusions stay outside it", () => {
  assert.equal(BIOCRAFT_GAP_BANK.length, 5);
  assert.ok(BIOCRAFT_EXCLUSIONS_QUESTION.includes("must NOT appear"));
  assert.ok(!BIOCRAFT_GAP_BANK.some((g) => /must NOT appear/i.test(g.question)));
});

test("parseGapResponse accepts empty gaps and exact bank wording", () => {
  assert.deepEqual(parseGapResponse('{"gaps":[]}'), []);
  const gaps = parseGapResponse(
    JSON.stringify({
      gaps: [bankGap("contact", "no reachability stated")],
    }),
  );
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].id, "contact");
});

test("parseGapResponse fails visibly on unparseable or invented gaps", () => {
  assert.throws(() => parseGapResponse("not json"), {
    failureCode: "gap_response_unparseable",
    status: 422,
  });
  assert.throws(
    () =>
      parseGapResponse(
        JSON.stringify({
          gaps: [
            {
              id: "contact",
              question: "rewritten question",
              reason: "missing",
            },
          ],
        }),
      ),
    { failureCode: "gap_response_unparseable" },
  );
  assert.throws(
    () =>
      parseGapResponse(
        JSON.stringify({
          gaps: [
            {
              id: "exclusions",
              question: BIOCRAFT_EXCLUSIONS_QUESTION,
              reason: "optional",
            },
          ],
        }),
      ),
    { failureCode: "gap_response_unparseable" },
  );
  assert.ok(KNOWN_FAILURE_CODES.includes("gap_response_unparseable"));
});

test("unansweredGaps and normalizeGapAnswers keep only bank ids", () => {
  const gaps = [bankGap("skills"), bankGap("contact")];
  assert.equal(
    unansweredGaps(gaps, { skills: "ops", contact: "" }).map((g) => g.id).join(","),
    "contact",
  );
  assert.deepEqual(
    normalizeGapAnswers({ skills: " ops ", bogus: "x", contact: " email " }),
    { skills: "ops", contact: "email" },
  );
});

test("A10 is registered as gap-fill with its own OpenAI-pinned artifact", async () => {
  assert.equal(await hasRuntimeArtifact("A10"), true);
  assert.equal(getRuntimeArtifactMode("A10"), "gap-fill");
  assert.equal(getRuntimeArtifactMode("A7"), "single-shot");
  const contract = getRuntimeInputContract("A10");
  assert.deepEqual(
    contract.fields.map((f) => f.key),
    ["fellowName", "sourceMaterial", "exclusions"],
  );
});

test("Terra pricing attributes spend from token counts", () => {
  assert.equal(
    costUsdFromUsage("gpt-5.6-terra", { inputTokens: 1_000_000, outputTokens: 0 }),
    2,
  );
  assert.equal(
    costUsdFromUsage("gpt-5.6-terra", { inputTokens: 0, outputTokens: 1_000_000 }),
    12,
  );
  assert.equal(costUsdFromUsage("unknown-model", { inputTokens: 10 }), undefined);
});

test("A10 mechanical checks reuse the same validators as A7", () => {
  assert.deepEqual(validateRuntimeArtifactOutput("A10", DRAFT), []);
});

test("gap-fill returns needs_input without drafting when gaps remain", async () => {
  let calls = 0;
  const invoker = runtimeInvoker(
    openaiRuntime(async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return openaiResponse({
            text: JSON.stringify({
              gaps: [bankGap("proudest-outcome", "no outcome in paste")],
            }),
            input_tokens: 10,
            output_tokens: 20,
          });
        },
      };
    }),
  );
  const result = await invoker.invoke(
    { id: "A10", invocation: { type: "runtime", mode: "gap-fill" } },
    {
      fellowName: "Mira Okonkwo",
      sourceMaterial: "Mira builds workflow tools.",
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "needs_input");
  assert.equal(result.callCount, 1);
  assert.equal(result.provider, "openai");
  assert.equal(result.modelId, "gpt-5.6-terra");
  assert.equal(result.costUsd, costUsdFromUsage("gpt-5.6-terra", {
    inputTokens: 10,
    outputTokens: 20,
  }));
  assert.equal(result.gaps[0].id, "proudest-outcome");
  assert.equal(result.output, "");
});

test("gap-fill zero gaps drafts immediately with two calls", async () => {
  let calls = 0;
  const invoker = runtimeInvoker(
    openaiRuntime(async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      const user = JSON.parse(body.input);
      if (calls === 1) {
        assert.equal(user.phase, "detect-gaps");
        assert.equal(body.model, "gpt-5.6-terra");
        return {
          ok: true,
          async json() {
            return openaiResponse({
              text: '{"gaps":[]}',
              input_tokens: 11,
              output_tokens: 5,
            });
          },
        };
      }
      assert.equal(user.phase, "draft");
      return {
        ok: true,
        async json() {
          return openaiResponse({
            text: DRAFT,
            input_tokens: 40,
            output_tokens: 80,
          });
        },
      };
    }),
  );
  const result = await invoker.invoke(
    { id: "A10", invocation: { type: "runtime", mode: "gap-fill" } },
    {
      fellowName: "Mira Okonkwo",
      sourceMaterial:
        "Complete profile covering outcome, role, mission, skills, and contact email.",
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.status, "ok");
  assert.equal(result.callCount, 2);
  assert.equal(result.inputTokens, 51);
  assert.equal(result.outputTokens, 85);
  assert.equal(
    result.costUsd,
    Math.round(
      ((11 / 1e6) * 2 + (5 / 1e6) * 12 + (40 / 1e6) * 2 + (80 / 1e6) * 12) *
        1e8,
    ) / 1e8,
  );
  assert.match(result.output, /### LinkedIn About/);
});

test("gap-fill continue drafts after answers; unparseable Call 1 never drafts", async () => {
  let calls = 0;
  const invoker = runtimeInvoker(
    openaiRuntime(async (_url, init) => {
      calls += 1;
      const body = JSON.parse(init.body);
      const user = JSON.parse(body.input);
      if (calls === 1) {
        assert.equal(user.phase, "detect-gaps");
        return {
          ok: true,
          async json() {
            return openaiResponse({
              text: JSON.stringify({
                gaps: [bankGap("contact", "no CTA channel")],
              }),
              input_tokens: 12,
              output_tokens: 8,
            });
          },
        };
      }
      assert.equal(user.phase, "draft");
      assert.equal(user.gapAnswers.contact, "message me on LinkedIn");
      return {
        ok: true,
        async json() {
          return openaiResponse({ text: DRAFT, input_tokens: 30, output_tokens: 60 });
        },
      };
    }),
  );
  const result = await invoker.invoke(
    { id: "A10", invocation: { type: "runtime", mode: "gap-fill" } },
    {
      fellowName: "Mira Okonkwo",
      sourceMaterial: "Mira builds tools for founders.",
      gapAnswers: { contact: "message me on LinkedIn" },
      exclusions: "Do not mention Acme Corp",
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.status, "ok");

  const bad = runtimeInvoker(
    openaiRuntime(async () => ({
      ok: true,
      async json() {
        return openaiResponse({
          text: "I'll just draft instead.",
          input_tokens: 3,
          output_tokens: 3,
        });
      },
    })),
  );
  await assert.rejects(
    () =>
      bad.invoke(
        { id: "A10", invocation: { type: "runtime", mode: "gap-fill" } },
        { fellowName: "Mira", sourceMaterial: "short" },
      ),
    (err) =>
      err.failureCode === "gap_response_unparseable" &&
      err.status === 422 &&
      err.usage?.inputTokens === 3,
  );
});
