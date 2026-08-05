/**
 * Biocraft gap-fill — Sarah's fixed interview bank, batched.
 *
 * Q1–Q5 can be skipped when source material already answers them. Q6
 * (exclusions) is never a detectable gap: ask it always as an optional form
 * field, never emit it from Call 1.
 *
 * Question wording is Sarah's, pinned from utopia-agents @
 * f92555f81e51eb1fcb4557c8a134095ce1d6bfa9 biocraft/SKILL.md
 * (sha256 172969f8d74c74a15728934c6ead47f20bf37c28ac9709e6b02b7cfc18eded51).
 */

export const BIOCRAFT_GAP_BANK = Object.freeze([
  Object.freeze({
    id: "proudest-outcome",
    question:
      "What's the single outcome or result you're proudest of? Only give me a number if you actually have one — don't estimate.",
  }),
  Object.freeze({
    id: "role-and-why",
    question:
      "In a sentence or two, if a stranger asked what you do and why it matters, what would you say?",
  }),
  Object.freeze({
    id: "mission",
    question:
      "What's the problem, gap, or mission that got you building what you're building?",
  }),
  Object.freeze({
    id: "skills",
    question:
      "List 5–10 skills, tools, or areas of expertise you want to be found for when someone searches LinkedIn.",
  }),
  Object.freeze({
    id: "contact",
    question:
      "How do you want people to reach you: email, a portfolio/site link, or just 'send me a message'?",
  }),
]);

/** Always-optional exclusion. Not in the Call-1 gap bank. */
export const BIOCRAFT_EXCLUSIONS_QUESTION =
  "Anything that must NOT appear in either bio?";

const BANK_BY_ID = new Map(BIOCRAFT_GAP_BANK.map((item) => [item.id, item]));

export function gapBankForPrompt() {
  return BIOCRAFT_GAP_BANK.map(({ id, question }) => ({ id, question }));
}

/**
 * Parse Call-1 model output into a validated gap list.
 * Throws with failureCode `gap_response_unparseable` on any structural miss.
 */
export function parseGapResponse(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    throw gapParseError("empty Call-1 response");
  }

  let parsed;
  try {
    parsed = JSON.parse(extractJsonPayload(text));
  } catch {
    throw gapParseError("Call-1 response is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw gapParseError("Call-1 JSON must be an object");
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, "gaps")) {
    throw gapParseError('Call-1 JSON must include a "gaps" array');
  }
  if (!Array.isArray(parsed.gaps)) {
    throw gapParseError('"gaps" must be an array');
  }

  const seen = new Set();
  const gaps = [];
  for (const entry of parsed.gaps) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw gapParseError("each gap must be an object");
    }
    const id = String(entry.id || "").trim();
    const question = String(entry.question || "").trim();
    const reason = String(entry.reason || "").trim();
    if (!id || !BANK_BY_ID.has(id)) {
      throw gapParseError(`unknown or missing gap id: ${id || "(empty)"}`);
    }
    if (seen.has(id)) {
      throw gapParseError(`duplicate gap id: ${id}`);
    }
    seen.add(id);
    const bank = BANK_BY_ID.get(id);
    if (question !== bank.question) {
      throw gapParseError(`gap question text must match the bank for ${id}`);
    }
    if (!reason) {
      throw gapParseError(`gap ${id} needs a non-empty reason`);
    }
    gaps.push({ id, question: bank.question, reason });
  }

  return gaps;
}

/** Require a non-empty answer for every gap returned by Call 1. */
export function unansweredGaps(gaps, gapAnswers) {
  const answers =
    gapAnswers && typeof gapAnswers === "object" && !Array.isArray(gapAnswers)
      ? gapAnswers
      : {};
  return (gaps || []).filter((gap) => !String(answers[gap.id] || "").trim());
}

export function normalizeGapAnswers(gapAnswers) {
  if (!gapAnswers || typeof gapAnswers !== "object" || Array.isArray(gapAnswers)) {
    return {};
  }
  const out = {};
  for (const item of BIOCRAFT_GAP_BANK) {
    const value = String(gapAnswers[item.id] || "").trim();
    if (value) out[item.id] = value;
  }
  return out;
}

function extractJsonPayload(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function gapParseError(detail) {
  return Object.assign(
    new Error(`Gap detection response unparseable: ${detail}`),
    { status: 422, failureCode: "gap_response_unparseable" },
  );
}
