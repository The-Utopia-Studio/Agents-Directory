// What a trace may say about why a run failed, without saying what was in it.
//
// `failureReason` used to be stripped everywhere because a free-text reason can
// carry model output, and model output is material about the fellow. That was
// the right instinct applied too bluntly: it also discarded the checker's
// verdict, which is the one failure signal we generate mechanically. The maker
// then read `failureReason` off every failing trace and always found nothing.
//
// The line held here is shape, not content. A trace may carry closed-vocabulary
// check ids and numeric/boolean facts about the structure that was inspected.
// It may never carry a matched substring, an excerpt, or an arbitrary message —
// those are rejected by construction, not by reviewer discipline.

// Membership, not shape. A pattern like /^[a-z0-9_]+$/ only says a string
// LOOKS like an id; it would pass any future lowercase token, including one
// derived from model output. The set below is the complete vocabulary a trace
// may use. Adding a check means adding it here on purpose.
//
// KNOWN_CHECK_IDS must stay in step with RUNTIME_CHECKS in runtimeArtifacts.js.
// It is duplicated rather than imported so that observability does not pull in
// artifact loading; a test asserts the two never drift.
export const KNOWN_CHECK_IDS = Object.freeze([
  "about_section_present",
  "about_hook_max_200_characters",
  "about_has_no_delimiter_separated_keyword_run",
  "about_closing_has_cta",
]);

/** Non-check failures. Codes only — never a provider or model message. */
export const KNOWN_FAILURE_CODES = Object.freeze(["empty_output"]);

const ALLOWED_REASONS = new Set([...KNOWN_CHECK_IDS, ...KNOWN_FAILURE_CODES]);
const ALLOWED_CHECK_IDS = new Set(KNOWN_CHECK_IDS);

/** Counts and lengths — structure, never content. */
const NUMERIC_FACTS = new Set([
  "paragraphCount",
  "windowParagraphs",
  "windowChars",
  "hookChars",
  "finalParagraphChars",
  "segmentCount",
  "limit",
]);

/** Did a detector fire? Enough to separate a parse miss from a real omission. */
const BOOLEAN_FACTS = new Set([
  "sectionFound",
  "hasContactChannel",
  "hasImperativeOpener",
  "hasInvitationFrame",
]);

/** Punctuation only. A delimiter character is not content about anyone. */
const DELIMITER_VALUES = new Set(["·", "|", "•"]);

/**
 * Keep a checker verdict only if every field is provably shape.
 * Unknown keys are dropped rather than trusted.
 */
export function sanitizeCheckResults(value) {
  if (!Array.isArray(value)) return [];
  const safe = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const checkId = String(entry.checkId || "");
    if (!ALLOWED_CHECK_IDS.has(checkId)) continue;
    const clean = { checkId };
    for (const [key, raw] of Object.entries(entry)) {
      if (key === "checkId") continue;
      if (NUMERIC_FACTS.has(key) && Number.isFinite(raw)) {
        clean[key] = raw;
      } else if (BOOLEAN_FACTS.has(key) && typeof raw === "boolean") {
        clean[key] = raw;
      } else if (key === "delimiter" && DELIMITER_VALUES.has(raw)) {
        clean[key] = raw;
      }
      // Anything else — messages, excerpts, matched text — is dropped.
    }
    safe.push(clean);
  }
  return safe;
}

/**
 * Accept a reason only if every token is a registered id or code. An unknown
 * token rejects the whole string rather than being passed through, so a value
 * this module has never heard of cannot reach the store by looking plausible.
 */
export function sanitizeFailureReason(value) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) return null;
  const tokens = reason.split(",").map((token) => token.trim());
  if (!tokens.length || tokens.some((token) => !ALLOWED_REASONS.has(token))) {
    return null;
  }
  return tokens.join(", ");
}
