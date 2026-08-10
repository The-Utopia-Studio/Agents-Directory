// Frontmatter guardrails + grounding failures as binary promotion gates.
// Results are never summed into mechanicalCheckScore / pass rates.

const EM_DASH_OR_DOUBLE_HYPHEN = /—|--/;
const AI_CLICHE_SINGLE_TERMS = Object.freeze([
  "utilize", "leverage", "facilitate", "innovative", "robust", "seamless",
  "cutting-edge", "unlock", "elevate", "passionate", "synergy", "game-changer",
  "revolutionize", "revolutionary",
]);
const AI_CLICHE_PHRASES = Object.freeze(["sits at the intersection of"]);
const CONTRAST_FRAME = /\bit is not\b[\s\S]{0,80}\bit is\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const EXCLAMATION = /!/;
const CHARACTER_COUNT_ANNOTATION =
  /\b\d{2,4}\s*(?:characters?|chars?)\b|\bcharacter count\b/i;

function hasCompletePhrase(content, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(
    content,
  );
}

function hasAiCliche(output) {
  const text = String(output || "");
  return (
    AI_CLICHE_SINGLE_TERMS.some((term) => hasCompletePhrase(text, term)) ||
    AI_CLICHE_PHRASES.some((phrase) => hasCompletePhrase(text, phrase))
  );
}

/**
 * Map a frontmatter guardrail prose line to an executable binary check.
 * Unmapped lines are recorded as skipped (do not fail the gate).
 * @returns {{ id: string, run: (output: string) => { passed: boolean, why: string|null } } | null}
 */
export function runnerForGuardrailProse(prose, index) {
  const text = String(prose || "");
  const id = `guardrail:${index}:${text.slice(0, 48).replace(/\s+/g, "_")}`;

  if (/em[\s-]?dash|double hyphen/i.test(text)) {
    return {
      id: `${id}:em_dash`,
      run: (output) => {
        const hit = EM_DASH_OR_DOUBLE_HYPHEN.test(String(output || ""));
        return {
          passed: !hit,
          why: hit
            ? "Output contains an em dash or double-hyphen substitute."
            : null,
        };
      },
    };
  }

  if (/ai clich|utilize|leverage|facilitate|innovative|synergy/i.test(text)) {
    return {
      id: `${id}:ai_cliche`,
      run: (output) => {
        const hit = hasAiCliche(output);
        return {
          passed: !hit,
          why: hit ? "Output contains a registered AI-cliché phrase." : null,
        };
      },
    };
  }

  if (/it is not.*it is|contrast framing/i.test(text)) {
    return {
      id: `${id}:contrast_frame`,
      run: (output) => {
        const hit = CONTRAST_FRAME.test(String(output || ""));
        return {
          passed: !hit,
          why: hit ? 'Output uses "it is not X, it is Y" contrast framing.' : null,
        };
      },
    };
  }

  if (/emoji|exclamation/i.test(text)) {
    return {
      id: `${id}:emoji_exclamation`,
      run: (output) => {
        const raw = String(output || "");
        if (EMOJI.test(raw)) {
          return { passed: false, why: "Output contains emoji." };
        }
        if (EXCLAMATION.test(raw)) {
          return { passed: false, why: "Output contains an exclamation point." };
        }
        return { passed: true, why: null };
      },
    };
  }

  if (/character count|model-generated count/i.test(text)) {
    return {
      id: `${id}:character_count_annotation`,
      run: (output) => {
        const hit = CHARACTER_COUNT_ANNOTATION.test(String(output || ""));
        return {
          passed: !hit,
          why: hit
            ? "Output annotates or reports a character count."
            : null,
        };
      },
    };
  }

  // Fabrication / employer / qualifier prose is enforced via grounding results
  // (added separately), not a second prose regex.
  if (
    /never fabricate|employer|qualifiers|intern|founding|credential|quote/i.test(
      text,
    )
  ) {
    return null;
  }

  // CTA-in-intro and similar: no reliable binary runner yet — skip, do not block.
  return null;
}

/**
 * Summarize frontmatter guardrail executable coverage.
 * Skips (unmapped prose) do not fail the gate — they are reported here so
 * "passed" is never mistaken for "fully evaluated".
 */
export function summarizeGuardrailCoverage(results = [], frontmatterTotal = 0) {
  const frontmatter = results.filter(
    (row) =>
      row.source === "frontmatter" || row.source === "frontmatter-unmapped",
  );
  const total =
    typeof frontmatterTotal === "number" && frontmatterTotal >= 0
      ? frontmatterTotal
      : frontmatter.length;
  const evaluated = frontmatter.filter((row) => row.passed !== null).length;
  const skipped = frontmatter.filter((row) => row.passed === null).length;
  const passed = frontmatter.filter((row) => row.passed === true).length;
  const failed = frontmatter.filter((row) => row.passed === false).length;

  let summary;
  if (total === 0) {
    summary = "0 of 0 evaluated (no frontmatter guardrails declared)";
  } else if (evaluated === total && failed === 0) {
    summary = `${total} of ${total} evaluated, all passed`;
  } else if (evaluated === 0) {
    summary = `0 of ${total} evaluated, ${skipped} not executable`;
  } else if (failed === 0) {
    summary = `${evaluated} of ${total} evaluated, ${passed} passed, ${skipped} not executable`;
  } else {
    summary = `${evaluated} of ${total} evaluated, ${passed} passed, ${failed} failed, ${skipped} not executable`;
  }

  return {
    total,
    evaluated,
    skipped,
    passed,
    failed,
    summary,
  };
}

/**
 * @param {{
 *   output: string,
 *   guardrails?: string[],
 *   groundingResults?: { id?: string, checkId?: string, passed?: boolean|null, why?: string|null, status?: string }[],
 * }} args
 * @returns {{
 *   passed: boolean,
 *   results: { id: string, passed: boolean|null, why: string|null, source: string }[],
 *   coverage: { total: number, evaluated: number, skipped: number, passed: number, failed: number, summary: string },
 * }}
 */
export function evaluateGuardrailGate({
  output,
  guardrails = [],
  groundingResults = [],
}) {
  const results = [];

  // Grounding failures are hard gates — never only a score deduction.
  for (const row of groundingResults) {
    const id = row.id || row.checkId;
    if (!id) continue;
    if (row.passed === false || row.status === "fail") {
      results.push({
        id: `grounding:${id}`,
        passed: false,
        why: row.why || `Grounding check ${id} failed.`,
        source: "source-grounding",
      });
    } else if (row.passed === true || row.status === "pass") {
      results.push({
        id: `grounding:${id}`,
        passed: true,
        why: null,
        source: "source-grounding",
      });
    }
  }

  for (let i = 0; i < guardrails.length; i++) {
    const prose = guardrails[i];
    const runner = runnerForGuardrailProse(prose, i);
    if (!runner) {
      results.push({
        id: `guardrail:${i}:unmapped`,
        passed: null,
        why: "No executable runner for this guardrail prose; not blocking.",
        source: "frontmatter-unmapped",
      });
      continue;
    }
    const outcome = runner.run(output);
    results.push({
      id: runner.id,
      passed: outcome.passed,
      why: outcome.why,
      source: "frontmatter",
    });
  }

  // Only explicit failures block. Unmapped (null) does not.
  const passed = results.every((row) => row.passed !== false);
  const coverage = summarizeGuardrailCoverage(results, guardrails.length);

  return {
    passed,
    results,
    coverage,
  };
}
