// Invoke a digest-verified historical artifact as the system prompt.
// Does not touch the live RUNTIME_ARTIFACTS registry — baselines are fixtures.
//
// Scoring path (option 3): OpenAI Responses API — same provider family as the
// hosted biocraft / Software Factory agents. Not Anthropic.
// Test path: config.runtime.openai.fetch override, or outputSource fixtures.

import { loadHistoricalArtifact } from "./historicalArtifacts.js";
import { RUNTIME_TIMEOUT_MS } from "../invoke/index.js";
import { normalizeGapAnswers } from "../invoke/gapFill.js";
import { getRuntimeInputContract, resolveRuntimeInputs } from "../invoke/runtimeArtifacts.js";

/** Default scoring model when the historical fixture has no runtime_model pin. */
export const SCORING_DEFAULT_MODEL = "gpt-5.6-terra";
export const SCORING_PROVIDER = "openai";

function refuse(message, status = 500) {
  throw Object.assign(new Error(message), { status });
}

function runtimeModelFromArtifactContent(content) {
  const match = String(content || "").match(/^runtime_model:\s*(\S+)\s*$/m);
  return match ? match[1] : null;
}

/**
 * Build the same user payload the live single-shot runtime sends.
 */
// Historical default for fixture runs. Only correct because the unsealed A7/A10
// fixtures are both Mira Okonkwo; see the note in preview-candidate.test.js
// about sealed cases, which this misnames on the SCORING path.
const FIXTURE_DEFAULT_FELLOW = "Mira Okonkwo";

export function buildGoldenUserPayload(agentId, golden, overrides = {}) {
  // Pasted material wins over the fixture. `golden` is null on the pasted path,
  // so every read of it is optional — previously `golden.input` threw a raw
  // TypeError there, and the pasted text never reached the model at all.
  const sourceMaterial = String(
    overrides.sourceMaterial || golden?.input || "",
  ).trim();
  if (!sourceMaterial) {
    refuse(
      "No source material to generate from: supply sourceMaterial, or a golden case with input.",
      400,
    );
  }
  // NEVER substitute a fixture identity onto pasted material. The old default
  // was "Mira Okonkwo", so a paste submitted without a name generated a bio
  // attributed to the fixture's fellow — a materially misattributed draft that
  // would then be attested as a real preview. A fixture run may default to its
  // own fellow because that IS whose material it is; a paste may not.
  // A fixture run may fall back to the fixture's own fellow — that IS whose
  // material it is. A PASTE may not: the old default was "Mira Okonkwo", so a
  // paste submitted without a name produced a draft attributed to the fixture's
  // fellow, which is a materially misattributed preview.
  const fellowName = String(
    overrides.fellowName || golden?.fellowName || (golden ? FIXTURE_DEFAULT_FELLOW : ""),
  ).trim();
  if (!fellowName) {
    refuse(
      "Pasted source needs a fellowName: generating under the fixture's fellow would misattribute the draft.",
      400,
    );
  }
  const contract = getRuntimeInputContract(agentId);
  if (!contract) {
    return { fellowName, sourceMaterial };
  }
  const { values, missing } = resolveRuntimeInputs(agentId, {
    fellowName,
    sourceMaterial,
    interviewAnswers: "",
  });
  if (missing.length) {
    refuse(
      `Golden case cannot satisfy runtime input contract: missing ${missing.join(", ")}`,
      400,
    );
  }
  // resolveRuntimeInputs returns ONLY the agent's declared contract fields, so
  // gapAnswers passed through it were silently dropped — A10 declares
  // fellowName/sourceMaterial/exclusions and no gapAnswers. The live runtime
  // adds them to the payload AFTER resolving inputs (invoke/index.js), with a
  // "draft" phase so Call 2 runs instead of Call 1 asking again. Mirror that.
  const gapAnswers = normalizeGapAnswers(overrides.gapAnswers);
  if (gapAnswers && Object.keys(gapAnswers).length) {
    return { phase: "draft", ...values, gapAnswers };
  }
  return values;
}

function extractOpenAiText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const chunks = [];
  for (const item of payload?.output || []) {
    if (item?.type === "message") {
      for (const part of item.content || []) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          chunks.push(part.text);
        }
      }
    }
  }
  return chunks.join("\n").trim();
}

/**
 * Generate one draft under a historical artifact prompt via OpenAI Responses.
 * Returns metadata + output text. Caller scores; this module does not persist text.
 */
export async function generateUnderHistoricalArtifact({
  agentId,
  artifactVersion,
  golden,
  // Pasted material and gap answers were previously accepted by callers and
  // silently dropped here, so a "pasted source" preview generated from the
  // fixture and A10's gap answers never reached Call 2.
  sourceMaterial = "",
  fellowName = "",
  gapAnswers = null,
  config = {},
}) {
  const artifact = loadHistoricalArtifact(artifactVersion);
  const openai = config.runtime?.openai || {};
  const model =
    openai.model ||
    runtimeModelFromArtifactContent(artifact.content) ||
    SCORING_DEFAULT_MODEL;
  const timeoutMs = openai.timeoutMs || RUNTIME_TIMEOUT_MS;
  const fetchImpl = openai.fetch || globalThis.fetch;

  if (!openai.apiKey && fetchImpl === globalThis.fetch) {
    refuse(
      "Live output_quality generation needs OPENAI_API_KEY (or a test fetch)",
      503,
    );
  }
  if (fetchImpl !== globalThis.fetch && !process.env.NODE_TEST_CONTEXT) {
    refuse("Custom runtime transport is test-only", 500);
  }

  const userPayload = buildGoldenUserPayload(agentId, golden, {
    sourceMaterial,
    fellowName,
    gapAnswers,
  });
  const userContent = JSON.stringify(userPayload, null, 2);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("OpenAI generation timed out")),
    timeoutMs,
  );
  const started = Date.now();
  let response;
  let payload;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openai.apiKey || "test-key"}`,
      },
      body: JSON.stringify({
        model,
        instructions: artifact.content,
        input: userContent,
        store: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      refuse(`OpenAI Responses API returned ${response.status}`, 502);
    }
    try {
      payload = await response.json();
    } catch {
      refuse("OpenAI Responses API returned invalid JSON", 502);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      refuse("OpenAI generation timed out", 504);
    }
    if (error.status) throw error;
    refuse("OpenAI Responses API request failed", 502);
  } finally {
    clearTimeout(timer);
  }

  if (
    payload.status === "failed" ||
    payload.error ||
    payload.status === "cancelled"
  ) {
    refuse("OpenAI Responses API failed to complete", 502);
  }

  const output = extractOpenAiText(payload);
  if (!output) {
    refuse("OpenAI Responses API returned no text output", 502);
  }

  return {
    output,
    artifactVersion: artifact.artifactVersion,
    artifactDigest: artifact.artifactDigest,
    provider: SCORING_PROVIDER,
    modelId: payload.model || model,
    latencyMs: Date.now() - started,
    inputTokens: payload.usage?.input_tokens,
    outputTokens: payload.usage?.output_tokens,
  };
}
