import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  APPROVED_IMPORT_MANIFEST_DIGEST,
  APPROVED_IMPORT_SPEC,
  stableStringify,
} from "./importSpec";
import { requireApprover, type AuthorityActor } from "./lib/auth";

type ImportCtx = MutationCtx | QueryCtx;

function rejectUnapprovedManifest(digest: string): void {
  if (digest !== APPROVED_IMPORT_MANIFEST_DIGEST) {
    throw new ConvexError({
      code: "MANIFEST_NOT_APPROVED",
      status: 403,
      message: "Import manifest is altered, unresolved, or not approved",
    });
  }
}

async function oneAgentByDisplayId(ctx: ImportCtx, displayId: string) {
  const matches = await ctx.db
    .query("agents")
    .withIndex("by_displayId", (q) => q.eq("displayId", displayId))
    .collect();
  if (matches.length > 1) {
    throw new Error(`Duplicate canonical display id ${displayId}`);
  }
  return matches[0] ?? null;
}

function pickAgentContract(agent: Record<string, unknown>) {
  const {
    name,
    tagline,
    description,
    platform,
    status,
    category,
    owner,
    initials,
    model,
    runner,
    usabilityModes,
    invocation,
    autonomyLevel,
    executionContract,
    evidenceContract,
    outcomeContract,
    optimisableUnit,
    guardrails,
    skills,
    tools,
    context,
    accessUrl,
    repoUrl,
  } = agent;
  return {
    name,
    tagline,
    description,
    platform,
    status,
    category,
    owner,
    initials,
    model,
    runner,
    usabilityModes,
    invocation,
    autonomyLevel,
    executionContract,
    evidenceContract,
    outcomeContract,
    optimisableUnit,
    guardrails,
    skills,
    tools,
    context,
    accessUrl,
    repoUrl,
  };
}

function assertExact(label: string, actual: unknown, expected: unknown): void {
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(
      `${label} already exists but does not match the approved import manifest`,
    );
  }
}

function provenance(now: number) {
  return {
    manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST,
    sourceExportDigest: APPROVED_IMPORT_SPEC.sourceExportSha256,
    importedAt: now,
    legacyCreatorClaimed: false as const,
  };
}

async function ensureAgent(
  ctx: MutationCtx,
  displayId: "A7" | "A8",
  approved: (typeof APPROVED_IMPORT_SPEC.imports)["A7" | "A8"],
  actor: AuthorityActor,
  now: number,
) {
  const existing = await oneAgentByDisplayId(ctx, displayId);
  if (existing) {
    assertExact(
      `${displayId} agent`,
      pickAgentContract(existing as unknown as Record<string, unknown>),
      pickAgentContract(
        approved.agent as unknown as Record<string, unknown>,
      ),
    );
    if (
      existing.importProvenance?.manifestDigest !==
      APPROVED_IMPORT_MANIFEST_DIGEST
    ) {
      throw new Error(
        `${displayId} exists without this approved import provenance`,
      );
    }
    return { id: existing._id, created: false };
  }

  const id = await ctx.db.insert("agents", {
    ...(approved.agent as any),
    displayId,
    importProvenance: provenance(now),
    createdBy: actor,
    createdAt: now,
  });
  return { id, created: true };
}

async function oneVersion(
  ctx: ImportCtx,
  agentId: Id<"agents">,
  version: string,
) {
  return await ctx.db
    .query("agentVersions")
    .withIndex("by_agentId_and_version", (q) =>
      q.eq("agentId", agentId).eq("version", version),
    )
    .unique();
}

async function ensureVersion(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  approved:
    | typeof APPROVED_IMPORT_SPEC.imports.A7.version
    | typeof APPROVED_IMPORT_SPEC.imports.A8.version,
  actor: AuthorityActor,
  now: number,
) {
  const existing = await oneVersion(ctx, agentId, approved.version);
  const expected = {
    state: approved.state,
    artifact: approved.artifact ?? undefined,
    sourcePin: "sourcePin" in approved ? approved.sourcePin : undefined,
  };
  if (existing) {
    assertExact(`${approved.version} version`, {
      state: existing.state,
      artifact: existing.artifact,
      sourcePin: existing.sourcePin,
    }, expected);
    if (
      existing.importProvenance?.manifestDigest !==
      APPROVED_IMPORT_MANIFEST_DIGEST
    ) {
      throw new Error(
        `${approved.version} exists without this approved import provenance`,
      );
    }
    return { id: existing._id, created: false };
  }

  const id = await ctx.db.insert("agentVersions", {
    agentId,
    version: approved.version,
    state: approved.state,
    artifact: approved.artifact ?? undefined,
    sourcePin: "sourcePin" in approved ? approved.sourcePin : undefined,
    importProvenance: provenance(now),
    createdBy: actor,
    createdAt: now,
  } as any);
  return { id, created: true };
}

async function ensureA7Proposal(
  ctx: MutationCtx,
  agentId: Id<"agents">,
  candidateVersionId: Id<"agentVersions">,
  actor: AuthorityActor,
  now: number,
) {
  const existing = await ctx.db
    .query("proposals")
    .withIndex("by_candidateVersionId", (q) =>
      q.eq("candidateVersionId", candidateVersionId),
    )
    .unique();
  if (existing) {
    if (existing.agentId !== agentId) {
      throw new Error("A7 candidate proposal belongs to another agent");
    }
    return { id: existing._id, created: false, status: existing.status };
  }
  const id = await ctx.db.insert("proposals", {
    agentId,
    candidateVersionId,
    status: "open",
    summary: APPROVED_IMPORT_SPEC.imports.A7.release.proposalSummary,
    createdBy: actor,
    createdAt: now,
  });
  return { id, created: true, status: "open" as const };
}

async function previewState(ctx: QueryCtx) {
  const a7 = await oneAgentByDisplayId(ctx, "A7");
  const a8 = await oneAgentByDisplayId(ctx, "A8");
  const a7Version = a7
    ? await oneVersion(
        ctx,
        a7._id,
        APPROVED_IMPORT_SPEC.imports.A7.version.version,
      )
    : null;
  const a8Version = a8
    ? await oneVersion(
        ctx,
        a8._id,
        APPROVED_IMPORT_SPEC.imports.A8.version.version,
      )
    : null;
  const a7Proposal = a7Version
    ? await ctx.db
        .query("proposals")
        .withIndex("by_candidateVersionId", (q) =>
          q.eq("candidateVersionId", a7Version._id),
        )
        .unique()
    : null;
  return {
    manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST,
    scope: ["A7", "A8"],
    exclusions: APPROVED_IMPORT_SPEC.exclusions,
    creates: {
      agents: [!a7 ? "A7" : null, !a8 ? "A8" : null].filter(Boolean),
      versions: [
        !a7Version ? "A7:biocraft-singleshot-v4" : null,
        !a8Version ? "A8:0.1.0" : null,
      ].filter(Boolean),
      proposals: !a7Proposal ? ["A7 canonical release proposal"] : [],
      reviewEvents: [],
      evidence: [],
      evalResults: [],
      requests: [],
    },
    existing: {
      A7: Boolean(a7),
      A7Version: Boolean(a7Version),
      A7Proposal: Boolean(a7Proposal),
      A7CurrentApproved:
        Boolean(a7?.["currentApprovedVersionId"]) &&
        a7?.["currentApprovedVersionId"] === a7Version?._id,
      A8: Boolean(a8),
      A8Version: Boolean(a8Version),
    },
  };
}

export const previewApprovedCanonicalImport = query({
  args: { manifestDigest: v.string() },
  handler: async (ctx, args) => {
    await requireApprover(ctx);
    rejectUnapprovedManifest(args.manifestDigest);
    return await previewState(ctx);
  },
});

export const executeApprovedCanonicalImport = mutation({
  args: { manifestDigest: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireApprover(ctx);
    rejectUnapprovedManifest(args.manifestDigest);
    const now = Date.now();

    const a7Agent = await ensureAgent(
      ctx,
      "A7",
      APPROVED_IMPORT_SPEC.imports.A7,
      actor,
      now,
    );
    const a7Version = await ensureVersion(
      ctx,
      a7Agent.id,
      APPROVED_IMPORT_SPEC.imports.A7.version,
      actor,
      now,
    );
    const a7Proposal = await ensureA7Proposal(
      ctx,
      a7Agent.id,
      a7Version.id,
      actor,
      now,
    );

    const a8Agent = await ensureAgent(
      ctx,
      "A8",
      APPROVED_IMPORT_SPEC.imports.A8,
      actor,
      now,
    );
    const a8Version = await ensureVersion(
      ctx,
      a8Agent.id,
      APPROVED_IMPORT_SPEC.imports.A8.version,
      actor,
      now,
    );

    return {
      manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST,
      importedAt: now,
      importedBy: { subject: actor.subject, issuer: actor.issuer },
      A7: {
        agentId: a7Agent.id,
        agentCreated: a7Agent.created,
        versionId: a7Version.id,
        versionCreated: a7Version.created,
        proposalId: a7Proposal.id,
        proposalCreated: a7Proposal.created,
        proposalStatus: a7Proposal.status,
      },
      A8: {
        agentId: a8Agent.id,
        agentCreated: a8Agent.created,
        versionId: a8Version.id,
        versionCreated: a8Version.created,
      },
    };
  },
});

export const inspectApprovedCanonicalImport = query({
  args: { manifestDigest: v.string() },
  handler: async (ctx, args) => {
    await requireApprover(ctx);
    rejectUnapprovedManifest(args.manifestDigest);
    const [
      agents,
      versions,
      proposals,
      reviews,
      evidence,
      evalResults,
      requests,
    ] = await Promise.all([
      ctx.db.query("agents").collect(),
      ctx.db.query("agentVersions").collect(),
      ctx.db.query("proposals").collect(),
      ctx.db.query("reviewEvents").collect(),
      ctx.db.query("evidence").collect(),
      ctx.db.query("evalResults").collect(),
      ctx.db.query("requests").collect(),
    ]);
    const importedAgents = agents.filter((agent) =>
      APPROVED_IMPORT_SPEC.scope.includes(agent.displayId as "A7" | "A8"),
    );
    const importedAgentIds = new Set(importedAgents.map((agent) => agent._id));
    const importedVersions = versions.filter((version) =>
      importedAgentIds.has(version.agentId),
    );
    return {
      manifestDigest: APPROVED_IMPORT_MANIFEST_DIGEST,
      counts: {
        agents: agents.length,
        agentVersions: versions.length,
        proposals: proposals.length,
        reviewEvents: reviews.length,
        evidence: evidence.length,
        evalResults: evalResults.length,
        requests: requests.length,
      },
      importedAgents: importedAgents.map((agent) => ({
        id: agent._id,
        displayId: agent.displayId,
        runner: agent.runner,
        usabilityModes: agent.usabilityModes,
        approvedVersionId: agent["currentApprovedVersionId"] ?? null,
        createdBy: agent.createdBy,
        createdAt: agent.createdAt,
        importProvenance: agent.importProvenance,
      })),
      importedVersions: importedVersions.map((version) => ({
        id: version._id,
        agentId: version.agentId,
        version: version.version,
        state: version.state,
        artifact: version.artifact ?? null,
        sourcePin: version.sourcePin ?? null,
        createdBy: version.createdBy,
        createdAt: version.createdAt,
        importProvenance: version.importProvenance,
      })),
      proposals: proposals.map((proposal) => ({
        id: proposal._id,
        agentId: proposal.agentId,
        candidateVersionId: proposal.candidateVersionId,
        status: proposal.status,
      })),
      reviews: reviews.map((review) => ({
        id: review._id,
        proposalId: review.proposalId,
        decision: review.decision,
        actor: review.actor,
        resultingVersionId: review.resultingVersionId ?? null,
        timestamp: review.timestamp,
      })),
    };
  },
});
