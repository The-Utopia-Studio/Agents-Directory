// Heuristic optimizer. Fully offline, no external calls, no cost.
// It can only emit changes for defect classes it explicitly understands.
// Unknown prose is refused rather than copied into a generic prompt template:
// classifying feedback into prompt/check/runtime edits is a reasoning task.
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
  return agent.id === "A7"
    ? `${BIOCRAFT_ARTIFACT}#${section}`
    : `server/src/scripts/seed.js#SEED_AGENTS ${agent.id} ${section}`;
}

function classifiedSignalKey(reason) {
  if (/voice mismatch/i.test(reason)) return "voice";
  if (/aggressive cta/i.test(reason)) return "aggressive";
  if (/^[a-z0-9_]+$/.test(reason)) return reason;
  return null;
}

function normalizedArtifact(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Defect catalogue. Each entry is INDEPENDENT.
 *
 * The previous version computed `asksForPrompt` / `asksForCheck` once for the
 * whole note and used them to gate unrelated branches. One sentence mentioning
 * a guardrail therefore suppressed the em-dash finding entirely — the reviewer's
 * main defect was matched and then discarded by a flag set elsewhere in the same
 * note. Routing is per-defect here: `matches` decides whether THIS defect is
 * present, and nothing else can veto it.
 *
 * `alreadyInArtifact` is the honesty gate. It is checked against the real
 * server-owned artifact bytes, so the optimizer cannot assert a `current` state
 * for a file it never opened.
 *
 * LIMITATION, deliberately not papered over: `alreadyInArtifact` proves the
 * artifact already covers a rule. It does NOT establish polarity. A note saying
 * "no fabricated character counts" (praise) and one saying "fabricated counts
 * again" (defect) are indistinguishable to keyword matching, and no regex will
 * separate them. This gate happens to suppress the praise case because the rule
 * is present; it would NOT suppress false praise about a rule that is absent.
 * Reading intent from prose is a reasoning task and remains the argument for a
 * model-backed maker. Do not assume polarity is handled.
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

function collectDefects(agent, evidence, artifact) {
  const view = artifactView(artifact);
  const found = new Map();

  function record(definition, source, evidenceIds) {
    // Verify before asserting. Without the live artifact the optimizer cannot
    // honestly describe `current`, so it emits nothing rather than guessing.
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

  const byReason = new Map();
  for (const trace of evidence.failingTraces || []) {
    const reason = String(trace.failureReason || "").trim();
    if (!reason || !trace.id) continue;
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push(trace.id);
  }
  for (const [reason, traceIds] of byReason) {
    for (const definition of TRACE_DEFECTS) {
      if (definition.matches(reason)) record(definition, "trace", traceIds);
    }
    // A mechanical check id alone proves a detector fired, not whether the
    // draft or the detector is wrong. Without reviewer judgement there is no
    // honest exact edit, so unmatched reasons emit nothing.
  }

  for (const feedbackRecord of evidence.feedback || []) {
    const note = String(feedbackRecord.notes || "").toLowerCase();
    if (!note || !feedbackRecord.id) continue;
    for (const definition of FEEDBACK_DEFECTS) {
      if (definition.matches(note)) {
        record(definition, "feedback", [feedbackRecord.id]);
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
            "Heuristic optimizer found evidence but every classified defect is already addressed by the live artifact, or could not be classified into an exact prompt, check, or runtime change — refusing rather than echoing reviewer text",
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
        summary: `${defect.change.surface} change for ${defect.change.target}`,
        detail: `Reviewed ${sources}. This proposal is one defect with one change; approving it records a decision on that change alone and edits no artifact.`,
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
              failingTraces
                .map((trace) => classifiedSignalKey(trace.failureReason || ""))
                .filter(Boolean),
            ),
          ],
          changeTargets: [`${defect.change.surface}:${defect.change.target}`],
        },
      }));
    },
  };
}
