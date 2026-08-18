import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  actorIdentity,
  actorKind,
  agentStatus,
  artifactReference,
  autonomyLevel,
  category,
  contextItem,
  editCategory,
  evalSetStatus,
  evidenceContract,
  evidenceSource,
  evidenceType,
  checkOverride,
  executionKind,
  previewSourceKind,
  executionContract,
  guardrailDefinition,
  guardrailResult,
  importProvenance,
  invocation,
  ownershipClaimStatus,
  optimisableUnit,
  outcomeContract,
  platform,
  proposalStatus,
  proposalVerdict,
  providerCost,
  releaseTrigger,
  requestPriority,
  requestStatus,
  reviewDecision,
  rubricCriterion,
  rubricCriterionResult,
  runner,
  sourcePin,
  toolItem,
  usabilityMode,
  versionState,
} from "./lib/validators";

export default defineSchema({
  agents: defineTable({
    displayId: v.string(),
    name: v.string(),
    tagline: v.string(),
    description: v.optional(v.string()),
    platform,
    status: agentStatus,
    category,
    owner: v.string(),
    initials: v.string(),
    // Display ownership is a string. Authority uses this signed identity.
    ownerIdentity: v.optional(actorIdentity),
    model: v.optional(v.string()),
    // Directory-facing workflow metadata. Optional so existing imported A7/A8
    // rows stay valid until the authorised merged re-import fills them.
    objective: v.optional(v.string()),
    whenToUse: v.optional(v.string()),
    sop: v.optional(v.string()),
    outputs: v.optional(v.array(v.string())),
    runner,
    usabilityModes: v.array(usabilityMode),
    invocation: v.optional(invocation),
    autonomyLevel: v.optional(autonomyLevel),
    executionContract,
    evidenceContract,
    outcomeContract,
    optimisableUnit: v.optional(optimisableUnit),
    guardrails: v.array(guardrailDefinition),
    skills: v.array(v.string()),
    tools: v.array(toolItem),
    context: v.array(contextItem),
    accessUrl: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    currentApprovedVersionId: v.optional(v.id("agentVersions")),
    importProvenance: v.optional(importProvenance),
    createdBy: actorIdentity,
    createdAt: v.number(),
  })
    .index("by_category", ["category"])
    .index("by_status", ["status"])
    .index("by_owner", ["owner"])
    .index("by_displayId", ["displayId"]),

  ownershipClaims: defineTable({
    agentId: v.id("agents"),
    claimant: actorIdentity,
    // A claim cannot silently transfer an agent after a later reassignment.
    expectedOwnerIdentity: v.optional(actorIdentity),
    status: ownershipClaimStatus,
    requestedAt: v.number(),
    resolvedBy: v.optional(actorIdentity),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_agentId_and_status", ["agentId", "status"])
    .index("by_agentId_and_claimant", ["agentId", "claimant.subject"]),

  ownershipEvents: defineTable({
    agentId: v.id("agents"),
    claimId: v.id("ownershipClaims"),
    previousOwnerIdentity: v.optional(actorIdentity),
    newOwnerIdentity: actorIdentity,
    transferredBy: actorIdentity,
    transferredAt: v.number(),
  })
    .index("by_agentId", ["agentId"])
    .index("by_claimId", ["claimId"]),

  agentVersions: defineTable({
    agentId: v.id("agents"),
    version: v.string(),
    state: versionState,
    basedOnVersionId: v.optional(v.id("agentVersions")),
    artifact: v.optional(artifactReference),
    sourcePin: v.optional(sourcePin),
    importProvenance: v.optional(importProvenance),
    createdBy: actorIdentity,
    createdAt: v.number(),
  })
    .index("by_agentId", ["agentId"])
    .index("by_agentId_and_version", ["agentId", "version"])
    .index("by_agentId_and_state", ["agentId", "state"]),

  /**
   * Proof that an execution actually happened, written by the SERVICE that
   * performed it.
   *
   * Evidence claims "a human saw output". Nothing bound that claim to a run
   * until this table: the mutations took caller-supplied identifiers and
   * trusted them, so an approver who knew a digest could mint promotion
   * evidence without executing or reading anything.
   *
   * Railway can prove execution because it performed it. The human's
   * attestation CONSUMES one of these rows, so service proves the run happened
   * and the human proves they read it — neither alone is sufficient, which is
   * the property the promotion gate was always supposed to have.
   *
   * Insert-only except for consumedByEvidenceId, which is set exactly once.
   */
  executionRecords: defineTable({
    agentId: v.id("agents"),
    agentVersionId: v.id("agentVersions"),
    declaredArtifactDigest: v.string(),
    executionKind,
    // What the SERVICE's own scoring found, and what it actually executed
    // against. Both were previously caller-supplied on the attestation, so an
    // approver could omit a failed check to skip the override gate, or mislabel
    // pasted material as a fixture. A caller's value is a claim; the executor's
    // is an observation, and the evidence row now takes the observation.
    blockingCheckIds: v.optional(v.array(v.string())),
    previewSourceKind: v.optional(previewSourceKind),
    // The service principal that ran it. Never a human — a human cannot
    // testify that their own attestation was preceded by a real execution.
    recordedBy: actorIdentity,
    traceId: v.optional(v.string()),
    cost: v.optional(providerCost),
    occurredAt: v.number(),
    // Set once, by the evidence mutation that used it. One execution attests
    // one evidence row; a second attempt finds nothing unconsumed.
    consumedByEvidenceId: v.optional(v.id("evidence")),
  })
    .index("by_digest", ["declaredArtifactDigest"])
    .index("by_agentVersionId", ["agentVersionId"]),

  evidence: defineTable({
    agentId: v.id("agents"),
    agentVersionId: v.id("agentVersions"),
    declaredArtifactDigest: v.string(),
    type: evidenceType,
    source: evidenceSource,
    eligibleForEvaluation: v.boolean(),
    eligibleForPromotion: v.boolean(),
    runBy: actorIdentity,
    // Optional: absent = UNKNOWN (legacy), never implied human. See actorKind.
    // actorKind is WHO WROTE THE ROW and nothing else. It is deliberately not
    // overloaded to mean "a human was involved" — that question is answered by
    // runBy + executedBy together.
    actorKind: v.optional(actorKind),
    // Who performed the execution, when that is not who wrote the row. On a
    // human-witnessed hosted run the browser writes the row (runBy = the
    // signed-in human, actorKind "human") while Railway performed the call —
    // recorded here as the loop service principal. Same two-identity shape as
    // reviewEvents actor/onBehalfOf, with each field naming its own role.
    executedBy: v.optional(actorIdentity),
    // Preview vs production. Absent = production (legacy). A reader must never
    // mistake a candidate preview for a run a fellow received.
    executionKind: v.optional(executionKind),
    // Preview only: what the run was executed against.
    previewSourceKind: v.optional(previewSourceKind),
    // Present only when a human attested past a blocking check failure.
    checkOverride: v.optional(checkOverride),
    // Set only when a row's eligibility was corrected after the fact by a rule
    // change. Evidence is insert-only, so a correction is recorded, never a
    // silent rewrite of what the row originally claimed.
    eligibilityCorrection: v.optional(
      v.object({
        previousEligibleForPromotion: v.boolean(),
        reason: v.string(),
        correctedBy: actorIdentity,
        correctedAt: v.number(),
      }),
    ),
    occurredAt: v.number(),
    cost: v.optional(providerCost),
    feedbackForEvidenceId: v.optional(v.id("evidence")),
  })
    .index("by_agentVersionId", ["agentVersionId"])
    .index("by_version_and_eval_eligibility", [
      "agentVersionId",
      "eligibleForEvaluation",
    ])
    .index("by_version_and_promotion_eligibility", [
      "agentVersionId",
      "eligibleForPromotion",
    ])
    .index("by_feedback_target", ["feedbackForEvidenceId"]),

  proposals: defineTable({
    agentId: v.id("agents"),
    priorApprovedVersionId: v.optional(v.id("agentVersions")),
    candidateVersionId: v.id("agentVersions"),
    status: proposalStatus,
    summary: v.string(),
    verdict: v.optional(proposalVerdict),
    createdBy: actorIdentity,
    createdAt: v.number(),
  })
    .index("by_agentId", ["agentId"])
    .index("by_agentId_and_status", ["agentId", "status"])
    .index("by_candidateVersionId", ["candidateVersionId"]),

  reviewEvents: defineTable({
    proposalId: v.id("proposals"),
    decision: reviewDecision,
    // Who wrote the row. On the merged-PR release path this is the loop
    // service principal, never the human — a service act is recorded as a
    // service act. Absent = UNKNOWN (legacy rows), never implied human.
    actor: actorIdentity,
    actorKind: v.optional(actorKind),
    // The human the service acted for. Optional in the validator only because
    // legacy rows predate it; assertServiceReviewIdentity in lib/serviceActor
    // REQUIRES it on every service-written approval and refuses the write
    // otherwise. Never derive an approver from `actor` alone on a service row.
    onBehalfOf: v.optional(actorIdentity),
    // The merge event itself — the primary evidence the identity came from.
    releaseTrigger: v.optional(releaseTrigger),
    // Set only on decision "release-refused": why the pointer did not move.
    refusalCode: v.optional(v.string()),
    refusalMessage: v.optional(v.string()),
    editCategory,
    priorApprovedVersionId: v.optional(v.id("agentVersions")),
    resultingVersionId: v.optional(v.id("agentVersions")),
    evidenceId: v.optional(v.id("evidence")),
    timestamp: v.number(),
  })
    .index("by_proposalId", ["proposalId"])
    .index("by_resultingVersionId", ["resultingVersionId"]),

  evalSets: defineTable({
    agentId: v.id("agents"),
    name: v.string(),
    version: v.number(),
    status: evalSetStatus,
    rubric: v.array(rubricCriterion),
    guardrails: v.array(guardrailDefinition),
    createdBy: actorIdentity,
    createdAt: v.number(),
  })
    .index("by_agentId", ["agentId"])
    .index("by_agentId_and_status", ["agentId", "status"]),

  evalCases: defineTable({
    evalSetId: v.id("evalSets"),
    name: v.string(),
    fixtureRef: v.string(),
    declaredFixtureDigest: v.string(),
    createdBy: actorIdentity,
    createdAt: v.number(),
  }).index("by_evalSetId", ["evalSetId"]),

  evalResults: defineTable({
    evalSetId: v.id("evalSets"),
    evalCaseId: v.id("evalCases"),
    agentVersionId: v.id("agentVersions"),
    evidenceId: v.id("evidence"),
    criterionResults: v.array(rubricCriterionResult),
    earnedMaximum: v.number(),
    applicableMaximum: v.number(),
    normalizedScore: v.number(),
    guardrailResults: v.array(guardrailResult),
    eligibleForPromotion: v.boolean(),
    evaluatedBy: actorIdentity,
    // Optional: absent = UNKNOWN (legacy), never implied human. See actorKind.
    actorKind: v.optional(actorKind),
    evaluatedAt: v.number(),
  })
    .index("by_agentVersionId", ["agentVersionId"])
    .index("by_evalSetId", ["evalSetId"])
    .index("by_evidenceId", ["evidenceId"])
    .index("by_version_and_promotion_eligibility", [
      "agentVersionId",
      "eligibleForPromotion",
    ]),

  entitlements: defineTable({
    subjectType: v.union(v.literal("user"), v.literal("organization")),
    subjectId: v.string(),
    agentId: v.id("agents"),
    usabilityModes: v.array(usabilityMode),
    grantedBy: actorIdentity,
    grantedAt: v.number(),
    expiresAt: v.optional(v.number()),
  })
    .index("by_subject", ["subjectType", "subjectId"])
    .index("by_agentId", ["agentId"]),

  requests: defineTable({
    displayId: v.string(),
    title: v.string(),
    desc: v.string(),
    requestedBy: v.string(),
    createdBy: actorIdentity,
    updatedBy: actorIdentity,
    updatedAt: v.number(),
    date: v.string(),
    priority: requestPriority,
    status: requestStatus,
    notes: v.string(),
    assignee: v.string(),
    shippedAgentId: v.union(v.id("agents"), v.null()),
  })
    .index("by_status", ["status"])
    .index("by_priority", ["priority"])
    .index("by_displayId", ["displayId"]),
});
