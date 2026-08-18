// Structural guard on the historical record.
//
// The v9 fixture was silently redefined: an edit to the live SKILL.md was
// copied into eval-artifacts/biocraft/biocraft-singleshot-v9/, so every
// "historical" comparison against v9 ran against bytes v9 never had. Nothing
// failed. The drift was only visible weeks later when a digest was checked by
// hand.
//
// A released version's bytes are immutable. This asserts that directly, for
// every registered version, in the normal suite — so the next time a live edit
// leaks into a sealed fixture the suite goes red on that commit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HISTORICAL_ARTIFACT_REGISTRY,
  listHistoricalArtifactVersions,
} from "../src/eval/historicalArtifacts.js";
import { getRuntimeArtifactDescriptor } from "../src/invoke/runtimeArtifacts.js";

const FIXTURES_ROOT = new URL("../src/eval-artifacts/", import.meta.url);

function sha256File(url) {
  return createHash("sha256").update(readFileSync(fileURLToPath(url))).digest("hex");
}

test("every registered version's fixture hashes to its sealed digest", () => {
  const entries = Object.values(HISTORICAL_ARTIFACT_REGISTRY);
  assert.ok(entries.length > 0, "registry must not be empty");

  const drift = [];
  for (const entry of entries) {
    const url = new URL(entry.fixtureRelativePath, FIXTURES_ROOT);
    if (!existsSync(fileURLToPath(url))) {
      drift.push(`${entry.artifactVersion}: fixture missing at ${entry.fixtureRelativePath}`);
      continue;
    }
    const actual = sha256File(url);
    if (actual !== entry.declaredDigest) {
      drift.push(
        `${entry.artifactVersion}: fixture hashes ${actual.slice(0, 12)} but the ` +
          `registry seals ${entry.declaredDigest.slice(0, 12)}`,
      );
    }
  }
  assert.deepEqual(
    drift,
    [],
    "a sealed fixture no longer matches its declared digest — a released " +
      "version's bytes were redefined:\n  " + drift.join("\n  "),
  );
});

test("a fixture's own frontmatter names the version it is filed under", () => {
  // Catches the other half of the same failure: bytes copied into the wrong
  // version directory still hash consistently, but claim to be something else.
  const mismatched = [];
  for (const entry of Object.values(HISTORICAL_ARTIFACT_REGISTRY)) {
    const url = new URL(entry.fixtureRelativePath, FIXTURES_ROOT);
    if (!existsSync(fileURLToPath(url))) continue;
    const text = readFileSync(fileURLToPath(url), "utf8");
    const declared = text.match(/^artifact_version:\s*([A-Za-z0-9._-]+)\s*$/m)?.[1];
    if (declared !== entry.artifactVersion) {
      mismatched.push(
        `${entry.fixtureRelativePath} declares artifact_version ${declared} ` +
          `but is filed as ${entry.artifactVersion}`,
      );
    }
  }
  assert.deepEqual(mismatched, []);
});

test("the live artifact matches the fixture of the version it claims to be", () => {
  // The incumbent pin. If someone edits the live SKILL.md without releasing,
  // this fails here rather than at a 409 in production.
  for (const agentId of ["A7", "A10"]) {
    const live = getRuntimeArtifactDescriptor(agentId);
    assert.ok(live, `${agentId} must have a runtime artifact`);
    const entry = HISTORICAL_ARTIFACT_REGISTRY[live.artifactVersion];
    // No escape. Every agent with a runtime artifact must have its live version
    // sealed — the escape previously covered A10 entirely, so gap-fill bytes
    // could drift with nothing failing.
    assert.ok(
      entry,
      `${agentId} live version ${live.artifactVersion} has no registry entry sealing it`,
    );
    assert.equal(
      live.artifactDigest,
      entry.declaredDigest,
      `${agentId} live bytes (${live.artifactVersion}) drifted from the sealed fixture`,
    );
  }
});

test("the live artifact's frontmatter names its own digest's version", () => {
  // The version string lives inside the digested bytes, so a file claiming one
  // version while hashing to another's digest would make the descriptor and
  // Convex disagree forever. Asserted as self-consistency against the registry
  // rather than against a hardcoded version: which version is live is a
  // deployment fact, and pinning it here would fail on every legitimate release.
  for (const agentId of ["A7", "A10"]) {
    const live = getRuntimeArtifactDescriptor(agentId);
    const entry = HISTORICAL_ARTIFACT_REGISTRY[live.artifactVersion];
    assert.ok(
      entry,
      `${agentId} live version ${live.artifactVersion} has no registry entry sealing it`,
    );
    assert.equal(
      live.artifactDigest,
      entry.declaredDigest,
      `${agentId} declares ${live.artifactVersion} but its bytes hash to something else`,
    );
    const text = readFileSync(fileURLToPath(new URL(entry.fixtureRelativePath, FIXTURES_ROOT)), "utf8");
    assert.match(text, new RegExp(`^artifact_version: ${live.artifactVersion}$`, "m"));
  }
});

test("no fixture directory exists without a registry entry sealing it", () => {
  // An unsealed fixture is bytes nothing verifies — the state v9 was in.
  const orphans = [];
  const sealed = new Set(
    Object.values(HISTORICAL_ARTIFACT_REGISTRY).map((e) => e.fixtureRelativePath),
  );
  // Every agent directory, not just biocraft/ — scanning one agent is how an
  // unsealed gapfill fixture would have gone unnoticed.
  const agentDirs = readdirSync(fileURLToPath(FIXTURES_ROOT), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "golden")
    .map((d) => d.name);
  const versionDirs = agentDirs.flatMap((agent) =>
    readdirSync(fileURLToPath(new URL(`${agent}/`, FIXTURES_ROOT)), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ agent, name: d.name })),
  );
  for (const dir of versionDirs) {
    const rel = `${dir.agent}/${dir.name}/SKILL.md`;
    if (!existsSync(fileURLToPath(new URL(rel, FIXTURES_ROOT)))) continue;
    if (!sealed.has(rel)) orphans.push(rel);
  }
  assert.deepEqual(
    orphans,
    [],
    `fixture(s) present with no registry entry sealing their digest: ${orphans.join(", ")}`,
  );
});

test("every registered A7 version is distinct — no two share bytes", () => {
  const byDigest = new Map();
  for (const row of listHistoricalArtifactVersions("A7")) {
    const entry = HISTORICAL_ARTIFACT_REGISTRY[row.artifactVersion];
    const seen = byDigest.get(entry.declaredDigest);
    assert.equal(
      seen,
      undefined,
      `${row.artifactVersion} and ${seen} declare the same digest — one of them is mislabelled`,
    );
    byDigest.set(entry.declaredDigest, row.artifactVersion);
  }
  assert.ok(byDigest.size >= 5);
});
