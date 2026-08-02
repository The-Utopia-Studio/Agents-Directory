// Heuristic optimizer. Fully offline, no external calls, no cost.
// It can only emit changes for defect classes it explicitly understands.
// Unknown prose is refused rather than copied into a generic prompt template:
// classifying feedback into prompt/check/runtime edits is a reasoning task.
//
// It is deliberately the same INTERFACE as the GEPA adapter, so the loop is
// exercisable today and you can flip OPTIMIZER=gepa without touching callers.
//
// It has no template fallback. With no defect signal it refuses, because a
// proposal carries an Approve button and must never be backed by a sentence
// the optimizer wrote about itself.
const BIOCRAFT_PROMPT = "server/src/artifacts/biocraft/SKILL.md#guardrails";

function promptTarget(agent) {
  return agent.id === "A7"
    ? BIOCRAFT_PROMPT
    : `server/src/scripts/seed.js#SEED_AGENTS ${agent.id} prompt`;
}

function classifiedSignalKey(reason) {
  if (/voice mismatch/i.test(reason)) return "voice";
  if (/aggressive cta/i.test(reason)) return "aggressive";
  if (/^[a-z0-9_]+$/.test(reason)) return reason;
  return null;
}

function addChange(changes, change) {
  const existing = changes.find(
    (candidate) =>
      candidate.surface === change.surface &&
      candidate.target === change.target &&
      candidate.proposed === change.proposed,
  );
  if (existing) {
    existing.evidence = [...new Set([...existing.evidence, ...change.evidence])];
    return;
  }
  changes.push(change);
}

function traceChanges(agent, failingTraces) {
  const changes = [];
  const byReason = new Map();
  for (const trace of failingTraces) {
    const reason = String(trace.failureReason || "").trim();
    if (!reason || !trace.id) continue;
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push(trace.id);
  }

  for (const [reason, evidence] of byReason) {
    if (/voice mismatch/i.test(reason)) {
      addChange(changes, {
        surface: "prompt",
        target: promptTarget(agent),
        current: "Voice matching is not anchored to supplied first-person examples.",
        proposed:
          'Add: "Before drafting, identify at least two supplied first-person voice anchors and preserve their register; if none exist, ask for them rather than inventing a voice."',
        rationale: "The referenced traces failed voice matching.",
        evidence,
      });
    } else if (/aggressive cta/i.test(reason)) {
      addChange(changes, {
        surface: "prompt",
        target: promptTarget(agent),
        current: "CTA guidance does not explicitly reject urgency or coercion.",
        proposed:
          'Add: "Keep CTA language invitational; remove urgency, coercion, scarcity, and sales-led commands before returning the draft."',
        rationale: "The referenced traces failed CTA tone.",
        evidence,
      });
    }
    // Mechanical check ids alone prove a detector fired, not whether the draft
    // or detector is wrong. Without reviewer judgement the heuristic cannot
    // propose an exact check or prompt edit honestly, so it emits no change.
  }
  return changes;
}

function feedbackChanges(agent, feedback) {
  const changes = [];
  for (const record of feedback) {
    const note = String(record.notes || "").toLowerCase();
    if (!note || !record.id) continue;
    const evidence = [record.id];
    const mentionsCliche = /clich[eé]|intersection of|ai phrase/.test(note);
    const asksForCheck = /\bcheck(?:er)?\b|detector|phrase list|word list|regex/.test(note);
    const asksForPrompt = /\bprompt\b|guardrail|instruction/.test(note);

    if (mentionsCliche && asksForCheck) {
      addChange(changes, {
        surface: "check",
        target: "about_has_no_ai_cliche_phrase",
        current: "No phrase-level AI-cliché mechanical check is registered.",
        proposed:
          'Add a check that matches configured multi-word clichés as complete phrases; keep single banned terms in a separate exact-word list and add pass/fail regression fixtures.',
        rationale: "The cited review distinguishes phrase detection from ordinary-word bans.",
        evidence,
      });
    }
    if (mentionsCliche && (asksForPrompt || !asksForCheck)) {
      addChange(changes, {
        surface: "prompt",
        target: promptTarget(agent),
        current: "The AI-cliché guardrail mixes phrase-level clichés with single banned terms.",
        proposed:
          'Replace it with: "Remove generic AI-written claims and stock positioning phrases as complete phrases; separately reject only the explicitly listed banned words."',
        rationale: "The cited review calls for general prompt guidance separate from checker logic.",
        evidence,
      });
    }
    if (/em dash|double hyphen/.test(note) && !asksForPrompt) {
      addChange(changes, {
        surface: "check",
        target: "about_has_no_em_dash",
        current: "The prompt prohibits em dashes, but no mechanical check enforces it.",
        proposed:
          "Add a deterministic check for U+2014 and double-hyphen substitutes, scoped to generated sections, with regression fixtures for both forms.",
        rationale: "The cited review reports punctuation that the existing prompt rule missed.",
        evidence,
      });
    }
    if (/founder|for (?:a |the )?company|job title|intern|participant|apprentice/.test(note)) {
      addChange(changes, {
        surface: "prompt",
        target: promptTarget(agent),
        current: "Source-grounding rules do not require an explicit relationship-and-title verification pass.",
        proposed:
          'Add: "Before returning, compare every company relationship and role title against the source; preserve qualifiers and distinguish work done for a company from founding or owning it."',
        rationale: "The cited review identifies a source-relationship or title-preservation defect.",
        evidence,
      });
    }
    if (/character count|self-reported count|fabricated count/.test(note)) {
      addChange(changes, {
        surface: "prompt",
        target: promptTarget(agent),
        current: "The draft can still include model-generated character-count claims.",
        proposed:
          'Add to the final cut: "Never print or claim character counts; the host computes limits mechanically after generation."',
        rationale: "The cited review reports an unverified model-generated count.",
        evidence,
      });
    }
  }
  return changes;
}

export function createHeuristicOptimizer() {
  return {
    name: "heuristic",

    async health() { return { ok: true, detail: "offline reflective heuristic" }; },

    async propose(agent, evidence) {
      const {
        traces = [],
        failingTraces = [],
        feedback = [],
        lowRatings = [],
        defectSignals = [],
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

      const changes = [
        ...traceChanges(agent, failingTraces),
        ...feedbackChanges(agent, feedback),
      ];
      if (!changes.length) {
        throw Object.assign(
          new Error(
            "Heuristic optimizer found evidence but cannot classify it into an exact prompt, check, or runtime change — refusing rather than echoing reviewer text",
          ),
          { status: 422 },
        );
      }
      const ratedFeedback = feedback.filter((f) => typeof f.rating === "number");
      const gain = Math.min(
        25,
        6 + failingTraces.length * 2 + lowRatings.length * 3 + changes.length * 2,
      );

      const sources = [
        `${traces.length} trace(s) (${failingTraces.length} failing)`,
        `${feedback.length} feedback record(s)`,
        `${defectSignals.length} defect signal(s)`,
      ].join(", ");

      return {
        source: "heuristic",
        status: "proposed",
        date: new Date().toISOString().slice(0, 10),
        summary:
          changes.length === 1
            ? `${changes[0].surface} change for ${changes[0].target}`
            : `${changes.length} separable evidenced changes`,
        detail: `Reviewed ${sources}. Review each change below independently; approval records one proposal-level decision and does not edit an artifact.`,
        changes,
        expectedGain: gain,
        evidence: {
          tracesReviewed: traces.length,
          failing: failingTraces.length,
          feedbackReviewed: feedback.length,
          lowRatings: lowRatings.length,
          averageRating: ratedFeedback.length
            ? Number(
                (
                  ratedFeedback.reduce((sum, f) => sum + f.rating, 0) /
                  ratedFeedback.length
                ).toFixed(2),
              )
            : undefined,
          references: [...new Set(changes.flatMap((change) => change.evidence))],
          signalKeys: [
            ...new Set(
              failingTraces
                .map((trace) => classifiedSignalKey(trace.failureReason || ""))
                .filter(Boolean),
            ),
          ],
          changeTargets: changes.map(
            (change) => `${change.surface}:${change.target}`,
          ),
        },
      };
    },
  };
}
