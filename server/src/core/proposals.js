// Pending-proposal shape, shared by the service, the loop, and the exporter.
//
// One proposal is one defect with exactly one change. Approval is a single
// proposal-level decision, so a proposal that bundled several defects rendered
// them as separable rows while offering one verdict — a reviewer could not take
// three and reject the fourth. Splitting them keeps the granularity a reviewer
// sees and the granularity they can act on identical, without inventing a
// per-change audit model.
//
// Lives in its own module so `loop/policy.js` can ask the question without
// importing the whole service.

/**
 * Pending proposals for an agent, newest write order preserved.
 *
 * Records written before the split carry a single `proposedImprovement`. They
 * are read as a one-element list and rewritten into the array on the next
 * write, so no stored proposal is stranded by the shape change.
 */
export function readProposals(agent) {
  if (Array.isArray(agent?.proposedImprovements)) return agent.proposedImprovements;
  return agent?.proposedImprovement ? [agent.proposedImprovement] : [];
}

export function writeProposals(agent, proposals) {
  agent.proposedImprovements = proposals;
  agent.proposedImprovement = null;
  return agent;
}

/** No id means "the only pending one"; ambiguity must be an explicit choice. */
export function selectProposal(proposals, proposalId) {
  if (proposalId) return proposals.find((p) => p.id === proposalId) || null;
  return proposals.length === 1 ? proposals[0] : null;
}

export function pendingProposals(agent) {
  return readProposals(agent).filter((p) => p?.status === "proposed");
}
