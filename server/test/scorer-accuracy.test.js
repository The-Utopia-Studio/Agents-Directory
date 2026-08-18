// Scorer accuracy harness. Ground truth lives in sibling .expected.json files
// written by hand. This file must not invent those expectations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIER_ADVISORY,
  TIER_NAMED_HIT,
  TIER_SCORED,
  isBlockingCheckResult,
  tierForCheck,
} from "../src/eval/checkTiers.js";
import {
  getRuntimeArtifactDescriptor,
  validateRuntimeArtifactOutput,
} from "../src/invoke/runtimeArtifacts.js";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/scorer-accuracy",
);

const CHECK_IDS = Object.freeze([
  ...getRuntimeArtifactDescriptor("A7").checks,
]);

function loadCases() {
  const names = readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".md"))
    .sort();
  return names.map((name) => {
    const id = name.replace(/\.md$/, "");
    const text = readFileSync(join(FIXTURE_DIR, name), "utf8");
    const expected = JSON.parse(
      readFileSync(join(FIXTURE_DIR, `${id}.expected.json`), "utf8"),
    );
    return { id, text, expected };
  });
}

function actualVerdict(checkId, results) {
  const row = results.find((r) => r.checkId === checkId);
  const tier = tierForCheck(checkId);
  if (tier === TIER_ADVISORY) return "OBSERVATION";
  if (tier === TIER_NAMED_HIT) {
    return row && isBlockingCheckResult(row) ? "HIT" : "NO_HIT";
  }
  return row && isBlockingCheckResult(row) ? "FAIL" : "PASS";
}

function classifyScored(expected, actual) {
  if (expected === "PASS" && actual === "PASS") return "true_pass";
  if (expected === "FAIL" && actual === "FAIL") return "true_fail";
  if (expected === "FAIL" && actual === "PASS") return "false_pass";
  return "false_fail";
}

test("scorer accuracy harness: hand-labelled fixtures vs RUNTIME_CHECKS, grouped by tier", () => {
  const cases = loadCases();
  assert.equal(cases.length, 18, "expected 18 markdown fixtures");

  const scoredIds = CHECK_IDS.filter((id) => tierForCheck(id) === TIER_SCORED);
  const namedHitIds = CHECK_IDS.filter((id) => tierForCheck(id) === TIER_NAMED_HIT);
  const advisoryIds = CHECK_IDS.filter((id) => tierForCheck(id) === TIER_ADVISORY);

  const scoredMatrix = Object.fromEntries(
    scoredIds.map((checkId) => [
      checkId,
      { true_pass: 0, true_fail: 0, false_pass: 0, false_fail: 0 },
    ]),
  );
  const namedHitCounts = Object.fromEntries(
    namedHitIds.map((checkId) => [
      checkId,
      { labelled_hit: 0, labelled_no_hit: 0, actual_hit: 0, actual_no_hit: 0, mismatch: 0 },
    ]),
  );
  const advisoryCounts = Object.fromEntries(
    advisoryIds.map((checkId) => [
      checkId,
      { observations: 0, non_observation: 0 },
    ]),
  );

  const falsePasses = [];
  const falseFails = [];
  const failExpectedByCheck = Object.fromEntries(
    scoredIds.map((checkId) => [checkId, []]),
  );

  for (const fixture of cases) {
    const missing = CHECK_IDS.filter(
      (checkId) => !fixture.expected.expected[checkId],
    );
    assert.equal(
      missing.length,
      0,
      `${fixture.id} is missing expected keys: ${missing.join(", ")}`,
    );
    const results = validateRuntimeArtifactOutput("A7", fixture.text);
    for (const checkId of CHECK_IDS) {
      const expected = fixture.expected.expected[checkId];
      const actual = actualVerdict(checkId, results);
      const tier = tierForCheck(checkId);

      if (tier === TIER_SCORED) {
        const bucket = classifyScored(expected, actual);
        scoredMatrix[checkId][bucket] += 1;
        if (expected === "FAIL") failExpectedByCheck[checkId].push(fixture.id);
        if (bucket === "false_pass") {
          falsePasses.push({
            fixture: fixture.id,
            checkId,
            class: fixture.expected.class,
            notes: fixture.expected.notes,
            text: fixture.text,
          });
        }
        if (bucket === "false_fail") {
          falseFails.push({
            fixture: fixture.id,
            checkId,
            class: fixture.expected.class,
            notes: fixture.expected.notes,
          });
        }
      } else if (tier === TIER_NAMED_HIT) {
        const row = namedHitCounts[checkId];
        if (expected === "HIT") row.labelled_hit += 1;
        else row.labelled_no_hit += 1;
        if (actual === "HIT") row.actual_hit += 1;
        else row.actual_no_hit += 1;
        if (expected !== actual) row.mismatch += 1;
      } else {
        const row = advisoryCounts[checkId];
        if (actual === "OBSERVATION") row.observations += 1;
        else row.non_observation += 1;
      }
    }
  }

  const unexercisedFail = scoredIds.filter(
    (checkId) => failExpectedByCheck[checkId].length === 0,
  );

  const lines = [];
  lines.push("SCORER ACCURACY — validateRuntimeArtifactOutput vs hand labels");
  lines.push(`Checks: ${CHECK_IDS.join(", ")}`);
  lines.push("");
  lines.push("FALSE_PASS is meaningful only for scored checks.");
  lines.push("named_hit: a miss is not a cleanliness certificate — FALSE_PASS is n/a.");
  lines.push("advisory: results are observations, never pass/fail — FALSE_PASS is n/a.");
  lines.push("");

  lines.push("=== scored ===");
  lines.push("check_id | true_pass | true_fail | FALSE_PASS | false_fail");
  for (const checkId of scoredIds) {
    const row = scoredMatrix[checkId];
    lines.push(
      `${checkId} | ${row.true_pass} | ${row.true_fail} | ${row.false_pass} | ${row.false_fail}`,
    );
  }
  lines.push("");

  lines.push("=== named_hit (FALSE_PASS n/a) ===");
  lines.push("check_id | labelled_hit | labelled_no_hit | actual_hit | actual_no_hit | mismatch");
  for (const checkId of namedHitIds) {
    const row = namedHitCounts[checkId];
    lines.push(
      `${checkId} | ${row.labelled_hit} | ${row.labelled_no_hit} | ${row.actual_hit} | ${row.actual_no_hit} | ${row.mismatch}`,
    );
  }
  lines.push("");

  lines.push("=== advisory (FALSE_PASS n/a; never pass/fail) ===");
  lines.push("check_id | observations | non_observation");
  for (const checkId of advisoryIds) {
    const row = advisoryCounts[checkId];
    lines.push(
      `${checkId} | ${row.observations} | ${row.non_observation}`,
    );
  }
  lines.push("");

  lines.push("FALSE PASSES (scored only: check said PASS, ground truth FAIL)");
  if (!falsePasses.length) {
    lines.push("(none)");
  } else {
    for (const hit of falsePasses) {
      lines.push(`--- ${hit.fixture} / ${hit.checkId} (${hit.class})`);
      lines.push(hit.notes);
      lines.push(hit.text.trimEnd());
    }
  }
  lines.push("");
  lines.push("FALSE FAILS (scored only: check said FAIL, ground truth PASS)");
  if (!falseFails.length) {
    lines.push("(none)");
  } else {
    for (const hit of falseFails) {
      lines.push(`- ${hit.fixture} / ${hit.checkId} (${hit.class}): ${hit.notes}`);
    }
  }
  lines.push("");
  lines.push("NO FAIL-LABELLED FIXTURE among scored checks");
  lines.push(unexercisedFail.length ? unexercisedFail.join(", ") : "(none)");
  lines.push("");

  const report = lines.join("\n");
  console.log(`\n${report}\n`);

  assert.equal(falsePasses.length, 0, report);
  assert.equal(falseFails.length, 0, report);
  assert.equal(unexercisedFail.length, 0, report);
  for (const checkId of namedHitIds) {
    assert.equal(namedHitCounts[checkId].mismatch, 0, report);
  }
  for (const checkId of advisoryIds) {
    assert.equal(advisoryCounts[checkId].non_observation, 0, report);
  }
});
