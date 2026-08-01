// Central, env-driven configuration. Reads a .env file if present (no
// dependency — a tiny parser), then process.env overrides. Every provider
// is selected here by name so the rest of the code never hard-codes one.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function loadDotEnv() {
  try {
    const path = fileURLToPath(new URL("../.env", import.meta.url));
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* no .env — defaults apply */ }
}
loadDotEnv();

const env = process.env;
const dataDir = env.DATA_DIR
  ? env.DATA_DIR
  : fileURLToPath(new URL("../data/", import.meta.url));

export const config = {
  port: Number(env.PORT || 8790),
  dataDir,
  corsOrigin: env.CORS_ORIGIN || "*",
  // Optional shared secret. When set, the router requires Authorization: Bearer.
  // When unset/empty, all routes stay open (local + zero-secrets deploy).
  apiToken: env.API_TOKEN || "",

  runtime: {
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || "",
      model: "claude-sonnet-4-6",
      timeoutMs: 120_000,
    },
  },

  observability: {
    provider: env.OBS_PROVIDER || "local",
    lowScoreThreshold: Number(env.OBS_LOW_SCORE || 70),
    langfuse: {
      host: env.LANGFUSE_HOST || "https://cloud.langfuse.com",
      publicKey: env.LANGFUSE_PUBLIC_KEY || "",
      secretKey: env.LANGFUSE_SECRET_KEY || "",
    },
  },

  optimizer: {
    provider: env.OPTIMIZER || "heuristic",
    gepa: {
      endpoint: env.GEPA_ENDPOINT || "",
      cmd: env.GEPA_CMD || "",
      model: env.GEPA_MODEL || "claude-opus-4-8",
      budget: Number(env.GEPA_BUDGET || 10),
    },
  },

  // The checker in the maker/checker split — grades the optimizer's proposals.
  verifier: {
    provider: env.VERIFIER || "heuristic",
    endpoint: env.VERIFIER_ENDPOINT || "",
    model: env.VERIFIER_MODEL || "claude-opus-4-8",
  },

  // The heartbeat — automations that make it a loop, not a one-off run.
  loop: {
    enabled: env.LOOP_ENABLED === "true",
    intervalMs: Number(env.LOOP_INTERVAL_MS || 0), // 0 = no auto scheduler (manual trigger only)
    lowScore: Number(env.LOOP_LOW_SCORE || 70),
    maxJobs: Number(env.LOOP_MAX_JOBS || 3),
    budgetUsd: Number(env.LOOP_BUDGET_USD || 1),
    costPerJobUsd: Number(env.LOOP_COST_PER_JOB || 0.05),
    autoApply: env.LOOP_AUTOAPPLY === "true",       // default: human approves everything
    autoApplyConfidence: Number(env.LOOP_AUTOAPPLY_CONFIDENCE || 0.85),
  },

  // The Context pillar — agent memory / knowledge with semantic recall.
  memory: {
    provider: env.MEMORY_PROVIDER || "local",
    topK: Number(env.MEMORY_TOP_K || 5),
    supermemory: {
      baseUrl: env.SUPERMEMORY_BASE_URL || "https://api.supermemory.ai",
      apiKey: env.SUPERMEMORY_API_KEY || "",
    },
    activeloop: {
      baseUrl: env.ACTIVELOOP_BASE_URL || "https://app.activeloop.ai/api/query/v1",
      token: env.ACTIVELOOP_TOKEN || "",
      org: env.ACTIVELOOP_ORG || "",
      dataset: env.ACTIVELOOP_DATASET || "agent_memory",
      embedEndpoint: env.EMBED_ENDPOINT || "",
      ingestEndpoint: env.ACTIVELOOP_INGEST_ENDPOINT || "",
    },
  },
};
