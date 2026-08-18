// Shared detectors for the live A7 style checks. Imported by the runtime
// validator and by historical mechanical scoring so the four widened rules
// have one implementation.

const PAIRWISE_SLASH = /\b(?:and\/or|he\/she|she\/he|s\/he|him\/her|his\/her|TCP\/IP|HTTP\/2|I\/O|Q\/A)\b/gi;
const URL_OR_DATE_SLASH =
  /https?:\/\/\S+|\bwww\.\S+|\b\d{1,4}\/\d{1,2}\/\d{1,4}\b/gi;

/** Em dash, en dash, horizontal bar, double hyphen, or spaced hyphen as a clause break. */
const CLAUSE_BREAK_DASH =
  /[\u2013\u2014\u2015]|(?<![A-Za-z0-9])--(?![A-Za-z0-9])|(?<=\S) - (?=\S)/;

export const AI_CLICHE_SINGLE_TERMS = Object.freeze([
  "utilize", "leverage", "facilitate", "innovative", "robust", "seamless",
  "cutting-edge", "unlock", "elevate", "passionate", "synergy", "game-changer",
  "revolutionize", "revolutionary",
]);

export const AI_CLICHE_PHRASE_VARIANTS = Object.freeze([
  {
    registered: "sits at the intersection of",
    variants: Object.freeze([
      "sits at the intersection of",
      "sit at the intersection of",
      "sitting at the intersection of",
      "sat at the intersection of",
      "sits at the crossroads of",
      "sit at the crossroads of",
      "sitting at the crossroads of",
      "sat at the crossroads of",
    ]),
  },
]);

const CONTACT_CHANNEL =
  /(?:[\w.+-]+@[\w-]+\.[\w.]{2,}|https?:\/\/\S+|\b(?:www|linkedin|calendly|substack|github)\.[\w./-]+)/i;

const IMPERATIVE_OPENER =
  /^(?:book|email|message|call|reach|contact|connect|send|visit|schedule|join|drop|ping|write|follow|apply|subscribe|hire|explore|start|get|say|tell)\b|^(?:let'?s\b|feel free\b)/i;

const IMPERATIVE_READER_OR_ACTION =
  /\b(?:you|your|me|us|we|here|out|call|email|message|chat|note|slot|time|coffee|meeting|conversation|demo|walkthrough|touch|contact|linkedin)\b/i;

const INVITATION_FRAME =
  /\b(?:available (?:for|to)|open (?:to|for)|currently taking on|taking on new|now booking|accepting|happy to|looking to|reach out|get in touch|contact me|connect with me|(?:i )?would like to connect|email me|message me|send me|dm me|drop me|write to me|say hello|let'?s (?:connect|talk|chat)|work with me|hear from you|find me at|book a|schedule a)\b/i;

export function hasClauseBreakDash(content) {
  return CLAUSE_BREAK_DASH.test(String(content || ""));
}

function inflectionSource(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (term.includes("-") || term.includes(" ")) {
    return `${escaped}s?`;
  }
  if (term.endsWith("e")) {
    const stem = escaped.slice(0, -1);
    return `${stem}(?:e(?:s|d|ly)?|ing)`;
  }
  if (term.endsWith("y") && !/[aeiou]y$/i.test(term)) {
    const stem = escaped.slice(0, -1);
    return `(?:${escaped}(?:s|ing|ed|ly)?|${stem}ies)`;
  }
  return `${escaped}(?:s|es|ed|ing|ly)?`;
}

function hasCompletePhrase(content, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(content);
}

/**
 * Every registered cliche hit in the text, in order of first occurrence.
 *
 * A named_hit scanner that stops at the first match under-reports by design,
 * and the count is load-bearing: the maker picks which defect to attack from
 * what the scanner reports, so one hit and four hits must not look alike.
 *
 * One entry per registered lemma — a lemma appearing twice is one defect, not
 * two — but every distinct lemma is reported. `surface` is the text as written,
 * which is how an inflected or near-variant evasion stays visible next to the
 * base form it maps to.
 */
export function findAllAiCliches(content) {
  const text = String(content || "");
  if (!text) return [];
  const hits = [];
  for (const term of AI_CLICHE_SINGLE_TERMS) {
    const re = new RegExp(`(?:^|[^a-z0-9])${inflectionSource(term)}(?=$|[^a-z0-9])`, "i");
    const match = text.match(re);
    if (match) {
      hits.push({
        registeredPhrase: term,
        surface: match[0].replace(/^[^a-z0-9]+/i, ""),
        index: match.index ?? text.toLowerCase().indexOf(match[0].toLowerCase()),
      });
    }
  }
  for (const entry of AI_CLICHE_PHRASE_VARIANTS) {
    let best = null;
    for (const variant of entry.variants) {
      if (!hasCompletePhrase(text, variant)) continue;
      const at = text.toLowerCase().indexOf(variant.toLowerCase());
      if (best === null || at < best.index) {
        best = { registeredPhrase: entry.registered, surface: variant, index: at };
      }
    }
    if (best) hits.push(best);
  }
  return hits
    .sort((a, b) => a.index - b.index)
    .map(({ registeredPhrase, surface }) => ({ registeredPhrase, surface }));
}

/**
 * First hit only. Kept for callers that need a yes/no; prefer
 * findAllAiCliches anywhere the number of distinct cliches matters.
 */
export function findAiCliche(content) {
  return findAllAiCliches(content)[0] || null;
}

export function findDelimiterKeywordRun(text) {
  const source = String(text || "");
  const masked = source
    .replace(URL_OR_DATE_SLASH, (m) => " ".repeat(m.length))
    .replace(PAIRWISE_SLASH, (m) => " ".repeat(m.length));
  const match = masked.match(/(?:([·|•/])[^·|•/\n]*){2,}/);
  if (!match) return null;
  const delimiter = match[1];
  return {
    delimiter,
    segmentCount: match[0].split(delimiter).filter(Boolean).length,
  };
}

export function ctaSignals(windowText) {
  const sentences = String(windowText || "")
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    hasContactChannel: CONTACT_CHANNEL.test(windowText),
    hasImperativeOpener: sentences.some(
      (s) => IMPERATIVE_OPENER.test(s) && IMPERATIVE_READER_OR_ACTION.test(s),
    ),
    hasInvitationFrame: INVITATION_FRAME.test(windowText),
  };
}
