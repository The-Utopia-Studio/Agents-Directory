// Defect vocabulary for the heuristic maker — derived from the closed check
// id set the runtime/scorer may emit (KNOWN_CHECK_IDS), not a second hand list.
//
// A failing trace's failureReason tokens are these ids. Category tells the
// maker whether a fabrication (grounding) failure is the same class of problem
// as punctuation (style). Description is the canonical "why" the check uses.

import {
  CHECK_SET_CATEGORY_GROUNDING,
  CHECK_SET_CATEGORY_STYLE,
} from "../eval/checkSetId.js";
import { KNOWN_CHECK_IDS, KNOWN_FAILURE_CODES } from "../core/traceSafety.js";

/**
 * @typedef {{ id: string, category: "style"|"grounding", description: string }} CheckDefectEntry
 */

/** Canonical why-strings — keep in step with runtimeArtifacts fail messages. */
const CHECK_DESCRIPTIONS = Object.freeze({
  about_section_present:
    "LinkedIn About section is missing or not labelled exactly.",
  about_hook_max_200_characters:
    "LinkedIn About hook exceeds the 200-character limit.",
  about_max_2600_characters:
    "LinkedIn About exceeds the 2,600-character limit.",
  headline_max_220_characters:
    "Suggested headline exceeds the 220-character limit.",
  about_has_no_delimiter_separated_keyword_run:
    "LinkedIn About contains a delimiter-separated keyword run.",
  about_closing_has_cta:
    "LinkedIn About closing has no clear call to action.",
  draft_has_no_em_dash:
    "A generated section contains an em dash or double-hyphen substitute.",
  draft_has_no_ai_cliche_phrase:
    "A generated section contains a registered AI cliche term or phrase.",
  source_no_employer_frame_for_marked_non_employer:
    "A source-marked non-employer entity was framed as a workplace or employer.",
  source_claim_tenure_years:
    "Draft tenure/years claim is not supported by the source as stated.",
  source_claim_role_title:
    "Draft role or title claim is not supported by the source as stated.",
  source_claim_employer_frame:
    "Draft employer/workplace framing is not supported by the source.",
  source_claim_metric:
    "Draft metric or achievement claim is not supported by the source.",
  source_claim_credential:
    "Draft credential claim is not supported by the source.",
  source_claim_quote:
    "Draft quote attribution is not supported by the source.",
  source_claim_other:
    "Draft claim is not supported by the source.",
  empty_output: "The run produced an empty draft.",
  gap_response_unparseable: "Gap-fill response could not be parsed.",
  uncategorized_failure:
    "Run failed but no surviving check id or failure code was recorded after sanitization.",
});

const GROUNDING_IDS = new Set([
  "source_no_employer_frame_for_marked_non_employer",
  "source_claim_tenure_years",
  "source_claim_role_title",
  "source_claim_employer_frame",
  "source_claim_metric",
  "source_claim_credential",
  "source_claim_quote",
  "source_claim_other",
]);

/**
 * Full vocabulary the maker can classify. Built from KNOWN_CHECK_IDS +
 * KNOWN_FAILURE_CODES so it cannot drift from what traces may carry.
 * @returns {CheckDefectEntry[]}
 */
export function listCheckDefectVocabulary() {
  const ids = [...KNOWN_CHECK_IDS, ...KNOWN_FAILURE_CODES];
  return ids.map((id) => ({
    id,
    category: GROUNDING_IDS.has(id)
      ? CHECK_SET_CATEGORY_GROUNDING
      : CHECK_SET_CATEGORY_STYLE,
    description:
      CHECK_DESCRIPTIONS[id] ||
      `Registered check or failure code "${id}" fired.`,
  }));
}

const BY_ID = new Map(
  listCheckDefectVocabulary().map((entry) => [entry.id, entry]),
);

export function resolveCheckDefect(checkId) {
  const id = String(checkId || "").trim();
  if (!id) return null;
  return BY_ID.get(id) || null;
}

/** Split a failureReason / mechanical signal into check-id tokens. */
export function parseFailureReasonTokens(reason) {
  const raw = String(reason || "").trim();
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((token) => token.trim().replace(/^mechanical:/, ""))
        // Check ids are snake_case tokens. Prose like "voice mismatch" must
        // not be treated as an unknown check id — that path still uses TRACE_DEFECTS.
        .filter((token) => /^[a-z][a-z0-9_]*$/.test(token)),
    ),
  ];
}

export { CHECK_SET_CATEGORY_GROUNDING, CHECK_SET_CATEGORY_STYLE };
