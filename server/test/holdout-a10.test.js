import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { createLoopService } from "../src/core/loopService.js";
import { createLocalObservability } from "../src/observability/localAdapter.js";
import { getOptimizer } from "../src/improve/index.js";
import { getMemory } from "../src/memory/index.js";
import { seed } from "../src/scripts/seed.js";
import {
  A7_JONAS_PARK_V1,
  A10_PRIYA_VENKAT_V1,
} from "../src/eval/goldenCases.js";
import { assertNoSealedGoldenCasesForMaker } from "../src/eval/holdout.js";
import { createHeuristicOptimizer } from "../src/improve/heuristicOptimizer.js";
import { scoreGoldenCannedAgainstLive } from "../src/eval/scoreGoldenCase.js";
import { MECHANICAL_RESULTS_COLLECTION } from "../src/eval/mechanicalResults.js";
import { declaredClicheCheckId, liveArtifact } from "./artifactContract.js";
const LIVE_A7 = liveArtifact("A7");
const CLICHE_ID = declaredClicheCheckId("A7");

function loopConfig() {
  return {
    observability: { lowScoreThreshold: 70, feedbackNotes: true, feedbackNotesMaxChars: 2000 },
    optimizer: { provider: "heuristic" },
    memory: { provider: "local", topK: 5 },
    loop: {},
  };
}

async function service() {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-holdout-")));
  await seed(store);
  const config = loopConfig();
  const svc = createLoopService({
    store,
    obs: createLocalObservability({ store, lowScoreThreshold: 70 }),
    optimizer: getOptimizer(config),
    memory: getMemory(config, { store }),
    verifier: null,
    config,
  });
  return { store, svc };
}

test("sealed golden cases cannot reach the maker", async () => {
  const optimizer = createHeuristicOptimizer();
  await assert.rejects(
    () =>
      optimizer.propose(
        { id: "A7", guardrails: [] },
        {
          defectSignals: ["about_hook_max_200_characters"],
          goldenCases: [A7_JONAS_PARK_V1],
          artifact: { available: true, text: "# x\n", checks: [] },
        },
      ),
    (error) => {
      assert.equal(error.status, 422);
      assert.match(error.message, /Sealed golden cases cannot reach the maker/);
      assert.match(error.message, /a7-jonas-park-v1/);
      return true;
    },
  );

  assert.throws(
    () =>
      assertNoSealedGoldenCasesForMaker({
        mechanicalResults: [
          {
            goldenCaseId: A10_PRIYA_VENKAT_V1.id,
            sealed: true,
            outputSource: "live",
            failed: ["about_has_no_delimiter_separated_keyword_run"],
          },
        ],
      }),
    /a10-priya-venkat-v1/,
  );

  const { store, svc } = await service();
  const agent = await store.get("agents", "A7");
  await store.append(MECHANICAL_RESULTS_COLLECTION, {
    agentId: "A7",
    goldenCaseId: A7_JONAS_PARK_V1.id,
    sealed: true,
    outputSource: "live",
    failed: ["about_hook_max_200_characters"],
    timestamp: new Date().toISOString(),
  });
  const evidence = await svc.collectImprovementEvidence("A7", agent);
  assert.equal(
    evidence.defectSignals.includes("mechanical:about_hook_max_200_characters"),
    false,
    "sealed live mechanical failures must not become maker defect signals",
  );
});

test("A10 mechanicalScore succeeds against the live checks: block", async () => {
  const { svc } = await service();
  const result = await svc.mechanicalScore("A10", {
    caseId: "a10-mira-okonkwo-v1",
    outputSource: "canned",
  });
  assert.equal(result.ok, true);
  assert.equal(result.verification, "ok");
  assert.equal(result.agentId, "A10");
  assert.equal(result.caseId, "a10-mira-okonkwo-v1");
  assert.equal(result.sealed, false);
  assert.equal(result.holdout, "unsealed");
  assert.equal(result.artifactVersion, liveArtifact("A10").artifactVersion);
  assert.ok(Array.isArray(result.declaredChecks) && result.declaredChecks.length > 0);
  // Named for what it measures; the old ambiguous key is no longer written.
  assert.equal(typeof result.groundingPassRate, "number");
  assert.equal(typeof result.groundingScoreableCount, "number");
  assert.ok(Array.isArray(result.groundingBasisCheckIds));
  assert.equal(result.mechanicalCheckScore, undefined);
  assert.notEqual(result.averaged, true);

  await assert.rejects(
    () => svc.mechanicalScore("A1", { outputSource: "canned" }),
    (error) => {
      assert.equal(error.status, 400);
      assert.match(error.message, /missing a runtime artifact/);
      return true;
    },
  );
});

test("sealed holdout pair exercises scored length and delimiter checks", () => {
  const jonas = scoreGoldenCannedAgainstLive("a7-jonas-park-v1");
  assert.equal(A7_JONAS_PARK_V1.sealed, true);
  assert.ok(jonas.failed.includes("about_hook_max_200_characters"));

  const priya = scoreGoldenCannedAgainstLive("a10-priya-venkat-v1");
  assert.equal(A10_PRIYA_VENKAT_V1.sealed, true);
  assert.ok(priya.failed.includes("about_has_no_delimiter_separated_keyword_run"));
});
