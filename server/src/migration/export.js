// Phase 2 read-only snapshot of the Railway file store.
//
// This module deliberately receives only the store read interface and never
// calls put/append/seed. Payload-bearing fields are removed before the snapshot
// crosses the HTTP boundary; the source files remain untouched.
import { getRuntimeArtifactDescriptor } from "../invoke/runtimeArtifacts.js";
import { getHandoffDescriptor } from "../handoff/handoffArtifacts.js";

export const MIGRATION_COLLECTIONS = Object.freeze([
  "agents",
  "agentVersions",
  "evalResults",
  "proposals",
  "reviewEvents",
  "requests",
  "evidence",
  "traces",
  "feedback",
  "loopRuns",
  "learnings",
  "researchQueue",
  "memories",
  "adminAudit",
]);

const EXPORTED_COLLECTIONS = new Set([
  "agents",
  "agentVersions",
  "evalResults",
  "proposals",
  "reviewEvents",
  "requests",
  "evidence",
  "traces",
  "feedback",
]);

const OMITTED_KEYS = new Set([
  "input",
  "output",
  "prompt",
  "response",
  "rawInput",
  "rawOutput",
  "sourceMaterial",
  "pastedText",
  "interviewAnswers",
  "token",
  "jwt",
  "authorization",
  "apiKey",
  "accessToken",
  "refreshToken",
]);

function safeValue(value, path, redactions) {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      safeValue(item, `${path}[${index}]`, redactions),
    );
  }
  if (!value || typeof value !== "object") return value;

  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (OMITTED_KEYS.has(key)) {
      redactions.push({
        path: path ? `${path}.${key}` : key,
        reason: "raw payload, source material, or credential field excluded",
      });
      continue;
    }
    if (
      (key === "notes" || key === "knownIssues") &&
      (path.startsWith("service.feedback") ||
        path.includes(".evalHistory[") ||
        path.startsWith("service.evalResults"))
    ) {
      const note = typeof item === "string" ? item : "";
      copy[`${key}Present`] = Boolean(note.trim());
      copy[`${key}Length`] = note.length;
      redactions.push({
        path: `${path}.${key}`,
        reason: "review prose withheld from metadata-only export",
      });
      continue;
    }
    if (
      (key === "expected" || key === "source") &&
      path.includes(".goldenCases[")
    ) {
      redactions.push({
        path: `${path}.${key}`,
        reason: "golden-case content/source withheld from metadata-only export",
      });
      continue;
    }
    copy[key] = safeValue(item, path ? `${path}.${key}` : key, redactions);
  }
  return copy;
}

function artifactReferences(agents) {
  const references = [];
  for (const agent of agents) {
    const descriptor = getRuntimeArtifactDescriptor(agent?.id);
    if (descriptor?.artifactDigest) {
      // Real bytes loaded at boot produced this SHA-256. No prompt/file bytes
      // are included in the export.
      references.push({
        agentId: agent.id,
        artifactVersion: descriptor.artifactVersion,
        artifact: {
          scheme: "git",
          locator: `server/src/artifacts/${descriptor.slug}/SKILL.md`,
          declaredDigest: descriptor.artifactDigest,
          declaredDigestAlgorithm: descriptor.artifactDigestAlgorithm,
        },
      });
      continue;
    }
    const handoff = getHandoffDescriptor(agent?.id);
    if (!handoff) continue;
    // A Git commit pins the external package but is not a SHA-256 digest of the
    // artifact bytes. Preserve it honestly and let readiness flag the missing
    // declared artifact digest for human resolution.
    references.push({
      agentId: agent.id,
      artifactVersion: handoff.version,
      pinnedCommitSha: handoff.commitSha,
      artifact: {
        scheme: "git",
        locator: `${handoff.repoUrl}/tree/${handoff.commitSha}`,
      },
    });
  }
  return references;
}

export async function buildServiceMigrationSnapshot(
  store,
  { now = () => new Date().toISOString() } = {},
) {
  const loaded = {};
  await Promise.all(
    MIGRATION_COLLECTIONS.map(async (collection) => {
      loaded[collection] = await store.all(collection);
    }),
  );

  const redactions = [];
  const collections = {};
  for (const collection of MIGRATION_COLLECTIONS) {
    if (!EXPORTED_COLLECTIONS.has(collection)) continue;
    collections[collection] = safeValue(
      loaded[collection],
      `service.${collection}`,
      redactions,
    );
  }

  return {
    schemaVersion: "agents-directory-service-export-v1",
    generatedAt: now(),
    source: "railway-file-store",
    collectionCounts: Object.fromEntries(
      MIGRATION_COLLECTIONS.map((collection) => [
        collection,
        loaded[collection].length,
      ]),
    ),
    collections,
    omittedCollections: Object.fromEntries(
      MIGRATION_COLLECTIONS.filter(
        (collection) => !EXPORTED_COLLECTIONS.has(collection),
      ).map((collection) => [
        collection,
        {
          count: loaded[collection].length,
          reason:
            "operational loop/memory data is outside the Phase 2 governed-record export",
        },
      ]),
    ),
    artifactReferences: artifactReferences(loaded.agents),
    redactions,
  };
}

export const SERVICE_EXPORT_OMITTED_KEYS = Object.freeze([
  ...OMITTED_KEYS,
]);
