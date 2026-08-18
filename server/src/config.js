// Central, env-driven configuration. Reads .env files if present (no
// dependency — a tiny parser), then process.env overrides. Every provider
// is selected here by name so the rest of the code never hard-codes one.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isRailwayEnvironment,
  resolveDataDir,
} from "./core/dataDir.js";

function loadDotEnvFile(path) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* missing file — defaults apply */
  }
}

function loadDotEnv() {
  // Prefer process.env; fill gaps from server/.env then repo-root .env.local/.env
  // so local GITHUB_LOOP_TOKEN in .env.local is visible without copying.
  loadDotEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  loadDotEnvFile(fileURLToPath(new URL("../../.env.local", import.meta.url)));
  loadDotEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
}
loadDotEnv();

const env = process.env;
// Human approval is mandatory. This is fail-closed rather than default-off:
// a stale production variable cannot silently re-enable catalog approval.
if (env.LOOP_AUTOAPPLY && env.LOOP_AUTOAPPLY !== "false") {
  throw new Error(
    "LOOP_AUTOAPPLY is disabled: unset it or set exactly false; all proposals require human review",
  );
}
// On Railway this throws at import if DATA_DIR is unset — before listen —
// so a missing volume config can never look like a healthy deploy.
const dataDir = resolveDataDir(env);
const requirePersistentDataDir = isRailwayEnvironment(env);

export const config = {
  port: Number(env.PORT || 8790),
  dataDir,
  // True on Railway: the store root must already exist (volume mount) and is
  // never created on the ephemeral container filesystem.
  requirePersistentDataDir,
  corsOrigin: env.CORS_ORIGIN || "*",
  // Optional shared secret. When set, the router requires Authorization: Bearer.
  // When unset/empty, all routes stay open (local + zero-secrets deploy).
  apiToken: env.API_TOKEN || "",
  clerk: {
    issuer: env.CLERK_JWT_ISSUER_DOMAIN || "",
    audience: env.CLERK_JWT_AUDIENCE || "convex",
  },
  // Convex authority (state B): deploy-key call auth; recorded actor is the
  // declared service principal. Missing creds → hosted-run evidence writes skip.
  convex: {
    url: env.CONVEX_URL || "",
    deployKey: env.CONVEX_DEPLOY_KEY || "",
  },
  // The migration export returns the whole metadata catalogue in one response,
  // so it is not one of the routes a public origin may leave open. On Railway
  // it refuses to answer until API_TOKEN is configured; locally it stays
  // reachable for development.
  requireAuthenticatedExport: requirePersistentDataDir,

  runtime: {
    // Selects the LLM adapter (openai Responses / anthropic Messages). Must
    // match each live artifact's runtime_provider frontmatter or invoke fails.
    provider: env.RUNTIME_PROVIDER || "openai",
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || "",
      timeoutMs: 120_000,
    },
    openai: {
      apiKey: env.OPENAI_API_KEY || "",
      timeoutMs: 120_000,
    },
  },

  observability: {
    provider: env.OBS_PROVIDER || "local",
    lowScoreThreshold: Number(env.OBS_LOW_SCORE || 70),
    // Reviewer judgement of the agent, stored on the feedback record and never
    // on the trace. On by default: a rating without a reason is not actionable.
    // Set FEEDBACK_NOTES=false to accept ratings only.
    feedbackNotes: env.FEEDBACK_NOTES !== "false",
    feedbackNotesMaxChars: Number(env.FEEDBACK_NOTES_MAX_CHARS || 2000),
    langfuse: {
      host: env.LANGFUSE_HOST || "https://cloud.langfuse.com",
      publicKey: env.LANGFUSE_PUBLIC_KEY || "",
      secretKey: env.LANGFUSE_SECRET_KEY || "",
    },
  },

  optimizer: {
    // "llm" = OpenAI Responses real-diff maker; "heuristic" = offline.
    provider: env.OPTIMIZER || "heuristic",
    gepa: {
      endpoint: env.GEPA_ENDPOINT || "",
      cmd: env.GEPA_CMD || "",
      model: env.GEPA_MODEL || "claude-opus-4-8",
      budget: Number(env.GEPA_BUDGET || 10),
    },
  },

  // LLM grounding checker (additive). Off until variance passes and
  // LLM_GROUNDING_ENABLED=true (or grounding.llmEnabled in tests).
  grounding: {
    llmEnabled: env.LLM_GROUNDING_ENABLED === "true",
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
    // Unused for accounting (no measured token spend on the heuristic path).
    // Kept so old env files do not crash config reads.
    budgetUsd: Number(env.LOOP_BUDGET_USD || 1),
    costPerJobUsd: Number(env.LOOP_COST_PER_JOB || 0.05),
    autoApply: false, // hard-disabled; LOOP_AUTOAPPLY=true aborts boot above
  },

  // Loop PR writer for The-Utopia-Studio/utopia-agents. Contents + PRs write.
  // Never fall back to GITHUB_SKILLS_TOKEN (fellow downloads; Contents:read).
  github: {
    loopToken: String(env.GITHUB_LOOP_TOKEN || "").trim(),
    loopRepo: "The-Utopia-Studio/utopia-agents",
    // HMAC secret for the merge webhook. Unset = the webhook refuses every
    // delivery. It is the only authentication on a route that can move
    // currentApprovedVersionId, so there is no unverified mode.
    webhookSecret: String(env.GITHUB_WEBHOOK_SECRET || "").trim(),
    // TEMPORARY authority mechanism — see docs/merged-pr-release.md.
    // Comma-separated GitHub logins permitted to release by merging a loop/ PR.
    // Unset/empty/whitespace-only refuses every release; empty is never
    // permissive. Intended end state is a GitHub → Clerk approver mapping so
    // one approver set governs both the UI and the merge path.
    releaseApprovers: String(env.LOOP_RELEASE_APPROVERS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
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
