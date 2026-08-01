import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ARTIFACTS_ROOT = new URL("../artifacts/", import.meta.url);

function snapshotArtifact(directoryUrl, primaryName) {
  let files;
  let primary;
  try {
    const allowedRoot = realpathSync(fileURLToPath(ARTIFACTS_ROOT));
    const directory = realpathSync(fileURLToPath(directoryUrl));
    if (
      directory !== allowedRoot &&
      !directory.startsWith(`${allowedRoot}${sep}`)
    ) {
      return null;
    }

    files = [];
    function walk(current) {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const path = resolve(current, entry.name);
        const name = relative(directory, path).split(sep).join("/");
        if (!name || name.startsWith("../") || resolve(directory, name) !== path) {
          return false;
        }
        if (entry.isSymbolicLink()) return false;
        if (entry.isDirectory()) {
          if (!walk(path)) return false;
          continue;
        }
        if (!entry.isFile() || !lstatSync(path).isFile()) return false;
        files.push({ name, data: readFileSync(path) });
      }
      return true;
    }
    if (!walk(directory)) return null;

    primary = files.find((file) => file.name === primaryName);
    if (!primary) return null;
  } catch {
    return null;
  }

  // Digesting is intentionally outside the resolution catch. Once bytes have
  // loaded, digest failure is contradictory and must fail boot visibly.
  const artifactDigest = createHash("sha256")
    .update(primary.data)
    .digest("hex");
  if (!artifactDigest) {
    throw new Error("Artifact loaded but SHA-256 digest was unavailable");
  }
  return {
    content: primary.data.toString("utf8"),
    files,
    artifactDigest,
    artifactDigestAlgorithm: "sha256",
  };
}

const BIOCRAFT_DIRECTORY = new URL("../artifacts/biocraft/", import.meta.url);
const BIOCRAFT_SNAPSHOT = snapshotArtifact(BIOCRAFT_DIRECTORY, "SKILL.md");

/**
 * The run contract is server-owned. Field keys are stable identifiers, never
 * the agent record's display labels: those are editable in the directory, and
 * keying off them silently breaks the run the moment someone renames a field.
 */
const RUNTIME_ARTIFACTS = Object.freeze({
  A7: Object.freeze({
    directory: BIOCRAFT_DIRECTORY,
    url: new URL("../artifacts/biocraft/SKILL.md", import.meta.url),
    mode: "single-shot",
    slug: "biocraft",
    displayName: "Biocraft single-shot draft",
    snapshot: BIOCRAFT_SNAPSHOT,
    descriptions: Object.freeze({
      "SKILL.md":
        "The exact single-shot system artifact executed by the hosted runtime.",
    }),
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
  if (!artifact.snapshot) {
    const error = new Error(`Server-owned runtime artifact unavailable for ${agentId}`);
    error.status = 503;
    throw error;
  }
  if (
    artifact.snapshot.content &&
    (!artifact.snapshot.artifactDigest ||
      artifact.snapshot.artifactDigestAlgorithm !== "sha256")
  ) {
    const error = new Error(
      `Runtime artifact for ${agentId} loaded without a SHA-256 digest`,
    );
    error.status = 500;
    throw error;
  }
  return artifact.snapshot.content;
}

export function getRuntimeArtifactMode(agentId) {
  return RUNTIME_ARTIFACTS[agentId]?.mode || null;
}

/** Shared custody record used by invocation, evaluation metadata, and export. */
export function getRuntimeArtifactDescriptor(agentId) {
  const artifact = RUNTIME_ARTIFACTS[agentId];
  if (!artifact?.snapshot) return null;
  return {
    directory: artifact.directory,
    url: artifact.url,
    mode: artifact.mode,
    slug: artifact.slug,
    displayName: artifact.displayName,
    artifactDigest: artifact.snapshot.artifactDigest,
    artifactDigestAlgorithm: artifact.snapshot.artifactDigestAlgorithm,
    files: artifact.snapshot.files.map((file) => ({
      name: file.name,
      data: Buffer.from(file.data),
    })),
    descriptions: artifact.descriptions,
  };
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
