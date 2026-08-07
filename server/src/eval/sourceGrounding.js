// Source-grounding checks: compare output against supplied source facts.
// Distinct family from style / banned-token scanners — a result must never
// imply these were style-scanned.
//
// Crude and deterministic on purpose. An LLM judge is not a regression baseline.
//
// Founding-verb rules are directed: "founded … Company" or "Company … founder".
// A bag-of-words window across a whole draft falsely credits Company B when
// the output founded Company A in the same sentence (the Mira trap).

export const SOURCE_GROUNDING_FAMILY = "source-grounding";

const FOUNDING_VERBS = Object.freeze([
  "founded",
  "founding",
  "founder",
  "co-founded",
  "cofounded",
  "co-founder",
  "cofounder",
]);

/** Default proximity for token pairs (e.g. Intern near Helix). */
export const DEFAULT_SOURCE_WINDOW_WORDS = 12;

/**
 * Tighter directed window for founding↔company. Long enough for
 * "founding designer at Northline", short enough that "founded Dextrum …
 * works at Northline" does not count as founding Northline.
 */
export const FOUNDING_SOURCE_WINDOW_WORDS = 4;

/** Proximity for "at Entity" employer-frame detection. */
export const EMPLOYER_FRAME_WINDOW_WORDS = 3;

/**
 * Tokens that establish employment near an entity in source material.
 * Deliberately excludes tool/event language and bare "work"/"employer"
 * (those false-positive on "client work" and "not an employer").
 */
const EMPLOYMENT_CUES = Object.freeze([
  "worked",
  "working",
  "works",
  "contractor",
  "employee",
  "intern",
  "internship",
  "hired",
  "employed",
  "apprentice",
  "apprenticeship",
  "staff",
]);

/** Prepositions/verbs that mean tool-use or event attendance, not employment. */
const NON_EMPLOYER_EXCUSES = Object.freeze([
  "using",
  "with",
  "via",
  "through",
  "during",
  "built",
  "building",
  "prototype",
  "prototyping",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function indicesOf(tokens, needle) {
  const want = needle.toLowerCase();
  const hits = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === want) hits.push(i);
  }
  return hits;
}

function withinWindow(aIndices, bIndices, windowWords) {
  for (const a of aIndices) {
    for (const b of bIndices) {
      if (Math.abs(a - b) <= windowWords) return true;
    }
  }
  return false;
}

/**
 * True when a founding verb claims the company: verb then company within
 * window, or company then founder/founding within window.
 */
function foundingClaimsCompany(tokens, company, windowWords) {
  const companyHits = indicesOf(tokens, company);
  if (!companyHits.length) return { near: false, partnerPresent: false };

  let partnerPresent = false;
  for (let i = 0; i < tokens.length; i++) {
    if (!FOUNDING_VERBS.includes(tokens[i])) continue;
    partnerPresent = true;
    const verb = tokens[i];
    for (const c of companyHits) {
      // "founded Dextrum" / "founding designer at Northline"
      if (c > i && c - i <= windowWords) return { near: true, partnerPresent };
      // "Northline founder" / "Northline's founding"
      if (
        i > c &&
        i - c <= windowWords &&
        (verb === "founder" ||
          verb === "founding" ||
          verb === "co-founder" ||
          verb === "cofounder")
      ) {
        return { near: true, partnerPresent };
      }
    }
  }
  return { near: false, partnerPresent };
}

/**
 * True when source material establishes the entity as an employer/workplace.
 * Tools ("uses Factory"), platforms, and events ("Snoonu Hackathon") must not
 * match — those are the Mira Factory / hackathon traps.
 */
export function sourceEstablishesEmployer(sourceText, entity) {
  const tokens = tokenize(sourceText);
  const hits = indicesOf(tokens, entity);
  if (!hits.length) return false;
  for (const h of hits) {
    for (
      let i = Math.max(0, h - DEFAULT_SOURCE_WINDOW_WORDS);
      i <= Math.min(tokens.length - 1, h + DEFAULT_SOURCE_WINDOW_WORDS);
      i++
    ) {
      if (EMPLOYMENT_CUES.includes(tokens[i])) return true;
      // "worked for Dextrum" / "for Helix"
      if (tokens[i] === "for" && Math.abs(i - h) <= 3) return true;
    }
    // Directed founding claim only — keep the tight window so "founding …
    // Northline … Uses Factory" does not credit Factory as founded/employed.
    if (
      foundingClaimsCompany(tokens, entity, FOUNDING_SOURCE_WINDOW_WORDS).near
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True when output presents the entity as a workplace via "at Entity"
 * without a tool/event excuse immediately before the preposition.
 */
export function outputHasEmployerFrame(
  outputText,
  entity,
  windowWords = EMPLOYER_FRAME_WINDOW_WORDS,
) {
  const tokens = tokenize(outputText);
  const hits = indicesOf(tokens, entity);
  for (const h of hits) {
    for (let i = Math.max(0, h - windowWords); i < h; i++) {
      if (tokens[i] !== "at") continue;
      const before = tokens.slice(Math.max(0, i - 2), i);
      if (before.some((t) => NON_EMPLOYER_EXCUSES.includes(t))) continue;
      return true;
    }
  }
  return false;
}

/**
 * Discover entities the source itself marks as tools/platforms/events — not a
 * declared golden-case list. Live runs need this: unstructured prose has no
 * Mira-style anchor table, but local markers ("Uses X", "X Hackathon",
 * "X (… tool)", "not an employer") are answerable without an LLM.
 *
 * Returns lowercase entity tokens only — never raw substrings for traces.
 */
export function discoverMarkedNonEmployerEntities(sourceText) {
  const text = String(sourceText || "");
  const found = new Set();

  for (const match of text.matchAll(
    /\b(?:[Uu]ses|[Uu]sing)\s+([A-Z][A-Za-z0-9]+)\b/g,
  )) {
    found.add(match[1].toLowerCase());
  }

  for (const match of text.matchAll(
    /\b([A-Z][A-Za-z0-9]+)\s*\(([^)]*)\)/g,
  )) {
    const gloss = match[2].toLowerCase();
    if (
      /\b(?:tool|platform|event|hackathon)\b/.test(gloss) ||
      /\bnot an employer\b/.test(gloss)
    ) {
      found.add(match[1].toLowerCase());
    }
  }

  for (const match of text.matchAll(
    /\b([A-Z][A-Za-z0-9]+)\s+Hackathon\b/g,
  )) {
    found.add(match[1].toLowerCase());
  }

  for (const match of text.matchAll(
    /\b([A-Z][A-Za-z0-9]+)(?:\s*[—–-]|\s+)\s*not an employer\b/gi,
  )) {
    found.add(match[1].toLowerCase());
  }

  return [...found].sort();
}

/**
 * Live host check: any source-marked non-employer framed as a workplace in
 * the draft. One closed-vocabulary id; counts/booleans only — never entity
 * names (those would be content about the fellow).
 */
export function liveMarkedNonEmployerFrameFailures(output, sourceText) {
  const marked = discoverMarkedNonEmployerEntities(sourceText);
  if (!marked.length) return [];

  let framedCount = 0;
  for (const entity of marked) {
    if (sourceEstablishesEmployer(sourceText, entity)) continue;
    if (outputHasEmployerFrame(output, entity)) framedCount += 1;
  }
  if (!framedCount) return [];

  return [
    {
      checkId: "source_no_employer_frame_for_marked_non_employer",
      family: SOURCE_GROUNDING_FAMILY,
      why: `Output frames ${framedCount} source-marked non-employer entit${framedCount === 1 ? "y" : "ies"} as a workplace.`,
      sectionFound: true,
      sourceAllowsEmployer: false,
      employerFramed: true,
      markedNonEmployerCount: marked.length,
      framedNonEmployerCount: framedCount,
    },
  ];
}

/**
 * @typedef {Object} SourceGroundingRule
 * @property {string} checkId
 * @property {"require-near"|"forbid-near"|"forbid-employer-frame"} kind
 * @property {string} anchor
 * @property {string} [requiredToken]
 * @property {"founding-verb"} [requiredClass]
 * @property {"founding-verb"} [forbiddenClass]
 * @property {number} [windowWords]
 */

/**
 * @param {string} output
 * @param {SourceGroundingRule[]} [rules]
 * @param {{ sourceText?: string }} [options] sourceText required for
 *   forbid-employer-frame (entity may only be an employer if source says so).
 */
export function runSourceGroundingChecks(output, rules = [], options = {}) {
  const tokens = tokenize(output);
  const sourceText = options.sourceText || "";
  const results = [];

  for (const rule of rules) {
    const defaultWindow =
      rule.kind === "forbid-employer-frame"
        ? EMPLOYER_FRAME_WINDOW_WORDS
        : rule.requiredClass === "founding-verb" ||
            rule.forbiddenClass === "founding-verb"
          ? FOUNDING_SOURCE_WINDOW_WORDS
          : DEFAULT_SOURCE_WINDOW_WORDS;
    const windowWords = Number.isFinite(rule.windowWords)
      ? rule.windowWords
      : defaultWindow;
    const anchorHits = indicesOf(tokens, rule.anchor);
    const base = {
      checkId: rule.checkId,
      family: SOURCE_GROUNDING_FAMILY,
      sectionFound: tokens.length > 0,
      windowWords,
      anchorPresent: anchorHits.length > 0,
    };

    if (rule.kind === "forbid-employer-frame") {
      const sourceAllows = sourceEstablishesEmployer(sourceText, rule.anchor);
      const framed = outputHasEmployerFrame(output, rule.anchor, windowWords);
      // Source already names it as an employer → framing is allowed.
      // Absent mention cannot invent a workplace → pass.
      const fail = !sourceAllows && framed;
      results.push({
        ...base,
        status: fail ? "fail" : "pass",
        why: fail
          ? `Output frames "${rule.anchor}" as an employer/workplace, but source does not establish that relationship.`
          : null,
        sourceAllowsEmployer: sourceAllows,
        employerFramed: framed,
        near: framed,
        partnerPresent: framed,
      });
      continue;
    }

    if (
      rule.kind === "require-near" &&
      rule.requiredClass === "founding-verb"
    ) {
      const claim = foundingClaimsCompany(tokens, rule.anchor, windowWords);
      const fail = !claim.near;
      results.push({
        ...base,
        status: fail ? "fail" : "pass",
        why: fail
          ? `Output does not preserve a founding-verb claim near "${rule.anchor}" that the source requires.`
          : null,
        partnerPresent: claim.partnerPresent,
        near: claim.near,
        directed: true,
      });
      continue;
    }

    if (
      rule.kind === "forbid-near" &&
      rule.forbiddenClass === "founding-verb"
    ) {
      const claim = foundingClaimsCompany(tokens, rule.anchor, windowWords);
      // Absent company mention: cannot invent a false relationship — pass.
      const fail = anchorHits.length > 0 && claim.near;
      results.push({
        ...base,
        status: fail ? "fail" : "pass",
        why: fail
          ? `Output invents a founding relationship near "${rule.anchor}" that source does not support.`
          : null,
        partnerPresent: claim.partnerPresent,
        near: claim.near,
        directed: true,
      });
      continue;
    }

    if (rule.kind === "require-near" && rule.requiredToken) {
      const partnerHits = indicesOf(tokens, rule.requiredToken);
      const near = withinWindow(anchorHits, partnerHits, windowWords);
      const pass = anchorHits.length > 0 && partnerHits.length > 0 && near;
      results.push({
        ...base,
        status: pass ? "pass" : "fail",
        why: pass
          ? null
          : `Output drops required token "${rule.requiredToken}" near "${rule.anchor}" (or omits the anchor).`,
        partnerPresent: partnerHits.length > 0,
        near: Boolean(near),
      });
      continue;
    }

    results.push({
      ...base,
      status: "fail",
      why: `Unknown source-grounding rule kind "${rule.kind}" for check ${rule.checkId}.`,
      partnerPresent: false,
      near: false,
      unknownKind: true,
    });
  }

  return results;
}
