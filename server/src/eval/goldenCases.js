// Synthetic golden cases for A7/A10 mechanical-check scoring.
// Never real LinkedIn / fellow data.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_SOURCE_WINDOW_WORDS,
  EMPLOYER_FRAME_WINDOW_WORDS,
  FOUNDING_SOURCE_WINDOW_WORDS,
} from "./sourceGrounding.js";

const GOLDEN_ROOT = new URL("../eval-artifacts/golden/", import.meta.url);

function readGoldenFile(caseId, name) {
  return readFileSync(new URL(`${caseId}/${name}`, GOLDEN_ROOT), "utf8");
}

const MIRA_RELATIONSHIP_RULES = Object.freeze([
  Object.freeze({
    checkId: "source_preserves_intern_near_helix",
    kind: "require-near",
    anchor: "helix",
    requiredToken: "intern",
    windowWords: DEFAULT_SOURCE_WINDOW_WORDS,
  }),
  Object.freeze({
    checkId: "source_no_founding_verb_near_dextrum",
    kind: "forbid-near",
    anchor: "dextrum",
    forbiddenClass: "founding-verb",
    windowWords: FOUNDING_SOURCE_WINDOW_WORDS,
  }),
  Object.freeze({
    checkId: "source_preserves_founding_near_northline",
    kind: "require-near",
    anchor: "northline",
    requiredClass: "founding-verb",
    windowWords: FOUNDING_SOURCE_WINDOW_WORDS,
  }),
]);

/**
 * Mira Okonkwo — synthetic. Exercises inflation (Dextrum), downgrade
 * (Northline), Intern qualifier drop, em dash, relocated AI cliché, missing CTA.
 *
 * Also carries all three widened-branch evasions, added because the golden
 * cases exercised none of them and the golden path is what gates promotion:
 * an en dash (U+2013) clause break, a slash-delimited keyword run, and an
 * inflected-only cliché variant ("sitting at the crossroads of"). Each is
 * invisible to the pre-widening detectors and caught by the current ones.
 */
export const A7_MIRA_OKONKWO_V1 = Object.freeze({
  id: "a7-mira-okonkwo-v1",
  agentId: "A7",
  sealed: false,
  source: "synthetic/golden-a7-v1",
  label: "Mira Okonkwo synthetic grounding traps",
  // Directory-shaped goldenCases fields (types.js).
  input: readGoldenFile("a7-mira-okonkwo-v1", "source.txt").trim(),
  expected:
    "Preserve Intern+Helix; Dextrum = worked-for not founded; Northline = founded not merely worked; About CTA; no em dash AND no en dash used as a clause break; no slash-delimited keyword run; no sits-at-the-intersection cliché in any inflection or near-variant",
  rule: "mechanical + source-grounding checks on canned-bad-output must fail the known traps under v5/v6 declared sets as documented in eval tests; the three widened branches (en dash, slash delimiter, inflected cliché) must each fire",
  // Source-grounding family — distinct from style scanners.
  sourceGroundingRules: MIRA_RELATIONSHIP_RULES,
  cannedBadOutputPath: fileURLToPath(
    new URL("a7-mira-okonkwo-v1/canned-bad-output.md", GOLDEN_ROOT),
  ),
  getCannedBadOutput() {
    return readGoldenFile("a7-mira-okonkwo-v1", "canned-bad-output.md");
  },
  getCannedImprovedOutput() {
    return readGoldenFile("a7-mira-okonkwo-v1", "canned-improved-output.md");
  },
});

/**
 * Mira Okonkwo — gap-fill. Same relationship traps as A7, plus Factory-as-tool
 * and Snoonu-Hackathon-as-event framed as workplaces. Source is partial so
 * Call 1 still has bank gaps (proudest outcome, skills, contact, mission).
 */
export const A10_MIRA_OKONKWO_V1 = Object.freeze({
  id: "a10-mira-okonkwo-v1",
  agentId: "A10",
  sealed: false,
  source: "synthetic/golden-a10-v1",
  label: "Mira Okonkwo gap-fill grounding + employer-frame traps",
  input: readGoldenFile("a10-mira-okonkwo-v1", "source.txt").trim(),
  expected:
    "Preserve Intern+Helix; Dextrum ≠ founded; Northline = founded; Factory = tool not employer; Snoonu = event not workplace; About CTA; no em dash AND no en dash clause break; no slash-delimited keyword run; no sits-at-the-intersection cliché in any inflection or near-variant; partial source leaves Call-1 gaps",
  rule: "mechanical + source-grounding (including forbid-employer-frame) on canned-bad-output; live gap-fill scoring via scoreGoldenCannedAgainstLive",
  expectedGapBankIds: Object.freeze([
    "proudest-outcome",
    "mission",
    "skills",
    "contact",
  ]),
  sourceGroundingRules: Object.freeze([
    ...MIRA_RELATIONSHIP_RULES,
    Object.freeze({
      checkId: "source_no_employer_frame_for_factory",
      kind: "forbid-employer-frame",
      anchor: "factory",
      windowWords: EMPLOYER_FRAME_WINDOW_WORDS,
    }),
    Object.freeze({
      checkId: "source_no_employer_frame_for_snoonu",
      kind: "forbid-employer-frame",
      anchor: "snoonu",
      windowWords: EMPLOYER_FRAME_WINDOW_WORDS,
    }),
  ]),
  cannedBadOutputPath: fileURLToPath(
    new URL("a10-mira-okonkwo-v1/canned-bad-output.md", GOLDEN_ROOT),
  ),
  getCannedBadOutput() {
    return readGoldenFile("a10-mira-okonkwo-v1", "canned-bad-output.md");
  },
  getCannedImprovedOutput() {
    return readGoldenFile("a10-mira-okonkwo-v1", "canned-improved-output.md");
  },
});

/**
 * Jonas Park — sealed A7 holdout. Coastal restoration career, not a Mira
 * variant. Canned-bad hook exceeds 200 characters (scored length).
 */
export const A7_JONAS_PARK_V1 = Object.freeze({
  id: "a7-jonas-park-v1",
  agentId: "A7",
  sealed: true,
  source: "synthetic/golden-a7-jonas-v1",
  label: "Jonas Park sealed holdout — coastal restoration length trap",
  input: readGoldenFile("a7-jonas-park-v1", "source.txt").trim(),
  expected:
    "Preserve Intern+Tidewatch; NOAA = contracted not founded; Kelpward = founded; hook within 200 characters; About CTA",
  rule: "sealed holdout — scorer may use; maker must never receive this case",
  sourceGroundingRules: Object.freeze([
    Object.freeze({
      checkId: "source_preserves_intern_near_tidewatch",
      kind: "require-near",
      anchor: "tidewatch",
      requiredToken: "intern",
      windowWords: DEFAULT_SOURCE_WINDOW_WORDS,
    }),
    Object.freeze({
      checkId: "source_no_founding_verb_near_noaa",
      kind: "forbid-near",
      anchor: "noaa",
      forbiddenClass: "founding-verb",
      windowWords: FOUNDING_SOURCE_WINDOW_WORDS,
    }),
    Object.freeze({
      checkId: "source_preserves_founding_near_kelpward",
      kind: "require-near",
      anchor: "kelpward",
      requiredClass: "founding-verb",
      windowWords: FOUNDING_SOURCE_WINDOW_WORDS,
    }),
  ]),
  cannedBadOutputPath: fileURLToPath(
    new URL("a7-jonas-park-v1/canned-bad-output.md", GOLDEN_ROOT),
  ),
  getCannedBadOutput() {
    return readGoldenFile("a7-jonas-park-v1", "canned-bad-output.md");
  },
  getCannedImprovedOutput() {
    return readGoldenFile("a7-jonas-park-v1", "canned-improved-output.md");
  },
});

/**
 * Priya Venkat — sealed A10 holdout. Food-safety consultant, not a Mira
 * variant. Canned-bad About has a delimiter-separated keyword run (scored).
 */
export const A10_PRIYA_VENKAT_V1 = Object.freeze({
  id: "a10-priya-venkat-v1",
  agentId: "A10",
  sealed: true,
  source: "synthetic/golden-a10-priya-v1",
  label: "Priya Venkat sealed holdout — food-safety delimiter trap",
  input: readGoldenFile("a10-priya-venkat-v1", "source.txt").trim(),
  expected:
    "Preserve Intern+Dairywell; Cargill ≠ founded; Saltline = founded; Benchling = tool; IAFP = event; no delimiter keyword run; partial source leaves Call-1 gaps",
  rule: "sealed holdout — scorer may use; maker must never receive this case",
  expectedGapBankIds: Object.freeze([
    "proudest-outcome",
    "mission",
    "skills",
    "contact",
  ]),
  sourceGroundingRules: Object.freeze([
    Object.freeze({
      checkId: "source_preserves_intern_near_dairywell",
      kind: "require-near",
      anchor: "dairywell",
      requiredToken: "intern",
      windowWords: DEFAULT_SOURCE_WINDOW_WORDS,
    }),
    Object.freeze({
      checkId: "source_no_founding_verb_near_cargill",
      kind: "forbid-near",
      anchor: "cargill",
      forbiddenClass: "founding-verb",
      windowWords: FOUNDING_SOURCE_WINDOW_WORDS,
    }),
    Object.freeze({
      checkId: "source_preserves_founding_near_saltline",
      kind: "require-near",
      anchor: "saltline",
      requiredClass: "founding-verb",
      windowWords: FOUNDING_SOURCE_WINDOW_WORDS,
    }),
    Object.freeze({
      checkId: "source_no_employer_frame_for_benchling",
      kind: "forbid-employer-frame",
      anchor: "benchling",
      windowWords: EMPLOYER_FRAME_WINDOW_WORDS,
    }),
    Object.freeze({
      checkId: "source_no_employer_frame_for_iafp",
      kind: "forbid-employer-frame",
      anchor: "iafp",
      windowWords: EMPLOYER_FRAME_WINDOW_WORDS,
    }),
  ]),
  cannedBadOutputPath: fileURLToPath(
    new URL("a10-priya-venkat-v1/canned-bad-output.md", GOLDEN_ROOT),
  ),
  getCannedBadOutput() {
    return readGoldenFile("a10-priya-venkat-v1", "canned-bad-output.md");
  },
  getCannedImprovedOutput() {
    return readGoldenFile("a10-priya-venkat-v1", "canned-improved-output.md");
  },
});

export const GOLDEN_CASES_BY_AGENT = Object.freeze({
  A7: Object.freeze([A7_MIRA_OKONKWO_V1, A7_JONAS_PARK_V1]),
  A10: Object.freeze([A10_MIRA_OKONKWO_V1, A10_PRIYA_VENKAT_V1]),
});

export function listGoldenCases(agentId) {
  return GOLDEN_CASES_BY_AGENT[agentId] || [];
}

export function getGoldenCase(caseId) {
  for (const cases of Object.values(GOLDEN_CASES_BY_AGENT)) {
    const hit = cases.find((c) => c.id === caseId);
    if (hit) return hit;
  }
  return null;
}

/** Shape suitable for agent.goldenCases[] without embedding the canned output. */
export function goldenCaseDirectoryEntry(caseRecord) {
  return {
    input: caseRecord.input,
    expected: caseRecord.expected,
    rule: caseRecord.rule,
    source: caseRecord.source,
    sealed: caseRecord.sealed === true,
  };
}
