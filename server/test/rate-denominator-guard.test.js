// The 57.1 → 80 case, and the guard that now refuses it.
//
// Retiering `about_closing_has_cta` to advisory and the cliche check to
// named_hit removed two checks from the scored style pool. On byte-identical
// output with identical defects the style pass rate went 4/7 = 57.1 to
// 4/5 = 80. Nothing improved. checkSetId did not catch it, because the
// DECLARED set was unchanged — only the CONTRIBUTING pool moved.
//
// A rate must carry its denominator and the ids behind it, and two rates over
// different id sets must be refused the same way a checkSetId mismatch is
// refused — not merely labelled non-comparable and handed back as a number.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groundingScoreDelta,
  rateDelta,
  styleRateDelta,
} from "../src/eval/compareExperiments.js";
import {
  rateBasisDigest,
  readGroundingPassRate,
  summarizeCategory,
} from "../src/eval/scoreMechanicalOutput.js";

/** The pre-widening scored style pool: 4 passed, 3 failed = 57.1%. */
const PRE_WIDENING_STYLE = {
  stylePassRate: 57.1,
  styleScoreableCount: 7,
  styleBasisCheckIds: [
    "about_closing_has_cta",
    "about_has_no_delimiter_separated_keyword_run",
    "about_hook_max_200_characters",
    "about_max_2600_characters",
    "draft_has_no_ai_cliche_phrase",
    "draft_has_no_em_dash",
    "headline_max_220_characters",
  ],
};

/** After retiering: same output, same defects, 4 passed, 1 failed = 80%. */
const POST_RETIER_STYLE = {
  stylePassRate: 80,
  styleScoreableCount: 5,
  styleBasisCheckIds: [
    "about_has_no_delimiter_separated_keyword_run",
    "about_hook_max_200_characters",
    "about_max_2600_characters",
    "draft_has_no_em_dash",
    "headline_max_220_characters",
  ],
};

test("THE CASE: 57.1 → 80 on identical output is REFUSED, not reported as +22.9", () => {
  const delta = styleRateDelta(PRE_WIDENING_STYLE, POST_RETIER_STYLE);

  // The refusal is the assertion. A +22.9 here would be the bug.
  assert.equal(delta.comparable, false);
  assert.equal(delta.denominatorChanged, true);
  assert.equal(delta.value, undefined, "a refused comparison must carry no number at all");

  // It names exactly which checks left the pool.
  assert.deepEqual(delta.removedCheckIds, [
    "about_closing_has_cta",
    "draft_has_no_ai_cliche_phrase",
  ]);
  assert.deepEqual(delta.addedCheckIds, []);

  // And it carries both denominators so the reader can see the shape of it.
  assert.equal(delta.leftScoreableCount, 7);
  assert.equal(delta.rightScoreableCount, 5);
  assert.match(delta.reason, /denominator changed \(7 → 5 checks/);
  assert.match(delta.reason, /removed about_closing_has_cta, draft_has_no_ai_cliche_phrase/);
  assert.match(delta.reason, /not a delta/);
});

test("the arithmetic that WOULD have been reported is exactly the +22.9 we refuse", () => {
  // Guards the fixture: if these numbers drift, the test above stops
  // reproducing the real case and silently becomes a different test.
  const naive = POST_RETIER_STYLE.stylePassRate - PRE_WIDENING_STYLE.stylePassRate;
  assert.equal(Math.round(naive * 10) / 10, 22.9);
  assert.equal(PRE_WIDENING_STYLE.styleBasisCheckIds.length, 7);
  assert.equal(POST_RETIER_STYLE.styleBasisCheckIds.length, 5);
  // Same four checks passed on both sides — nothing about the output changed.
  const passedBoth = POST_RETIER_STYLE.styleBasisCheckIds.filter((id) =>
    PRE_WIDENING_STYLE.styleBasisCheckIds.includes(id),
  );
  assert.equal(passedBoth.length, 5);
});

test("an unchanged denominator still produces a real delta", () => {
  const delta = styleRateDelta(POST_RETIER_STYLE, {
    ...POST_RETIER_STYLE,
    stylePassRate: 100,
  });
  assert.equal(delta.comparable, true);
  assert.equal(delta.value, 20);
  assert.equal(delta.leftScoreableCount, 5);
  assert.equal(delta.rightScoreableCount, 5);
});

test("an added check is refused too — the incentive runs both ways", () => {
  const delta = rateDelta(
    { passRate: 100, scoreableCount: 2, basisCheckIds: ["a", "b"] },
    { passRate: 66.7, scoreableCount: 3, basisCheckIds: ["a", "b", "c"] },
    "style pass rate",
  );
  assert.equal(delta.comparable, false);
  assert.deepEqual(delta.addedCheckIds, ["c"]);
  assert.equal(delta.value, undefined);
  // Adding a check must not read as a regression any more than removing one
  // reads as an improvement.
  assert.match(delta.reason, /added c/);
});

test("a rate with no recorded basis is refused, never assumed equal", () => {
  const delta = rateDelta(
    { passRate: 57.1, scoreableCount: 7 },
    { passRate: 80, scoreableCount: 5, basisCheckIds: ["a"] },
    "style pass rate",
  );
  assert.equal(delta.comparable, false);
  assert.match(delta.reason, /basis not recorded/);
  assert.equal(delta.value, undefined);
});

test("summarizeCategory records the basis that produced the rate", () => {
  const rows = [
    { id: "s_pass", category: "style", tier: "scored", status: "pass", passed: true },
    { id: "s_fail", category: "style", tier: "scored", status: "fail", passed: false },
    // Neither of these may enter the denominator.
    { id: "s_adv", category: "style", tier: "advisory", status: "observation", passed: null },
    { id: "s_named", category: "style", tier: "named_hit", status: "no_hit", passed: null },
  ];
  const style = summarizeCategory(rows, "style");
  assert.equal(style.scoreableCount, 2);
  assert.equal(style.passRate, 50);
  assert.deepEqual(style.basisCheckIds, ["s_fail", "s_pass"]);
  assert.equal(style.basisDigest, rateBasisDigest(["s_pass", "s_fail"]));
  // Basis is order-independent.
  assert.equal(rateBasisDigest(["b", "a"]), rateBasisDigest(["a", "b"]));
  assert.notEqual(rateBasisDigest(["a", "b"]), rateBasisDigest(["a", "b", "c"]));
});

test("the grounding delta is under the same guard", () => {
  const side = (passRate, ids) => ({
    checkSetId: "same-declared-set",
    outputSource: "canned",
    byCategory: {
      grounding: {
        passRate,
        scoreableCount: ids.length,
        basisCheckIds: [...ids].sort(),
      },
    },
    checkResults: ids.map((id) => ({
      id,
      category: "grounding",
      tier: "scored",
      status: "fail",
      passed: false,
    })),
  });
  const refused = groundingScoreDelta(
    side(0, ["g_a", "g_b", "g_c"]),
    side(50, ["g_a", "g_b"]),
  );
  assert.equal(refused.comparable, false);
  assert.equal(refused.denominatorChanged, true);
  assert.deepEqual(refused.removedCheckIds, ["g_c"]);
  assert.equal(refused.value, undefined);
});

test("readGroundingPassRate reads the new key and falls back to the historical alias", () => {
  assert.equal(readGroundingPassRate({ groundingPassRate: 42 }), 42);
  // Rows persisted before the rename are real history, not "not measured".
  assert.equal(readGroundingPassRate({ mechanicalCheckScore: 33.3 }), 33.3);
  // New key wins when both are present.
  assert.equal(
    readGroundingPassRate({ groundingPassRate: 42, mechanicalCheckScore: 99 }),
    42,
  );
  // Absent stays absent — never substituted with zero.
  assert.equal(readGroundingPassRate({}), null);
  assert.equal(readGroundingPassRate(null), null);
});
