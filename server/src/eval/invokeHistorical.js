// Invoke a digest-verified historical artifact as the system prompt.
// Does not touch the live RUNTIME_ARTIFACTS registry — baselines are fixtures.
//
// Live path: Anthropic Messages API (paid).
// Test path: config.runtime.anthropic.fetch override, or outputSource fixtures.

import { loadHistoricalArtifact } from "./historicalArtifacts.js";
import { RUNTIME_TIMEOUT_MS } from "../invoke/index.js";
import { getRuntimeInputContract, resolveRuntimeInputs } from "../invoke/runtimeArtifacts.js";

function refuse(message, status = 500) {
  throw Object.assign(new Error(message), { status });
}

/**
 * Build the same user payload the live single-shot runtime sends.
 */
export function buildGoldenUserPayload(agentId, golden) {
  const contract = getRuntimeInputContract(agentId);
  if (!contract) {
    return {
      fellowName: "Mira Okonkwo",
      sourceMaterial: golden.input,
    };
  }
  const { values, missing } = resolveRuntimeInputs(agentId, {
    fellowName: "Mira Okonkwo",
    sourceMaterial: golden.input,
    interviewAnswers: "",
  });
  if (missing.length) {
    refuse(
      `Golden case cannot satisfy runtime input contract: missing ${missing.join(", ")}`,
      400,
    );
  }
  return values;
}

/**
 * Generate one draft under a historical artifact prompt.
 * Returns metadata + output text. Caller scores; this module does not persist text.
 */
export async function generateUnderHistoricalArtifact({
  agentId,
  artifactVersion,
  golden,
  config = {},
}) {
  const artifact = loadHistoricalArtifact(artifactVersion);
  const anthropic = config.runtime?.anthropic || {};
  const model = anthropic.model || "claude-sonnet-4-6";
  const timeoutMs = anthropic.timeoutMs || RUNTIME_TIMEOUT_MS;
  const fetchImpl = anthropic.fetch || globalThis.fetch;

  if (!anthropic.apiKey && fetchImpl === globalThis.fetch) {
    refuse(
      "Live output_quality generation needs ANTHROPIC_API_KEY (or a test fetch)",
      503,
    );
  }
  if (fetchImpl !== globalThis.fetch && !process.env.NODE_TEST_CONTEXT) {
    refuse("Custom runtime transport is test-only", 500);
  }

  const userPayload = buildGoldenUserPayload(agentId, golden);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Anthropic generation timed out")),
    timeoutMs,
  );
  const started = Date.now();
  let response;
  let payload;
  try {
    response = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": anthropic.apiKey || "test-key",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: artifact.content,
        messages: [
          {
            role: "user",
            content: JSON.stringify(userPayload, null, 2),
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      refuse(`Anthropic Messages API returned ${response.status}`, 502);
    }
    try {
      payload = await response.json();
    } catch {
      refuse("Anthropic Messages API returned invalid JSON", 502);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      refuse("Anthropic generation timed out", 504);
    }
    if (error.status) throw error;
    refuse("Anthropic Messages API request failed", 502);
  } finally {
    clearTimeout(timer);
  }

  const output = (payload.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!output) {
    refuse("Anthropic Messages API returned no text output", 502);
  }

  return {
    output,
    artifactVersion: artifact.artifactVersion,
    artifactDigest: artifact.artifactDigest,
    provider: "anthropic",
    modelId: payload.model || model,
    latencyMs: Date.now() - started,
    inputTokens: payload.usage?.input_tokens,
    outputTokens: payload.usage?.output_tokens,
  };
}
