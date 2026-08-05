// Invocation seam — how an agent is actually used. The directory owns the
// definition; each platform is a runtime behind an adapter, so an agent isn't
// "a Claude project", it's a spec that currently runs on a selected LLM
// provider and can move. Adapters:
//   link / prompt — not server-run (open where it lives / paste the exported prompt)
//   http          — call an endpoint or webhook (n8n, custom, hosted agent)
//   mcp           — call via an MCP bridge (port: needs config)
//   runtime       — load a server-owned skill artifact and invoke the configured LLM
//   mock          — canned response for offline demos
import { requestJsonEndpoint } from "./networkPolicy.js";
import {
  gapBankForPrompt,
  normalizeGapAnswers,
  parseGapResponse,
  unansweredGaps,
} from "./gapFill.js";
import {
  createRuntimeLlm,
  RUNTIME_TIMEOUT_MS,
  sumUsage,
} from "./llm/index.js";
import {
  getRuntimeArtifactMode,
  getRuntimeArtifactDescriptor,
  getRuntimeInputContract,
  hasRuntimeArtifact,
  loadRuntimeArtifact,
  resolveRuntimeInputs,
  validateRuntimeArtifactOutput,
} from "./runtimeArtifacts.js";

export { RUNTIME_TIMEOUT_MS };

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

function artifactMeta(agentId) {
  const descriptor = getRuntimeArtifactDescriptor(agentId);
  return {
    artifactDigest: descriptor?.artifactDigest || undefined,
    artifactDigestAlgorithm: descriptor?.artifactDigestAlgorithm || undefined,
    artifactVersion: descriptor?.artifactVersion || undefined,
    runtimeProvider: descriptor?.runtimeProvider || undefined,
    runtimeModel: descriptor?.runtimeModel || undefined,
  };
}

function assertRuntimePin(agentId, llm) {
  const descriptor = getRuntimeArtifactDescriptor(agentId);
  if (!descriptor?.runtimeProvider || !descriptor?.runtimeModel) {
    throw Object.assign(
      new Error(
        `Runtime artifact for ${agentId} is missing runtime_provider / runtime_model frontmatter`,
      ),
      { status: 500 },
    );
  }
  if (descriptor.runtimeProvider !== llm.name) {
    throw Object.assign(
      new Error(
        `Artifact ${agentId} declares runtime_provider=${descriptor.runtimeProvider} but RUNTIME_PROVIDER=${llm.name}`,
      ),
      { status: 503 },
    );
  }
  return descriptor;
}

async function completeWithTimeout(llm, args, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("generation timed out")),
    timeoutMs,
  );
  try {
    return await llm.complete({ ...args, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function invokeGapFill(agent, inputs, llm, timeoutMs) {
  const pin = assertRuntimePin(agent.id, llm);
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

  const system = await loadRuntimeArtifact(agent.id);
  const callArgs = {
    system,
    model: pin.runtimeModel,
  };

  const call1 = await completeWithTimeout(
    llm,
    {
      ...callArgs,
      userContent: JSON.stringify(
        {
          phase: "detect-gaps",
          fellowName: values.fellowName,
          sourceMaterial: values.sourceMaterial,
          gapBank: gapBankForPrompt(),
        },
        null,
        2,
      ),
    },
    timeoutMs,
  );

  let gaps;
  try {
    gaps = parseGapResponse(call1.output);
  } catch (error) {
    error.usage = call1.usage;
    error.latencyMs = call1.latencyMs;
    if (typeof call1.costUsd === "number") error.costUsd = call1.costUsd;
    throw error;
  }

  if (gaps.length && !continuing) {
    return {
      status: "needs_input",
      gaps,
      output: "",
      callCount: 1,
      gapsCount: gaps.length,
      provider: call1.provider || llm.name,
      modelId: call1.modelId,
      latencyMs: call1.latencyMs,
      ...(typeof call1.costUsd === "number" ? { costUsd: call1.costUsd } : {}),
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
          ...(typeof call1.costUsd === "number" ? { costUsd: call1.costUsd } : {}),
        },
      );
    }
  }

  const call2 = await completeWithTimeout(
    llm,
    {
      ...callArgs,
      userContent: JSON.stringify(
        {
          phase: "draft",
          fellowName: values.fellowName,
          sourceMaterial: values.sourceMaterial,
          gapAnswers: gapAnswers || {},
          ...(values.exclusions ? { exclusions: values.exclusions } : {}),
        },
        null,
        2,
      ),
    },
    timeoutMs,
  );

  const checkResults = validateRuntimeArtifactOutput(agent.id, call2.output);
  const usage = sumUsage([call1.usage, call2.usage]);
  const costParts = [call1.costUsd, call2.costUsd].filter(
    (n) => typeof n === "number",
  );
  const costUsd = costParts.length
    ? Math.round(costParts.reduce((a, b) => a + b, 0) * 1e8) / 1e8
    : undefined;

  return {
    status: "ok",
    output: call2.output,
    ...(checkResults.length ? { checkResults } : {}),
    callCount: 2,
    gapsCount: gaps.length,
    provider: call2.provider || call1.provider || llm.name,
    modelId: call2.modelId || call1.modelId,
    latencyMs: call1.latencyMs + call2.latencyMs,
    ...(typeof costUsd === "number" ? { costUsd } : {}),
    ...artifactMeta(agent.id),
    ...usage,
  };
}

export function runtimeInvoker(config = {}) {
  const llm = createRuntimeLlm(config);
  const timeoutMs =
    config.runtime?.[llm.name]?.timeoutMs || RUNTIME_TIMEOUT_MS;
  return {
    name: "runtime",
    mode: "single-shot",
    provider: llm.name,
    modelId: null,
    serverRun: true,
    isConfigured: () => llm.isConfigured(),
    canInvoke: (agent) => hasRuntimeArtifact(agent.id),
    artifactDigest: (agent) =>
      getRuntimeArtifactDescriptor(agent.id)?.artifactDigest || null,
    artifactDigestAlgorithm: (agent) =>
      getRuntimeArtifactDescriptor(agent.id)?.artifactDigestAlgorithm || null,
    artifactVersion: (agent) =>
      getRuntimeArtifactDescriptor(agent.id)?.artifactVersion || null,
    inputContract: (agent) => getRuntimeInputContract(agent.id),
    async invoke(agent, inputs) {
      if (!llm.isConfigured()) {
        throw Object.assign(
          new Error(
            llm.name === "openai"
              ? "Runtime selected but OPENAI_API_KEY is unset"
              : "Runtime selected but ANTHROPIC_API_KEY is unset",
          ),
          { status: 503 },
        );
      }

      const runtimeMode = getRuntimeArtifactMode(agent.id);
      if (runtimeMode === "gap-fill") {
        return invokeGapFill(agent, inputs, llm, timeoutMs);
      }

      const pin = assertRuntimePin(agent.id, llm);
      const { values, missing } = resolveRuntimeInputs(agent.id, inputs);
      if (runtimeMode === "single-shot" && missing.length) {
        throw Object.assign(
          new Error(
            `Single-shot mode needs this material up front and none was supplied: ${missing.join(", ")}`,
          ),
          { status: 400 },
        );
      }

      const system = await loadRuntimeArtifact(agent.id);
      const call = await completeWithTimeout(
        llm,
        {
          system,
          model: pin.runtimeModel,
          userContent: JSON.stringify(
            runtimeMode === "single-shot" ? values : inputs || {},
            null,
            2,
          ),
        },
        timeoutMs,
      );

      const checkResults = validateRuntimeArtifactOutput(agent.id, call.output);

      return {
        status: "ok",
        output: call.output,
        ...(checkResults.length ? { checkResults } : {}),
        callCount: 1,
        provider: call.provider || llm.name,
        modelId: call.modelId,
        latencyMs: call.latencyMs,
        ...(typeof call.costUsd === "number" ? { costUsd: call.costUsd } : {}),
        ...artifactMeta(agent.id),
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
