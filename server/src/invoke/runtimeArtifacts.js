import { readFile } from "node:fs/promises";

const RUNTIME_ARTIFACTS = Object.freeze({
  A7: Object.freeze({
    url: new URL("../artifacts/biocraft/SKILL.md", import.meta.url),
    mode: "single-shot",
  }),
});

/**
 * Resolve prompt custody by server-owned agent id. The store's artifact pointer
 * is descriptive only: it never controls which file is read.
 *
 * Known limitation (TUS-2327): this registry is not an approved Convex
 * agentVersionId. Traces from it cannot support promotion.
 */
export async function loadRuntimeArtifact(agentId) {
  const artifact = RUNTIME_ARTIFACTS[agentId];
  if (!artifact) {
    const error = new Error(`No server-owned runtime artifact for ${agentId}`);
    error.status = 400;
    throw error;
  }
  try {
    return await readFile(artifact.url, "utf8");
  } catch {
    const error = new Error(`Server-owned runtime artifact unavailable for ${agentId}`);
    error.status = 503;
    throw error;
  }
}

export function getRuntimeArtifactMode(agentId) {
  return RUNTIME_ARTIFACTS[agentId]?.mode || null;
}

export async function hasRuntimeArtifact(agentId) {
  try {
    await loadRuntimeArtifact(agentId);
    return true;
  } catch {
    return false;
  }
}
