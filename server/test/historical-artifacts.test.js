import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HISTORICAL_ARTIFACT_REGISTRY,
  assertDeclaredDigest,
  gitShowBytes,
  listHistoricalArtifactVersions,
  loadHistoricalArtifact,
  verifyHistoricalFixtureAgainstGit,
} from "../src/eval/historicalArtifacts.js";
import { getRuntimeArtifactDescriptor } from "../src/invoke/runtimeArtifacts.js";

const V5 = "biocraft-singleshot-v5";
const V6 = "biocraft-singleshot-v6";
const V7 = "biocraft-singleshot-v7";
const V9 = "biocraft-singleshot-v9";
const V10 = "biocraft-singleshot-v10";
const V10_DIGEST =
  "c1028caa64ef7965ff2ee052f3ac300509ea47e19346ab6c42aa9075aaacd7c1";
const V9_DIGEST =
  "e229c64f44bcf3b6e8f57ea7dc74c868b7987ddfc7f92379ad4723761fa4314e";
const V5_DIGEST =
  "c5cc1a587a10deb6fb1b2ee73fed0c31fcad96fa12ed58bc5907544e408df92b";
const V6_DIGEST =
  "a8c08f4e98cd88f018764754eda760a20113e6fcf8a3362a192254b6bca81a10";
const V7_DIGEST =
  "751912f479d4ca65144e927bb18fe6e6c66c34ab63be557cab24ad28bc77fa26";

test("registry pins full SHAs and declared digests; fixtures are under src/", () => {
  assert.equal(HISTORICAL_ARTIFACT_REGISTRY[V5].declaredDigest, V5_DIGEST);
  assert.equal(HISTORICAL_ARTIFACT_REGISTRY[V6].declaredDigest, V6_DIGEST);
  assert.equal(HISTORICAL_ARTIFACT_REGISTRY[V7].declaredDigest, V7_DIGEST);
  assert.equal(HISTORICAL_ARTIFACT_REGISTRY[V9].declaredDigest, V9_DIGEST);
  assert.match(HISTORICAL_ARTIFACT_REGISTRY[V5].gitRev, /^[a-f0-9]{40}$/);
  assert.match(
    HISTORICAL_ARTIFACT_REGISTRY[V5].fixtureRelativePath,
    /^biocraft\//,
  );
});

test("loadHistoricalArtifact reads committed fixtures and verifies digests", () => {
  const v5 = loadHistoricalArtifact(V5);
  assert.equal(v5.source, "committed-fixture");
  assert.equal(v5.artifactVersion, V5);
  assert.equal(v5.artifactDigest, V5_DIGEST);
  assert.ok(
    v5.checks.includes(
      "generated_sections_have_no_delimiter_separated_keyword_run",
    ),
  );

  const v6 = loadHistoricalArtifact(V6);
  assert.equal(v6.artifactDigest, V6_DIGEST);
  assert.ok(v6.checks.includes("draft_has_no_em_dash"));
  assert.ok(v6.checks.includes("draft_has_no_ai_cliche_phrase"));
  assert.notEqual(v5.artifactDigest, v6.artifactDigest);

  const v7 = loadHistoricalArtifact(V7);
  assert.equal(v7.artifactDigest, V7_DIGEST);
  assert.ok(v7.checks.includes("about_max_2600_characters"));
  assert.ok(v7.checks.includes("headline_max_220_characters"));
  assert.match(v7.content, /Compare every\s+company relationship and role title/);
  assert.notEqual(v6.artifactDigest, v7.artifactDigest);

  // v9 is now history: its fixture holds the bytes Convex approved, which are
  // NOT the working tree. Editing the live file cannot redefine what v9 was.
  const v9 = loadHistoricalArtifact(V9);
  assert.equal(v9.artifactDigest, V9_DIGEST);
  assert.equal(v9.artifactVersion, V9);

  // v10 is the live incumbent: its fixture must match the working tree byte
  // for byte, because that is the artifact the runtime actually executes.
  const v10 = loadHistoricalArtifact(V10);
  assert.equal(v10.artifactDigest, V10_DIGEST);
  assert.equal(v10.artifactVersion, V10);
  // The live artifact must match the fixture of whatever version it declares —
  // v9 before the v10 release lands, v10 after. Pinning it to v10 here would
  // fail for the entire period the release is staged but not yet approved.
  const liveBytes = readFileSync(
    fileURLToPath(new URL("../src/artifacts/biocraft/SKILL.md", import.meta.url)),
  );
  const liveDigest = createHash("sha256").update(liveBytes).digest("hex");
  const live = getRuntimeArtifactDescriptor("A7");
  assert.equal(liveDigest, HISTORICAL_ARTIFACT_REGISTRY[live.artifactVersion].declaredDigest);
  assert.ok([V9_DIGEST, V10_DIGEST].includes(liveDigest));
  assert.notEqual(V9_DIGEST, V10_DIGEST);
});

test("fixture bytes on disk match declared digests", () => {
  for (const version of [V5, V6, V7, V9]) {
    const entry = HISTORICAL_ARTIFACT_REGISTRY[version];
    const path = fileURLToPath(
      new URL(
        `../src/eval-artifacts/${entry.fixtureRelativePath}`,
        import.meta.url,
      ),
    );
    const digest = createHash("sha256")
      .update(readFileSync(path))
      .digest("hex");
    assert.equal(digest, entry.declaredDigest);
  }
});

test("digest mismatch refuses loudly", () => {
  const v6 = loadHistoricalArtifact(V6);
  assert.throws(
    () =>
      assertDeclaredDigest(
        Buffer.from(v6.content),
        V5_DIGEST,
        "forged-v5-claim",
      ),
    (error) => {
      assert.equal(error.status, 500);
      assert.match(error.message, /digest mismatch/);
      return true;
    },
  );
});

test("unknown version refuses", () => {
  assert.throws(
    () => loadHistoricalArtifact("biocraft-singleshot-v99"),
    (error) => {
      assert.match(error.message, /No historical artifact registered/);
      return true;
    },
  );
});

test("dev-time git verification matches committed fixtures", () => {
  const verified = verifyHistoricalFixtureAgainstGit(V5);
  assert.equal(verified.artifactDigest, V5_DIGEST);
  assert.equal(verified.source, "git-verified-fixture");
  // gitShowBytes still available for verification tooling
  const bytes = gitShowBytes(
    HISTORICAL_ARTIFACT_REGISTRY[V5].gitRev,
    HISTORICAL_ARTIFACT_REGISTRY[V5].path,
  );
  assert.equal(createHash("sha256").update(bytes).digest("hex"), V5_DIGEST);
});

test("listHistoricalArtifactVersions scopes to A7", () => {
  assert.deepEqual(
    listHistoricalArtifactVersions("A7")
      .map((row) => row.artifactVersion)
      .sort(),
    [V5, V6, V7, V9, V10].sort(),
  );
  assert.equal(listHistoricalArtifactVersions("A8").length, 0);
});
