import { createRegistry } from "../../core/registry.js";
import { costUsdFromUsage } from "./pricing.js";

export const RUNTIME_TIMEOUT_MS = 120_000;

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

export { sumUsage, costUsdFromUsage };

function withCost(modelId, result) {
  const costUsd = costUsdFromUsage(modelId, result.usage);
  return {
    ...result,
    modelId: result.modelId || modelId,
    ...(typeof costUsd === "number" ? { costUsd } : {}),
  };
}

/** Anthropic Messages API — snake_case usage, top-level system, content blocks. */
export function createAnthropicMessagesProvider(opts = {}) {
  const apiKey = opts.apiKey || "";
  const timeoutMs = opts.timeoutMs || RUNTIME_TIMEOUT_MS;
  const fetchImpl = opts.fetch || globalThis.fetch;
  return {
    name: "anthropic",
    isConfigured: () => Boolean(apiKey),
    async complete({ system, userContent, model, signal }) {
      if (!apiKey) {
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
      const controller = new AbortController();
      const onAbort = () =>
        controller.abort(signal?.reason || new Error("aborted"));
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
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
        if (signal) signal.removeEventListener("abort", onAbort);
      }

      const latencyMs = Date.now() - started;
      if (
        payload.stop_reason === "refusal" ||
        payload.content?.some?.((block) => block.type === "refusal")
      ) {
        const usage = usageFromAnthropic(payload);
        throw Object.assign(new Error("Anthropic refused the runtime request"), {
          status: 502,
          usage,
          latencyMs,
          ...(typeof costUsdFromUsage(model, usage) === "number"
            ? { costUsd: costUsdFromUsage(model, usage) }
            : {}),
        });
      }

      const usage = usageFromAnthropic(payload);
      const output = (payload.content || [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      if (!output) {
        throw Object.assign(
          new Error("Anthropic Messages API returned no text output"),
          {
            status: 502,
            failureCode: "empty_output",
            usage,
            latencyMs,
            ...(typeof costUsdFromUsage(model, usage) === "number"
              ? { costUsd: costUsdFromUsage(model, usage) }
              : {}),
          },
        );
      }

      return withCost(model, {
        output,
        usage,
        latencyMs,
        modelId: payload.model || model,
        provider: "anthropic",
      });
    },
  };
}

function usageFromAnthropic(payload) {
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

/**
 * OpenAI Responses API — instructions + input, output_text / message items,
 * usage.input_tokens / usage.output_tokens. Not Chat Completions.
 */
export function createOpenAiResponsesProvider(opts = {}) {
  const apiKey = opts.apiKey || "";
  const timeoutMs = opts.timeoutMs || RUNTIME_TIMEOUT_MS;
  const fetchImpl = opts.fetch || globalThis.fetch;
  return {
    name: "openai",
    isConfigured: () => Boolean(apiKey),
    async complete({ system, userContent, model, signal }) {
      if (!apiKey) {
        throw Object.assign(
          new Error("Runtime selected but OPENAI_API_KEY is unset"),
          { status: 503 },
        );
      }
      if (fetchImpl !== globalThis.fetch && !process.env.NODE_TEST_CONTEXT) {
        throw Object.assign(
          new Error("Custom runtime transport is test-only"),
          { status: 500 },
        );
      }
      const controller = new AbortController();
      const onAbort = () =>
        controller.abort(signal?.reason || new Error("aborted"));
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
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
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            instructions: system,
            input: userContent,
            store: false,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw Object.assign(
            new Error(`OpenAI Responses API returned ${response.status}`),
            { status: 502, runtimeSafe: true },
          );
        }
        try {
          payload = await response.json();
        } catch {
          throw Object.assign(
            new Error("OpenAI Responses API returned invalid JSON"),
            { status: 502, runtimeSafe: true },
          );
        }
      } catch (error) {
        if (controller.signal.aborted) {
          throw Object.assign(new Error("OpenAI generation timed out"), {
            status: 504,
          });
        }
        if (error.runtimeSafe) throw error;
        throw Object.assign(
          new Error("OpenAI Responses API request failed"),
          { status: 502 },
        );
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
      }

      const latencyMs = Date.now() - started;
      const usage = usageFromOpenAi(payload);

      if (
        payload.status === "failed" ||
        payload.error ||
        payload.status === "cancelled"
      ) {
        throw Object.assign(
          new Error("OpenAI Responses API failed to complete"),
          {
            status: 502,
            usage,
            latencyMs,
            ...(typeof costUsdFromUsage(model, usage) === "number"
              ? { costUsd: costUsdFromUsage(model, usage) }
              : {}),
          },
        );
      }

      const output = extractOpenAiText(payload);
      if (!output) {
        throw Object.assign(
          new Error("OpenAI Responses API returned no text output"),
          {
            status: 502,
            failureCode: "empty_output",
            usage,
            latencyMs,
            ...(typeof costUsdFromUsage(model, usage) === "number"
              ? { costUsd: costUsdFromUsage(model, usage) }
              : {}),
          },
        );
      }

      return withCost(model, {
        output,
        usage,
        latencyMs,
        modelId: payload.model || model,
        provider: "openai",
      });
    },
  };
}

function usageFromOpenAi(payload) {
  // Responses API documents input_tokens / output_tokens (not Chat Completions'
  // prompt_tokens / completion_tokens). Do not map the wrong fields.
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
      : typeof payload.usage?.total_tokens === "number"
        ? { totalTokens: payload.usage.total_tokens }
        : {}),
  };
}

function extractOpenAiText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const chunks = [];
  for (const item of payload.output || []) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (
          (part?.type === "output_text" || part?.type === "text") &&
          typeof part.text === "string"
        ) {
          chunks.push(part.text);
        }
      }
    }
    if (item?.type === "output_text" && typeof item.text === "string") {
      chunks.push(item.text);
    }
  }
  return chunks.join("\n").trim();
}

const llmRegistry = createRegistry("runtime-llm");
llmRegistry.register("anthropic", createAnthropicMessagesProvider);
llmRegistry.register("openai", createOpenAiResponsesProvider);

export function createRuntimeLlm(config = {}) {
  const name = config.runtime?.provider || "openai";
  const section = config.runtime?.[name] || {};
  return llmRegistry.create(name, {
    apiKey: section.apiKey || "",
    timeoutMs: section.timeoutMs || RUNTIME_TIMEOUT_MS,
    fetch: section.fetch,
  });
}

export function listRuntimeLlmProviders() {
  return llmRegistry.names();
}
