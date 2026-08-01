import { createHash } from "node:crypto";
import { getRuntimeArtifactDescriptor } from "../invoke/runtimeArtifacts.js";
import { createZip } from "./zip.js";

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function resolveRegisteredArtifact(agentId) {
  // Export resolves through the invocation registry itself. There is no second
  // install registry that can drift away from what runtime executes.
  const artifact = getRuntimeArtifactDescriptor(agentId);
  if (!artifact) throw httpError(404, "No install artifact for this agent");
  if (
    !artifact.artifactDigest ||
    artifact.artifactDigestAlgorithm !== "sha256"
  ) {
    throw httpError(
      500,
      "Runtime artifact loaded without its required SHA-256 digest",
    );
  }
  return artifact;
}

async function readArtifactFiles(agentId) {
  const artifact = resolveRegisteredArtifact(agentId);
  const files = artifact.files.map(({ name, data }) => ({
    name,
    data: Buffer.from(data),
    sha256: createHash("sha256").update(data).digest("hex"),
    description: artifact.descriptions[name] || "Install artifact file.",
  }));
  return { artifact, files };
}

function cleanVersion(value) {
  const raw = String(value || "unversioned").trim();
  return raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function artifactVersion(value) {
  let version = cleanVersion(value)
    .replace(/^biocraft[._-]?/i, "")
    .replace(/^v/i, "");
  if (/^\d+\.0$/.test(version)) version = version.slice(0, -2);
  return `v${version || "unversioned"}`;
}

function zipFilename(agent, artifact) {
  return `${agent.id}-${artifact.slug}-${artifactVersion(agent.version)}-${artifact.artifactDigest.slice(0, 7)}.zip`;
}

function bulletList(values, fallback) {
  return values?.length
    ? values.map((value) => `- ${value}`).join("\n")
    : `- ${fallback}`;
}

function buildManifest(agent, artifact, files) {
  const inventory = [
    {
      name: "MANIFEST.md",
      description: "This provenance, install, and result-return guide.",
    },
    ...files,
  ]
    .map(
      (file) =>
        `- \`${file.name}\` — ${file.description}${
          file.sha256 ? ` (SHA-256: \`${file.sha256}\`)` : ""
        }`,
    )
    .join("\n");

  return `# ${artifact.displayName}

- Agent name: ${artifact.displayName}
- Directory display ID: ${agent.id}
- Directory record name: ${agent.name}
- Directory version label: ${cleanVersion(agent.version)}
- Artifact version: ${artifactVersion(agent.version)}
- Artifact mode: ${artifact.mode}
- Artifact digest: \`${artifact.artifactDigest}\`
- Artifact digest algorithm: \`${artifact.artifactDigestAlgorithm}\`

## Contents

${inventory}

## Install

Keep these files together as one \`${artifact.slug}\` folder.

- Claude Code / Claude skills: \`~/.claude/skills/${artifact.slug}/\`
- Cursor project skill: \`.cursor/skills/${artifact.slug}/\`
- Other harnesses: use that harness's skills directory without flattening or
  renaming the folder.

This is the **single-shot artifact**, not the full Chrome/Google Drive
\`/biocraft\` agent. The hosted runtime executes this same server-owned
\`SKILL.md\` verbatim. It has no browser, Drive, filesystem, HTML-rendering, or
follow-up conversation tools.

The filename and this manifest use the agent's current directory version label.
When the loop bumps that version, subsequent downloads follow it automatically;
runtime, evaluation, copy, and download still resolve through the same artifact
registry and content digest.

## Guardrails from the directory record

${bulletList(agent.guardrails, "No guardrails recorded.")}

## Success criteria from the directory record

${bulletList(agent.successCriteria, "No success criteria recorded.")}

## Return a result

Return all three items so the evaluation can be attributed to this exact build:

1. **Output** — the generated deliverable, or a link/path to it.
2. **Rating** — an integer from 1 to 5.
3. **Artifact digest** — \`${artifact.artifactDigest}\`.
4. **Artifact digest algorithm** — \`${artifact.artifactDigestAlgorithm}\`.

Include free-text notes explaining the rating whenever possible.
`;
}

export async function getInstallArtifactCapability(agent) {
  if (!agent?.usabilityModes?.includes("download-install")) {
    return { available: false };
  }
  const artifact = getRuntimeArtifactDescriptor(agent.id);
  if (!artifact) return { available: false };
  try {
    resolveRegisteredArtifact(agent.id);
    return {
      available: true,
      kind: "single-shot",
      label: artifact.displayName,
      artifactVersion: artifactVersion(agent.version),
      artifactDigest: artifact.artifactDigest,
      artifactDigestAlgorithm: artifact.artifactDigestAlgorithm,
      shortDigest: artifact.artifactDigest.slice(0, 7),
      filename: zipFilename(agent, artifact),
    };
  } catch {
    return { available: false };
  }
}

export async function loadInstallSkill(agent) {
  if (!agent?.usabilityModes?.includes("download-install")) {
    throw httpError(404, "Agent is not available for download-install");
  }
  const { artifact, files } = await readArtifactFiles(agent.id);
  const skill = files.find((file) => file.name === "SKILL.md");
  if (!skill) throw httpError(404, "Install artifact has no SKILL.md");
  return {
    content: skill.data.toString("utf8"),
    filename: `${agent.id}-${artifact.slug}-${artifactVersion(agent.version)}-${artifact.artifactDigest.slice(0, 7)}-SKILL.md`,
    artifactVersion: artifactVersion(agent.version),
    artifactDigest: artifact.artifactDigest,
    artifactDigestAlgorithm: artifact.artifactDigestAlgorithm,
    kind: "single-shot",
  };
}

export async function buildInstallArtifactZip(agent) {
  if (!agent?.usabilityModes?.includes("download-install")) {
    throw httpError(404, "Agent is not available for download-install");
  }
  const { artifact, files } = await readArtifactFiles(agent.id);
  const manifest = buildManifest(agent, artifact, files);
  const entries = [
    { name: "MANIFEST.md", data: Buffer.from(manifest, "utf8") },
    ...files.map(({ name, data }) => ({ name, data })),
  ];
  return {
    data: createZip(entries),
    filename: zipFilename(agent, artifact),
    artifactDigest: artifact.artifactDigest,
    artifactDigestAlgorithm: artifact.artifactDigestAlgorithm,
  };
}
