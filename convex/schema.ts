import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  actorIdentity,
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
  executionContract,
  guardrailDefinition,
  guardrailResult,
  importProvenance,
  invocation,
  optimisableUnit,
  outcomeContract,
  platform,
  proposalStatus,
  proposalVerdict,
  providerCost,
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
    model: v.optional(v.string()),
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

  evidence: defineTable({
    agentId: v.id("agents"),
    agentVersionId: v.id("agentVersions"),
    declaredArtifactDigest: v.string(),
    type: evidenceType,
    source: evidenceSource,
    eligibleForEvaluation: v.boolean(),
    eligibleForPromotion: v.boolean(),
    runBy: actorIdentity,
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
    actor: actorIdentity,
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
