// Check-set identity independent of the prompt artifact version.
// Derived only from the checks that actually score an output — never from
// artifactVersion / checkSetVersion strings.

import { createHash } from "node:crypto";
import { tierForCheck } from "./checkTiers.js";

/** @typedef {{ id: string, category: "style"|"grounding", tier?: string }} CheckSetEntry */

export const CHECK_SET_CATEGORY_STYLE = "style";
export const CHECK_SET_CATEGORY_GROUNDING = "grounding";

/**
 * Normalize and hash sorted (id, category, tier) triples.
 * @param {CheckSetEntry[]} entries
 * @returns {string} sha256 hex
 */
export function computeCheckSetId(entries = []) {
  const normalized = [...entries]
    .map((entry) => ({
      id: String(entry?.id || entry?.checkId || "").trim(),
      category:
        entry?.category === CHECK_SET_CATEGORY_GROUNDING
          ? CHECK_SET_CATEGORY_GROUNDING
          : CHECK_SET_CATEGORY_STYLE,
      tier: entry?.tier || tierForCheck(entry?.id || entry?.checkId),
    }))
    .filter((entry) => entry.id)
    .sort(
      (a, b) =>
        a.id.localeCompare(b.id) ||
        a.category.localeCompare(b.category) ||
        a.tier.localeCompare(b.tier),
    );

  // Drop duplicate id+category+tier pairs so accidental double registration does
  // not mint a different identity.
  const unique = [];
  const seen = new Set();
  for (const entry of normalized) {
    const key = `${entry.id}\0${entry.category}\0${entry.tier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  const payload = unique.map((e) => `${e.id}:${e.category}:${e.tier}`).join("\n");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Entries from the inputs that will score a run (declared style + grounding).
 * @param {string[]} declaredChecks
 * @param {{ checkId: string }[]} sourceGroundingRules
 * @returns {CheckSetEntry[]}
 */
export function checkSetEntriesFromInputs(
  declaredChecks = [],
  sourceGroundingRules = [],
) {
  return [
    ...declaredChecks.map((id) => ({
      id: String(id),
      category: CHECK_SET_CATEGORY_STYLE,
      tier: tierForCheck(id),
    })),
    ...sourceGroundingRules.map((rule) => ({
      id: String(rule.checkId || rule.id),
      category: CHECK_SET_CATEGORY_GROUNDING,
      tier: tierForCheck(rule.checkId || rule.id),
    })),
  ].filter((entry) => entry.id && entry.id !== "undefined");
}

/**
 * Entries reconstructed from scored checkResults (for deltas on stored rows).
 * @param {{ id?: string, checkId?: string, category?: string, family?: string }[]} checkResults
 * @returns {CheckSetEntry[]}
 */
export function checkSetEntriesFromResults(checkResults = []) {
  return checkResults
    .map((row) => {
      const id = row.id || row.checkId;
      if (!id) return null;
      const category =
        row.category === CHECK_SET_CATEGORY_GROUNDING ||
        row.family === "source-grounding"
          ? CHECK_SET_CATEGORY_GROUNDING
          : CHECK_SET_CATEGORY_STYLE;
      return {
        id: String(id),
        category,
        tier: row.tier || tierForCheck(id),
      };
    })
    .filter(Boolean);
}
