import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const PILOT_IDS = new Set(["A7", "A8"]);
const governedDirectoryQuery = makeFunctionReference(
  "agents:listGovernedDirectoryPilot",
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

export function mapGovernedPilotAgent(localAgent, row) {
  const governed = row?.agent;
  if (
    !localAgent ||
    !governed ||
    !PILOT_IDS.has(governed.displayId) ||
    localAgent.id !== governed.displayId
  ) {
    return localAgent;
  }

  const version = row.version ?? null;
  const mapped = {
    ...localAgent,
    id: governed.displayId,
    name: governed.name,
    tagline: governed.tagline,
    platform: governed.platform,
    status: governed.status,
    category: governed.category,
    owner: governed.owner,
    initials: governed.initials,
    runner: governed.runner,
    usabilityModes: [...governed.usabilityModes],
    successCriteria: labels(governed.outcomeContract?.successCriteria),
    guardrails: labels(governed.guardrails),
    skills: [...governed.skills],
    tools: labels(governed.tools),
    context: labels(governed.context),
    inputs: inputKeys(governed.executionContract),
    version: version?.version ?? localAgent.version,
    governedInConvex: true,
    convexGovernance: {
      versionState: version?.state ?? null,
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

  for (const optional of [
    "description",
    "model",
    "invocation",
    "autonomyLevel",
    "accessUrl",
    "repoUrl",
  ]) {
    if (governed[optional] !== undefined) mapped[optional] = governed[optional];
  }
  return mapped;
}

export function overlayGovernedPilotAgents(localAgents, rows) {
  if (!Array.isArray(localAgents) || !Array.isArray(rows)) return localAgents;
  const byDisplayId = new Map(
    rows
      .filter((row) => PILOT_IDS.has(row?.agent?.displayId))
      .map((row) => [row.agent.displayId, row]),
  );
  return localAgents.map((localAgent) => {
    const row = byDisplayId.get(localAgent.id);
    return row ? mapGovernedPilotAgent(localAgent, row) : localAgent;
  });
}

export function createConvexDirectoryClient({ url, clientFactory } = {}) {
  const normalizedUrl = typeof url === "string" ? url.trim() : "";
  if (!normalizedUrl) {
    return {
      enabled: false,
      async read(localAgents) {
        return { agents: localAgents, succeeded: false };
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
      async read(localAgents) {
        return { agents: localAgents, succeeded: false };
      },
    };
  }
  const factory =
    clientFactory ??
    ((deploymentUrl) => new ConvexHttpClient(deploymentUrl));
  const client = factory(normalizedUrl);
  return {
    enabled: true,
    async read(localAgents) {
      try {
        const rows = await client.query(
          governedDirectoryQuery,
          {},
        );
        return {
          agents: overlayGovernedPilotAgents(localAgents, rows),
          succeeded: true,
        };
      } catch {
        return { agents: localAgents, succeeded: false };
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
