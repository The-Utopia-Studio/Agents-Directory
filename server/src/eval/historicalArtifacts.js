// Historical artifact fixtures for mechanical-check comparison across versions.
//
// Production load path (option 2): committed fixture bytes under
// server/src/eval-artifacts/, hashed on load, refuse on digest mismatch.
// Railway's Dockerfile copies src/ only — no .git — so git show is unavailable
// in the deployed image.
//
// Dev-time verification: verifyHistoricalFixtureAgainstGit() extracts the same
// path at the pinned SHA and asserts the declared digest. Adding a baseline is
// a deliberate commit of bytes + digest + pin.
//
// The live runnable artifact remains server/src/artifacts/*/SKILL.md.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const V5_DIGEST =
  "c5cc1a587a10deb6fb1b2ee73fed0c31fcad96fa12ed58bc5907544e408df92b";
const V6_DIGEST =
  "a8c08f4e98cd88f018764754eda760a20113e6fcf8a3362a192254b6bca81a10";

const FIXTURES_ROOT = new URL("../eval-artifacts/", import.meta.url);

/**
 * Pin full commit SHAs for dev-time git verification only. Runtime never
 * requires those commits to be present in the image.
 */
export const HISTORICAL_ARTIFACT_REGISTRY = Object.freeze({
  "biocraft-singleshot-v5": Object.freeze({
    agentId: "A7",
    artifactVersion: "biocraft-singleshot-v5",
    path: "server/src/artifacts/biocraft/SKILL.md",
    fixtureRelativePath: "biocraft/biocraft-singleshot-v5/SKILL.md",
    // Parent of the v6 release commit — last revision whose SKILL.md is v5.
    gitRev: "abb6a4689f63019e6fbc99db5cc124198a034ab5",
    declaredDigest: V5_DIGEST,
    declaredDigestAlgorithm: "sha256",
  }),
  "biocraft-singleshot-v6": Object.freeze({
    agentId: "A7",
    artifactVersion: "biocraft-singleshot-v6",
    path: "server/src/artifacts/biocraft/SKILL.md",
    fixtureRelativePath: "biocraft/biocraft-singleshot-v6/SKILL.md",
    gitRev: "403f90f0c045b9dcd548121df8ae5da4b0743873",
    declaredDigest: V6_DIGEST,
    declaredDigestAlgorithm: "sha256",
  }),
});

function refuse(message) {
  throw Object.assign(new Error(message), { status: 500 });
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Pure digest gate — exported so tests can assert the refuse path. */
export function assertDeclaredDigest(bytes, declaredDigest, label) {
  const artifactDigest = sha256Hex(bytes);
  if (artifactDigest !== declaredDigest) {
    refuse(
      `Historical artifact ${label} digest mismatch: ` +
        `declared ${declaredDigest}, extracted ${artifactDigest}. ` +
        `Refuse rather than run an unverified baseline.`,
    );
  }
  return artifactDigest;
}

function resolveRepoRoot() {
  const start = fileURLToPath(new URL("../../..", import.meta.url));
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: start,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    refuse(
      `Cannot resolve git repository for historical verification: ${String(result.stderr || result.error || "git failed").trim()}`,
    );
  }
  return result.stdout.trim();
}

/**
 * Extract one blob from a pinned revision. Dev-time / tests only — production
 * load path does not call this.
 */
export function gitShowBytes(gitRev, path, { repoRoot = resolveRepoRoot() } = {}) {
  if (!gitRev || !path) refuse("gitShowBytes requires gitRev and path");
  if (path.includes("\0") || path.startsWith("/")) {
    refuse(`Refusing unsafe historical artifact path: ${path}`);
  }
  const result = spawnSync("git", ["show", `${gitRev}:${path}`], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    refuse(
      `Failed to extract ${path} at ${gitRev}: ${Buffer.from(result.stderr || []).toString("utf8").trim() || "git show failed"}`,
    );
  }
  if (!Buffer.isBuffer(result.stdout) || result.stdout.length === 0) {
    refuse(`Historical artifact at ${gitRev}:${path} is empty`);
  }
  return result.stdout;
}

function frontmatterList(frontmatter, key) {
  const block = frontmatter.match(
    new RegExp(`^${key}:\\n((?:^[ \\t]+-[ \\t].+\\n?)+)`, "m"),
  )?.[1];
  if (!block) return [];
  return block
    .split("\n")
    .map((line) => line.match(/^[ \t]+-[ \t]+(.+)$/)?.[1]?.trim())
    .filter(Boolean);
}

function parseArtifactFrontmatter(content, expectedVersion) {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  if (!frontmatter) {
    refuse(`Historical artifact ${expectedVersion} has no parseable frontmatter`);
  }
  const artifactVersion = frontmatter.match(
    /^artifact_version:\s*([a-zA-Z0-9._-]+)\s*$/m,
  )?.[1];
  if (!artifactVersion) {
    refuse(`Historical artifact ${expectedVersion} has no artifact_version`);
  }
  if (artifactVersion !== expectedVersion) {
    refuse(
      `Historical artifact version mismatch: registry expects ${expectedVersion} but frontmatter says ${artifactVersion}`,
    );
  }
  return {
    artifactVersion,
    guardrails: frontmatterList(frontmatter, "guardrails"),
    successCriteria: frontmatterList(frontmatter, "success_criteria"),
    checks: frontmatterList(frontmatter, "checks"),
  };
}

function readFixtureBytes(entry) {
  const url = new URL(entry.fixtureRelativePath, FIXTURES_ROOT);
  let bytes;
  try {
    bytes = readFileSync(url);
  } catch (error) {
    refuse(
      `Historical fixture missing for ${entry.artifactVersion} at ${entry.fixtureRelativePath}: ${error.message}`,
    );
  }
  if (!bytes.length) {
    refuse(`Historical fixture for ${entry.artifactVersion} is empty`);
  }
  return bytes;
}

export function listHistoricalArtifactVersions(agentId) {
  return Object.values(HISTORICAL_ARTIFACT_REGISTRY)
    .filter((entry) => !agentId || entry.agentId === agentId)
    .map((entry) => ({
      agentId: entry.agentId,
      artifactVersion: entry.artifactVersion,
      gitRev: entry.gitRev,
      path: entry.path,
      fixtureRelativePath: entry.fixtureRelativePath,
      declaredDigest: entry.declaredDigest,
      declaredDigestAlgorithm: entry.declaredDigestAlgorithm,
    }));
}

/**
 * Load a pinned historical artifact from the committed fixture. Always
 * verifies the declared digest — never runs an unverified baseline.
 */
export function loadHistoricalArtifact(artifactVersion) {
  const entry = HISTORICAL_ARTIFACT_REGISTRY[artifactVersion];
  if (!entry) {
    refuse(
      `No historical artifact registered for ${artifactVersion}. Known: ${Object.keys(HISTORICAL_ARTIFACT_REGISTRY).join(", ") || "(none)"}`,
    );
  }
  const bytes = readFixtureBytes(entry);
  const artifactDigest = assertDeclaredDigest(
    bytes,
    entry.declaredDigest,
    `${entry.artifactVersion} fixture ${entry.fixtureRelativePath}`,
  );
  const content = bytes.toString("utf8");
  const parsed = parseArtifactFrontmatter(content, entry.artifactVersion);
  return {
    agentId: entry.agentId,
    content,
    artifactVersion: parsed.artifactVersion,
    artifactDigest,
    artifactDigestAlgorithm: "sha256",
    gitRev: entry.gitRev,
    path: entry.path,
    fixtureRelativePath: entry.fixtureRelativePath,
    guardrails: parsed.guardrails,
    successCriteria: parsed.successCriteria,
    checks: parsed.checks,
    source: "committed-fixture",
  };
}

/**
 * Dev-time / CI: prove the committed fixture still matches git history at the
 * pinned SHA. Not used as the production load path.
 */
export function verifyHistoricalFixtureAgainstGit(artifactVersion, options = {}) {
  const entry = HISTORICAL_ARTIFACT_REGISTRY[artifactVersion];
  if (!entry) {
    refuse(`No historical artifact registered for ${artifactVersion}`);
  }
  const fixture = loadHistoricalArtifact(artifactVersion);
  const fromGit = gitShowBytes(entry.gitRev, entry.path, options);
  const gitDigest = assertDeclaredDigest(
    fromGit,
    entry.declaredDigest,
    `${entry.artifactVersion} git ${entry.gitRev}:${entry.path}`,
  );
  if (fixture.content !== fromGit.toString("utf8")) {
    refuse(
      `Historical fixture ${artifactVersion} bytes differ from git ${entry.gitRev}:${entry.path} despite matching digests — refuse`,
    );
  }
  return {
    artifactVersion,
    artifactDigest: gitDigest,
    gitRev: entry.gitRev,
    source: "git-verified-fixture",
  };
}
