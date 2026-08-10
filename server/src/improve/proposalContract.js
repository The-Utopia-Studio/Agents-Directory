const SURFACES = new Set(["prompt", "check", "runtime"]);

const LIMITS = Object.freeze({
  summary: 120,
  detail: 500,
  target: 240,
  // Full SKILL.md section bodies (Method ~2k, Guardrails ~1.3k today).
  // LLM maker returns the entire section, not a truncated note.
  current: 12000,
  proposed: 12000,
  rationale: 240,
});

function refuse(message) {
  throw Object.assign(new Error(`Invalid improvement proposal: ${message}`), {
    status: 422,
  });
}

function shortField(value, name, max) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) refuse(`${name} is required`);
  if (text.length > max) refuse(`${name} must be ${max} characters or fewer`);
  return text;
}

function normalized(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function rejectsInlinedFeedback(change, feedback) {
  const fields = [change.current, change.proposed, change.rationale].map(normalized);
  for (const record of feedback || []) {
    const note = normalized(record.notes);
    // Short phrases can legitimately describe an artifact edit. A verbatim
    // span of prose cannot: reviewer notes are evidence records to cite by id.
    const copiesProse = fields.some((field) => {
      if (note.length < 64 || field.length < 64) return false;
      for (let i = 0; i <= field.length - 64; i += 1) {
        if (note.includes(field.slice(i, i + 64))) return true;
      }
      return false;
    });
    if (copiesProse) {
      refuse(`change text inlines feedback ${record.id}; cite the id instead`);
    }
  }
}

/**
 * Validate and normalize an optimizer result at the server boundary.
 * Evidence ids are checked against records already scoped to this agent.
 */
export function validateProposal(proposal, improvementEvidence) {
  if (!proposal || typeof proposal !== "object") refuse("optimizer returned no object");

  const availableEvidence = new Set([
    ...(improvementEvidence?.traces || []).map((record) => record.id),
    ...(improvementEvidence?.feedback || []).map((record) => record.id),
  ].filter(Boolean));

  // Exactly one. Approval records a single decision on a proposal, so a
  // proposal carrying several changes renders them as separable rows a reviewer
  // cannot separately accept or refuse. One defect per proposal keeps what is
  // shown and what can be decided the same thing.
  if (!Array.isArray(proposal.changes) || proposal.changes.length === 0) {
    refuse("changes[] must contain exactly one concrete change");
  }
  if (proposal.changes.length > 1) {
    refuse(
      `changes[] must contain exactly one change (one proposal is one defect); got ${proposal.changes.length}. Emit one proposal per defect.`,
    );
  }

  const changes = proposal.changes.map((raw, index) => {
    if (!raw || typeof raw !== "object") refuse(`changes[${index}] must be an object`);
    if (!SURFACES.has(raw.surface)) {
      refuse(`changes[${index}].surface must be prompt, check, or runtime`);
    }
    const evidence = Array.isArray(raw.evidence)
      ? [...new Set(raw.evidence.map((id) => String(id || "").trim()))]
      : [];
    if (!evidence.length || evidence.some((id) => !id)) {
      refuse(`changes[${index}].evidence must contain at least one non-empty id`);
    }
    for (const id of evidence) {
      if (!availableEvidence.has(id)) {
        refuse(`changes[${index}].evidence references missing record ${id}`);
      }
    }

    const change = {
      surface: raw.surface,
      target: shortField(raw.target, `changes[${index}].target`, LIMITS.target),
      current: shortField(raw.current, `changes[${index}].current`, LIMITS.current),
      proposed: shortField(raw.proposed, `changes[${index}].proposed`, LIMITS.proposed),
      rationale: shortField(raw.rationale, `changes[${index}].rationale`, LIMITS.rationale),
      evidence,
    };
    if (
      change.surface === "check" &&
      !/^[a-z][a-z0-9_]*$/.test(change.target)
    ) {
      refuse(`changes[${index}].target must be a check id`);
    }
    if (
      change.surface !== "check" &&
      (!/^[a-zA-Z0-9_./-]+#[^#]+$/.test(change.target) ||
        change.target.includes(".."))
    ) {
      refuse(`changes[${index}].target must be a file path plus #section`);
    }
    rejectsInlinedFeedback(change, improvementEvidence?.feedback);
    return change;
  });

  return {
    ...proposal,
    summary: shortField(proposal.summary, "summary", LIMITS.summary),
    detail: shortField(proposal.detail, "detail", LIMITS.detail),
    changes,
  };
}

export const PROPOSAL_FIELD_LIMITS = LIMITS;
