import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { A7_MIRA_OKONKWO_V1 } from "../src/eval/goldenCases.js";
import {
  compareGoldenCannedVersions,
  recordGoldenCannedCompare,
  scoreGoldenCannedAgainstVersion,
} from "../src/eval/scoreGoldenCase.js";
import { createLoopService } from "../src/core/loopService.js";
import { createLocalObservability } from "../src/observability/localAdapter.js";
import { getOptimizer } from "../src/improve/index.js";
import { getMemory } from "../src/memory/index.js";
import { seed } from "../src/scripts/seed.js";

const V5 = "biocraft-singleshot-v5";
const V6 = "biocraft-singleshot-v6";
const CASE = A7_MIRA_OKONKWO_V1.id;

test("canned bad output embeds inflation, downgrade, Intern drop, em dash, cliché, no CTA", () => {
  const out = A7_MIRA_OKONKWO_V1.getCannedBadOutput();
  assert.match(out, /—/);
  assert.match(out, /sits at the intersection of/i);
  assert.match(out, /Dextrum[\s\S]*founded|founded[\s\S]*Dextrum/i);
  assert.match(out, /works at Northline/i);
  assert.doesNotMatch(out, /\bIntern\b/);
  assert.doesNotMatch(out, /open to|reach out|email me|advisory/i);
});

test("v5-vs-v6 mechanical delta on Mira canned output (no paid run)", () => {
  const { left: v5, right: v6, compare } = compareGoldenCannedVersions(
    CASE,
    V5,
    V6,
  );

  // v5 declared set cannot see em dash / cliché — those ids are absent.
  assert.equal(v5.failed.includes("draft_has_no_em_dash"), false);
  assert.equal(v5.failed.includes("draft_has_no_ai_cliche_phrase"), false);
  assert.ok(v5.observations?.includes("about_closing_has_cta"));
  assert.equal(v5.failed.includes("about_closing_has_cta"), false);
  // Historical keyword-run runner is registered and scoreable (option a).
  assert.ok(
    v5.checkResults.some(
      (r) =>
        r.checkId ===
          "generated_sections_have_no_delimiter_separated_keyword_run" &&
        r.status === "pass" &&
        r.historicalImplementation === true,
    ),
  );

  // Source-grounding fails on both versions (same canned output).
  for (const score of [v5, v6]) {
    assert.ok(score.failed.includes("source_preserves_intern_near_helix"));
    assert.ok(score.failed.includes("source_no_founding_verb_near_dextrum"));
    assert.ok(
      score.failed.includes("source_preserves_founding_near_northline"),
    );
    assert.ok(
      score.checkResults.every(
        (r) =>
          !r.checkId.startsWith("source_") || r.family === "source-grounding",
      ),
    );
  }

  // v6 surfaces the style traps v5's declared set missed.
  assert.ok(v6.failed.includes("draft_has_no_em_dash"));
  assert.ok(v6.failed.includes("draft_has_no_ai_cliche_phrase"));
  assert.equal(v6.failed.includes("about_closing_has_cta"), false);
  assert.ok(v6.observations?.includes("about_closing_has_cta"));
  const cta = v6.checkResults.find((c) => c.checkId === "about_closing_has_cta");
  assert.equal(cta.status, "observation");
  assert.equal(cta.passed, null);
  assert.equal(cta.tier, "advisory");

  const em = compare.changed.find((c) => c.checkId === "draft_has_no_em_dash");
  const cliche = compare.changed.find(
    (c) => c.checkId === "draft_has_no_ai_cliche_phrase",
  );
  assert.deepEqual(em, {
    checkId: "draft_has_no_em_dash",
    from: "absent",
    to: "fail",
  });
  assert.deepEqual(cliche, {
    checkId: "draft_has_no_ai_cliche_phrase",
    from: "absent",
    to: "fail",
  });

  // Mechanical check score: v6 fails more declared style checks → lower or
  // equal scoreable pass rate once grounding is shared. Assert the delta story
  // rather than a magic number: v6 has strictly more failed style checks.
  const v5StyleFails = v5.checkResults.filter(
    (r) => r.status === "fail" && r.family !== "source-grounding",
  ).length;
  const v6StyleFails = v6.checkResults.filter(
    (r) => r.status === "fail" && r.family !== "source-grounding",
  ).length;
  assert.ok(
    v6StyleFails > v5StyleFails,
    `expected v6 to surface more style failures than v5 (v5=${v5StyleFails}, v6=${v6StyleFails})`,
  );

  // Print the delta for the human report (node:test captures stdout).
  console.log(
    JSON.stringify(
      {
        label: "mechanical_check_score_delta",
        caseId: CASE,
        v5: {
          artifactVersion: v5.artifactVersion,
          artifactDigest: v5.artifactDigest,
          mechanicalCheckScore: v5.mechanicalCheckScore,
          passed: v5.passed,
          failed: v5.failed,
          notScoreable: v5.notScoreable,
        },
        v6: {
          artifactVersion: v6.artifactVersion,
          artifactDigest: v6.artifactDigest,
          mechanicalCheckScore: v6.mechanicalCheckScore,
          passed: v6.passed,
          failed: v6.failed,
          notScoreable: v6.notScoreable,
        },
        changed: compare.changed,
      },
      null,
      2,
    ),
  );
});

test("historical keyword-run is not silently remapped to About-only id", () => {
  const v5 = scoreGoldenCannedAgainstVersion(CASE, V5);
  assert.equal(
    v5.checkResults.some(
      (r) => r.checkId === "about_has_no_delimiter_separated_keyword_run",
    ),
    false,
  );
  assert.ok(
    v5.checkResults.some(
      (r) =>
        r.checkId ===
        "generated_sections_have_no_delimiter_separated_keyword_run",
    ),
  );
});

test("mechanical results are immutable metadata-only and reach maker evidence", async () => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-mech-")));
  await seed(store);
  const { leftRec, rightRec, left } = await recordGoldenCannedCompare(store, {
    caseId: CASE,
    leftVersion: V5,
    rightVersion: V6,
    agentId: "A7",
  });
  assert.equal(leftRec.artifactDigest, left.artifactDigest);
  assert.equal(leftRec.label, "mechanical_check_score");
  assert.equal("output" in leftRec, false);
  assert.ok(Array.isArray(leftRec.failed));

  await assert.rejects(
    () => store.put("mechanicalResults", { ...leftRec, failed: [] }),
    /immutable/,
  );

  const config = {
    observability: {
      lowScoreThreshold: 70,
      truncateNotes: true,
      feedbackNotesMaxChars: 2000,
    },
    optimizer: { provider: "heuristic" },
    memory: { provider: "local", topK: 5 },
    loop: {},
  };
  const obs = createLocalObservability({ store, lowScoreThreshold: 70 });
  const svc = createLoopService({
    store,
    obs,
    optimizer: getOptimizer(config),
    memory: getMemory(config, { store }),
    verifier: null,
    config,
  });
  const agent = await store.get("agents", "A7");
  const evidence = await svc.collectImprovementEvidence("A7", agent);
  // Canned plumbing rows are excluded from maker signals.
  assert.equal(
    evidence.defectSignals.some((s) => String(s).startsWith("mechanical:")),
    false,
    "canned mechanical failures must not reach the maker",
  );

  // Live rows with the same failures do reach the maker.
  await store.append("mechanicalResults", {
    ...leftRec,
    id: undefined,
    outputSource: "live",
    timestamp: new Date().toISOString(),
  });
  const liveEvidence = await svc.collectImprovementEvidence("A7", agent);
  assert.ok(
    liveEvidence.defectSignals.some((s) =>
      String(s).startsWith("mechanical:"),
    ),
    `expected live mechanical defect signals, got ${JSON.stringify(liveEvidence.defectSignals)}`,
  );
  assert.ok(rightRec.id);
});
