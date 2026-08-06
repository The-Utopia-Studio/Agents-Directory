// Score draft output against a historical artifact's declared check set, plus
// optional source-grounding rules from a golden case.
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

import {
  SOURCE_GROUNDING_FAMILY,
  runSourceGroundingChecks,
} from "./sourceGrounding.js";

export const STYLE_FAMILY = "style";
export const HISTORICAL_STYLE_FAMILY = "style-historical";

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
const EM_DASH_OR_DOUBLE_HYPHEN = /—|--/;
const AI_CLICHE_SINGLE_TERMS = Object.freeze([
  "utilize", "leverage", "facilitate", "innovative", "robust", "seamless",
  "cutting-edge", "unlock", "elevate", "passionate", "synergy", "game-changer",
  "revolutionize", "revolutionary",
]);
const AI_CLICHE_PHRASES = Object.freeze(["sits at the intersection of"]);

const CTA_WINDOW_PARAGRAPHS = 2;
const CONTACT_CHANNEL =
  /(?:[\w.+-]+@[\w-]+\.[\w.]{2,}|https?:\/\/\S+|\b(?:www|linkedin|calendly|substack|github)\.[\w./-]+)/i;
const IMPERATIVE_OPENER =
  /^(?:book|email|message|call|reach|contact|connect|send|visit|schedule|join|drop|ping|write|follow|apply|subscribe|hire|explore|start|get|say|tell)\b|^(?:let'?s\b|feel free\b)/i;
const INVITATION_FRAME =
  /\b(?:available (?:for|to)|open (?:to|for)|currently taking on|taking on new|now booking|accepting|happy to|looking to|reach out|get in touch|contact me|connect with me|(?:i )?would like to connect|email me|message me|send me|dm me|drop me|write to me|say hello|let'?s (?:connect|talk|chat)|work with me|hear from you|find me at|book a|schedule a)\b/i;

/** Checks the live A7 runtime still executes. */
const LIVE_STYLE_CHECKS = new Set([
  "about_hook_max_200_characters",
  "about_max_2600_characters",
  "headline_max_220_characters",
  "about_has_no_delimiter_separated_keyword_run",
  "about_closing_has_cta",
  "draft_has_no_em_dash",
  "draft_has_no_ai_cliche_phrase",
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

function ctaSignals(windowText) {
  const sentences = windowText
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    hasContactChannel: CONTACT_CHANNEL.test(windowText),
    hasImperativeOpener: sentences.some((s) => IMPERATIVE_OPENER.test(s)),
    hasInvitationFrame: INVITATION_FRAME.test(windowText),
  };
}

function hasCompletePhrase(content, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(content);
}

function passResult(checkId, family, facts = {}) {
  return { checkId, family, status: "pass", ...facts };
}

function failResult(checkId, family, facts = {}) {
  return { checkId, family, status: "fail", ...facts };
}

function scoreHeadlineLengthCheck(output, declaredChecks, results, scored) {
  if (!declaredChecks.includes("headline_max_220_characters")) return;
  if (scored.includes("headline_max_220_characters")) return;
  scored.push("headline_max_220_characters");
  const headline = markdownSection(output, "Suggested headline");
  if (!headline) {
    results.push(
      failResult("headline_max_220_characters", STYLE_FAMILY, {
        section: "Suggested headline",
        sectionFound: false,
        headlineChars: 0,
        limit: HEADLINE_CHARACTER_LIMIT,
      }),
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
      ? failResult("headline_max_220_characters", STYLE_FAMILY, facts)
      : passResult("headline_max_220_characters", STYLE_FAMILY, facts),
  );
}

function scoreStyleChecks(output, declaredChecks) {
  const about = markdownSection(output, "LinkedIn About");
  const results = [];
  const scored = [];

  if (!about) {
    // Without About, About-scoped checks are unscoreable as a section miss —
    // still record about_section_present as fail so the score is not empty.
    // Headline length does not need About; score it below.
    results.push(
      failResult("about_section_present", STYLE_FAMILY, {
        sectionFound: false,
        paragraphCount: 0,
      }),
    );
    for (const checkId of declaredChecks) {
      if (checkId === "headline_max_220_characters") continue;
      if (
        ABOUT_SCOPED_LIVE_CHECKS.has(checkId) ||
        LIVE_STYLE_CHECKS.has(checkId) ||
        HISTORICAL_STYLE_CHECKS.has(checkId)
      ) {
        results.push({
          checkId,
          family: HISTORICAL_STYLE_CHECKS.has(checkId)
            ? HISTORICAL_STYLE_FAMILY
            : STYLE_FAMILY,
          status: "not_scoreable",
          reason: "about_section_missing",
          sectionFound: false,
        });
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
          ? failResult(checkId, STYLE_FAMILY, facts)
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
          ? failResult(checkId, STYLE_FAMILY, facts)
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
      const match = about.match(KEYWORD_RUN);
      const facts = {
        section: "LinkedIn About",
        sectionFound: true,
        paragraphCount: paragraphs.length,
        ...(match
          ? {
              delimiter: match[1],
              segmentCount: match[0].split(match[1]).filter(Boolean).length,
            }
          : {}),
      };
      results.push(
        match
          ? failResult(checkId, STYLE_FAMILY, facts)
          : passResult(checkId, STYLE_FAMILY, facts),
      );
      continue;
    }

    if (checkId === "generated_sections_have_no_delimiter_separated_keyword_run") {
      // Historical v5 implementation — all generated sections.
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
          ? failResult(checkId, HISTORICAL_STYLE_FAMILY, failed)
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
      const ok =
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
        ok
          ? passResult(checkId, STYLE_FAMILY, facts)
          : failResult(checkId, STYLE_FAMILY, facts),
      );
      continue;
    }

    if (checkId === "draft_has_no_em_dash") {
      scored.push(checkId);
      let failedSection = null;
      for (const section of GENERATED_SECTIONS) {
        const content =
          section === "LinkedIn About" ? about : markdownSection(output, section);
        if (content && EM_DASH_OR_DOUBLE_HYPHEN.test(content)) {
          failedSection = section;
          break;
        }
      }
      results.push(
        failedSection
          ? failResult(checkId, STYLE_FAMILY, {
              section: failedSection,
              sectionFound: true,
            })
          : passResult(checkId, STYLE_FAMILY, { sectionFound: true }),
      );
      continue;
    }

    if (checkId === "draft_has_no_ai_cliche_phrase") {
      scored.push(checkId);
      let failedSection = null;
      for (const section of GENERATED_SECTIONS) {
        const content =
          section === "LinkedIn About" ? about : markdownSection(output, section);
        const hit =
          content &&
          [...AI_CLICHE_SINGLE_TERMS, ...AI_CLICHE_PHRASES].some((phrase) =>
            hasCompletePhrase(content, phrase),
          );
        if (hit) {
          failedSection = section;
          break;
        }
      }
      results.push(
        failedSection
          ? failResult(checkId, STYLE_FAMILY, {
              section: failedSection,
              sectionFound: true,
            })
          : passResult(checkId, STYLE_FAMILY, { sectionFound: true }),
      );
      continue;
    }

    // Declared but no runner — not remapped silently.
    results.push({
      checkId,
      family: STYLE_FAMILY,
      status: "not_scoreable",
      reason: "no_registered_runner",
    });
    scored.push(checkId);
  }

  return { results, scored };
}

/**
 * Score one output against an artifact's declared checks + optional
 * source-grounding rules.
 *
 * @returns {{
 *   artifactVersion: string,
 *   artifactDigest: string,
 *   checkResults: object[],
 *   passed: string[],
 *   failed: string[],
 *   notScoreable: string[],
 *   mechanicalCheckScore: number|null,
 *   scoreableCount: number,
 * }}
 */
export function scoreMechanicalOutput({
  output,
  artifactVersion,
  artifactDigest,
  declaredChecks = [],
  sourceGroundingRules = [],
  sourceText = "",
}) {
  const { results: styleResults } = scoreStyleChecks(output, declaredChecks);
  const groundingResults = runSourceGroundingChecks(
    output,
    sourceGroundingRules,
    { sourceText },
  ).map((row) => ({
    ...row,
    family: row.family || SOURCE_GROUNDING_FAMILY,
  }));

  const checkResults = [...styleResults, ...groundingResults];
  const passed = checkResults
    .filter((r) => r.status === "pass")
    .map((r) => r.checkId);
  const failed = checkResults
    .filter((r) => r.status === "fail")
    .map((r) => r.checkId);
  const notScoreable = checkResults
    .filter((r) => r.status === "not_scoreable")
    .map((r) => r.checkId);

  const scoreableCount = passed.length + failed.length;
  const mechanicalCheckScore =
    scoreableCount === 0
      ? null
      : Math.round((passed.length / scoreableCount) * 1000) / 10;

  return {
    artifactVersion,
    artifactDigest,
    checkResults,
    passed,
    failed,
    notScoreable,
    mechanicalCheckScore,
    scoreableCount,
  };
}

/**
 * Compare two mechanical scores for the same output. Records which check ids
 * changed status between versions — metadata only.
 */
export function compareMechanicalScores(left, right) {
  const ids = new Set([
    ...left.checkResults.map((r) => r.checkId),
    ...right.checkResults.map((r) => r.checkId),
  ]);
  const byId = (score) =>
    Object.fromEntries(score.checkResults.map((r) => [r.checkId, r.status]));
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
    leftScore: left.mechanicalCheckScore,
    rightScore: right.mechanicalCheckScore,
    changed,
  };
}
