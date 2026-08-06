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
 */
export const A7_MIRA_OKONKWO_V1 = Object.freeze({
  id: "a7-mira-okonkwo-v1",
  agentId: "A7",
  source: "synthetic/golden-a7-v1",
  label: "Mira Okonkwo synthetic grounding traps",
  // Directory-shaped goldenCases fields (types.js).
  input: readGoldenFile("a7-mira-okonkwo-v1", "source.txt").trim(),
  expected:
    "Preserve Intern+Helix; Dextrum = worked-for not founded; Northline = founded not merely worked; About CTA; no em dash; no sits-at-the-intersection cliché",
  rule: "mechanical + source-grounding checks on canned-bad-output must fail the known traps under v5/v6 declared sets as documented in eval tests",
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
  source: "synthetic/golden-a10-v1",
  label: "Mira Okonkwo gap-fill grounding + employer-frame traps",
  input: readGoldenFile("a10-mira-okonkwo-v1", "source.txt").trim(),
  expected:
    "Preserve Intern+Helix; Dextrum ≠ founded; Northline = founded; Factory = tool not employer; Snoonu = event not workplace; About CTA; no em dash; no sits-at-the-intersection cliché; partial source leaves Call-1 gaps",
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

export const GOLDEN_CASES_BY_AGENT = Object.freeze({
  A7: Object.freeze([A7_MIRA_OKONKWO_V1]),
  A10: Object.freeze([A10_MIRA_OKONKWO_V1]),
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
  };
}
