// Heuristic optimizer. Fully offline, no external calls, no cost.
// Check-id defects are derived from the closed check registry (same ids the
// scorer emits). Feedback prose still uses a small keyword catalogue. Unknown
// failureReason tokens are recorded as unclassified:<id>, never dropped.
//
// It is deliberately the same INTERFACE as the GEPA adapter, so the loop is
// exercisable today and you can flip OPTIMIZER=gepa without touching callers.
//
// `propose` returns an ARRAY of proposals: one defect per proposal, each with
// exactly one change. Approval is a proposal-level decision, so a proposal that
// bundled several defects rendered them as separable rows while offering a
// single verdict — you could not take three and reject the fourth. One defect
// per proposal makes the rendered granularity and the decision granularity the
// same thing without inventing a per-change audit model.
//
// It has no template fallback. With no defect signal it refuses, because a
// proposal carries an Approve button and must never be backed by a sentence
// the optimizer wrote about itself.

import {
  CHECK_SET_CATEGORY_GROUNDING,
  parseFailureReasonTokens,
  resolveCheckDefect,
} from "./checkDefectRegistry.js";
import { isPostProcessedCheckId } from "../invoke/postProcessDraft.js";

const BIOCRAFT_ARTIFACT = "server/src/artifacts/biocraft/SKILL.md";

/**
 * Targets are derived from the edit, never from one constant.
 *
 * A single `#guardrails` constant produced two failures at once: several edits
 * collided on one section and would conflict on apply, and an edit whose own
 * text said "add to the final cut" was filed against Guardrails when the final
 * cut is a Method step. A change now names the section it actually edits.
 */
function promptTarget(agent, section) {
  return agent.id === "A7" || agent.id === "A10"
    ? `${agent.id === "A10" ? "server/src/artifacts/biocraft-gapfill/SKILL.md" : BIOCRAFT_ARTIFACT}#${section}`
    : `server/src/scripts/seed.js#SEED_AGENTS ${agent.id} ${section}`;
}

function classifiedSignalKey(reason) {
  if (/voice mismatch/i.test(reason)) return "voice";
  if (/aggressive cta/i.test(reason)) return "aggressive";
  const tokens = parseFailureReasonTokens(reason);
  if (tokens.length === 1) return tokens[0];
  if (/^[a-z0-9_]+$/.test(reason)) return reason;
  return null;
}

function normalizedArtifact(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Feedback-note catalogue. Each entry is INDEPENDENT.
 *
 * Check-id defects from traces do NOT go through this list — they are resolved
 * from checkDefectRegistry so the maker vocabulary cannot drift from the scorer.
 *
 * `alreadyInArtifact` is the honesty gate for reviewer prose: do not re-propose
 * registering a check the artifact already declares.
 */
const FEEDBACK_DEFECTS = [
  {
    key: "em-dash",
    matches: (note) => /em[\s-]?dash|double hyphen|—/.test(note),
    // Guardrail 4 states the rule in prose; the defect is that nothing enforces
    // it mechanically, so the artifact rule is not evidence the gap is closed.
    alreadyInArtifact: (artifact) =>
      artifact.declaresCheck("draft_has_no_em_dash"),
    change: (agent) => ({
      surface: "check",
      target: "draft_has_no_em_dash",
      current:
        "No mechanical check enforces the em-dash guardrail in any generated section.",
      proposed:
        "Register a deterministic check for U+2014 and double-hyphen substitutes across the About, spoken introduction, and headline, with fixtures for both forms.",
      rationale:
        "The cited review reports punctuation the prompt rule alone did not prevent.",
    }),
  },
  {
    key: "cliche-check",
    matches: (note) => /clich[eé]|intersection of|ai phrase|stock phrase/.test(note),
    alreadyInArtifact: (artifact) =>
      artifact.declaresCheck("draft_has_no_ai_cliche_phrase"),
    change: (agent) => ({
      surface: "check",
      target: "draft_has_no_ai_cliche_phrase",
      current:
        "No mechanical check matches multi-word cliche phrases in any generated section.",
      proposed:
        "Register a check matching configured cliches as complete phrases across every generated section, keeping single banned terms in the separate exact-word rule.",
      rationale:
        "The cited review distinguishes phrase detection from ordinary-word bans and reports relocation between sections.",
    }),
  },
  {
    key: "source-relationship",
    matches: (note) =>
      /founder|for (?:a |the )?company|job title|intern\b|participant|apprentice/.test(
        note,
      ),
    alreadyInArtifact: (artifact) =>
      artifact.hasRule(/compare every\s+company relationship and role title/),
    change: (agent) => ({
      surface: "prompt",
      target: promptTarget(agent, "method"),
      current:
        "The final cut does not require an explicit relationship-and-title verification pass.",
      proposed:
        'Add to the final cut: "Compare every company relationship and role title against the source; preserve qualifiers and distinguish work done for a company from founding or owning it."',
      rationale:
        "The cited review identifies a source-relationship or title-preservation defect.",
    }),
  },
  {
    key: "character-count",
    matches: (note) =>
      /character count|self-reported count|fabricated count/.test(note),
    alreadyInArtifact: (artifact) =>
      artifact.hasRule(/do not report or annotate character counts/),
    change: (agent) => ({
      surface: "prompt",
      target: promptTarget(agent, "guardrails"),
      current:
        "No guardrail prevents the draft from printing model-generated character counts.",
      proposed:
        'Add: "Never print or claim character counts; the host computes limits mechanically after generation."',
      rationale:
        "The cited review reports an unverified model-generated count.",
    }),
  },
];

const TRACE_DEFECTS = [
  {
    key: "voice",
    matches: (reason) => /voice mismatch/i.test(reason),
    alreadyInArtifact: (artifact) =>
      artifact.hasRule(/first-person voice anchors/),
    change: (agent) => ({
      surface: "prompt",
      target: promptTarget(agent, "method"),
      current:
        "Voice matching is not anchored to supplied first-person examples.",
      proposed:
        'Add: "Before drafting, identify at least two supplied first-person voice anchors and preserve their register; if none exist, ask for them rather than inventing a voice."',
      rationale: "The referenced traces failed voice matching.",
    }),
  },
  {
    key: "aggressive-cta",
    matches: (reason) => /aggressive cta/i.test(reason),
    alreadyInArtifact: (artifact) =>
      artifact.hasRule(/keep cta language invitational/),
    change: (agent) => ({
      surface: "prompt",
      target: promptTarget(agent, "guardrails"),
      current: "CTA guidance does not explicitly reject urgency or coercion.",
      proposed:
        'Add: "Keep CTA language invitational; remove urgency, coercion, scarcity, and sales-led commands before returning the draft."',
      rationale: "The referenced traces failed CTA tone.",
    }),
  },
];

/** Read-only view of the live server-owned artifact the proposal targets. */
function artifactView(artifact) {
  const text = normalizedArtifact(artifact?.text);
  const declaredChecks = new Set(artifact?.checks || []);
  return {
    available: Boolean(text),
    hasRule: (pattern) => (text ? pattern.test(text) : false),
    declaresCheck: (checkId) => declaredChecks.has(checkId),
  };
}

function descriptionFromCheckResults(checkId, checkResults = []) {
  const matches = checkResults.filter((row) => row?.checkId === checkId);
  const sections = [
    ...new Set(matches.map((row) => row.section).filter(Boolean)),
  ];
  const registered = resolveCheckDefect(checkId);
  const base =
    registered?.description ||
    `Check "${checkId}" failed on a live run.`;
  if (!sections.length) return base;
  return `${base} Observed in: ${sections.join("; ")}.`;
}

function changeForCheckDefect(agent, checkId, category, description) {
  const grounding = category === CHECK_SET_CATEGORY_GROUNDING;
  const methodDefect =
    checkId === "about_closing_has_cta" ||
    checkId === "about_has_no_delimiter_separated_keyword_run";
  const section = grounding || methodDefect ? "method" : "guardrails";
  return {
    surface: "prompt",
    target: promptTarget(agent, section),
    current: `Live runs fail mechanical check ${checkId}.`,
    proposed: `Strengthen the artifact so ${checkId} stops failing on hosted runs. Defect: ${description}`,
    rationale: description,
  };
}

function changeForUnclassified(agent, token) {
  return {
    surface: "prompt",
    target: promptTarget(agent, "guardrails"),
    current: `Runtime emitted failure reason "${token}" which is not in the check registry.`,
    proposed: `Reconcile the check registry with the runtime: either register "${token}" as a known check id with a category and description, or stop emitting it from hosted runs.`,
    rationale: `unclassified: ${token}`,
  };
}

/**
 * Collect classifiable defects from traces + feedback.
 * Check ids are the vocabulary; unknown tokens become unclassified:<id>.
 * @returns {{ key: string, category?: string, description?: string, unclassified?: boolean, source: string, change: object, evidence: string[] }[]}
 */
export function collectDefects(agent, evidence, artifact) {
  const view = artifactView(artifact);
  const found = new Map();

  function recordFeedback(definition, source, evidenceIds) {
    if (!view.available) return;
    if (definition.alreadyInArtifact(view)) return;
    const existing = found.get(definition.key);
    if (existing) {
      existing.evidence = [...new Set([...existing.evidence, ...evidenceIds])];
      return;
    }
    found.set(definition.key, {
      key: definition.key,
      source,
      change: { ...definition.change(agent), evidence: [...evidenceIds] },
      evidence: [...evidenceIds],
    });
  }

  function recordCheckOrUnclassified(token, source, evidenceIds, checkResults) {
    if (!view.available) return;
    // Deterministic host post-processing owns these checks — never propose
    // a prompt edit for a rule the host already enforces on every run.
    if (isPostProcessedCheckId(token)) return;
    const registered = resolveCheckDefect(token);
    if (registered) {
      const key = registered.id;
      const description = descriptionFromCheckResults(key, checkResults);
      const existing = found.get(key);
      if (existing) {
        existing.evidence = [...new Set([...existing.evidence, ...evidenceIds])];
        if (description.length > (existing.description || "").length) {
          existing.description = description;
          existing.change = {
            ...changeForCheckDefect(
              agent,
              key,
              registered.category,
              description,
            ),
            evidence: [...existing.evidence],
          };
        }
        return;
      }
      found.set(key, {
        key,
        category: registered.category,
        description,
        source,
        change: {
          ...changeForCheckDefect(agent, key, registered.category, description),
          evidence: [...evidenceIds],
        },
        evidence: [...evidenceIds],
      });
      return;
    }

    const key = `unclassified:${token}`;
    const existing = found.get(key);
    if (existing) {
      existing.evidence = [...new Set([...existing.evidence, ...evidenceIds])];
      return;
    }
    found.set(key, {
      key,
      category: "style",
      description: `unclassified: ${token}`,
      unclassified: true,
      source,
      change: {
        ...changeForUnclassified(agent, token),
        evidence: [...evidenceIds],
      },
      evidence: [...evidenceIds],
    });
  }

  for (const trace of evidence.failingTraces || []) {
    if (!trace?.id) continue;
    const checkResults = Array.isArray(trace.checkResults)
      ? trace.checkResults
      : [];
    const tokens = [
      ...parseFailureReasonTokens(trace.failureReason),
      ...checkResults.map((row) => String(row?.checkId || "").trim()).filter(Boolean),
    ];
    const unique = [...new Set(tokens)];
    // Legacy prose reasons (seed / old mocks) that are not check ids.
    if (!unique.length) {
      const reason = String(trace.failureReason || "").trim();
      if (!reason) continue;
      for (const definition of TRACE_DEFECTS) {
        if (definition.matches(reason)) {
          recordFeedback(definition, "trace", [trace.id]);
        }
      }
      continue;
    }
    for (const token of unique) {
      recordCheckOrUnclassified(token, "trace", [trace.id], checkResults);
    }
  }

  for (const signal of evidence.defectSignals || []) {
    const text = String(signal || "").trim();
    if (!text.startsWith("mechanical:")) continue;
    for (const token of parseFailureReasonTokens(text)) {
      recordCheckOrUnclassified(token, "mechanical", [`mechanical:${token}`], []);
    }
  }

  for (const feedbackRecord of evidence.feedback || []) {
    const note = String(feedbackRecord.notes || "").toLowerCase();
    if (!note || !feedbackRecord.id) continue;
    for (const definition of FEEDBACK_DEFECTS) {
      if (definition.matches(note)) {
        recordFeedback(definition, "feedback", [feedbackRecord.id]);
      }
    }
  }

  return [...found.values()].map((defect) => ({
    ...defect,
    change: { ...defect.change, evidence: defect.evidence },
  }));
}

export function createHeuristicOptimizer() {
  return {
    name: "heuristic",

    async health() { return { ok: true, detail: "offline reflective heuristic" }; },

    /** @returns {Promise<object[]>} one proposal per defect, each with one change. */
    async propose(agent, evidence) {
      const {
        traces = [],
        failingTraces = [],
        feedback = [],
        lowRatings = [],
        defectSignals = [],
        artifact = null,
      } = evidence || {};

      if (!defectSignals.length) {
        // Belt and braces: the service refuses first, but an optimizer must
        // never be the component that invents a signal to fill a template.
        throw Object.assign(
          new Error(
            "Heuristic optimizer has no defect signal to propose against — refusing rather than emitting a placeholder",
          ),
          { status: 422 },
        );
      }

      const defects = collectDefects(agent, evidence, artifact);
      if (!defects.length) {
        throw Object.assign(
          new Error(
            "Heuristic optimizer found evidence but every classified feedback defect is already addressed by the live artifact, and no check-id failureReason was present to classify — refusing rather than echoing reviewer text",
          ),
          { status: 422 },
        );
      }

      const ratedFeedback = feedback.filter((f) => typeof f.rating === "number");
      const averageRating = ratedFeedback.length
        ? Number(
            (
              ratedFeedback.reduce((sum, f) => sum + f.rating, 0) /
              ratedFeedback.length
            ).toFixed(2),
          )
        : undefined;
      const sources = [
        `${traces.length} trace(s) (${failingTraces.length} failing)`,
        `${feedback.length} feedback record(s)`,
        `${defectSignals.length} defect signal(s)`,
      ].join(", ");

      return defects.map((defect) => ({
        source: "heuristic",
        status: "proposed",
        date: new Date().toISOString().slice(0, 10),
        defectKey: defect.key,
        ...(defect.category ? { defectCategory: defect.category } : {}),
        ...(defect.description ? { defectDescription: defect.description } : {}),
        ...(defect.unclassified ? { unclassified: true } : {}),
        summary: defect.unclassified
          ? `Unclassified failure reason: ${defect.key.replace(/^unclassified:/, "")}`
          : `${defect.change.surface} change for ${defect.change.target}`,
        detail: defect.description
          ? `${defect.description} Reviewed ${sources}. This proposal is one defect with one change; approving it records a decision on that change alone and edits no artifact.`
          : `Reviewed ${sources}. This proposal is one defect with one change; approving it records a decision on that change alone and edits no artifact.`,
        changes: [defect.change],
        expectedGain: Math.min(
          25,
          6 + failingTraces.length * 2 + lowRatings.length * 3 + 2,
        ),
        evidence: {
          tracesReviewed: traces.length,
          failing: failingTraces.length,
          feedbackReviewed: feedback.length,
          lowRatings: lowRatings.length,
          averageRating,
          references: [...defect.change.evidence],
          signalKeys: [
            ...new Set(
              [
                defect.key,
                ...failingTraces
                  .flatMap((trace) =>
                    parseFailureReasonTokens(trace.failureReason || ""),
                  )
                  .map((token) => classifiedSignalKey(token) || token),
              ].filter(Boolean),
            ),
          ],
          changeTargets: [`${defect.change.surface}:${defect.change.target}`],
        },
      }));
    },
  };
}

