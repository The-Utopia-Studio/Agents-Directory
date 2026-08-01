import { readFile } from "node:fs/promises";

/**
 * The run contract is server-owned. Field keys are stable identifiers, never
 * the agent record's display labels: those are editable in the directory, and
 * keying off them silently breaks the run the moment someone renames a field.
 */
const RUNTIME_ARTIFACTS = Object.freeze({
  A7: Object.freeze({
    url: new URL("../artifacts/biocraft/SKILL.md", import.meta.url),
    mode: "single-shot",
    inputContract: Object.freeze({
      fields: Object.freeze([
        {
          key: "fellowName",
          label: "Fellow's name",
          required: true,
          multiline: false,
          aliases: ["Fellow name", "Fellow's name", "name"],
        },
        {
          key: "sourceMaterial",
          label: "Source material (paste the full text)",
          help: "LinkedIn profile text, venture material, or CV. Paste it; the server cannot fetch links.",
          required: true,
          multiline: true,
          aliases: [
            "All source material and interview answers (required upfront)",
            "pasted text or local file path",
            "Pasted text",
            "sourceText",
          ],
        },
        {
          key: "interviewAnswers",
          label: "Short-interview answers",
          help: "Optional. Anything not already covered by the source material.",
          required: false,
          multiline: true,
          aliases: ["short-interview answers", "interview"],
        },
      ]),
      // Declared so the UI can show why these are absent rather than asking
      // for material this mode has no tool to read.
      unsupported: Object.freeze([
        {
          label: "LinkedIn URL",
          reason: "no browser tool in single-shot mode — paste the profile text instead",
        },
        {
          label: "Google Drive folder or pitch deck",
          reason: "no Drive tool in single-shot mode — paste the relevant text instead",
        },
        {
          label: "Local file path",
          reason: "no filesystem access in single-shot mode — paste the file contents instead",
        },
      ]),
    }),
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

/** Public contract: stable keys, labels, and the inputs this mode cannot read. */
export function getRuntimeInputContract(agentId) {
  const contract = RUNTIME_ARTIFACTS[agentId]?.inputContract;
  if (!contract) return null;
  return {
    fields: contract.fields.map(({ aliases: _aliases, ...field }) => ({
      ...field,
    })),
    unsupported: contract.unsupported.map((entry) => ({ ...entry })),
  };
}

/**
 * Map a submitted payload onto the contract's stable keys. Accepts the stable
 * key first, then declared aliases, then a case-insensitive label match, so a
 * renamed directory label degrades to a warning rather than a false refusal.
 */
export function resolveRuntimeInputs(agentId, inputs = {}) {
  const contract = RUNTIME_ARTIFACTS[agentId]?.inputContract;
  if (!contract) return { values: {}, missing: [] };

  const submitted = new Map(
    Object.entries(inputs || {}).map(([key, value]) => [
      key.trim().toLowerCase(),
      value,
    ]),
  );
  const values = {};
  const missing = [];

  for (const field of contract.fields) {
    const candidates = [field.key, field.label, ...(field.aliases || [])];
    let found = "";
    for (const candidate of candidates) {
      const value = submitted.get(String(candidate).trim().toLowerCase());
      if (String(value || "").trim()) {
        found = String(value).trim();
        break;
      }
    }
    if (found) values[field.key] = found;
    else if (field.required) missing.push(field.label);
  }

  return { values, missing };
}

export async function hasRuntimeArtifact(agentId) {
  try {
    await loadRuntimeArtifact(agentId);
    return true;
  } catch {
    return false;
  }
}
