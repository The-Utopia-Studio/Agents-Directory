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

export function runtimeInvoker(config = {}) {
  const anthropic = config.runtime?.anthropic || {};
  const model = anthropic.model || "claude-sonnet-4-6";
  const timeoutMs = anthropic.timeoutMs || RUNTIME_TIMEOUT_MS;
  const fetchImpl = anthropic.fetch || globalThis.fetch;
  return {
    name: "runtime",
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
      const { values, missing } = resolveRuntimeInputs(agent.id, inputs);
      if (runtimeMode === "single-shot" && missing.length) {
        throw Object.assign(
          new Error(
            `Single-shot mode needs this material up front and none was supplied: ${missing.join(", ")}`,
          ),
          { status: 400 },
        );
      }
      // The registered file is the effective runtime artifact. Export and ZIP
      // read this same file, so no adapter-only prompt suffix can fork evidence.
      const runtimeSystem = system;
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
            "x-api-key": anthropic.apiKey,
          },
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            system: runtimeSystem,
            messages: [
              {
                role: "user",
                // Contract-backed agents send only resolved fields: material
                // this mode cannot read (URLs, Drive links, file paths) must
                // not reach the model as if it were readable source.
                content: JSON.stringify(
                  runtimeMode === "single-shot" ? values : inputs || {},
                  null,
                  2,
                ),
              },
            ],
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
        });
      }
      // Anthropic has already billed by this point, so every downstream exit
      // carries usage — a failure whose spend cannot be attributed is a hole
      // in the cost record, not just a missing diagnostic.
      const usage = {
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

      // A failed check is a quality miss, not a safety stop: the guardrails are
      // the safety layer. Returning the output marked failed keeps the tokens
      // we already paid for, lets a reviewer see whether the check or the model
      // was wrong, and produces a rateable run instead of a dead error.
      const checkResults = validateRuntimeArtifactOutput(agent.id, output);

      return {
        output,
        ...(checkResults.length ? { checkResults } : {}),
        artifactDigest:
          getRuntimeArtifactDescriptor(agent.id)?.artifactDigest || undefined,
        artifactDigestAlgorithm:
          getRuntimeArtifactDescriptor(agent.id)?.artifactDigestAlgorithm ||
          undefined,
        artifactVersion:
          getRuntimeArtifactDescriptor(agent.id)?.artifactVersion || undefined,
        provider: "anthropic",
        modelId: payload.model || model,
        latencyMs,
        // TODO: costUsd is never calculated here, so no run — passed or failed
        // — carries attributable spend. Token counts are recorded; converting
        // them to cost needs per-model pricing that this adapter does not have.
        // Until that exists, treat cost-per-outcome as unimplemented, not zero.
        ...usage,
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
    case "runtime": return runtimeInvoker(config);
    case "prompt":
    case "link":
    default: return manual(type);
  }
}
