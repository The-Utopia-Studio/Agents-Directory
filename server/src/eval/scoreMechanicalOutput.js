// Score draft output against a historical artifact's declared check set, plus
// optional source-grounding rules from a golden case.
//
// Categories are never averaged together. Style and grounding each get their
// own pass rate. When a single headline number is needed, it is grounding —
// a falsehood cannot be diluted by style passes.
//
// Labels: this produces a mechanical check score — never "eval" or "quality".
// It does not feed fleet health.
//
// Historical note — generated_sections_have_no_delimiter_separated_keyword_run:
// v5 declared and implemented an all-generated-sections scan. v6 renamed and
// narrowed to About-only (about_has_no_delimiter_separated_keyword_run). Option
// (a): keep the v5 runner registered solely for historical scoring, marked
// historicalImplementation. Silent remapping to the v6 About-only runner is
// refused — that would score v5 with v6's implementation.

import { createHash } from "node:crypto";
import {
  SOURCE_GROUNDING_FAMILY,
  runSourceGroundingChecks,
} from "./sourceGrounding.js";
import {
  ctaSignals,
  findAllAiCliches,
  findDelimiterKeywordRun,
  hasClauseBreakDash,
} from "./styleDetectors.js";
import {
  checkSetEntriesFromInputs,
  computeCheckSetId,
} from "./checkSetId.js";
import { evaluateGuardrailGate } from "./guardrailGate.js";
import {
  TIER_ADVISORY,
  TIER_NAMED_HIT,
  TIER_SCORED,
  contributesToMechanicalScore,
  isBlockingCheckResult,
  isClicheCheckId,
  tierForCheck,
} from "./checkTiers.js";

export const STYLE_FAMILY = "style";
export const HISTORICAL_STYLE_FAMILY = "style-historical";
export const CATEGORY_STYLE = "style";
export const CATEGORY_GROUNDING = "grounding";

// Keep in step with limits in runtimeArtifacts.js — duplicated so historical
// scoring does not import the live artifact boot path.
const HOOK_CHARACTER_LIMIT = 200;
const ABOUT_CHARACTER_LIMIT = 2600;
const HEADLINE_CHARACTER_LIMIT = 220;

const KEYWORD_RUN = /(?:([·|•])[^·|•\n]*){2,}/;
const GENERATED_SECTIONS = Object.freeze([
  "LinkedIn About",
  "Spoken event introduction",
  "Suggested headline",
]);

const CTA_WINDOW_PARAGRAPHS = 2;

/** Checks the live A7 runtime still executes. */
const LIVE_STYLE_CHECKS = new Set([
  "about_hook_max_200_characters",
  "about_max_2600_characters",
  "headline_max_220_characters",
  "about_has_no_delimiter_separated_keyword_run",
  "about_closing_has_cta",
  "draft_has_no_em_dash",
  "draft_has_no_ai_cliche_phrase",
  "draft_registered_ai_cliche_lemma",
]);

/** About-scoped live checks — not scoreable when the About section is missing. */
const ABOUT_SCOPED_LIVE_CHECKS = new Set([
  "about_hook_max_200_characters",
  "about_max_2600_characters",
  "about_has_no_delimiter_separated_keyword_run",
  "about_closing_has_cta",
]);

/**
 * Historical-only. Same KEYWORD_RUN regex as live, but scans every generated
 * section — recovered from the v5 runtime at abb6a468…, not remapped to
 * about_has_no_delimiter_separated_keyword_run.
 */
const HISTORICAL_STYLE_CHECKS = new Set([
  "generated_sections_have_no_delimiter_separated_keyword_run",
]);

function markdownSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(markdown || "").match(
    new RegExp(
      `(?:^|\\n)#{1,6}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`,
      "i",
    ),
  );
  return match ? match[1].trim() : "";
}

function visibleText(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trailingWindow(paragraphs) {
  const picked = paragraphs.slice(-CTA_WINDOW_PARAGRAPHS);
  return { text: visibleText(picked.join("\n\n")), paragraphs: picked.length };
}

function categoryForFamily(family) {
  return family === SOURCE_GROUNDING_FAMILY
    ? CATEGORY_GROUNDING
    : CATEGORY_STYLE;
}

function severityFor(category, passed) {
  if (passed !== false) return null;
  return category === CATEGORY_GROUNDING ? "high" : "medium";
}

/**
 * Canonical check result: { id, passed, why, severity, category }.
 * Structural facts and legacy status/family/checkId are kept alongside.
 */
export function toCheckResult(row) {
  const id = row.id || row.checkId;
  const category = row.category || categoryForFamily(row.family);
  let passed = row.passed;
  if (passed === undefined) {
    if (row.status === "pass") passed = true;
    else if (row.status === "fail") passed = false;
    else passed = null;
  }
  const why =
    passed === false ||
    row.status === "observation" ||
    row.status === "no_hit"
      ? row.why != null
        ? row.why
        : row.message != null
          ? row.message
          : null
      : null;
  const status =
    row.status ||
    (passed === true ? "pass" : passed === false ? "fail" : "not_scoreable");
  const {
    id: _id,
    checkId: _checkId,
    passed: _passed,
    why: _why,
    severity: _sev,
    category: _cat,
    status: _st,
    family: _fam,
    message: _msg,
    ...facts
  } = row;
  return {
    id,
    checkId: id,
    passed,
    why,
    severity: row.severity !== undefined ? row.severity : severityFor(category, passed),
    category,
    status,
    family: row.family || (category === CATEGORY_GROUNDING
      ? SOURCE_GROUNDING_FAMILY
      : STYLE_FAMILY),
    tier: row.tier || tierForCheck(id),
    ...facts,
  };
}

function passResult(checkId, family, facts = {}) {
  return toCheckResult({
    checkId,
    family,
    status: "pass",
    why: null,
    ...facts,
  });
}

function failResult(checkId, family, why, facts = {}) {
  return toCheckResult({
    checkId,
    family,
    status: "fail",
    why,
    ...facts,
  });
}

function observationResult(checkId, family, why, facts = {}) {
  return toCheckResult({
    checkId,
    family,
    status: "observation",
    passed: null,
    why,
    severity: null,
    tier: TIER_ADVISORY,
    ...facts,
  });
}

function namedHitMissResult(checkId, family, facts = {}) {
  return toCheckResult({
    checkId,
    family,
    status: "no_hit",
    passed: null,
    why: null,
    severity: null,
    tier: TIER_NAMED_HIT,
    ...facts,
  });
}

function notScoreableResult(checkId, family, why, facts = {}) {
  return toCheckResult({
    checkId,
    family,
    status: "not_scoreable",
    passed: null,
    why,
    ...facts,
  });
}

/** Pass rate for one category: percentage to one decimal, or null if none scoreable. */
export function categoryPassRate(passedCount, scoreableCount) {
  if (scoreableCount === 0) return null;
  return Math.round((passedCount / scoreableCount) * 1000) / 10;
}

/**
 * Identity of the check id set a rate was computed over.
 *
 * A rate is only meaningful next to the checks that produced it. When two
 * checks were retiered out of the style pool, the style pass rate rose from
 * 57.1 to 80 on byte-identical output with identical defects — a denominator
 * change wearing the shape of an improvement. Carrying the ids makes that
 * detectable instead of plausible.
 */
export function rateBasisDigest(checkIds = []) {
  const sorted = [...checkIds].sort();
  if (!sorted.length) return null;
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}

export function summarizeCategory(checkResults, category) {
  const rows = checkResults.filter((r) => r.category === category);
  const scoredRows = rows.filter(contributesToMechanicalScore);
  const passed = scoredRows.filter((r) => r.passed === true).map((r) => r.id);
  const failed = scoredRows.filter((r) => r.passed === false).map((r) => r.id);
  const notScoreable = rows
    .filter((r) => r.passed === null || r.status === "not_scoreable")
    .filter((r) => r.status !== "observation" && r.status !== "no_hit")
    .map((r) => r.id);
  const scoreableCount = passed.length + failed.length;
  // The exact ids this rate was computed over — its denominator, itemised.
  const basisCheckIds = [...passed, ...failed].sort();
  return {
    category,
    passed,
    failed,
    notScoreable,
    scoreableCount,
    passRate: categoryPassRate(passed.length, scoreableCount),
    basisCheckIds,
    basisDigest: rateBasisDigest(basisCheckIds),
  };
}

function scoreHeadlineLengthCheck(output, declaredChecks, results, scored) {
  if (!declaredChecks.includes("headline_max_220_characters")) return;
  if (scored.includes("headline_max_220_characters")) return;
  scored.push("headline_max_220_characters");
  const headline = markdownSection(output, "Suggested headline");
  if (!headline) {
    results.push(
      failResult(
        "headline_max_220_characters",
        STYLE_FAMILY,
        "Suggested headline section is missing or not labelled exactly.",
        {
          section: "Suggested headline",
          sectionFound: false,
          headlineChars: 0,
          limit: HEADLINE_CHARACTER_LIMIT,
        },
      ),
    );
    return;
  }
  const headlineVisible = visibleText(headline);
  const facts = {
    section: "Suggested headline",
    sectionFound: true,
    headlineChars: headlineVisible.length,
    limit: HEADLINE_CHARACTER_LIMIT,
  };
  results.push(
    headlineVisible.length > HEADLINE_CHARACTER_LIMIT
      ? failResult(
          "headline_max_220_characters",
          STYLE_FAMILY,
          `Suggested headline is ${headlineVisible.length} characters; maximum is ${HEADLINE_CHARACTER_LIMIT}.`,
          facts,
        )
      : passResult("headline_max_220_characters", STYLE_FAMILY, facts),
  );
}

function scoreStyleChecks(output, declaredChecks) {
  const about = markdownSection(output, "LinkedIn About");
  const results = [];
  const scored = [];

  if (!about) {
    results.push(
      failResult(
        "about_section_present",
        STYLE_FAMILY,
        "LinkedIn About section is missing or not labelled exactly.",
        {
          sectionFound: false,
          paragraphCount: 0,
        },
      ),
    );
    for (const checkId of declaredChecks) {
      if (checkId === "headline_max_220_characters") continue;
      if (
        ABOUT_SCOPED_LIVE_CHECKS.has(checkId) ||
        LIVE_STYLE_CHECKS.has(checkId) ||
        HISTORICAL_STYLE_CHECKS.has(checkId)
      ) {
        results.push(
          notScoreableResult(
            checkId,
            HISTORICAL_STYLE_CHECKS.has(checkId)
              ? HISTORICAL_STYLE_FAMILY
              : STYLE_FAMILY,
            "About section missing — this check cannot be scored.",
            {
              reason: "about_section_missing",
              sectionFound: false,
            },
          ),
        );
        scored.push(checkId);
      }
    }
    scoreHeadlineLengthCheck(output, declaredChecks, results, scored);
    return { results, scored };
  }

  const paragraphs = about
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const hook = visibleText(paragraphs[0] || "");
  const aboutVisible = visibleText(about);

  for (const checkId of declaredChecks) {
    if (checkId === "about_hook_max_200_characters") {
      scored.push(checkId);
      const facts = {
        sectionFound: true,
        paragraphCount: paragraphs.length,
        hookChars: hook.length,
        limit: HOOK_CHARACTER_LIMIT,
      };
      results.push(
        hook.length > HOOK_CHARACTER_LIMIT
          ? failResult(
              checkId,
              STYLE_FAMILY,
              `LinkedIn About hook is ${hook.length} characters; maximum is ${HOOK_CHARACTER_LIMIT}.`,
              facts,
            )
          : passResult(checkId, STYLE_FAMILY, facts),
      );
      continue;
    }

    if (checkId === "about_max_2600_characters") {
      scored.push(checkId);
      const facts = {
        sectionFound: true,
        paragraphCount: paragraphs.length,
        aboutChars: aboutVisible.length,
        limit: ABOUT_CHARACTER_LIMIT,
      };
      results.push(
        aboutVisible.length > ABOUT_CHARACTER_LIMIT
          ? failResult(
              checkId,
              STYLE_FAMILY,
              `LinkedIn About is ${aboutVisible.length} characters; maximum is ${ABOUT_CHARACTER_LIMIT}.`,
              facts,
            )
          : passResult(checkId, STYLE_FAMILY, facts),
      );
      continue;
    }

    if (checkId === "headline_max_220_characters") {
      scoreHeadlineLengthCheck(output, declaredChecks, results, scored);
      continue;
    }

    if (checkId === "about_has_no_delimiter_separated_keyword_run") {
      scored.push(checkId);
      const match = findDelimiterKeywordRun(about);
      const facts = {
        section: "LinkedIn About",
        sectionFound: true,
        paragraphCount: paragraphs.length,
        ...(match
          ? {
              delimiter: match.delimiter,
              segmentCount: match.segmentCount,
            }
          : {}),
      };
      results.push(
        match
          ? failResult(
              checkId,
              STYLE_FAMILY,
              "LinkedIn About contains a delimiter-separated keyword run.",
              facts,
            )
          : passResult(checkId, STYLE_FAMILY, facts),
      );
      continue;
    }

    if (checkId === "generated_sections_have_no_delimiter_separated_keyword_run") {
      scored.push(checkId);
      let failed = null;
      for (const section of GENERATED_SECTIONS) {
        const content =
          section === "LinkedIn About" ? about : markdownSection(output, section);
        if (!content) continue;
        const match = content.match(KEYWORD_RUN);
        if (!match) continue;
        failed = {
          section,
          sectionFound: true,
          paragraphCount: content
            .split(/\n\s*\n/)
            .map((part) => part.trim())
            .filter(Boolean).length,
          delimiter: match[1],
          segmentCount: match[0].split(match[1]).filter(Boolean).length,
          historicalImplementation: true,
        };
        break;
      }
      results.push(
        failed
          ? failResult(
              checkId,
              HISTORICAL_STYLE_FAMILY,
              `${failed.section} contains a delimiter-separated keyword run.`,
              failed,
            )
          : passResult(checkId, HISTORICAL_STYLE_FAMILY, {
              sectionFound: true,
              historicalImplementation: true,
            }),
      );
      continue;
    }

    if (checkId === "about_closing_has_cta") {
      scored.push(checkId);
      const window = trailingWindow(paragraphs);
      const signals = ctaSignals(window.text);
      const fired =
        signals.hasContactChannel ||
        signals.hasImperativeOpener ||
        signals.hasInvitationFrame;
      const facts = {
        sectionFound: true,
        paragraphCount: paragraphs.length,
        windowParagraphs: window.paragraphs,
        windowChars: window.text.length,
        ...signals,
      };
      results.push(
        observationResult(
          checkId,
          STYLE_FAMILY,
          fired
            ? "Advisory CTA heuristic fired in the closing. This is not a scored pass."
            : "Advisory: no CTA heuristic fired in the LinkedIn About closing (trailing two paragraphs). This is not a scored fail.",
          facts,
        ),
      );
      continue;
    }

    if (checkId === "draft_has_no_em_dash") {
      scored.push(checkId);
      let failedSection = null;
      for (const section of GENERATED_SECTIONS) {
        const content =
          section === "LinkedIn About" ? about : markdownSection(output, section);
        if (content && hasClauseBreakDash(content)) {
          failedSection = section;
          break;
        }
      }
      results.push(
        failedSection
          ? failResult(
              checkId,
              STYLE_FAMILY,
              `${failedSection} contains a dash used as a clause break (em dash, en dash, horizontal bar, double hyphen, or spaced hyphen).`,
              {
                section: failedSection,
                sectionFound: true,
              },
            )
          : passResult(checkId, STYLE_FAMILY, { sectionFound: true }),
      );
      continue;
    }

    if (isClicheCheckId(checkId)) {
      scored.push(checkId);
      // Scan every section and report every hit. Stopping at the first one
      // hid the count, and the count is what the maker uses to choose which
      // defect to attack — one cliche and four cliches must not look alike.
      const hits = [];
      for (const section of GENERATED_SECTIONS) {
        const content =
          section === "LinkedIn About" ? about : markdownSection(output, section);
        if (!content) continue;
        for (const hit of findAllAiCliches(content)) {
          hits.push({
            section,
            registeredPhrase: hit.registeredPhrase,
            surface: hit.surface,
          });
        }
      }
      const lemmas = [...new Set(hits.map((h) => h.registeredPhrase))];
      results.push(
        hits.length
          ? failResult(
              checkId,
              STYLE_FAMILY,
              `${hits.length} registered AI cliche hit${hits.length === 1 ? "" : "s"} ` +
                `across ${new Set(hits.map((h) => h.section)).size} section(s): ` +
                `${lemmas.join(", ")}. This is a named hit against a closed list, ` +
                `not a certification that the draft is free of AI voice.`,
              {
                // First hit keeps its historical field names so existing
                // readers keep working; the full list sits beside them.
                section: hits[0].section,
                sectionFound: true,
                registeredPhrase: hits[0].registeredPhrase,
                hitCount: hits.length,
                registeredPhrases: lemmas,
                hits,
                tier: TIER_NAMED_HIT,
              },
            )
          : namedHitMissResult(checkId, STYLE_FAMILY, {
              sectionFound: true,
              hitCount: 0,
              registeredPhrases: [],
              hits: [],
            }),
      );
      continue;
    }

    results.push(
      notScoreableResult(
        checkId,
        STYLE_FAMILY,
        "No registered runner for this declared check.",
        { reason: "no_registered_runner" },
      ),
    );
    scored.push(checkId);
  }

  return { results, scored };
}

/**
 * Score one output against an artifact's declared checks + optional
 * source-grounding rules.
 *
 * Returns two separately named rates — `groundingPassRate` and
 * `stylePassRate` — and never a combined one. There is no single field here
 * that means "how good is the agent"; asking that question requires reading
 * both, with their denominators.
 */
export function scoreMechanicalOutput({
  output,
  artifactVersion,
  artifactDigest,
  declaredChecks = [],
  sourceGroundingRules = [],
  sourceText = "",
  guardrails = [],
  rulerVersion = null,
  // Legacy field kept on the wire for older readers; never used for
  // comparability. Prefer checkSetId + artifactVersion.
  checkSetVersion = null,
}) {
  const { results: styleResults } = scoreStyleChecks(output, declaredChecks);
  const groundingResults = runSourceGroundingChecks(
    output,
    sourceGroundingRules,
    { sourceText },
  ).map((row) =>
    toCheckResult({
      ...row,
      family: row.family || SOURCE_GROUNDING_FAMILY,
      category: CATEGORY_GROUNDING,
    }),
  );

  const checkResults = [...styleResults, ...groundingResults].map(toCheckResult);
  const grounding = summarizeCategory(checkResults, CATEGORY_GROUNDING);
  const style = summarizeCategory(checkResults, CATEGORY_STYLE);

  const passed = checkResults
    .filter((r) => (r.tier || tierForCheck(r.id)) === TIER_SCORED && r.passed === true)
    .map((r) => r.id);
  const failed = checkResults
    .filter((r) => isBlockingCheckResult(r))
    .map((r) => r.id);
  const notScoreable = checkResults
    .filter((r) => r.status === "not_scoreable")
    .map((r) => r.id);
  const observations = checkResults
    .filter((r) => r.status === "observation" || (r.tier || tierForCheck(r.id)) === TIER_ADVISORY)
    .map((r) => r.id);

  // Two separately named rates. There is deliberately no combined number and
  // no field a reader can mistake for whole-agent quality: `groundingPassRate`
  // says what it measures in its name, and style is reported beside it.
  const groundingPassRate = grounding.passRate;
  const groundingScoreableCount = grounding.scoreableCount;

  const checkSetId = computeCheckSetId(
    checkSetEntriesFromInputs(declaredChecks, sourceGroundingRules),
  );

  // Binary gate — never folded into mechanicalCheckScore / pass rates.
  const guardrailGate = evaluateGuardrailGate({
    output,
    guardrails,
    groundingResults,
  });

  return {
    artifactVersion,
    artifactDigest,
    checkSetId,
    // Legacy alias only; comparability uses checkSetId.
    checkSetVersion: checkSetVersion || null,
    ...(rulerVersion ? { rulerVersion } : {}),
    checkResults,
    passed,
    failed,
    notScoreable,
    observations,
    byCategory: {
      grounding,
      style,
    },
    // Grounding pass rate among scored grounding checks. named_hit / advisory
    // never enter it, and style never enters it. NOT whole-agent quality.
    groundingPassRate,
    groundingScoreableCount,
    groundingBasisCheckIds: grounding.basisCheckIds,
    groundingBasisDigest: grounding.basisDigest,
    // Reported beside grounding, never averaged with it.
    stylePassRate: style.passRate,
    styleScoreableCount: style.scoreableCount,
    styleBasisCheckIds: style.basisCheckIds,
    styleBasisDigest: style.basisDigest,
    guardrailGate,
  };
}

/**
 * Read a grounding pass rate from a score or a stored row.
 *
 * `mechanicalCheckScore` is the historical key for this number. Nothing writes
 * it any more; rows persisted before the rename still carry it, so reads fall
 * back rather than silently reporting "not measured" for real history.
 */
export function readGroundingPassRate(row) {
  if (!row || typeof row !== "object") return null;
  if (typeof row.groundingPassRate === "number") return row.groundingPassRate;
  if (typeof row.byCategory?.grounding?.passRate === "number") {
    return row.byCategory.grounding.passRate;
  }
  // Historical alias only.
  if (typeof row.mechanicalCheckScore === "number") return row.mechanicalCheckScore;
  return null;
}

/** Denominator for a grounding rate, with the same historical fallback. */
export function readGroundingScoreableCount(row) {
  if (!row || typeof row !== "object") return null;
  if (typeof row.groundingScoreableCount === "number") {
    return row.groundingScoreableCount;
  }
  if (typeof row.byCategory?.grounding?.scoreableCount === "number") {
    return row.byCategory.grounding.scoreableCount;
  }
  if (typeof row.scoreableCount === "number") return row.scoreableCount;
  return null;
}

/**
 * Compare two mechanical scores for the same output. Records which check ids
 * changed status between versions — metadata only. Does not invent a delta.
 */
export function compareMechanicalScores(left, right) {
  const ids = new Set([
    ...left.checkResults.map((r) => r.id || r.checkId),
    ...right.checkResults.map((r) => r.id || r.checkId),
  ]);
  const byId = (score) =>
    Object.fromEntries(
      score.checkResults.map((r) => [r.id || r.checkId, r.status]),
    );
  const leftMap = byId(left);
  const rightMap = byId(right);
  const changed = [];
  for (const id of [...ids].sort()) {
    const from = leftMap[id] || "absent";
    const to = rightMap[id] || "absent";
    if (from !== to) changed.push({ checkId: id, from, to });
  }
  return {
    leftVersion: left.artifactVersion,
    rightVersion: right.artifactVersion,
    leftGroundingPassRate: readGroundingPassRate(left),
    rightGroundingPassRate: readGroundingPassRate(right),
    leftStylePassRate: left.stylePassRate ?? null,
    rightStylePassRate: right.stylePassRate ?? null,
    changed,
  };
}
