// Explicit check tiers. The score, the blocker, and the UI must all read this
// map — never infer tier from a pass/fail bit.

export const TIER_SCORED = "scored";
export const TIER_NAMED_HIT = "named_hit";
export const TIER_ADVISORY = "advisory";

export const CHECK_TIERS = Object.freeze({
  about_hook_max_200_characters: TIER_SCORED,
  about_max_2600_characters: TIER_SCORED,
  headline_max_220_characters: TIER_SCORED,
  draft_has_no_em_dash: TIER_SCORED,
  about_has_no_delimiter_separated_keyword_run: TIER_SCORED,
  about_section_present: TIER_SCORED,
  generated_sections_have_no_delimiter_separated_keyword_run: TIER_SCORED,
  draft_registered_ai_cliche_lemma: TIER_NAMED_HIT,
  // Historical declared id — same detector, same tier.
  draft_has_no_ai_cliche_phrase: TIER_NAMED_HIT,
  about_closing_has_cta: TIER_ADVISORY,
  source_no_employer_frame_for_marked_non_employer: TIER_SCORED,
  source_claim_tenure_years: TIER_SCORED,
  source_claim_role_title: TIER_SCORED,
  source_claim_employer_frame: TIER_SCORED,
  source_claim_metric: TIER_SCORED,
  source_claim_credential: TIER_SCORED,
  source_claim_quote: TIER_SCORED,
  source_claim_other: TIER_SCORED,
});

export function tierForCheck(checkId) {
  const id = String(checkId || "");
  if (CHECK_TIERS[id]) return CHECK_TIERS[id];
  if (id.startsWith("source_")) return TIER_SCORED;
  return TIER_SCORED;
}

export function isAdvisoryResult(row) {
  const tier = row?.tier || tierForCheck(row?.checkId || row?.id);
  return (
    tier === TIER_ADVISORY ||
    row?.status === "observation"
  );
}

/** Scored fail or named_hit fail. Advisory never blocks. */
export function isBlockingCheckResult(row) {
  if (!row) return false;
  if (isAdvisoryResult(row)) return false;
  if (row.status === "observation" || row.status === "no_hit") return false;
  if (row.status === "pass" || row.passed === true) return false;
  if (row.status === "not_scoreable") return false;
  const tier = row.tier || tierForCheck(row.checkId || row.id);
  if (tier === TIER_ADVISORY) return false;
  if (row.passed === false || row.status === "fail") return true;
  // Live validator used to return failure-only objects with no status.
  if (!row.status && row.passed == null && (tier === TIER_SCORED || tier === TIER_NAMED_HIT)) {
    return Boolean(row.checkId || row.id);
  }
  return false;
}

/** Only scored pass/fail enter mechanicalCheckScore / style pass rates. */
export function contributesToMechanicalScore(row) {
  if (!row) return false;
  const tier = row.tier || tierForCheck(row.checkId || row.id);
  if (tier !== TIER_SCORED) return false;
  if (row.status === "not_scoreable" || row.status === "observation" || row.status === "no_hit") {
    return false;
  }
  return row.passed === true || row.passed === false || row.status === "pass" || row.status === "fail";
}

export const CLICHE_CHECK_IDS = Object.freeze([
  "draft_registered_ai_cliche_lemma",
  "draft_has_no_ai_cliche_phrase",
]);

export function isClicheCheckId(checkId) {
  return CLICHE_CHECK_IDS.includes(String(checkId || ""));
}
