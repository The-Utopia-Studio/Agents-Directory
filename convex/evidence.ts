import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireApprover, requireIdentity, type AuthorityActor } from "./lib/auth";
import { declaredLoopServiceActor } from "./lib/serviceActor";
import { claimExecutionProof } from "./executions";
import { evidenceType, providerCost } from "./lib/validators";

type EvidenceSource = "real" | "mock" | "demo" | "imported";
type SyntheticEvidenceSource = Extract<EvidenceSource, "mock" | "demo">;

/**
 * Identity for an evidence insert.
 *
 * - verified-human: requireIdentity ran; actorKind "human".
 * - declared-service: requireIdentity did NOT run; actor is the declared loop
 *   principal after the Clerk-shaped issuer hard guard; actorKind "service".
 *
 * Do not claim verification on the service path.
 */
type EvidenceWriter =
  | { kind: "verified-human"; actor: AuthorityActor }
  | { kind: "declared-service"; actor: AuthorityActor };

const A7_DEMO_DISPLAY_ID = "A7";
const A7_HOSTED_DISPLAY_ID = "A7";

function syntheticEligibility(_source: SyntheticEvidenceSource) {
  // Synthetic writers own these values. They are deliberately absent from
  // mutation arguments, so no caller can promote demo/mock data by supplying
  // eligibility flags.
  return {
    eligibleForEvaluation: false as const,
    eligibleForPromotion: false as const,
  };
}

/**
 * Eligibility is derived here from source + writer kind — never from mutation
 * args — so a future caller cannot pass promotion-eligible service evidence.
 *
 * Service rows are a machine reporting on a machine's output: real enough to
 * score (eligibleForEvaluation), but a release case needs a human somewhere
 * or the loop builds its own promotion dossier — auto-apply one layer down.
 */
function eligibilityFor(source: EvidenceSource, writer: EvidenceWriter) {
  if (source === "mock" || source === "demo") {
    return syntheticEligibility(source);
  }
  if (writer.kind === "declared-service") {
    return {
      eligibleForEvaluation: true as const,
      eligibleForPromotion: false as const,
    };
  }
  // verified-human: real may support promotion; imported may be scored only.
  return {
    eligibleForEvaluation: true as const,
    eligibleForPromotion: source === "real",
  };
}

async function insertEvidence(
  ctx: MutationCtx,
  args: {
    agentVersionId: Doc<"agentVersions">["_id"];
    type:
      | "run"
      | "submitted-artifact"
      | "test-report"
      | "approval-decision"
      | "edit-diff"
      | "manual-attestation"
      | "feedback";
    feedbackForEvidenceId?: Doc<"evidence">["_id"];
    cost?: {
      amountUsd: number;
      provider: string;
      modelId: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  },
  source: EvidenceSource,
  writer: EvidenceWriter,
  executedBy?: AuthorityActor,
  executionKind?: "production" | "candidate-preview",
  extra?: {
    previewSourceKind?: "golden-fixture" | "pasted-source";
    checkOverride?: { reason: string; overriddenCheckIds: string[] };
  },
) {
  const runBy = writer.actor;
  const actorKind = writer.kind === "verified-human" ? "human" : "service";
  const eligibility = eligibilityFor(source, writer);
  // Structural invariant, not a re-derivation: no row may be both
  // service-written and promotion-eligible. eligibilityFor already guarantees
  // it, so this can only fire if that function is later edited — which is
  // exactly when it should. One fossil row exists from before the rule; this
  // makes a second one impossible rather than merely unlikely.
  if (actorKind === "service" && eligibility.eligibleForPromotion === true) {
    throw new Error(
      "Refusing to insert service-written evidence marked eligibleForPromotion: " +
        "a release case needs a human somewhere, or the loop builds its own promotion dossier",
    );
  }
  const version = await ctx.db.get(args.agentVersionId);
  if (!version) throw new Error(`Version ${args.agentVersionId} not found`);
  if (!version.artifact?.declaredDigest) {
    if (version.sourcePin?.kind === "git-commit") {
      throw new Error(
        "Foreign-runtime evidence is unavailable: a Git commit source pin is not an artifact content digest, and the evidence-identity model is not yet defined",
      );
    }
    throw new Error(
      "Evidence requires a version with a declared artifact digest",
    );
  }
  const agent = await ctx.db.get(version.agentId);
  if (!agent) throw new Error(`Agent ${version.agentId} not found`);
  if (source === "demo" && agent.displayId !== A7_DEMO_DISPLAY_ID) {
    throw new Error("Demo evidence is restricted to A7");
  }
  if (!agent.evidenceContract.acceptedTypes.includes(args.type)) {
    throw new Error(`Evidence type ${args.type} is not accepted by this agent`);
  }
  if (args.type === "feedback" && !args.feedbackForEvidenceId) {
    throw new Error("Feedback evidence must reference the evidence it evaluates");
  }
  if (args.type !== "feedback" && args.feedbackForEvidenceId) {
    throw new Error("Only feedback evidence may reference another evidence row");
  }
  if (args.feedbackForEvidenceId) {
    const target = await ctx.db.get(args.feedbackForEvidenceId);
    if (!target || target.agentId !== version.agentId) {
      throw new Error("Feedback target must exist and belong to the same agent");
    }
  }
  if (args.cost) {
    if (
      args.cost.amountUsd < 0 ||
      !args.cost.provider.trim() ||
      !args.cost.modelId.trim()
    ) {
      throw new Error("Provider-attributed cost is invalid");
    }
    for (const tokens of [
      args.cost.inputTokens,
      args.cost.outputTokens,
      args.cost.totalTokens,
    ]) {
      if (tokens !== undefined && (!Number.isInteger(tokens) || tokens < 0)) {
        throw new Error("Token counts must be non-negative integers");
      }
    }
  }

  return await ctx.db.insert("evidence", {
    agentId: version.agentId,
    agentVersionId: version._id,
    declaredArtifactDigest: version.artifact.declaredDigest,
    type: args.type,
    source,
    ...eligibility,
    runBy,
    actorKind,
    ...(executedBy ? { executedBy } : {}),
    ...(executionKind ? { executionKind } : {}),
    ...(extra?.previewSourceKind ? { previewSourceKind: extra.previewSourceKind } : {}),
    ...(extra?.checkOverride ? { checkOverride: extra.checkOverride } : {}),
    occurredAt: Date.now(),
    cost: args.cost,
    feedbackForEvidenceId: args.feedbackForEvidenceId,
  });
}

async function verifiedHumanWriter(ctx: MutationCtx): Promise<EvidenceWriter> {
  return { kind: "verified-human", actor: await requireIdentity(ctx) };
}

function declaredServiceWriter(): EvidenceWriter {
  // requireIdentity is not called here — the actor is declared, not verified.
  return { kind: "declared-service", actor: declaredLoopServiceActor() };
}

/**
 * Look up the governed version whose declared digest matches the live artifact.
 * Never creates a version — a version is a release decision and stays human-only.
 */
async function lookupGovernedVersionByDigest(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  artifactDigest: string,
): Promise<Doc<"agentVersions">> {
  const digest = String(artifactDigest || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("artifactDigest must be a sha256 hex digest");
  }
  const versions = await ctx.db
    .query("agentVersions")
    .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
    .collect();
  const matches = versions.filter(
    (row) =>
      String(row.artifact?.declaredDigest || "").toLowerCase() === digest,
  );
  if (matches.length === 0) {
    throw new Error(
      "No governed version matches the live artifact digest; evidence path looks up versions and never creates them",
    );
  }
  if (matches.length > 1) {
    throw new Error(
      "Multiple governed versions share this artifact digest; refuse rather than guess",
    );
  }
  return matches[0];
}

const executionEvidenceArgs = {
  agentVersionId: v.id("agentVersions"),
  type: evidenceType,
  feedbackForEvidenceId: v.optional(v.id("evidence")),
  cost: v.optional(providerCost),
};

export const recordRealExecutionEvidence = internalMutation({
  args: executionEvidenceArgs,
  handler: async (ctx, args) =>
    await insertEvidence(ctx, args, "real", declaredServiceWriter()),
});

export const recordMockEvidence = internalMutation({
  args: {
    agentVersionId: v.id("agentVersions"),
    type: evidenceType,
    feedbackForEvidenceId: v.optional(v.id("evidence")),
  },
  handler: async (ctx, args) =>
    await insertEvidence(ctx, args, "mock", declaredServiceWriter()),
});

export const recordDemoEvidence = internalMutation({
  args: {
    agentVersionId: v.id("agentVersions"),
    type: evidenceType,
    feedbackForEvidenceId: v.optional(v.id("evidence")),
  },
  handler: async (ctx, args) =>
    await insertEvidence(ctx, args, "demo", declaredServiceWriter()),
});

/**
 * One metadata-only evidence row for a scored A7 hosted run.
 * Resolves the agent version by live artifact digest — never inserts a version.
 */
export const recordHostedRunEvidence = internalMutation({
  args: {
    displayId: v.string(),
    artifactDigest: v.string(),
    cost: v.optional(providerCost),
  },
  handler: async (ctx, args) => {
    const displayId = args.displayId.trim();
    if (displayId !== A7_HOSTED_DISPLAY_ID) {
      throw new Error(
        `Hosted-run evidence is limited to ${A7_HOSTED_DISPLAY_ID} in this step`,
      );
    }
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_displayId", (q) => q.eq("displayId", displayId))
      .unique();
    if (!agent) throw new Error(`No agent ${displayId}`);
    const version = await lookupGovernedVersionByDigest(
      ctx,
      agent._id,
      args.artifactDigest,
    );
    return await insertEvidence(
      ctx,
      {
        agentVersionId: version._id,
        type: "run",
        cost: args.cost,
      },
      "real",
      declaredServiceWriter(),
    );
  },
});

/**
 * A human-witnessed hosted run — the only public path to promotion-eligible
 * evidence, and the reason the promotion gate is reachable at all.
 *
 * Called by the BROWSER as the signed-in human, never by Railway. That is the
 * whole distinction: recordHostedRunEvidence is an internalMutation invoked
 * with the deploy key, so it can only ever produce actorKind "service". Here
 * requireIdentity runs against the caller's own Clerk session.
 *
 * Two identities, neither overloaded:
 *   runBy      = the signed-in human who chose to run it and saw the output
 *   actorKind  = "human" — WHO WROTE THE ROW, nothing more
 *   executedBy = the loop service principal, which performed the actual call
 *
 * What stops this becoming a hand-written promotion dossier:
 *   1. declaredArtifactDigest must resolve to exactly one governed version.
 *      Convex looks up; it never creates. You cannot attest to a version that
 *      does not exist, or to bytes nothing approved.
 *   2. Eligibility is derived in eligibilityFor, never taken from arguments,
 *      so no caller can promote by supplying a flag.
 *   3. No input and no output are recorded. This says a human ran it, never
 *      what came back — the row cannot carry fellow material.
 *   4. It is not a release. assertReleasableCandidate additionally requires an
 *      evalResult naming what was checked, which is a separate deliberate act.
 */
export const recordVerifiedHumanRunEvidence = mutation({
  args: {
    displayId: v.string(),
    artifactDigest: v.string(),
    cost: v.optional(providerCost),
  },
  handler: async (ctx, args) => {
    // requireIdentity, not requireApprover: witnessing a run is not approving
    // one. The approver gate stays where the pointer moves.
    const human = await requireIdentity(ctx);
    const displayId = args.displayId.trim();
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_displayId", (q) => q.eq("displayId", displayId))
      .unique();
    if (!agent) throw new Error(`No agent ${displayId}`);
    // Constraint 1: the digest must resolve to exactly one governed version.
    const version = await lookupGovernedVersionByDigest(
      ctx,
      agent._id,
      args.artifactDigest,
    );
    // Proof first. Without a service-recorded execution of these exact bytes,
    // "a human saw output" is an assertion the caller made about themselves.
    const proof = await claimExecutionProof(ctx, {
      agentVersionId: version._id,
      declaredArtifactDigest: version.artifact!.declaredDigest,
      executionKind: "production",
    });
    const evidenceId = await insertEvidence(
      ctx,
      {
        agentVersionId: version._id,
        type: "run",
        // Prefer the cost the SERVICE recorded when it ran. A caller-supplied
        // figure is a claim; the executing service's is a measurement.
        cost: proof.cost ?? args.cost,
      },
      "real",
      { kind: "verified-human", actor: human },
      // Railway ran it; the human witnessed it. Recorded, not conflated.
      declaredLoopServiceActor(),
      "production",
    );
    // Consume in the same transaction as the insert, so two concurrent
    // attestations cannot both redeem one execution.
    await ctx.db.patch(proof._id, { consumedByEvidenceId: evidenceId });
    return evidenceId;
  },
});

/**
 * A human-witnessed PREVIEW of a candidate version.
 *
 * Breaks the release deadlock. Witnessing production bytes cannot attest a
 * candidate: to serve candidate bytes you must put them on main, which makes
 * the served digest disagree with the approved one, which 409s the run — so
 * the only run that could produce candidate evidence is the run the digest
 * gate refuses. The preview executes the candidate's PINNED FIXTURE from
 * eval-artifacts instead, which fellows never receive.
 *
 * Permitted only for a version that is ALL THREE, each refused by name:
 *   1. state "candidate"          — a draft or released version is not under release
 *   2. referenced by an OPEN proposal — bounds it to a release actually in progress
 *   3. not currentApprovedVersionId  — previewing what is already live is production
 *
 * Without all three this is "execute arbitrary bytes and call it evidence",
 * which is the relaxed digest gate we deliberately did not build.
 *
 * source stays "real" — the model call and the bytes are real. executionKind
 * records that the audience was a reviewer, not a fellow.
 */
export const recordCandidatePreviewEvidence = mutation({
  args: {
    displayId: v.string(),
    artifactDigest: v.string(),
    cost: v.optional(providerCost),
    // previewSourceKind and blockingCheckIds are deliberately NOT arguments.
    // Both are read off the service execution proof below. As arguments they
    // were caller-controlled: omitting a failed check skipped the override
    // gate, and a wrong source kind made the durable row misdescribe what was
    // attested. Neither is something the attester gets to assert.
    // The deliberate override. Reason required; absence is a refusal.
    overrideReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Approver, not merely authenticated. The preview ROUTE is approver-gated,
    // so a non-approver could not have run the preview they would be attesting.
    // This does NOT prove an execution happened — see the preview-proof gap
    // recorded in docs/APPROVER_IDENTITY.md.
    const human = await requireApprover(ctx);
    const displayId = args.displayId.trim();
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_displayId", (q) => q.eq("displayId", displayId))
      .unique();
    if (!agent) throw new Error(`No agent ${displayId}`);

    const version = await lookupGovernedVersionByDigest(
      ctx,
      agent._id,
      args.artifactDigest,
    );

    if (version.state !== "candidate") {
      throw new ConvexError({
        code: "PREVIEW_VERSION_NOT_CANDIDATE",
        status: 409,
        message: `PREVIEW_VERSION_NOT_CANDIDATE: ${version.version} is state "${version.state}", not "candidate". Only a version under release may be previewed.`,
      });
    }
    if (agent.currentApprovedVersionId === version._id) {
      throw new ConvexError({
        code: "PREVIEW_VERSION_ALREADY_APPROVED",
        status: 409,
        message: `PREVIEW_VERSION_ALREADY_APPROVED: ${version.version} is the current approved version. Running it is production, not a preview.`,
      });
    }
    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_candidateVersionId", (q) =>
        q.eq("candidateVersionId", version._id),
      )
      .collect();
    if (!proposals.some((proposal) => proposal.status === "open")) {
      throw new ConvexError({
        code: "PREVIEW_NO_OPEN_PROPOSAL",
        status: 409,
        message: `PREVIEW_NO_OPEN_PROPOSAL: no open proposal references ${version.version}. A preview attests a release in progress; without one there is nothing being decided.`,
      });
    }

    // Claim the proof FIRST: the blocking failures and the source kind are
    // facts the executing service observed, so they come from the proof rather
    // than from the caller attesting to it.
    const proof = await claimExecutionProof(ctx, {
      agentVersionId: version._id,
      declaredArtifactDigest: version.artifact!.declaredDigest,
      executionKind: "candidate-preview",
    });

    // A blocking failure REFUSES the attestation. Not a warning: evidence that
    // a human saw output a scored or named_hit check failed, with nothing
    // recording that they knew, is exactly the "looked like it worked" artifact
    // this system exists to prevent.
    const blocking = proof.blockingCheckIds ?? [];
    const overrideReason = (args.overrideReason ?? "").trim();
    if (blocking.length && !overrideReason) {
      throw new ConvexError({
        code: "BLOCKING_CHECK_FAILED",
        status: 409,
        message:
          `BLOCKING_CHECK_FAILED: the recorded execution failed ${blocking.join(", ")}. ` +
          `Attesting is refused. To attest anyway, state why the check is wrong about this draft — ` +
          `the reason is recorded on the evidence row as an explicit human override.`,
      });
    }
    if (overrideReason && !blocking.length) {
      throw new ConvexError({
        code: "OVERRIDE_WITHOUT_FAILURE",
        status: 400,
        message:
          "OVERRIDE_WITHOUT_FAILURE: an override was supplied but the recorded execution failed no blocking check. An override must name what it overrides.",
      });
    }
    // A preview whose execution never recorded what it ran against cannot be
    // attested: the row would have to guess, and a guess about provenance is
    // the thing this field exists to prevent.
    if (!proof.previewSourceKind) {
      throw new ConvexError({
        code: "PREVIEW_PROVENANCE_UNRECORDED",
        status: 409,
        message:
          "PREVIEW_PROVENANCE_UNRECORDED: the execution record does not say what the preview ran against, so the evidence row cannot state it. Re-run the preview on a build that records provenance.",
      });
    }
    const evidenceId = await insertEvidence(
      ctx,
      {
        agentVersionId: version._id,
        type: "run",
        cost: proof.cost ?? args.cost,
      },
      "real",
      { kind: "verified-human", actor: human },
      declaredLoopServiceActor(),
      "candidate-preview",
      {
        // From the proof, never the caller.
        previewSourceKind: proof.previewSourceKind,
        ...(overrideReason
          ? {
              checkOverride: {
                reason: overrideReason,
                overriddenCheckIds: [...blocking],
              },
            }
          : {}),
      },
    );
    await ctx.db.patch(proof._id, { consumedByEvidenceId: evidenceId });
    return evidenceId;
  },
});

export const recordImportedEvidence = mutation({
  args: {
    agentVersionId: v.id("agentVersions"),
    type: evidenceType,
    feedbackForEvidenceId: v.optional(v.id("evidence")),
  },
  handler: async (ctx, args) =>
    await insertEvidence(
      ctx,
      args,
      "imported",
      await verifiedHumanWriter(ctx),
    ),
});

export const listForVersion = query({
  args: { agentVersionId: v.id("agentVersions") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("evidence")
      .withIndex("by_agentVersionId", (q) =>
        q.eq("agentVersionId", args.agentVersionId),
      )
      .collect(),
});

export const listEligibleForEvaluation = query({
  args: { agentVersionId: v.id("agentVersions") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("evidence")
      .withIndex("by_version_and_eval_eligibility", (q) =>
        q
          .eq("agentVersionId", args.agentVersionId)
          .eq("eligibleForEvaluation", true),
      )
      .collect();
    return rows.filter((row) => row.source === "real" || row.source === "imported");
  },
});

export const listEligibleForPromotion = query({
  args: { agentVersionId: v.id("agentVersions") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("evidence")
      .withIndex("by_version_and_promotion_eligibility", (q) =>
        q
          .eq("agentVersionId", args.agentVersionId)
          .eq("eligibleForPromotion", true),
      )
      .collect();
    return rows.filter((row) => row.source === "real");
  },
});

/** Latest evidence rows for a display id — used to inspect service writes. */
export const listRecentForDisplayId = query({
  args: { displayId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const agent = await ctx.db
      .query("agents")
      .withIndex("by_displayId", (q) => q.eq("displayId", args.displayId.trim()))
      .unique();
    if (!agent) return [];
    const versions = await ctx.db
      .query("agentVersions")
      .withIndex("by_agentId", (q) => q.eq("agentId", agent._id))
      .collect();
    const versionIds = new Set(versions.map((row) => row._id));
    const all = [];
    for (const versionId of versionIds) {
      const rows = await ctx.db
        .query("evidence")
        .withIndex("by_agentVersionId", (q) =>
          q.eq("agentVersionId", versionId),
        )
        .collect();
      all.push(...rows);
    }
    all.sort((a, b) => b.occurredAt - a.occurredAt);
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
    return all.slice(0, limit);
  },
});
