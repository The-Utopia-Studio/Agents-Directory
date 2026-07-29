// Invocation seam — how an agent is actually used. The directory owns the
// definition; each platform is a runtime behind an adapter, so an agent isn't
// "a Claude project", it's a spec that currently runs on Claude and can run
// anywhere. Adapters:
//   link / prompt — not server-run (open where it lives / paste the exported prompt)
//   http          — call an endpoint or webhook (n8n, custom, hosted agent)
//   mcp           — call via an MCP bridge (port: needs config)
//   runtime       — run via @studio/ai-runtime (port: sandbox + metered inference)
//   mock          — canned response for offline demos
import { requestJsonEndpoint } from "./networkPolicy.js";

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
    case "runtime": return portStub("runtime", "wire @studio/ai-runtime (sandbox + metered inference)");
    case "prompt":
    case "link":
    default: return manual(type);
  }
}
