/** Shared authority-model validators. Keep these aligned with schema.ts. */
import { v } from "convex/values";

export const platform = v.union(
  v.literal("Claude"),
  v.literal("Codex"),
  v.literal("Cursor"),
  v.literal("Manus"),
  v.literal("ChatGPT"),
  v.literal("n8n"),
  v.literal("Custom"),
  v.literal("Other"),
);

export const agentStatus = v.union(
  v.literal("Experimental"),
  v.literal("Active"),
  v.literal("Under Review"),
  v.literal("Deprecated"),
);

export const autonomyLevel = v.union(
  v.literal("L0"),
  v.literal("L1"),
  v.literal("L2"),
  v.literal("L3"),
  v.literal("L4"),
);

export const category = v.union(
  v.literal("Personal Branding"),
  v.literal("Marketing & Content"),
  v.literal("Design & Product"),
  v.literal("Research & Analysis"),
  v.literal("Operations & Workflow"),
  v.literal("Investment & DD"),
  v.literal("Other"),
);

export const runner = v.union(
  v.literal("native"),
  v.literal("api"),
  v.literal("foreign-runtime-handoff"),
  v.literal("scheduled-worker"),
  v.literal("none"),
);

export const usabilityMode = v.union(
  v.literal("hosted-run"),
  v.literal("download-install"),
  v.literal("prepared-handoff"),
  v.literal("approval-queue"),
);

export const invocationType = v.union(
  v.literal("runtime"),
  v.literal("mock"),
  v.literal("http"),
  v.literal("mcp"),
);

export const invocation = v.object({
  type: invocationType,
  configRef: v.optional(v.string()),
});

export const executionContract = v.object({
  inputs: v.array(
    v.object({
      key: v.string(),
      required: v.boolean(),
    }),
  ),
  runnerConfig: v.array(
    v.object({
      key: v.string(),
      value: v.string(),
    }),
  ),
});

export const evidenceType = v.union(
  v.literal("run"),
  v.literal("submitted-artifact"),
  v.literal("test-report"),
  v.literal("approval-decision"),
  v.literal("edit-diff"),
  v.literal("manual-attestation"),
  v.literal("feedback"),
);

export const evidenceContract = v.object({
  acceptedTypes: v.array(evidenceType),
  requiredReturnArtifact: v.boolean(),
  returnArtifactKind: v.optional(v.string()),
});

export const successCriterion = v.object({
  id: v.string(),
  label: v.string(),
});

export const outcomeContract = v.object({
  successCriteria: v.array(successCriterion),
  evalSetId: v.union(v.id("evalSets"), v.null()),
});

export const optimisableUnit = v.union(
  v.object({ kind: v.literal("not-safely-changeable") }),
  v.object({
    kind: v.literal("artifact"),
    pointer: v.string(),
  }),
  v.object({
    kind: v.literal("artifact-section"),
    pointer: v.string(),
  }),
  v.object({
    kind: v.literal("config-field"),
    pointer: v.string(),
  }),
);

export const guardrailDefinition = v.object({
  id: v.string(),
  label: v.string(),
});

export const artifactReference = v.object({
  scheme: v.union(
    v.literal("git"),
    v.literal("convex-storage"),
    v.literal("external"),
  ),
  locator: v.string(),
  declaredDigest: v.string(),
  declaredDigestAlgorithm: v.literal("sha256"),
});

export const sourcePin = v.object({
  kind: v.literal("git-commit"),
  repoUrl: v.string(),
  commitSha: v.string(),
  // The type forces the truth into the row: a commit SHA cannot be mistaken
  // for the content digest required by artifactReference.
  isContentDigest: v.literal(false),
});

export const importProvenance = v.object({
  manifestDigest: v.string(),
  sourceExportDigest: v.string(),
  importedAt: v.number(),
  legacyCreatorClaimed: v.literal(false),
});

export const versionState = v.union(
  v.literal("draft"),
  v.literal("candidate"),
);

export const actorIdentity = v.object({
  subject: v.string(),
  issuer: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
});

export const evidenceSource = v.union(
  v.literal("real"),
  v.literal("mock"),
  v.literal("demo"),
  v.literal("imported"),
);

export const providerCost = v.object({
  amountUsd: v.number(),
  provider: v.string(),
  modelId: v.string(),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
});

export const proposalStatus = v.union(
  v.literal("open"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("deferred"),
);

export const proposalVerdict = v.object({
  verdict: v.union(v.literal("ship"), v.literal("hold"), v.literal("reject")),
  confidence: v.number(),
  reasons: v.array(v.string()),
});

export const reviewDecision = v.union(
  v.literal("approve"),
  v.literal("approve-with-edit"),
  v.literal("reject"),
  v.literal("defer"),
);

export const editCategory = v.union(
  v.literal("no-edit"),
  v.literal("factual-correction"),
  v.literal("policy-safety"),
  v.literal("tone"),
  v.literal("priority"),
  v.literal("formatting"),
  v.literal("missing-context"),
);

export const evalSetStatus = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("archived"),
);

export const rubricCriterion = v.object({
  id: v.string(),
  label: v.string(),
  maxScore: v.number(),
  conditional: v.boolean(),
});

export const rubricCriterionResult = v.object({
  criterionId: v.string(),
  result: v.union(
    v.object({
      kind: v.literal("score"),
      score: v.number(),
    }),
    v.object({ kind: v.literal("n/a") }),
  ),
});

export const guardrailResult = v.object({
  guardrailId: v.string(),
  passed: v.boolean(),
  evidenceId: v.optional(v.id("evidence")),
});

export const toolType = v.union(
  v.literal("mcp"),
  v.literal("api"),
  v.literal("integration"),
  v.literal("other"),
);

export const contextType = v.union(
  v.literal("memory"),
  v.literal("doc"),
  v.literal("dataset"),
  v.literal("other"),
);

export const toolItem = v.object({
  label: v.string(),
  type: v.optional(toolType),
  permissions: v.optional(v.string()),
});

export const contextItem = v.object({
  label: v.string(),
  type: v.optional(contextType),
  source: v.optional(v.string()),
});

export const requestPriority = v.union(
  v.literal("Nice to have"),
  v.literal("Important"),
  v.literal("Urgent"),
);

export const requestStatus = v.union(
  v.literal("Requested"),
  v.literal("Approved"),
  v.literal("In Progress"),
  v.literal("Shipped"),
  v.literal("Declined"),
);
