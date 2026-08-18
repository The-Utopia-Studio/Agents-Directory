// The preview path and the scorer path must resolve the SAME artifact and the
// SAME check set, for every agent.
//
// This asymmetry has now caused two defects:
//   1. the preview ran no checks at all, so it was strictly less informative
//      than runMechanicalScore on identical bytes;
//   2. the preview went straight to the historical registry, so A10 — which has
//      no registry entry — could never be previewed, while runMechanicalScore
//      worked on the same agent via its live-runtime fallback.
//
// Both were a second implementation that was less capable than the first. There
// is now one resolver; this asserts nothing has grown a second one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  resolveScoringArtifact,
  resolveDeclaredChecks,
} from "../src/eval/scoringArtifact.js";
import { HISTORICAL_ARTIFACT_REGISTRY } from "../src/eval/historicalArtifacts.js";
import { getRuntimeArtifactDescriptor } from "../src/invoke/runtimeArtifacts.js";

const AGENTS = ["A7", "A10"];

function sourceOf(rel) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("both paths resolve through the one shared resolver", () => {
  const runCompare = sourceOf("../src/eval/runCompare.js");
  const preview = sourceOf("../src/eval/previewCandidate.js");
  for (const [label, src] of [["runCompare", runCompare], ["previewCandidate", preview]]) {
    assert.match(src, /resolveScoringArtifact/, `${label} must use the shared resolver`);
  }
  // runCompare's scoring resolver must DELEGATE, not re-implement. Its compare
  // paths still load registered versions directly, which is correct: comparing
  // two historical versions legitimately requires both to be registered. The
  // asymmetry that caused both defects was in resolving the artifact that
  // SCORES an output, and that has one implementation.
  assert.match(
    runCompare,
    /function loadScoringArtifact\(agentId, artifactVersion\) \{\s*return resolveScoringArtifact\(agentId, artifactVersion\);\s*\}/,
    "loadScoringArtifact must delegate to the shared resolver, not re-implement it",
  );
  // The preview must never reach past the resolver to the registry loader —
  // that bypass is exactly what made A10 unpreviewable.
  const previewCode = preview.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(
    previewCode,
    /\bloadHistoricalArtifact\s*\(/,
    "previewCandidate must not call loadHistoricalArtifact directly",
  );
});

test("live version resolves identically for every agent with a runtime artifact", () => {
  for (const agentId of AGENTS) {
    const live = getRuntimeArtifactDescriptor(agentId);
    assert.ok(live, `${agentId} must have a runtime artifact`);
    const byName = resolveScoringArtifact(agentId, live.artifactVersion);
    const byLive = resolveScoringArtifact(agentId, "live");
    const byDefault = resolveScoringArtifact(agentId, undefined);
    assert.equal(byName.artifactDigest, live.artifactDigest);
    assert.equal(byLive.artifactDigest, live.artifactDigest);
    assert.equal(byDefault.artifactDigest, live.artifactDigest);
    assert.deepEqual([...byName.checks].sort(), [...byLive.checks].sort());
    assert.deepEqual([...byName.checks].sort(), [...byDefault.checks].sort());
    assert.ok(byName.checks.length >= 5, `${agentId} must declare a real check set`);
  }
});

test("every registered version resolves for its own agent, and only for it", () => {
  for (const entry of Object.values(HISTORICAL_ARTIFACT_REGISTRY)) {
    const resolved = resolveScoringArtifact(entry.agentId, entry.artifactVersion);
    assert.equal(resolved.artifactDigest, entry.declaredDigest);
    assert.equal(resolved.source, "historical-fixture");
    assert.ok(resolved.checks.length > 0, `${entry.artifactVersion} must declare checks`);
  }
});

test("A10 resolves its candidate the same way A7 does — the defect this closes", () => {
  // Before the shared resolver, this threw PREVIEW_FIXTURE_UNAVAILABLE for A10
  // while the identical call for A7 succeeded.
  const a7 = resolveScoringArtifact("A7", "biocraft-singleshot-v10");
  const a10 = resolveScoringArtifact("A10", "biocraft-gapfill-v4");
  for (const [agentId, r] of [["A7", a7], ["A10", a10]]) {
    assert.equal(r.source, "historical-fixture", `${agentId} must resolve from a sealed fixture`);
    assert.match(r.artifactDigest, /^[a-f0-9]{64}$/);
    assert.ok(r.checks.length >= 5);
  }
  // Same check vocabulary on both — the gap-fill agent reuses A7's checks.
  assert.deepEqual([...a7.checks].sort(), [...a10.checks].sort());
});

test("declared checks are identical whichever helper asks", () => {
  for (const agentId of AGENTS) {
    const live = getRuntimeArtifactDescriptor(agentId);
    assert.deepEqual(
      resolveDeclaredChecks(agentId, live.artifactVersion).sort(),
      [...resolveScoringArtifact(agentId, live.artifactVersion).checks].sort(),
    );
  }
});

test("an unknown version refuses rather than silently falling back to live", () => {
  for (const agentId of AGENTS) {
    assert.throws(
      () => resolveScoringArtifact(agentId, "biocraft-singleshot-v999"),
      /No scoring artifact/,
      `${agentId} must not substitute live bytes for a version that does not exist`,
    );
  }
});

test("every agent with a runtime artifact has its live version sealed", () => {
  // The condition the fixture-integrity escapes used to hide.
  for (const agentId of AGENTS) {
    const live = getRuntimeArtifactDescriptor(agentId);
    assert.ok(
      HISTORICAL_ARTIFACT_REGISTRY[live.artifactVersion],
      `${agentId} live version ${live.artifactVersion} is not sealed in the registry`,
    );
  }
});
