import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const governedDirectoryQuery = makeFunctionReference(
  "agents:listGovernedDirectoryPilot",
);
const authenticatedRequestsQuery = makeFunctionReference("requests:listRequests");
const registerAgentMutation = makeFunctionReference("agents:registerAgent");
const updateAgentMutation = makeFunctionReference("agents:updateAgent");
const createRequestMutation = makeFunctionReference("requests:createRequest");
const updateRequestMutation = makeFunctionReference("requests:updateRequest");
// The only public path to promotion-eligible evidence. Called by the BROWSER
// as the signed-in human — that is what makes actorKind "human". Routing it
// through Railway would make it a service write and defeat the point.
const recordVerifiedHumanRunEvidenceMutation = makeFunctionReference(
  "evidence:recordVerifiedHumanRunEvidence",
);

// ── Maintainer surface ───────────────────────────────────────────────────────
// Approver-only. Reachable ONLY from inside the app: requireApprover reads a
// top-level `role` claim carried solely by the named "convex" JWT template,
// which Clerk's default __session token does not have — so the Clerk CLI and
// the Convex dashboard cannot call any of these.
const servicePromotionViolationsQuery = makeFunctionReference(
  "evidenceIntegrity:listServicePromotionViolations",
);
const backfillServicePromotionMutation = makeFunctionReference(
  "evidenceIntegrity:backfillServicePromotionEligibility",
);
const a7V10ReleaseMutation = makeFunctionReference(
  "reimports:executeApprovedA7V10Release",
);
const a10V4ReleaseMutation = makeFunctionReference(
  "reimports:executeApprovedA10V4Release",
);
const createEvalSetMutation = makeFunctionReference("evalSets:createEvalSet");
const createEvalCaseMutation = makeFunctionReference("evalSets:createEvalCase");
const recordEvalResultMutation = makeFunctionReference("evalResults:recordEvalResult");
const approveProposalMutation = makeFunctionReference("reviews:approve");
// Explicit, human-initiated attestation of a candidate preview. Deliberately
// NOT called by the preview itself: if the output is bad the human declines by
// not invoking this, and nothing is written.
const recordCandidatePreviewEvidenceMutation = makeFunctionReference(
  "evidence:recordCandidatePreviewEvidence",
);

function labels(items) {
  return Array.isArray(items)
    ? items.map((item) => item?.label).filter((label) => typeof label === "string")
    : [];
}

function inputKeys(contract) {
  return Array.isArray(contract?.inputs)
    ? contract.inputs
        .map((input) => input?.key)
        .filter((key) => typeof key === "string")
    : [];
}

export function mapGovernedPilotAgent(row) {
  const governed = row?.agent;
  if (!governed) return null;

  const version = row.version ?? null;
  const mapped = {
    id: governed.displayId,
    convexId: governed._id,
    name: governed.name,
    tagline: governed.tagline,
    description: governed.description ?? "",
    platform: governed.platform,
    status: governed.status,
    category: governed.category,
    owner: governed.owner,
    initials: governed.initials,
    model: governed.model ?? "",
    objective: governed.objective ?? "",
    when: governed.whenToUse ?? "",
    sop: governed.sop ?? "",
    outputs: Array.isArray(governed.outputs) ? [...governed.outputs] : [],
    runner: governed.runner,
    invocation: governed.invocation ?? null,
    autonomyLevel: governed.autonomyLevel ?? "L1",
    usabilityModes: [...governed.usabilityModes],
    successCriteria: labels(governed.outcomeContract?.successCriteria),
    guardrails: labels(governed.guardrails),
    skills: [...governed.skills],
    tools: labels(governed.tools),
    context: labels(governed.context),
    inputs: inputKeys(governed.executionContract),
    accessUrl: governed.accessUrl ?? "",
    repoUrl: governed.repoUrl ?? "",
    version: version?.version ?? "unversioned",
    convexRecord: governed,
    governedInConvex: true,
    convexGovernance: {
      versionState: version?.state ?? null,
      isCurrentApproved: row.isCurrentApproved === true,
      runner: governed.runner,
      invocationType: governed.invocation?.type ?? null,
      usabilityModes: [...governed.usabilityModes],
      artifact:
        version?.artifact?.declaredDigestAlgorithm === "sha256"
          ? {
              digest: version.artifact.declaredDigest,
              algorithm: "sha256",
              locator: version.artifact.locator,
            }
          : null,
      sourcePin:
        version?.sourcePin?.kind === "git-commit" &&
        version.sourcePin.isContentDigest === false
          ? {
              kind: "git-commit",
              repoUrl: version.sourcePin.repoUrl,
              commitSha: version.sourcePin.commitSha,
              isContentDigest: false,
            }
          : null,
    },
  };

  return mapped;
}

export function mapGovernedDirectoryRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(mapGovernedPilotAgent)
    .filter(Boolean)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
}

function mapRequest(row) {
  return {
    id: row.displayId,
    convexId: row._id,
    title: row.title,
    desc: row.desc,
    requestedBy: row.requestedBy,
    date: row.date,
    priority: row.priority,
    status: row.status,
    assignee: row.assignee ?? "",
    notes: row.notes ?? "",
    shippedAgentId: row.shippedAgentId ?? null,
  };
}

export function createConvexDirectoryClient({ url, clientFactory } = {}) {
  const normalizedUrl = typeof url === "string" ? url.trim() : "";
  if (!normalizedUrl) {
    return {
      enabled: false,
      async read() {
        return { agents: [], succeeded: false };
      },
    };
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    parsedUrl = null;
  }
  if (
    !parsedUrl ||
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    return {
      enabled: false,
      async read() {
        return { agents: [], succeeded: false };
      },
    };
  }
  const factory =
    clientFactory ??
    ((deploymentUrl) => new ConvexHttpClient(deploymentUrl));
  const client = factory(normalizedUrl);
  return {
    enabled: true,
    setAuthToken(token) {
      if (typeof token === "string" && token) client.setAuth(token);
      else client.clearAuth();
    },
    async verifySignedIdentity() {
      // This is an authenticated, read-only query. It proves a Clerk token is
      // accepted by this Convex deployment without creating a smoke-test row.
      await client.query(authenticatedRequestsQuery, {});
    },
    async registerAgent(args) {
      return await client.mutation(registerAgentMutation, args);
    },
    async updateAgent(args) {
      return await client.mutation(updateAgentMutation, args);
    },
    async createRequest(args) {
      return await client.mutation(createRequestMutation, args);
    },
    async updateRequest(args) {
      return await client.mutation(updateRequestMutation, args);
    },
    /**
     * Record that this signed-in human witnessed a hosted run.
     *
     * `artifactDigest` MUST be the digest the run actually served, taken from
     * the run response — never the digest we expected. Attesting to the
     * expected bytes when different bytes ran is the fabrication this whole
     * path exists to prevent.
     *
     * Does NOT create an evalResult. That is a separate deliberate act on a
     * separate surface; if one action produced both, the separation would be
     * decorative.
     */
    async recordVerifiedHumanRunEvidence({ displayId, artifactDigest }) {
      return await client.mutation(recordVerifiedHumanRunEvidenceMutation, {
        displayId,
        artifactDigest,
      });
    },
    // ── Maintainer surface ──
    async listServicePromotionViolations() {
      return await client.query(servicePromotionViolationsQuery, {});
    },
    async backfillServicePromotionEligibility(args = {}) {
      return await client.mutation(backfillServicePromotionMutation, args);
    },
    async executeA7V10Release(releaseManifestDigest) {
      return await client.mutation(a7V10ReleaseMutation, { releaseManifestDigest });
    },
    async executeA10V4Release(releaseManifestDigest) {
      return await client.mutation(a10V4ReleaseMutation, { releaseManifestDigest });
    },
    async createEvalSet(args) {
      return await client.mutation(createEvalSetMutation, args);
    },
    async createEvalCase(args) {
      return await client.mutation(createEvalCaseMutation, args);
    },
    /**
     * The second deliberate act. Convex refuses an empty or all-N/A criterion
     * set with EVAL_RESULT_NAMES_NOTHING — an attestation that names nothing
     * checked nothing.
     */
    async recordEvalResult(args) {
      return await client.mutation(recordEvalResultMutation, args);
    },
    async recordCandidatePreviewEvidence({
      displayId,
      artifactDigest,
      previewSourceKind,
      blockingCheckIds,
      overrideReason,
      cost,
    }) {
      return await client.mutation(recordCandidatePreviewEvidenceMutation, {
        displayId,
        artifactDigest,
        previewSourceKind,
        ...(blockingCheckIds ? { blockingCheckIds } : {}),
        ...(overrideReason ? { overrideReason } : {}),
        ...(cost ? { cost } : {}),
      });
    },
    async approveProposal(proposalId) {
      return await client.mutation(approveProposalMutation, {
        proposalId,
        editCategory: "no-edit",
      });
    },
    async listRequests() {
      const rows = await client.query(authenticatedRequestsQuery, {});
      return rows.map(mapRequest);
    },
    async read() {
      try {
        const rows = await client.query(
          governedDirectoryQuery,
          {},
        );
        return {
          agents: mapGovernedDirectoryRows(rows),
          succeeded: true,
        };
      } catch {
        return { agents: [], succeeded: false };
      }
    },
  };
}

if (typeof window !== "undefined" && typeof window.document !== "undefined") {
  const localOverride = window.localStorage?.getItem("directory_convex_url") ?? "";
  const configured =
    typeof window.DIRECTORY_CONVEX_URL === "string"
      ? window.DIRECTORY_CONVEX_URL
      : "";
  window.ConvexDirectory = createConvexDirectoryClient({
    url: localOverride || configured,
  });
}
