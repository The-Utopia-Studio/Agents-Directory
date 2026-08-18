import { test } from "node:test";
import assert from "node:assert/strict";
import {
  discoverMarkedNonEmployerEntities,
  outputHasEmployerFrame,
  runSourceGroundingChecks,
  sourceEstablishesEmployer,
} from "../src/eval/sourceGrounding.js";
import {
  A10_MIRA_OKONKWO_V1,
} from "../src/eval/goldenCases.js";
import { scoreGoldenCannedAgainstLive } from "../src/eval/scoreGoldenCase.js";
import {
  getRuntimeArtifactDescriptor,
  validateRuntimeArtifactOutput,
} from "../src/invoke/runtimeArtifacts.js";
import { sanitizeCheckResults } from "../src/core/traceSafety.js";

test("sourceEstablishesEmployer accepts jobs and rejects tools/events", () => {
  const source = A10_MIRA_OKONKWO_V1.input;
  assert.equal(sourceEstablishesEmployer(source, "helix"), true);
  assert.equal(sourceEstablishesEmployer(source, "dextrum"), true);
  assert.equal(sourceEstablishesEmployer(source, "northline"), true);
  assert.equal(sourceEstablishesEmployer(source, "factory"), false);
  assert.equal(sourceEstablishesEmployer(source, "snoonu"), false);
});

test("outputHasEmployerFrame catches At Factory / at the Snoonu, not using/during", () => {
  assert.equal(
    outputHasEmployerFrame("At Factory, I shipped an MVP for Dextrum.", "factory"),
    true,
  );
  assert.equal(
    outputHasEmployerFrame(
      "I did product strategy at the Snoonu Hackathon.",
      "snoonu",
    ),
    true,
  );
  assert.equal(
    outputHasEmployerFrame(
      "I shipped intake prototypes using Factory for client work.",
      "factory",
    ),
    false,
  );
  assert.equal(
    outputHasEmployerFrame(
      "During the Snoonu Hackathon I participated on product strategy.",
      "snoonu",
    ),
    false,
  );
});

test("forbid-employer-frame fails canned bad and passes canned improved", () => {
  const bad = runSourceGroundingChecks(
    A10_MIRA_OKONKWO_V1.getCannedBadOutput(),
    A10_MIRA_OKONKWO_V1.sourceGroundingRules,
    { sourceText: A10_MIRA_OKONKWO_V1.input },
  );
  const byId = Object.fromEntries(bad.map((r) => [r.checkId, r]));
  assert.equal(byId.source_no_employer_frame_for_factory.status, "fail");
  assert.equal(byId.source_no_employer_frame_for_snoonu.status, "fail");
  assert.equal(byId.source_no_founding_verb_near_dextrum.status, "fail");

  const good = runSourceGroundingChecks(
    A10_MIRA_OKONKWO_V1.getCannedImprovedOutput(),
    A10_MIRA_OKONKWO_V1.sourceGroundingRules,
    { sourceText: A10_MIRA_OKONKWO_V1.input },
  );
  const goodById = Object.fromEntries(good.map((r) => [r.checkId, r]));
  assert.equal(goodById.source_no_employer_frame_for_factory.status, "pass");
  assert.equal(goodById.source_no_employer_frame_for_snoonu.status, "pass");
  assert.equal(goodById.source_preserves_intern_near_helix.status, "pass");
  assert.equal(goodById.source_no_founding_verb_near_dextrum.status, "pass");
  assert.equal(goodById.source_preserves_founding_near_northline.status, "pass");
});

test("A10 live artifact keeps A7 mechanical checks and scores Mira gap-fill golden", () => {
  const live = getRuntimeArtifactDescriptor("A10");
  assert.equal(live.artifactVersion, "biocraft-gapfill-v3");
  assert.ok(live.checks.includes("about_hook_max_200_characters"));
  assert.ok(live.checks.includes("draft_has_no_em_dash"));
  assert.ok(
    live.guardrails.some((g) => /tools, platforms, and events/i.test(g)),
  );

  const score = scoreGoldenCannedAgainstLive("a10-mira-okonkwo-v1");
  assert.ok(score.failed.includes("source_no_employer_frame_for_factory"));
  assert.ok(score.failed.includes("source_no_employer_frame_for_snoonu"));
  assert.ok(score.failed.includes("source_no_founding_verb_near_dextrum"));
  assert.ok(score.failed.includes("draft_has_no_em_dash"));
  assert.ok(score.failed.includes("about_closing_has_cta"));
  assert.ok(
    score.checkResults
      .filter((r) => r.checkId.startsWith("source_"))
      .every((r) => r.family === "source-grounding"),
  );
});

test("live validateRuntimeArtifactOutput discovers marked non-employers from source", () => {
  const source = A10_MIRA_OKONKWO_V1.input;
  const marked = discoverMarkedNonEmployerEntities(source);
  assert.ok(marked.includes("factory"));
  assert.ok(marked.includes("snoonu"));
  assert.ok(!marked.includes("dextrum"));

  const failures = validateRuntimeArtifactOutput(
    "A10",
    A10_MIRA_OKONKWO_V1.getCannedBadOutput(),
    { sourceText: source },
  );
  const liveGrounding = failures.find(
    (f) => f.checkId === "source_no_employer_frame_for_marked_non_employer",
  );
  assert.ok(liveGrounding);
  assert.equal(liveGrounding.employerFramed, true);
  assert.equal(liveGrounding.sourceAllowsEmployer, false);
  assert.ok(liveGrounding.framedNonEmployerCount >= 1);

  const safe = sanitizeCheckResults([liveGrounding]);
  assert.equal(safe.length, 1);
  assert.equal(safe[0].checkId, "source_no_employer_frame_for_marked_non_employer");
  assert.equal(safe[0].employerFramed, true);
  assert.ok(!("message" in safe[0]));

  const clean = validateRuntimeArtifactOutput(
    "A10",
    A10_MIRA_OKONKWO_V1.getCannedImprovedOutput(),
    { sourceText: source },
  );
  assert.equal(
    clean.some(
      (f) => f.checkId === "source_no_employer_frame_for_marked_non_employer",
    ),
    false,
  );
});
