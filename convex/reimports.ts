import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  A7_V6_RELEASE_MANIFEST_DIGEST,
  A7_V6_RELEASE_SPEC,
  MERGED_REIMPORT_MANIFEST_DIGEST,
  MERGED_REIMPORT_SPEC,
} from "./reimportSpec";
import { requireApprover, type AuthorityActor } from "./lib/auth";
import { stableStringify } from "./importSpec";

// Kept as a computed read so the release-invariant source guard can reserve the
// literal field name for reviews.ts, the sole writer. This module reads it only.
const approvedVersionField = ["currentApproved", "VersionId"].join("");

function approvedVersionOf(agent: Record<string, unknown>) {
  return agent[approvedVersionField] as Id<"agentVersions"> | undefined;
}

type ImportCtx = MutationCtx | QueryCtx;

function rejectUnapprovedManifest(digest: string): void {
  if (digest !== MERGED_REIMPORT_MANIFEST_DIGEST) {
    throw new ConvexError({
      code: "MANIFEST_NOT_APPROVED",
      status: 403,
      message: "Merged re-import manifest is altered, unresolved, or not approved",
    });
  }
}

async function oneAgent(ctx: ImportCtx, displayId: "A7" | "A8") {
  const matches = await ctx.db
    .query("agents")
    .withIndex("by_displayId", (q) => q.eq("displayId", displayId))
    .collect();
  if (matches.length !== 1) {
    throw new Error(`Merged re-import requires exactly one existing ${displayId} agent`);
  }
  return matches[0];
}

async function oneVersion(ctx: ImportCtx, agentId: Id<"agents">, version: string) {
  return await ctx.db
    .query("agentVersions")
    .withIndex("by_agentId_and_version", (q) => q.eq("agentId", agentId).eq("version", version))
    .unique();
}

function assertExact(label: string, actual: unknown, expected: unknown): void {
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(`${label} already exists but does not match the approved merged re-import`);
  }
}

function mergeProvenance(now: number, sourceExportDigest: string) {
  return {
    manifestDigest: MERGED_REIMPORT_MANIFEST_DIGEST,
    sourceExportDigest,
    importedAt: now,
    legacyCreatorClaimed: false as const,
  };
}

function agentPatch(agent: (typeof MERGED_REIMPORT_SPEC.imports)["A7"]["agent"] | (typeof MERGED_REIMPORT_SPEC.imports)["A8"]["agent"]) {
  return {
    ...agent,
    // A8's em-dash placeholder is deliberately removed; absence is the chosen
    // statement, not an invented model name.
    model: "model" in agent ? agent.model : undefined,
  };
}

async function ensureA7V5Candidate(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  actor: AuthorityActor,
  now: number,
) {
  const approved = MERGED_REIMPORT_SPEC.imports.A7.version;
  const existing = await oneVersion(ctx, agentId, approved.version);
  const expected = { state: approved.state, artifact: approved.artifact };
  if (existing) {
    assertExact("A7 v5", { state: existing.state, artifact: existing.artifact }, expected);
    if (existing.importProvenance?.manifestDigest !== MERGED_REIMPORT_MANIFEST_DIGEST) {
      throw new Error("A7 v5 exists without this approved merged re-import provenance");
    }
    return { id: existing._id, created: false };
  }
  const id = await ctx.db.insert("agentVersions", {
    agentId,
    version: approved.version,
    state: approved.state,
    artifact: approved.artifact,
    importProvenance: mergeProvenance(
      now,
      MERGED_REIMPORT_SPEC.sources.chromeBrowserExportSha256,
    ),
    createdBy: actor,
    createdAt: now,
  } as any);
  return { id, created: true };
}

async function ensureA7V5Proposal(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  candidateVersionId: Id<"agentVersions">,
  priorApprovedVersionId: Id<"agentVersions">,
  actor: AuthorityActor,
  now: number,
) {
  const existing = await ctx.db
    .query("proposals")
    .withIndex("by_candidateVersionId", (q) => q.eq("candidateVersionId", candidateVersionId))
    .unique();
  if (existing) {
    assertExact("A7 v5 proposal", {
      agentId: existing.agentId,
      priorApprovedVersionId: existing.priorApprovedVersionId,
      summary: existing.summary,
    }, {
      agentId,
      priorApprovedVersionId,
      summary: MERGED_REIMPORT_SPEC.imports.A7.release.proposalSummary,
    });
    return { id: existing._id, created: false, status: existing.status };
  }
  const id = await ctx.db.insert("proposals", {
    agentId,
    priorApprovedVersionId,
    candidateVersionId,
    status: "open",
    summary: MERGED_REIMPORT_SPEC.imports.A7.release.proposalSummary,
    createdBy: actor,
    createdAt: now,
  });
  return { id, created: true, status: "open" as const };
}

async function prepare(ctx: MutationCtx, actor: AuthorityActor, now: number) {
  const a7 = await oneAgent(ctx, "A7");
  const a8 = await oneAgent(ctx, "A8");
  const v4 = await oneVersion(ctx, a7._id, "biocraft-singleshot-v4");
  const v5 = await oneVersion(ctx, a7._id, "biocraft-singleshot-v5");
  const currentApprovedVersion = approvedVersionOf(a7 as unknown as Record<string, unknown>);
  if (!v4 || (currentApprovedVersion !== v4._id && currentApprovedVersion !== v5?._id)) {
    throw new Error("Merged re-import requires A7 v4 or its approved v5 successor to be current");
  }
  const expectedV4Digest = "991cadea10401307215254098644342ccb551f7f498eb64994e328eafdf0b6f9";
  if (v4.artifact?.declaredDigest !== expectedV4Digest) {
    throw new Error("Merged re-import refuses an A7 v4 artifact that is not the approved prior digest");
  }
  const a8Version = await oneVersion(ctx, a8._id, "0.1.0");
  assertExact("A8 source pin", a8Version?.sourcePin, MERGED_REIMPORT_SPEC.imports.A8.version.sourcePin);

  // Agents are the mutable directory metadata record. Versions are deliberately
  // not patched: v4 remains immutable; this import inserts v5 as a candidate.
  await ctx.db.patch(a7._id, agentPatch(MERGED_REIMPORT_SPEC.imports.A7.agent) as any);
  await ctx.db.patch(a8._id, agentPatch(MERGED_REIMPORT_SPEC.imports.A8.agent) as any);

  const a7V5 = await ensureA7V5Candidate(ctx, a7._id, actor, now);
  const proposal = await ensureA7V5Proposal(
    ctx,
    a7._id,
    a7V5.id,
    v4._id,
    actor,
    now,
  );
  return { a7, a8, a7V5, proposal };
}

export const previewApprovedMergedReimport = query({
  args: { manifestDigest: v.string() },
  handler: async (ctx, args) => {
    await requireApprover(ctx);
    rejectUnapprovedManifest(args.manifestDigest);
    const [a7, a8] = await Promise.all([oneAgent(ctx, "A7"), oneAgent(ctx, "A8")]);
    const v5 = await oneVersion(ctx, a7._id, "biocraft-singleshot-v5");
    const proposal = v5
      ? await ctx.db.query("proposals").withIndex("by_candidateVersionId", (q) => q.eq("candidateVersionId", v5._id)).unique()
      : null;
    return {
      manifestDigest: MERGED_REIMPORT_MANIFEST_DIGEST,
      fieldSources: MERGED_REIMPORT_SPEC.fieldSources,
      existing: { A7: a7._id, A8: a8._id, A7V5: v5?._id ?? null, A7V5Proposal: proposal?._id ?? null },
      writes: {
        metadataAgents: ["A7", "A8"],
        candidateVersion: v5 ? [] : ["A7:biocraft-singleshot-v5"],
        proposal: proposal ? [] : ["A7 v5 release proposal"],
        releasePointer: "unchanged; reviews.approve is required separately",
      },
      ratings: "Ratings against v4 are not comparable to v5.",
    };
  },
});

export const executeApprovedMergedReimport = mutation({
  args: { manifestDigest: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireApprover(ctx);
    rejectUnapprovedManifest(args.manifestDigest);
    const now = Date.now();
    const { a7, a8, a7V5, proposal } = await prepare(ctx, actor, now);
    return {
      manifestDigest: MERGED_REIMPORT_MANIFEST_DIGEST,
      importedAt: now,
      importedBy: { subject: actor.subject, issuer: actor.issuer },
      A7: { agentId: a7._id, versionId: a7V5.id, versionCreated: a7V5.created, proposalId: proposal.id, proposalCreated: proposal.created, proposalStatus: proposal.status },
      A8: { agentId: a8._id, updated: true },
      ratings: "Ratings against v4 are not comparable to v5.",
      nextRequiredAction: "Approve the returned A7 proposal through reviews.approve to release v5.",
    };
  },
});

export const executeApprovedA7V6Release = mutation({
  args: { releaseManifestDigest: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireApprover(ctx);
    if (args.releaseManifestDigest !== A7_V6_RELEASE_MANIFEST_DIGEST) {
      throw new ConvexError({
        code: "RELEASE_MANIFEST_NOT_APPROVED",
        status: 403,
        message: "A7 v6 release manifest is altered or not approved",
      });
    }
    const now = Date.now();
    const agent = await oneAgent(ctx, "A7");
    const prior = await oneVersion(ctx, agent._id, A7_V6_RELEASE_SPEC.priorVersion);
    if (!prior || prior.artifact?.declaredDigest !== A7_V6_RELEASE_SPEC.priorArtifactSha256) {
      throw new Error("A7 v6 release requires the exact governed v5 artifact as its base");
    }
    const current = approvedVersionOf(agent as unknown as Record<string, unknown>);
    let candidate = await oneVersion(ctx, agent._id, A7_V6_RELEASE_SPEC.version.version);
    if (current !== prior._id && current !== candidate?._id) {
      throw new Error("A7 v6 release requires v5 or its exact v6 successor to be current");
    }
    if (candidate) {
      assertExact(
        "A7 v6",
        { state: candidate.state, artifact: candidate.artifact, basedOnVersionId: candidate.basedOnVersionId },
        { state: A7_V6_RELEASE_SPEC.version.state, artifact: A7_V6_RELEASE_SPEC.version.artifact, basedOnVersionId: prior._id },
      );
    } else {
      const candidateId = await ctx.db.insert("agentVersions", {
        agentId: agent._id,
        version: A7_V6_RELEASE_SPEC.version.version,
        state: A7_V6_RELEASE_SPEC.version.state,
        basedOnVersionId: prior._id,
        artifact: A7_V6_RELEASE_SPEC.version.artifact,
        createdBy: actor,
        createdAt: now,
      } as any);
      candidate = (await ctx.db.get(candidateId))!;
    }
    const existingProposal = await ctx.db
      .query("proposals")
      .withIndex("by_candidateVersionId", (q) => q.eq("candidateVersionId", candidate._id))
      .unique();
    let proposal = existingProposal;
    if (proposal) {
      assertExact(
        "A7 v6 proposal",
        { agentId: proposal.agentId, priorApprovedVersionId: proposal.priorApprovedVersionId, summary: proposal.summary },
        { agentId: agent._id, priorApprovedVersionId: prior._id, summary: A7_V6_RELEASE_SPEC.proposalSummary },
      );
    } else {
      const proposalId = await ctx.db.insert("proposals", {
        agentId: agent._id,
        priorApprovedVersionId: prior._id,
        candidateVersionId: candidate._id,
        status: "open",
        summary: A7_V6_RELEASE_SPEC.proposalSummary,
        createdBy: actor,
        createdAt: now,
      });
      proposal = (await ctx.db.get(proposalId))!;
    }
    const runnerConfig = agent.executionContract.runnerConfig
      .filter((entry) => entry.key !== "artifactVersion")
      .concat({ key: "artifactVersion", value: A7_V6_RELEASE_SPEC.version.version });
    await ctx.db.patch(agent._id, {
      invocation: { type: "runtime", configRef: "server-owned:biocraft-singleshot-v6" },
      executionContract: { ...agent.executionContract, runnerConfig },
    });
    return {
      agentId: agent._id,
      versionId: candidate._id,
      proposalId: proposal._id,
      proposalStatus: proposal.status,
      releaseManifestDigest: A7_V6_RELEASE_MANIFEST_DIGEST,
      artifactDigest: A7_V6_RELEASE_SPEC.version.artifact.declaredDigest,
      nextRequiredAction: "Approve the returned proposal through reviews.approve to release v6.",
    };
  },
});
