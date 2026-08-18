// Deterministic post-generation cleanup for rules that should never be
// prompt-edit proposals. Applied before mechanical validation so the returned
// draft already satisfies these checks when possible.
//
// Maker must not propose prompt changes for POST_PROCESSED_CHECK_IDS — the
// host enforces them in code.

const EM_DASH = /\u2014/g;
const DOUBLE_HYPHEN = /(?<![A-Za-z0-9])--(?![A-Za-z0-9])/g;
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu;
const EXCLAMATION = /!+/g;

/** Banned term → replacement. Empty string means delete the token. */
export const BANNED_TERM_REPLACEMENTS = Object.freeze({
  utilize: "use",
  leverage: "use",
  facilitate: "help",
  innovative: "new",
  robust: "strong",
  seamless: "smooth",
  "cutting-edge": "modern",
  unlock: "open",
  elevate: "raise",
  passionate: "",
  synergy: "",
  "game-changer": "",
  revolutionize: "change",
  revolutionary: "new",
});

/**
 * Check ids enforced by postProcessDraft — excluded from maker defect classes.
 * CTA presence stays a maker/check concern (detectable, not mechanically fixable).
 */
export const POST_PROCESSED_CHECK_IDS = Object.freeze([
  "draft_has_no_em_dash",
  "draft_has_no_ai_cliche_phrase",
  "about_hook_max_200_characters",
  "about_max_2600_characters",
  "headline_max_220_characters",
]);

export const HOOK_LIMIT = 200;
export const ABOUT_LIMIT = 2600;
export const HEADLINE_LIMIT = 220;

function replaceBannedTerms(text) {
  let out = String(text || "");
  for (const [term, replacement] of Object.entries(BANNED_TERM_REPLACEMENTS)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, "gi");
    out = out.replace(re, (match, _word, offset) => {
      const lead = match.slice(0, match.length - String(_word).length);
      if (!replacement) {
        return lead.replace(/\s+$/, "") || (offset === 0 ? "" : " ");
      }
      const capped =
        _word[0] === _word[0].toUpperCase()
          ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
          : replacement;
      return `${lead}${capped}`;
    });
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/ \n/g, "\n");
}

/** Em dash / double-hyphen → spaced hyphen (readable substitute, not deletion). */
function replaceEmDashes(text) {
  return String(text || "")
    .replace(EM_DASH, " - ")
    .replace(DOUBLE_HYPHEN, " - ")
    .replace(/ +\- +/g, " - ")
    .replace(/[ \t]{2,}/g, " ");
}

function stripEmojiAndExclamations(text) {
  return String(text || "")
    .replace(EMOJI, "")
    .replace(EXCLAMATION, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/[ \t]{2,}/g, " ");
}

function markdownSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(markdown || "").match(
    new RegExp(
      `(^|\\n)(#{1,6}\\s*${escaped}\\s*\\n)([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`,
      "i",
    ),
  );
  if (!match) return null;
  return {
    full: match[0].startsWith("\n") ? match[0].slice(1) : match[0],
    headingLine: match[2],
    body: match[3],
    start: match.index + (match[1] === "\n" ? 1 : 0),
  };
}

function visibleLength(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

function truncateVisible(text, limit) {
  const raw = String(text || "");
  if (visibleLength(raw) <= limit) return raw;
  // Prefer paragraph/sentence boundaries inside the limit window.
  let cut = raw;
  while (visibleLength(cut) > limit && cut.length > 0) {
    cut = cut.slice(0, -1);
  }
  const trimmed = cut.replace(/\s+\S*$/, "").trimEnd();
  return trimmed || cut.trimEnd();
}

function rewriteSection(markdown, heading, rewriteBody) {
  const section = markdownSection(markdown, heading);
  if (!section) return markdown;
  const nextBody = rewriteBody(section.body);
  if (nextBody === section.body) return markdown;
  const replacement = `${section.headingLine}${nextBody}`;
  return (
    markdown.slice(0, section.start) +
    replacement +
    markdown.slice(section.start + section.full.length)
  );
}

/**
 * Apply deterministic cleanup. Returns { output, applied: string[] }.
 */
export function postProcessDraft(output) {
  const applied = [];
  let text = String(output || "");
  const before = text;

  const withDashes = replaceEmDashes(text);
  if (withDashes !== text) {
    applied.push("draft_has_no_em_dash");
    text = withDashes;
  }

  const withTerms = replaceBannedTerms(text);
  if (withTerms !== text) {
    applied.push("draft_has_no_ai_cliche_phrase");
    text = withTerms;
  }

  const withNoise = stripEmojiAndExclamations(text);
  if (withNoise !== text) {
    applied.push("emoji_exclamation");
    text = withNoise;
  }

  const about = markdownSection(text, "LinkedIn About");
  if (about) {
    const paragraphs = about.body.split(/\n\s*\n/);
    if (paragraphs[0] && visibleLength(paragraphs[0]) > HOOK_LIMIT) {
      paragraphs[0] = truncateVisible(paragraphs[0], HOOK_LIMIT);
      text = rewriteSection(text, "LinkedIn About", () =>
        paragraphs.join("\n\n"),
      );
      applied.push("about_hook_max_200_characters");
    }
    const aboutNow = markdownSection(text, "LinkedIn About");
    if (aboutNow && visibleLength(aboutNow.body) > ABOUT_LIMIT) {
      text = rewriteSection(text, "LinkedIn About", (body) =>
        truncateVisible(body, ABOUT_LIMIT),
      );
      applied.push("about_max_2600_characters");
    }
  }

  const headline = markdownSection(text, "Suggested headline");
  if (headline && visibleLength(headline.body) > HEADLINE_LIMIT) {
    text = rewriteSection(text, "Suggested headline", (body) =>
      truncateVisible(body, HEADLINE_LIMIT),
    );
    applied.push("headline_max_220_characters");
  }

  return {
    output: text,
    applied: [...new Set(applied)],
    changed: text !== before,
  };
}

export function isPostProcessedCheckId(checkId) {
  return POST_PROCESSED_CHECK_IDS.includes(String(checkId || ""));
}
