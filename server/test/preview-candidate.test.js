// The preview path: how a candidate gets witnessed without serving fellows.
//
// The deadlock it breaks: witnessing production bytes cannot attest a
// candidate, because serving candidate bytes makes the served digest disagree
// with the approved one, which 409s the run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PreviewRefusal,
  assertFixtureMatchesCandidate,
} from "../src/eval/previewCandidate.js";
import { HISTORICAL_ARTIFACT_REGISTRY } from "../src/eval/historicalArtifacts.js";
import { getRuntimeArtifactDescriptor, snapshotArtifact } from "../src/invoke/runtimeArtifacts.js";

const V10 = "biocraft-singleshot-v10";
const V10_DIGEST = HISTORICAL_ARTIFACT_REGISTRY[V10].declaredDigest;

test("the fixture root is not the served root — fellows cannot reach a fixture", () => {
  // snapshotArtifact realpath-confines itself to server/src/artifacts/. Handing
  // it a fixture directory returns null rather than serving it.
  const fixtureDir = new URL("../src/eval-artifacts/biocraft/biocraft-singleshot-v10/", import.meta.url);
  assert.equal(snapshotArtifact(fixtureDir, "SKILL.md"), null,
    "the fellow-facing loader must refuse a path outside the artifact root");

  // And the two roots genuinely differ on disk.
  const served = fileURLToPath(new URL("../src/artifacts/", import.meta.url));
  const fixtures = fileURLToPath(new URL("../src/eval-artifacts/", import.meta.url));
  assert.notEqual(served, fixtures);
  assert.ok(!fixtures.startsWith(served));
});

test("run-time digest equality is checked, not assumed from CI", () => {
  // Matching fixture and candidate digests pass.
  assert.equal(
    assertFixtureMatchesCandidate({
      artifactVersion: V10,
      fixtureDigest: V10_DIGEST,
      candidateDeclaredDigest: V10_DIGEST,
    }),
    V10_DIGEST,
  );

  // A candidate declaring different bytes refuses BY NAME. This is the case CI
  // cannot catch: Convex and the registry are separate records.
  assert.throws(
    () =>
      assertFixtureMatchesCandidate({
        artifactVersion: V10,
        fixtureDigest: V10_DIGEST,
        candidateDeclaredDigest: "a".repeat(64),
      }),
    (error) => {
      assert.ok(error instanceof PreviewRefusal);
      assert.equal(error.code, "PREVIEW_FIXTURE_DIGEST_MISMATCH");
      assert.match(error.message, /attest output the candidate never produces/);
      return true;
    },
  );
});

test("a missing digest on either side refuses rather than skipping the check", () => {
  assert.throws(
    () => assertFixtureMatchesCandidate({ artifactVersion: V10, fixtureDigest: "", candidateDeclaredDigest: V10_DIGEST }),
    (e) => e.code === "PREVIEW_FIXTURE_DIGEST_MISSING",
  );
  assert.throws(
    () => assertFixtureMatchesCandidate({ artifactVersion: V10, fixtureDigest: V10_DIGEST, candidateDeclaredDigest: "" }),
    (e) => e.code === "PREVIEW_CANDIDATE_DIGEST_MISSING",
  );
  // A blank candidate digest must never be treated as "no opinion".
  assert.throws(
    () => assertFixtureMatchesCandidate({ artifactVersion: V10, fixtureDigest: V10_DIGEST, candidateDeclaredDigest: undefined }),
    (e) => e.code === "PREVIEW_CANDIDATE_DIGEST_MISSING",
  );
});

test("the v10 fixture on disk actually hashes to what the registry declares", () => {
  // The equality the preview relies on, asserted against real bytes.
  const bytes = readFileSync(
    fileURLToPath(new URL("../src/eval-artifacts/biocraft/biocraft-singleshot-v10/SKILL.md", import.meta.url)),
  );
  assert.equal(createHash("sha256").update(bytes).digest("hex"), V10_DIGEST);
});

test("previewing v10 executes different bytes than the live artifact serves", () => {
  // If these were equal there would be no deadlock and no need for a preview.
  const live = getRuntimeArtifactDescriptor("A7");
  assert.notEqual(
    V10_DIGEST,
    HISTORICAL_ARTIFACT_REGISTRY["biocraft-singleshot-v9"].declaredDigest,
    "v9 and v10 must be distinct or the preview proves nothing",
  );
  assert.ok(live.artifactDigest);
});

test("the preview route is absent from the fellow run contract", () => {
  const routes = readFileSync(new URL("../src/http/routes.js", import.meta.url), "utf8");
  assert.match(routes, /preview-candidate/);
  // It is approver-gated, not identity-gated like the fellow run path.
  const idx = routes.indexOf("preview-candidate");
  const block = routes.slice(idx, idx + 260);
  assert.match(block, /requireClerkApprover/);

  // And it is not advertised as a usability mode or invocation capability.
  const svc = readFileSync(new URL("../src/core/loopService.js", import.meta.url), "utf8");
  const capStart = svc.indexOf("getInvocationCapability");
  const capBlock = svc.slice(capStart, capStart + 2000);
  assert.doesNotMatch(capBlock, /preview/i);
});

test("cost is returned for persistence before any human decision", () => {
  const src = readFileSync(new URL("../src/eval/previewCandidate.js", import.meta.url), "utf8");
  assert.match(src, /costUsdFromUsage/);
  // Unpriced models must not fabricate a zero.
  assert.match(src, /never a fabricated zero/);
  assert.match(src, /costAttributable/);

  const svc = readFileSync(new URL("../src/core/loopService.js", import.meta.url), "utf8");
  const start = svc.indexOf("async previewCandidate(");
  const body = svc.slice(start, svc.indexOf("async findProposalByLoopBranch"));
  // The trace write happens before the return, unconditionally.
  assert.match(body, /Unconditional\. The money was spent/);
  assert.match(body, /costUsd/);
  // A failed trace write says the spend is unrecorded rather than passing silently.
  assert.match(body, /is NOT recorded/);
});

test("the preview never writes evidence itself", () => {
  const svc = readFileSync(new URL("../src/core/loopService.js", import.meta.url), "utf8");
  const start = svc.indexOf("async previewCandidate(");
  const body = svc.slice(start, svc.indexOf("async findProposalByLoopBranch"));
  assert.doesNotMatch(body, /recordCandidatePreviewEvidence|recordVerifiedHumanRunEvidence/);
  assert.match(body, /evidenceRecorded: false/);
});

test("a sealed golden case can never be previewed", () => {
  const svc = readFileSync(new URL("../src/core/loopService.js", import.meta.url), "utf8");
  const start = svc.indexOf("async previewCandidate(");
  const body = svc.slice(start, svc.indexOf("async findProposalByLoopBranch"));
  assert.match(body, /sealed === true/);
  assert.match(body, /sealed and cannot be previewed/);
});

test("a golden case belonging to another agent is refused", async () => {
  // getGoldenCase is global. Previewing A7's candidate against A10's fixture
  // would record evidence claiming the candidate was exercised by input it
  // never saw. runMechanicalScore already refuses this; so must the preview.
  const { createLoopService } = await import("../src/core/loopService.js");
  const { createStore } = await import("../src/core/store.js");
  const { config } = await import("../src/config.js");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { seed } = await import("../src/scripts/seed.js");

  const store = createStore(await mkdtemp(join(tmpdir(), "adir-preview-")));
  await seed(store);
  const svc = createLoopService({
    store,
    obs: { recordTrace: async () => ({ id: "t1" }) },
    optimizer: {},
    memory: {},
    verifier: {},
    config,
  });

  await assert.rejects(
    () =>
      svc.previewCandidate("A7", {
        artifactVersion: "biocraft-singleshot-v10",
        candidateDeclaredDigest: "c".repeat(64),
        caseId: "a10-mira-okonkwo-v1",
      }),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /belongs to A10, not A7/);
      return true;
    },
  );
});
