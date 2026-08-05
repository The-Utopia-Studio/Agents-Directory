// Invocation seam — how an agent is actually used. The directory owns the
// definition; each platform is a runtime behind an adapter, so an agent isn't
// "a Claude project", it's a spec that currently runs on Claude and can run
// anywhere. Adapters:
//   link / prompt — not server-run (open where it lives / paste the exported prompt)
//   http          — call an endpoint or webhook (n8n, custom, hosted agent)
//   mcp           — call via an MCP bridge (port: needs config)
//   runtime       — load a server-owned skill artifact and invoke Anthropic
//   mock          — canned response for offline demos
import { requestJsonEndpoint } from "./networkPolicy.js";
import {
  gapBankForPrompt,
  normalizeGapAnswers,
  parseGapResponse,
  unansweredGaps,
} from "./gapFill.js";
import {
  getRuntimeArtifactMode,
  getRuntimeArtifactDescriptor,
  getRuntimeInputContract,
  hasRuntimeArtifact,
  loadRuntimeArtifact,
  resolveRuntimeInputs,
  validateRuntimeArtifactOutput,
} from "./runtimeArtifacts.js";

export const RUNTIME_TIMEOUT_MS = 120_000;

const manual = (type) => ({
  name: type,
  serverRun: false,
  async invoke() {
    throw Object.assign(new Error(`Agent is ${type}-invoked — open it where it lives or copy its exported prompt/SKILL.md.`), { status: 400 });
  },
});

export function httpInvoker(config = {}) {
  return {
    name: "http",
    serverRun: true,
    async invoke(agent, inputs) {
      const inv = agent.invocation || {};
      if (!inv.url) throw Object.assign(new Error("http invocation needs invocation.url"), { status: 400 });
      const res = await requestJsonEndpoint(inv.url, {
        agent: agent.id,
        objective: agent.objective,
        inputs,
      }, {
        timeoutMs: config.invoke?.httpTimeoutMs || 10_000,
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw Object.assign(
          new Error(`agent endpoint returned ${res.statusCode}`),
          { status: 502 },
        );
      }
      const contentType = String(res.headers["content-type"] || "");
      let out = res.body;
      if (contentType.includes("json") && res.body) {
        try {
          out = JSON.parse(res.body);
        } catch {
          throw Object.assign(new Error("agent endpoint returned invalid JSON"), { status: 502 });
        }
      }
      return {
        output:
          typeof out === "string"
            ? out
            : (out && out.output) || JSON.stringify(out),
      };
    },
  };
}

function mockInvoker() {
  return {
    name: "mock",
    serverRun: true,
    async invoke(agent, inputs) {
      const given = Object.entries(inputs || {}).map(([k, v]) => `${k}: ${v}`).join("; ") || "no inputs";
      return {
        output: `[mock run of "${agent.name}"] Given ${given}. Would produce: ${(agent.outputs || []).join(", ") || "the agent's declared outputs"}. (Wire a real runtime — http / mcp / @studio/ai-runtime — to replace this.)`,
      };
    },
  };
}

function sumUsage(parts) {
  let inputTokens = 0;
  let outputTokens = 0;
  let haveInput = false;
  let haveOutput = false;
  for (const part of parts) {
    if (typeof part?.inputTokens === "number") {
      inputTokens += part.inputTokens;
      haveInput = true;
    }
    if (typeof part?.outputTokens === "number") {
      outputTokens += part.outputTokens;
      haveOutput = true;
    }
  }
  return {
    ...(haveInput ? { inputTokens } : {}),
    ...(haveOutput ? { outputTokens } : {}),
    ...(haveInput && haveOutput
      ? { totalTokens: inputTokens + outputTokens }
      : {}),
  };
}

function usageFromPayload(payload) {
  return {
    ...(typeof payload.usage?.input_tokens === "number"
      ? { inputTokens: payload.usage.input_tokens }
      : {}),
    ...(typeof payload.usage?.output_tokens === "number"
      ? { outputTokens: payload.usage.output_tokens }
      : {}),
    ...(typeof payload.usage?.input_tokens === "number" &&
    typeof payload.usage?.output_tokens === "number"
      ? {
          totalTokens:
            payload.usage.input_tokens + payload.usage.output_tokens,
        }
      : {}),
  };
}

function artifactMeta(agentId) {
  const descriptor = getRuntimeArtifactDescriptor(agentId);
  return {
    artifactDigest: descriptor?.artifactDigest || undefined,
    artifactDigestAlgorithm: descriptor?.artifactDigestAlgorithm || undefined,
    artifactVersion: descriptor?.artifactVersion || undefined,
  };
}

async function callAnthropicMessages({
  fetchImpl,
  apiKey,
  model,
  timeoutMs,
  system,
  userContent,
}) {
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
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw Object.assign(
        new Error(`Anthropic Messages API returned ${response.status}`),
        { status: 502, runtimeSafe: true },
      );
    }
    try {
      payload = await response.json();
    } catch {
      throw Object.assign(
        new Error("Anthropic Messages API returned invalid JSON"),
        { status: 502, runtimeSafe: true },
      );
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("Anthropic generation timed out"), {
        status: 504,
      });
    }
    if (error.runtimeSafe) throw error;
    throw Object.assign(
      new Error("Anthropic Messages API request failed"),
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Date.now() - started;
  if (
    payload.stop_reason === "refusal" ||
    payload.content?.some?.((block) => block.type === "refusal")
  ) {
    throw Object.assign(new Error("Anthropic refused the runtime request"), {
      status: 502,
      usage: usageFromPayload(payload),
      latencyMs,
    });
  }

  const usage = usageFromPayload(payload);
  const output = (payload.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!output) {
    throw Object.assign(
      new Error("Anthropic Messages API returned no text output"),
      { status: 502, failureCode: "empty_output", usage, latencyMs },
    );
  }

  return {
    output,
    usage,
    latencyMs,
    modelId: payload.model || model,
  };
}

async function invokeGapFill(agent, inputs, ctx) {
  const { values, missing } = resolveRuntimeInputs(agent.id, inputs);
  if (missing.length) {
    throw Object.assign(
      new Error(
        `Gap-fill mode needs this material up front and none was supplied: ${missing.join(", ")}`,
      ),
      { status: 400 },
    );
  }

  const continuing = Object.prototype.hasOwnProperty.call(
    inputs || {},
    "gapAnswers",
  );
  const gapAnswers = continuing
    ? normalizeGapAnswers(inputs.gapAnswers)
    : undefined;

  const detectPayload = {
    phase: "detect-gaps",
    fellowName: values.fellowName,
    sourceMaterial: values.sourceMaterial,
    gapBank: gapBankForPrompt(),
  };

  const call1 = await callAnthropicMessages({
    ...ctx,
    userContent: JSON.stringify(detectPayload, null, 2),
  });

  let gaps;
  try {
    gaps = parseGapResponse(call1.output);
  } catch (error) {
    error.usage = call1.usage;
    error.latencyMs = call1.latencyMs;
    throw error;
  }

  if (gaps.length && !continuing) {
    return {
      status: "needs_input",
      gaps,
      output: "",
      callCount: 1,
      gapsCount: gaps.length,
      provider: "anthropic",
      modelId: call1.modelId,
      latencyMs: call1.latencyMs,
      ...artifactMeta(agent.id),
      ...call1.usage,
    };
  }

  if (gaps.length && continuing) {
    const missingAnswers = unansweredGaps(gaps, gapAnswers);
    if (missingAnswers.length) {
      throw Object.assign(
        new Error(
          `Gap-fill continue is missing answers for: ${missingAnswers
            .map((g) => g.id)
            .join(", ")}`,
        ),
        {
          status: 400,
          usage: call1.usage,
          latencyMs: call1.latencyMs,
        },
      );
    }
  }

  const draftPayload = {
    phase: "draft",
    fellowName: values.fellowName,
    sourceMaterial: values.sourceMaterial,
    gapAnswers: gapAnswers || {},
    ...(values.exclusions ? { exclusions: values.exclusions } : {}),
  };

  const call2 = await callAnthropicMessages({
    ...ctx,
    userContent: JSON.stringify(draftPayload, null, 2),
  });

  const checkResults = validateRuntimeArtifactOutput(agent.id, call2.output);
  const usage = sumUsage([call1.usage, call2.usage]);

  return {
    status: "ok",
    output: call2.output,
    ...(checkResults.length ? { checkResults } : {}),
    callCount: 2,
    gapsCount: gaps.length,
    provider: "anthropic",
    modelId: call2.modelId || call1.modelId,
    latencyMs: call1.latencyMs + call2.latencyMs,
    ...artifactMeta(agent.id),
    ...usage,
  };
}

export function runtimeInvoker(config = {}) {
  const anthropic = config.runtime?.anthropic || {};
  const model = anthropic.model || "claude-sonnet-4-6";
  const timeoutMs = anthropic.timeoutMs || RUNTIME_TIMEOUT_MS;
  const fetchImpl = anthropic.fetch || globalThis.fetch;
  return {
    name: "runtime",
    // Per-agent mode is applied in getInvoker from the registry.
    mode: "single-shot",
    provider: "anthropic",
    modelId: model,
    serverRun: true,
    isConfigured: () => Boolean(anthropic.apiKey),
    canInvoke: (agent) => hasRuntimeArtifact(agent.id),
    artifactDigest: (agent) =>
      getRuntimeArtifactDescriptor(agent.id)?.artifactDigest || null,
    artifactDigestAlgorithm: (agent) =>
      getRuntimeArtifactDescriptor(agent.id)?.artifactDigestAlgorithm || null,
    artifactVersion: (agent) =>
      getRuntimeArtifactDescriptor(agent.id)?.artifactVersion || null,
    inputContract: (agent) => getRuntimeInputContract(agent.id),
    async invoke(agent, inputs) {
      if (!anthropic.apiKey) {
        throw Object.assign(
          new Error("Runtime selected but ANTHROPIC_API_KEY is unset"),
          { status: 503 },
        );
      }
      if (fetchImpl !== globalThis.fetch && !process.env.NODE_TEST_CONTEXT) {
        throw Object.assign(
          new Error("Custom runtime transport is test-only"),
          { status: 500 },
        );
      }

      const system = await loadRuntimeArtifact(agent.id);
      const runtimeMode = getRuntimeArtifactMode(agent.id);
      const ctx = {
        fetchImpl,
        apiKey: anthropic.apiKey,
        model,
        timeoutMs,
        system,
      };

      if (runtimeMode === "gap-fill") {
        return invokeGapFill(agent, inputs, ctx);
      }

      const { values, missing } = resolveRuntimeInputs(agent.id, inputs);
      if (runtimeMode === "single-shot" && missing.length) {
        throw Object.assign(
          new Error(
            `Single-shot mode needs this material up front and none was supplied: ${missing.join(", ")}`,
          ),
          { status: 400 },
        );
      }

      const call = await callAnthropicMessages({
        ...ctx,
        userContent: JSON.stringify(
          runtimeMode === "single-shot" ? values : inputs || {},
          null,
          2,
        ),
      });

      // A failed check is a quality miss, not a safety stop: the guardrails are
      // the safety layer. Returning the output marked failed keeps the tokens
      // we already paid for, lets a reviewer see whether the check or the model
      // was wrong, and produces a rateable run instead of a dead error.
      const checkResults = validateRuntimeArtifactOutput(agent.id, call.output);

      return {
        status: "ok",
        output: call.output,
        ...(checkResults.length ? { checkResults } : {}),
        callCount: 1,
        ...artifactMeta(agent.id),
        provider: "anthropic",
        modelId: call.modelId,
        latencyMs: call.latencyMs,
        // TODO: costUsd is never calculated here, so no run — passed or failed
        // — carries attributable spend. Token counts are recorded; converting
        // them to cost needs per-model pricing that this adapter does not have.
        // Until that exists, treat cost-per-outcome as unimplemented, not zero.
        ...call.usage,
      };
    },
  };
}

function portStub(kind, hint) {
  return { name: kind, serverRun: false, async invoke() { throw Object.assign(new Error(`${kind} invocation not configured — ${hint}`), { status: 501 }); } };
}

/** Resolve the invoker for an agent from its declared invocation type. */
export function getInvoker(agent, config) {
  const type = agent?.invocation?.type || "link";
  switch (type) {
    case "http": return httpInvoker(config);
    case "mock": return mockInvoker();
    case "mcp": return portStub("mcp", "provide an MCP bridge endpoint");
    case "runtime": {
      const base = runtimeInvoker(config);
      const mode =
        getRuntimeArtifactMode(agent.id) ||
        agent.invocation?.mode ||
        base.mode;
      return { ...base, mode };
    }
    case "prompt":
    case "link":
    default: return manual(type);
  }
}
