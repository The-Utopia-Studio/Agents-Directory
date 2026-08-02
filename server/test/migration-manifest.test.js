import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanonicalImportManifest,
  buildExecutableImportPlan,
} from "../src/migration/manifest.js";
import { writeDryRunManifest } from "../src/scripts/buildMigrationManifest.js";

const A7_DIGEST =
  "991cadea10401307215254098644342ccb551f7f498eb64994e328eafdf0b6f9";
const A8_COMMIT = "2a8f2b9562c4d4569c156e2ae7559ab04a54b883";

function row(collection, source, sourceId, data = {}) {
  const prefix = source === "browser-localStorage" ? "browser" : "service";
  return {
    source,
    sourceId,
    sourcePath: `${prefix}.${collection}.${sourceId}`,
    data,
    readiness: { status: "blocked", reasons: [] },
  };
}

function fixture() {
  const agents = [];
  const versions = [];
  for (let number = 1; number <= 8; number += 1) {
    const id = `A${number}`;
    agents.push(row("agents", "browser-localStorage", id, { id }));
    agents.push(row("agents", "railway-file-store", id, { id }));
    versions.push(
      row(
        "versions",
        "browser-localStorage",
        `browser.agents[${number - 1}].changelog[0]`,
        { agentId: id, legacyShape: "agent.changelog" },
      ),
      row(
        "versions",
        "railway-file-store",
        `service.agents[${number - 1}].changelog[0]`,
        { agentId: id, legacyShape: "agent.changelog" },
      ),
    );
  }
  versions.push(
    row(
      "versions",
      "railway-artifact-registry",
      "service.artifactReferences[0]",
      {
        agentId: "A7",
        version: "biocraft-singleshot-v4",
        legacyShape: "artifact-reference-without-version-row",
        artifact: {
          scheme: "git",
          locator: "server/src/artifacts/biocraft/SKILL.md",
          declaredDigest: A7_DIGEST,
          declaredDigestAlgorithm: "sha256",
        },
      },
    ),
    row(
      "versions",
      "railway-artifact-registry",
      "service.artifactReferences[1]",
      {
        agentId: "A8",
        version: "0.1.0",
        legacyShape: "artifact-reference-without-version-row",
        pinnedCommitSha: A8_COMMIT,
        artifact: {
          scheme: "git",
          locator: `https://github.com/example/agent/tree/${A8_COMMIT}`,
        },
      },
    ),
  );

  return {
    schemaVersion: "agents-directory-phase2-export-v1",
    generatedAt: "2026-08-02T18:15:15.294Z",
    sources: {},
    records: {
      agents,
      versions,
      evals: Array.from({ length: 9 }, (_, index) =>
        row(
          "evals",
          index < 5 ? "browser-localStorage" : "railway-file-store",
          `eval-${index + 1}`,
          { notes: `PRIVATE_EVAL_TEXT_${index}` },
        ),
      ),
      proposals: [],
      reviewHistory: [],
      requests: Array.from({ length: 5 }, (_, index) =>
        row("requests", "browser-localStorage", `R${index + 1}`, {
          desc: `PRIVATE_REQUEST_TEXT_${index}`,
        }),
      ),
      evidence: [
        row("evidence", "railway-file-store", "trace-1", {
          evidenceKind: "run",
          output: "PRIVATE_RAW_OUTPUT",
        }),
        row("evidence", "railway-file-store", "trace-2", {
          evidenceKind: "run",
          input: "PRIVATE_RAW_INPUT",
        }),
        row("evidence", "railway-file-store", "feedback-1", {
          evidenceKind: "feedback",
          notes: "PRIVATE_FEEDBACK_TEXT",
        }),
      ],
    },
    redactions: [],
  };
}

function manifestFor(source = fixture()) {
  return buildCanonicalImportManifest(source, {
    generatedAt: "2026-08-02T19:00:00.000Z",
    sourceFilename: "phase2-export.json",
    sourceFileSha256: "a".repeat(64),
  });
}

test("dry-run does not mutate its source and emits no executable records", () => {
  const source = fixture();
  const before = structuredClone(source);
  const manifest = manifestFor(source);

  assert.deepEqual(source, before);
  assert.equal(manifest.mode, "dry-run-only");
  assert.equal(manifest.executable, false);
  assert.equal(manifest.policy.convexMutations, false);
  assert.equal(manifest.policy.railwayWrites, false);
  assert.equal(manifest.policy.localStorageWrites, false);
  assert.equal(manifest.policy.sourceWrites, false);
  assert.ok(manifest.records.every((record) => record.executable === false));
  assert.equal(manifest.summary.actionCounts.import, 0);
});

test("manifest never serializes payloads, feedback text, or source prose", () => {
  const encoded = JSON.stringify(manifestFor());
  assert.doesNotMatch(
    encoded,
    /PRIVATE_RAW_OUTPUT|PRIVATE_RAW_INPUT|PRIVATE_FEEDBACK_TEXT|PRIVATE_EVAL_TEXT|PRIVATE_REQUEST_TEXT/,
  );
  assert.equal(manifestFor().sourceExport.embeddedSourceRecords, false);
});

test("requires-human-decision records cannot become an executable plan", () => {
  const manifest = manifestFor();
  assert.ok(
    manifest.records.some(
      (record) => record.action === "requires-human-decision",
    ),
  );
  assert.throws(
    () => buildExecutableImportPlan(manifest),
    (error) =>
      error.code === "HUMAN_DECISION_REQUIRED" &&
      /require human decision/.test(error.message),
  );
});

test("A7 content digest stays distinct from A8 pinned Git commit", () => {
  const manifest = manifestFor();
  const a7 = manifest.records.find(
    (record) =>
      record.recordType === "artifact-version-candidate" &&
      record.sourceRef.sourceId === "service.artifactReferences[0]",
  );
  const a8 = manifest.records.find(
    (record) =>
      record.recordType === "artifact-version-candidate" &&
      record.sourceRef.sourceId === "service.artifactReferences[1]",
  );

  assert.equal(a7.artifactIdentity.status, "real-content-digest");
  assert.equal(a7.artifactIdentity.declaredDigest, A7_DIGEST);
  assert.equal(a7.artifactIdentity.declaredDigestAlgorithm, "sha256");
  assert.equal(a7.artifactIdentity.pinnedGitCommitSha, null);

  assert.equal(
    a8.artifactIdentity.status,
    "pinned-git-commit-not-content-digest",
  );
  assert.equal(a8.artifactIdentity.pinnedGitCommitSha, A8_COMMIT);
  assert.equal(a8.artifactIdentity.declaredDigest, null);
  assert.notEqual(A7_DIGEST, A8_COMMIT);
});

test("default decisions match the approved Phase 2.5A policy", () => {
  const manifest = manifestFor();
  assert.deepEqual(manifest.summary.actionCounts, {
    import: 0,
    exclude: 33,
    "requires-human-decision": 18,
  });
  assert.equal(manifest.summary.totalRecords, 51);
  assert.equal(manifest.summary.typeCounts.agent, 16);
  assert.equal(manifest.summary.typeCounts["legacy-changelog-version"], 16);
  assert.equal(manifest.summary.typeCounts["artifact-version-candidate"], 2);
  assert.equal(manifest.summary.typeCounts["legacy-eval"], 9);
  assert.equal(manifest.summary.typeCounts["legacy-request"], 5);
  assert.equal(manifest.summary.typeCounts["legacy-trace"], 2);
  assert.equal(manifest.summary.typeCounts["legacy-feedback"], 1);

  const browserAgents = manifest.records.filter(
    (record) =>
      record.recordType === "agent" &&
      record.sourceRef.source === "browser-localStorage",
  );
  assert.equal(browserAgents.length, 8);
  assert.ok(
    browserAgents.every(
      (record) =>
        record.action === "requires-human-decision" &&
        record.recommendedAction === "import" &&
        record.proposedCanonicalSource === "browser-localStorage",
    ),
  );
  assert.ok(
    manifest.records
      .filter((record) => record.recordType === "legacy-eval")
      .every((record) => record.action === "exclude"),
  );
  assert.ok(
    manifest.records
      .filter((record) => record.recordType === "legacy-request")
      .every(
        (record) =>
          record.action === "exclude" &&
          record.provenance.authenticatedApproverMustSupplyOrAttest,
      ),
  );
});

test("file writer changes only the ignored manifest output, not its source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adir-manifest-source-"));
  const inputPath = join(dir, "phase2-export.json");
  const inputBytes = `${JSON.stringify(fixture(), null, 2)}\n`;
  await writeFile(inputPath, inputBytes, "utf8");

  const outputPath = fileURLToPath(
    new URL(
      `../../migration-output/.test-manifest-${process.pid}.json`,
      import.meta.url,
    ),
  );
  try {
    const { manifest } = await writeDryRunManifest({
      inputPath,
      outputPath,
      generatedAt: "2026-08-02T19:00:00.000Z",
    });
    assert.equal(await readFile(inputPath, "utf8"), inputBytes);
    assert.equal(
      JSON.parse(await readFile(outputPath, "utf8")).schemaVersion,
      manifest.schemaVersion,
    );
    assert.equal(manifest.executable, false);
  } finally {
    await unlink(outputPath).catch(() => {});
  }
});
