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
 * @typedef {Object} SourceGroundingRule
 * @property {string} checkId
 * @property {"require-near"|"forbid-near"} kind
 * @property {string} anchor
 * @property {string} [requiredToken]
 * @property {"founding-verb"} [requiredClass]
 * @property {"founding-verb"} [forbiddenClass]
 * @property {number} [windowWords]
 */

export function runSourceGroundingChecks(output, rules = []) {
  const tokens = tokenize(output);
  const results = [];

  for (const rule of rules) {
    const defaultWindow =
      rule.requiredClass === "founding-verb" ||
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

    if (
      rule.kind === "require-near" &&
      rule.requiredClass === "founding-verb"
    ) {
      const claim = foundingClaimsCompany(tokens, rule.anchor, windowWords);
      results.push({
        ...base,
        status: claim.near ? "pass" : "fail",
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
        partnerPresent: partnerHits.length > 0,
        near: Boolean(near),
      });
      continue;
    }

    results.push({
      ...base,
      status: "fail",
      partnerPresent: false,
      near: false,
      unknownKind: true,
    });
  }

  return results;
}
