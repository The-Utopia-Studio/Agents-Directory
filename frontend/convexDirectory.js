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
const approvedA7V5ReimportMutation = makeFunctionReference(
  "reimports:executeApprovedMergedReimport",
);
const approveReleaseMutation = makeFunctionReference("reviews:approve");
const APPROVED_A7_V5_MANIFEST_DIGEST =
  "23b04a0348e35976bdae5d7354c2524932aa8ede04edcf34aa249b57dbcae48d";

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
    async releaseApprovedA7V5() {
      const prepared = await client.mutation(approvedA7V5ReimportMutation, {
        manifestDigest: APPROVED_A7_V5_MANIFEST_DIGEST,
      });
      const approval = await client.mutation(approveReleaseMutation, {
        proposalId: prepared.A7.proposalId,
        editCategory: "no-edit",
      });
      return { prepared, approval };
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
