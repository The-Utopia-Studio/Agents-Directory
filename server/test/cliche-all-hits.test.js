// The cliche scanner reports every hit, not the first.
//
// A named_hit scanner that stops after one under-reports by design, and the
// count is load-bearing: the maker chooses which defect to attack from what
// the scanner reports, so one cliche and four cliches must not look alike.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_CLICHE_PHRASE_VARIANTS,
  AI_CLICHE_SINGLE_TERMS,
  findAiCliche,
  findAllAiCliches,
} from "../src/eval/styleDetectors.js";
import { scoreMechanicalOutput } from "../src/eval/scoreMechanicalOutput.js";
import { validateRuntimeArtifactOutput } from "../src/invoke/runtimeArtifacts.js";
import { sanitizeCheckResults } from "../src/core/traceSafety.js";
import { getGoldenCase } from "../src/eval/goldenCases.js";

test("findAllAiCliches returns every distinct lemma, in order of occurrence", () => {
  const text =
    "We leverage robust systems. The team sits at the intersection of design and ops, " +
    "and we utilize seamless tooling.";
  const hits = findAllAiCliches(text);
  assert.deepEqual(
    hits.map((h) => h.registeredPhrase),
    ["leverage", "robust", "sits at the intersection of", "utilize", "seamless"],
  );
  // The legacy single-hit helper still returns the first.
  assert.deepEqual(findAiCliche(text), hits[0]);
});

test("a lemma repeated is one defect, not several", () => {
  const hits = findAllAiCliches("We leverage this and leverage that and leverage more.");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].registeredPhrase, "leverage");
});

test("an inflected variant reports the registered lemma and the surface as written", () => {
  const hits = findAllAiCliches("The practice is sitting at the crossroads of two fields.");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].registeredPhrase, "sits at the intersection of");
  assert.equal(hits[0].surface, "sitting at the crossroads of");
});

test("clean text returns an empty list, and the legacy helper returns null", () => {
  assert.deepEqual(findAllAiCliches("A plain sentence about intake tooling."), []);
  assert.equal(findAiCliche("A plain sentence about intake tooling."), null);
  assert.deepEqual(findAllAiCliches(""), []);
});

test("the scorer reports the count across sections, not just the first hit", () => {
  // Two DIFFERENT lemmas in two different sections. Before this change the
  // scanner broke on the first and reported one.
  const output = [
    "### LinkedIn About",
    "",
    "We build sitting at the crossroads of design and delivery.",
    "",
    "### Spoken event introduction",
    "",
    "Mira leverage-free? No: the team will leverage this work.",
    "",
    "### Suggested headline",
    "",
    "Designer",
  ].join("\n");

  const score = scoreMechanicalOutput({
    output,
    artifactVersion: "test",
    artifactDigest: "d".repeat(64),
    declaredChecks: ["draft_registered_ai_cliche_lemma"],
  });
  const row = score.checkResults.find(
    (r) => r.checkId === "draft_registered_ai_cliche_lemma",
  );
  assert.equal(row.tier, "named_hit");
  assert.equal(row.status, "fail");
  assert.equal(row.hitCount, 2);
  assert.deepEqual(row.registeredPhrases, [
    "sits at the intersection of",
    "leverage",
  ]);
  assert.equal(row.hits.length, 2);
  assert.deepEqual(
    row.hits.map((h) => h.section),
    ["LinkedIn About", "Spoken event introduction"],
  );
  assert.match(row.why, /2 registered AI cliche hits across 2 section\(s\)/);
  // Historical single-hit fields still populated for existing readers.
  assert.equal(row.registeredPhrase, "sits at the intersection of");
  assert.equal(row.section, "LinkedIn About");
});

test("a clean draft records hitCount 0 as a no_hit, never a pass", () => {
  const score = scoreMechanicalOutput({
    output: "### LinkedIn About\n\nPlain prose.\n\n### Suggested headline\n\nDesigner",
    artifactVersion: "test",
    artifactDigest: "d".repeat(64),
    declaredChecks: ["draft_registered_ai_cliche_lemma"],
  });
  const row = score.checkResults.find(
    (r) => r.checkId === "draft_registered_ai_cliche_lemma",
  );
  assert.equal(row.status, "no_hit");
  assert.equal(row.passed, null, "a miss proves nothing and is never a pass");
  assert.equal(row.hitCount, 0);
  assert.deepEqual(row.registeredPhrases, []);
});

test("the unsealed golden fixtures now report both the inflected variant and the literal", () => {
  // The point of adding the evasions: the widened branch fires AND the literal
  // base form is still counted, rather than being hidden behind a first-hit break.
  for (const id of ["a7-mira-okonkwo-v1", "a10-mira-okonkwo-v1"]) {
    const c = getGoldenCase(id);
    const score = scoreMechanicalOutput({
      output: c.getCannedBadOutput(),
      artifactVersion: "test",
      artifactDigest: "d".repeat(64),
      declaredChecks: ["draft_registered_ai_cliche_lemma"],
    });
    const row = score.checkResults.find(
      (r) => r.checkId === "draft_registered_ai_cliche_lemma",
    );
    assert.equal(row.hitCount, 2, `${id} must report both cliche occurrences`);
    assert.deepEqual(
      row.hits.map((h) => `${h.section}:${h.surface}`),
      [
        "LinkedIn About:sitting at the crossroads of",
        "Spoken event introduction:sits at the intersection of",
      ],
      `${id}`,
    );
  }
});

test("the live validator reports the same count as the scorer", () => {
  const output = [
    "### LinkedIn About",
    "",
    "We build sitting at the crossroads of design and delivery.",
    "",
    "### Spoken event introduction",
    "",
    "The team will leverage this work.",
    "",
    "### Suggested headline",
    "",
    "Designer",
  ].join("\n");
  const findings = validateRuntimeArtifactOutput("A7", output);
  const cliche = findings.find(
    (f) => f.checkId === "draft_registered_ai_cliche_lemma",
  );
  assert.ok(cliche, "the live validator must raise the cliche finding");
  assert.equal(cliche.hitCount, 2);
  assert.deepEqual(cliche.registeredPhrases, [
    "sits at the intersection of",
    "leverage",
  ]);
  // One finding carrying a count — not N findings sharing a checkId, which
  // would double-count against the blocking logic.
  assert.equal(
    findings.filter((f) => f.checkId === "draft_registered_ai_cliche_lemma").length,
    1,
  );
});

test("the count survives trace sanitization but the matched text does not", () => {
  const [clean] = sanitizeCheckResults([
    {
      checkId: "draft_registered_ai_cliche_lemma",
      tier: "named_hit",
      status: "fail",
      passed: false,
      section: "LinkedIn About",
      sectionFound: true,
      registeredPhrase: "sits at the intersection of",
      hitCount: 3,
      registeredPhrases: ["sits at the intersection of", "leverage"],
      // Must be dropped: matched text is model output, i.e. material about a
      // fellow. The count travels; the excerpt never does.
      hits: [{ section: "LinkedIn About", surface: "sitting at the crossroads of" }],
      message: "free text that must not reach the store",
    },
  ]);
  assert.equal(clean.hitCount, 3, "the maker needs the count");
  assert.deepEqual(clean.registeredPhrases, [
    "sits at the intersection of",
    "leverage",
  ]);
  assert.equal(clean.hits, undefined, "matched text must never reach the store");
  assert.equal(clean.message, undefined);
  assert.equal(clean.surface, undefined);
});

test("registeredPhrases is membership-checked, not shape-checked", () => {
  const [clean] = sanitizeCheckResults([
    {
      checkId: "draft_registered_ai_cliche_lemma",
      // A token that merely LOOKS like a lemma must not pass.
      registeredPhrases: ["leverage", "something the model wrote"],
    },
  ]);
  assert.equal(
    clean.registeredPhrases,
    undefined,
    "one unregistered entry rejects the whole array",
  );
});

test("the traceSafety cliche registry does not drift from styleDetectors", async () => {
  // The comment in traceSafety.js promises this test exists. Keep it honest.
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/core/traceSafety.js", import.meta.url), "utf8"),
  );
  const block = source.match(
    /const REGISTERED_CLICHE_LEMMAS = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1];
  assert.ok(block, "REGISTERED_CLICHE_LEMMAS must be present");
  const declared = new Set(
    [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  );
  const expected = new Set([
    ...AI_CLICHE_SINGLE_TERMS,
    ...AI_CLICHE_PHRASE_VARIANTS.map((e) => e.registered),
  ]);
  assert.deepEqual(
    [...declared].sort(),
    [...expected].sort(),
    "traceSafety's cliche registry drifted from eval/styleDetectors.js",
  );
});
