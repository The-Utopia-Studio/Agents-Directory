#!/usr/bin/env node
// Local A10 gap-fill probe — no HTTP, no Clerk. Spends the configured LLM.
//
//   node scripts/run-a10-gaps.js
//   FELLOW_NAME='…' SOURCE_MATERIAL='…' node scripts/run-a10-gaps.js
//
// Optional: EXCLUSIONS='…'
import { config } from "../src/config.js";
import { runtimeInvoker } from "../src/invoke/index.js";

const fellowName = process.env.FELLOW_NAME || "Haniyah Umair";
const sourceMaterial =
  process.env.SOURCE_MATERIAL ||
  "Agentic Operator Intern at The Utopia Studio, Doha. Previously Developer Intern at Silatha and AI Intern at Rock River Research. CS student at University of Aberdeen.";
const exclusions = process.env.EXCLUSIONS || "";

if (!config.runtime?.openai?.apiKey && config.runtime?.provider === "openai") {
  console.error("OPENAI_API_KEY is unset in server config / .env");
  process.exit(1);
}
if (!config.runtime?.anthropic?.apiKey && config.runtime?.provider === "anthropic") {
  console.error("ANTHROPIC_API_KEY is unset in server config / .env");
  process.exit(1);
}

const invoker = runtimeInvoker(config);
const inputs = {
  fellowName,
  sourceMaterial,
  ...(exclusions ? { exclusions } : {}),
};

const result = await invoker.invoke(
  { id: "A10", invocation: { type: "runtime", mode: "gap-fill" } },
  inputs,
);

console.log(
  JSON.stringify(
    {
      status: result.status,
      callCount: result.callCount,
      gapsCount: result.gapsCount,
      gaps: result.gaps || null,
      output: result.output || "",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      modelId: result.modelId,
      latencyMs: result.latencyMs,
      artifactVersion: result.artifactVersion,
    },
    null,
    2,
  ),
);
