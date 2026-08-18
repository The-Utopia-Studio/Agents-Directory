import { test } from "node:test";
import assert from "node:assert/strict";
import {
  postProcessDraft,
  POST_PROCESSED_CHECK_IDS,
  isPostProcessedCheckId,
} from "../src/invoke/postProcessDraft.js";
import { collectDefects } from "../src/improve/heuristicOptimizer.js";

test("postProcessDraft strips em dashes and banned terms", () => {
  const input = [
    "### LinkedIn About",
    "",
    "I utilize AI — and leverage synergy!",
    "",
    "### Spoken event introduction",
    "",
    "She builds tools.",
    "",
    "### Suggested headline",
    "",
    "Builder",
  ].join("\n");
  const { output, applied } = postProcessDraft(input);
  assert.equal(output.includes("—"), false);
  assert.equal(output.includes("utilize"), false);
  assert.equal(output.includes("!"), false);
  assert.ok(applied.includes("draft_has_no_em_dash"));
  assert.ok(applied.includes("draft_registered_ai_cliche_lemma"));
});

test("maker collectDefects ignores post-processed check ids", () => {
  const defects = collectDefects(
    { id: "A7" },
    {
      failingTraces: [
        {
          id: "t1",
          failureReason: "draft_has_no_em_dash, about_closing_has_cta",
          checkResults: [
            { checkId: "draft_has_no_em_dash" },
            { checkId: "about_closing_has_cta" },
          ],
        },
      ],
      defectSignals: ["draft_has_no_em_dash", "about_closing_has_cta"],
      feedback: [],
    },
    {
      text: "# Method\n\nDo things.\n\n## Guardrails\n\n1. Be careful.\n",
      checks: POST_PROCESSED_CHECK_IDS,
    },
  );
  assert.deepEqual(
    defects.map((d) => d.key).sort(),
    ["about_closing_has_cta"],
  );
  assert.equal(isPostProcessedCheckId("draft_has_no_em_dash"), true);
  assert.equal(isPostProcessedCheckId("about_closing_has_cta"), false);
});
