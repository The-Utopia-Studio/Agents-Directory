// Phase 2 browser migration export.
//
// Pure/read-only by design: this module accepts snapshots and returns a new
// object. It never writes localStorage, the loop service, or Convex.

export const MIGRATION_EXPORT_VERSION =
  "agents-directory-phase2-export-v1";
export const MIGRATION_STORAGE_KEY = "utopia_agents_dir_v2";

const RUNNERS = new Set([
  "native",
  "api",
  "foreign-runtime-handoff",
  "scheduled-worker",
  "none",
]);
const USABILITY_MODES = new Set([
  "hosted-run",
  "download-install",
  "prepared-handoff",
  "approval-queue",
]);
const INVOCATION_TYPES = new Set(["runtime", "mock", "http", "mcp"]);
const UNSAFE_KEYS = new Set([
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
const TYPES = [
  "agents",
  "versions",
  "evals",
  "proposals",
  "reviewHistory",
  "requests",
  "evidence",
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitize(value, path, redactions) {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitize(item, `${path}[${index}]`, redactions),
    );
  }
  if (!isObject(value)) return value;
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(key)) {
      redactions.push({
        path: path ? `${path}.${key}` : key,
        reason: "raw payload, source material, or credential field excluded",
      });
      continue;
    }
    if (
      (key === "notes" || key === "knownIssues") &&
      (/(?:^|\.)feedback(?:\[|\.|$)/.test(path) ||
        path.includes(".evalHistory[") ||
        /(?:^|\.)evalResults(?:\[|\.|$)/.test(path))
    ) {
      const text = typeof item === "string" ? item : "";
      copy[`${key}Present`] = Boolean(text.trim());
      copy[`${key}Length`] = text.length;
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
    copy[key] = sanitize(item, path ? `${path}.${key}` : key, redactions);
  }
  return copy;
}

export function readBrowserMigrationSnapshot(
  storage,
  key = MIGRATION_STORAGE_KEY,
) {
  let raw;
  try {
    raw = storage?.getItem?.(key);
  } catch (error) {
    return {
      source: "browser-localStorage",
      storageKey: key,
      available: false,
      parseError: `localStorage read failed: ${String(error?.message || error)}`,
      data: null,
      redactions: [],
    };
  }
  if (raw == null) {
    return {
      source: "browser-localStorage",
      storageKey: key,
      available: false,
      parseError: null,
      data: null,
      redactions: [],
    };
  }
  try {
    const redactions = [];
    return {
      source: "browser-localStorage",
      storageKey: key,
      available: true,
      parseError: null,
      data: sanitize(JSON.parse(raw), "browser", redactions),
      redactions,
    };
  } catch (error) {
    return {
      source: "browser-localStorage",
      storageKey: key,
      available: true,
      parseError: `Invalid JSON: ${String(error?.message || error)}`,
      data: null,
      redactions: [],
    };
  }
}

function sourceId(data, fallback) {
  if (!isObject(data)) return fallback;
  return String(
    data.displayId ||
      data.id ||
      data._id ||
      data.traceId ||
      data.proposalId ||
      fallback,
  );
}

function pushRecord(records, type, source, sourcePath, data) {
  records[type].push({
    source,
    sourcePath,
    sourceId: sourceId(data, sourcePath),
    data,
    readiness: { status: "ready", reasons: [] },
  });
}

function arrayAt(value, key) {
  return isObject(value) && Array.isArray(value[key]) ? value[key] : [];
}

function extractAgentNested(records, source, path, agent) {
  if (!isObject(agent)) return;
  const agentId = agent.displayId || agent.id || null;
  for (const [index, change] of arrayAt(agent, "changelog").entries()) {
    pushRecord(
      records,
      "versions",
      source,
      `${path}.changelog[${index}]`,
      isObject(change)
        ? { ...change, agentId, legacyShape: "agent.changelog" }
        : change,
    );
  }
  for (const [index, evaluation] of arrayAt(agent, "evalHistory").entries()) {
    pushRecord(
      records,
      "evals",
      source,
      `${path}.evalHistory[${index}]`,
      isObject(evaluation)
        ? { ...evaluation, agentId, legacyShape: "agent.evalHistory" }
        : evaluation,
    );
  }
  if (agent.proposedImprovement != null) {
    pushRecord(
      records,
      "proposals",
      source,
      `${path}.proposedImprovement`,
      isObject(agent.proposedImprovement)
        ? {
            ...agent.proposedImprovement,
            agentId,
            legacyShape: "agent.proposedImprovement",
          }
        : agent.proposedImprovement,
    );
  }
}

function collectRecords(browser, service) {
  const records = Object.fromEntries(TYPES.map((type) => [type, []]));
  const browserData = browser?.data;
  for (const [index, agent] of arrayAt(browserData, "agents").entries()) {
    const path = `browser.agents[${index}]`;
    pushRecord(records, "agents", "browser-localStorage", path, agent);
    extractAgentNested(records, "browser-localStorage", path, agent);
  }
  for (const [index, request] of arrayAt(browserData, "requests").entries()) {
    pushRecord(
      records,
      "requests",
      "browser-localStorage",
      `browser.requests[${index}]`,
      request,
    );
  }

  const collections = isObject(service?.collections)
    ? service.collections
    : {};
  for (const [index, agent] of arrayAt(collections, "agents").entries()) {
    const path = `service.agents[${index}]`;
    pushRecord(records, "agents", "railway-file-store", path, agent);
    extractAgentNested(records, "railway-file-store", path, agent);
  }

  const direct = {
    agentVersions: "versions",
    evalResults: "evals",
    proposals: "proposals",
    reviewEvents: "reviewHistory",
    requests: "requests",
    evidence: "evidence",
    traces: "evidence",
    feedback: "evidence",
  };
  for (const [collection, type] of Object.entries(direct)) {
    for (const [index, row] of arrayAt(collections, collection).entries()) {
      pushRecord(
        records,
        type,
        "railway-file-store",
        `service.${collection}[${index}]`,
        isObject(row)
          ? {
              ...row,
              ...(collection === "traces"
                ? { legacyShape: "trace", evidenceKind: "run" }
                : {}),
              ...(collection === "feedback"
                ? { legacyShape: "feedback", evidenceKind: "feedback" }
                : {}),
            }
          : row,
      );
    }
  }

  for (const [index, reference] of arrayAt(
    service,
    "artifactReferences",
  ).entries()) {
    pushRecord(
      records,
      "versions",
      "railway-artifact-registry",
      `service.artifactReferences[${index}]`,
      isObject(reference)
        ? {
            agentId: reference.agentId,
            version: reference.artifactVersion,
            artifact: reference.artifact,
            ...(reference.pinnedCommitSha
              ? { pinnedCommitSha: reference.pinnedCommitSha }
              : {}),
            legacyShape: "artifact-reference-without-version-row",
          }
        : reference,
    );
  }
  return records;
}

function addReason(record, status, code, message, field) {
  record.readiness.reasons.push({
    status,
    code,
    message,
    ...(field ? { field } : {}),
  });
  if (
    status === "blocked" ||
    (status === "needs-review" && record.readiness.status === "ready")
  ) {
    record.readiness.status = status;
  }
}

function requireString(record, data, field) {
  if (typeof data[field] !== "string" || !data[field].trim()) {
    addReason(
      record,
      "blocked",
      `missing-${field}`,
      `Required field ${field} is missing or empty`,
      field,
    );
  }
}

function validActor(actor) {
  return (
    isObject(actor) &&
    typeof actor.subject === "string" &&
    Boolean(actor.subject.trim()) &&
    typeof actor.issuer === "string" &&
    Boolean(actor.issuer.trim())
  );
}

function requireProvenance(record, data, actorField, timeField) {
  if (!validActor(data[actorField])) {
    addReason(
      record,
      "blocked",
      `missing-${actorField}`,
      `Required authenticated provenance ${actorField} is absent`,
      actorField,
    );
  }
  if (typeof data[timeField] !== "number") {
    addReason(
      record,
      "blocked",
      `missing-${timeField}`,
      `Required provenance timestamp ${timeField} is absent`,
      timeField,
    );
  }
}

function checkAgent(record) {
  const data = record.data;
  if (!isObject(data)) {
    addReason(record, "blocked", "malformed-record", "Agent is not an object");
    return;
  }
  for (const field of [
    "displayId",
    "name",
    "tagline",
    "platform",
    "status",
    "category",
    "owner",
  ]) {
    requireString(record, data, field);
  }
  if (!RUNNERS.has(data.runner)) {
    addReason(
      record,
      "blocked",
      "missing-or-invalid-runner",
      "Runner is missing or is not one of the five governed values",
      "runner",
    );
  }
  if (
    !Array.isArray(data.usabilityModes) ||
    data.usabilityModes.length === 0
  ) {
    addReason(
      record,
      "blocked",
      "missing-usabilityModes",
      "usabilityModes must be a non-empty array",
      "usabilityModes",
    );
  } else if (data.usabilityModes.some((mode) => !USABILITY_MODES.has(mode))) {
    addReason(
      record,
      "blocked",
      "unsupported-usabilityMode",
      "usabilityModes contains an unsupported legacy value",
      "usabilityModes",
    );
  }
  if (
    data.invocation != null &&
    (!isObject(data.invocation) ||
      !INVOCATION_TYPES.has(data.invocation.type))
  ) {
    addReason(
      record,
      "blocked",
      "unsupported-invocation",
      "Invocation is not a governed Convex invocation shape",
      "invocation",
    );
  }
  const execution = data.executionContract;
  if (
    !isObject(execution) ||
    !Array.isArray(execution.inputs) ||
    !Array.isArray(execution.runnerConfig)
  ) {
    addReason(
      record,
      "blocked",
      "missing-executionContract",
      "Execution contract requires inputs[] and runnerConfig[]",
      "executionContract",
    );
  }
  const evidence = data.evidenceContract;
  if (
    !isObject(evidence) ||
    !Array.isArray(evidence.acceptedTypes) ||
    typeof evidence.requiredReturnArtifact !== "boolean"
  ) {
    addReason(
      record,
      "blocked",
      "missing-evidenceContract",
      "Evidence contract requires acceptedTypes[] and requiredReturnArtifact",
      "evidenceContract",
    );
  }
  const outcome = data.outcomeContract;
  if (
    !isObject(outcome) ||
    !Array.isArray(outcome.successCriteria) ||
    !Object.hasOwn(outcome, "evalSetId")
  ) {
    addReason(
      record,
      "blocked",
      "missing-outcomeContract",
      "Outcome contract requires successCriteria[] and evalSetId",
      "outcomeContract",
    );
  }
  requireProvenance(record, data, "createdBy", "createdAt");
}

function checkVersion(record, knownAgents) {
  const data = record.data;
  if (!isObject(data)) {
    addReason(record, "blocked", "malformed-record", "Version is not an object");
    return;
  }
  requireString(record, data, "version");
  if (!data.agentId || !knownAgents.has(String(data.agentId))) {
    addReason(
      record,
      "blocked",
      "unknown-agent-reference",
      "Version does not reference a known exported agent",
      "agentId",
    );
  }
  if (data.state !== "draft" && data.state !== "candidate") {
    addReason(
      record,
      "blocked",
      "missing-version-state",
      "Version state is missing or unsupported",
      "state",
    );
  }
  if (data.legacyShape) {
    addReason(
      record,
      "blocked",
      "unsupported-legacy-version-shape",
      `Legacy ${data.legacyShape} is not an immutable agentVersion row`,
    );
  }
  if (!isObject(data.artifact)) {
    addReason(
      record,
      data.state === "candidate" ? "blocked" : "needs-review",
      "missing-artifact-reference",
      "No artifact reference is recorded; drafts may omit it only after human review",
      "artifact",
    );
  } else {
    requireString(record, data.artifact, "locator");
    requireString(record, data.artifact, "declaredDigest");
    if (data.artifact.declaredDigestAlgorithm !== "sha256") {
      addReason(
        record,
        "blocked",
        "missing-or-invalid-digest-algorithm",
        "Artifact digest algorithm must be sha256",
        "artifact.declaredDigestAlgorithm",
      );
    }
  }
  requireProvenance(record, data, "createdBy", "createdAt");
}

function checkEval(record, knownAgents, knownVersions, knownEvidence) {
  const data = record.data;
  if (!isObject(data)) {
    addReason(record, "blocked", "malformed-record", "Eval is not an object");
    return;
  }
  if (data.legacyShape) {
    addReason(
      record,
      "blocked",
      "unsupported-legacy-eval-shape",
      "Embedded eval history is not a governed evalResult",
    );
  }
  for (const field of ["evalSetId", "evalCaseId", "agentVersionId", "evidenceId"]) {
    if (!data[field]) {
      addReason(
        record,
        "blocked",
        `missing-${field}`,
        `Eval requires ${field}`,
        field,
      );
    }
  }
  if (data.agentId && !knownAgents.has(String(data.agentId))) {
    addReason(record, "blocked", "unknown-agent-reference", "Eval agent is unknown");
  }
  if (data.agentVersionId && !knownVersions.has(String(data.agentVersionId))) {
    addReason(record, "blocked", "unknown-version-reference", "Eval version is unknown");
  }
  if (data.evidenceId && !knownEvidence.has(String(data.evidenceId))) {
    addReason(record, "blocked", "unknown-evidence-reference", "Eval evidence is unknown");
  }
  requireProvenance(record, data, "evaluatedBy", "evaluatedAt");
  if (!data.source && !data.evidenceSource) {
    addReason(
      record,
      "needs-review",
      "unclassified-evidence-source",
      "Eval is not marked real, imported, demo, or mock",
    );
  }
}

function checkProposal(record, knownAgents, knownVersions) {
  const data = record.data;
  if (!isObject(data)) {
    addReason(record, "blocked", "malformed-record", "Proposal is not an object");
    return;
  }
  if (data.legacyShape) {
    addReason(
      record,
      "blocked",
      "unsupported-legacy-proposal-shape",
      "Embedded proposal is not a governed Convex proposal",
    );
  }
  if (!data.agentId || !knownAgents.has(String(data.agentId))) {
    addReason(record, "blocked", "unknown-agent-reference", "Proposal agent is unknown");
  }
  if (
    !data.candidateVersionId ||
    !knownVersions.has(String(data.candidateVersionId))
  ) {
    addReason(
      record,
      "blocked",
      "missing-or-unknown-candidate-version",
      "Proposal requires an exported candidateVersionId",
      "candidateVersionId",
    );
  }
  requireString(record, data, "summary");
  requireProvenance(record, data, "createdBy", "createdAt");
}

function checkReview(record, knownProposals) {
  const data = record.data;
  if (!isObject(data)) {
    addReason(record, "blocked", "malformed-record", "Review event is not an object");
    return;
  }
  if (!data.proposalId || !knownProposals.has(String(data.proposalId))) {
    addReason(record, "blocked", "unknown-proposal-reference", "Review proposal is unknown");
  }
  if (!["approve", "reject", "defer"].includes(data.decision)) {
    addReason(record, "blocked", "missing-review-decision", "Review decision is missing");
  }
  if (!validActor(data.actor)) {
    addReason(record, "blocked", "missing-actor", "Review actor provenance is absent");
  }
  if (typeof data.timestamp !== "number") {
    addReason(record, "blocked", "missing-timestamp", "Review timestamp is absent");
  }
}

function checkRequest(record, knownAgents) {
  const data = record.data;
  if (!isObject(data)) {
    addReason(record, "blocked", "malformed-record", "Request is not an object");
    return;
  }
  for (const field of ["displayId", "title", "desc", "requestedBy", "date"]) {
    requireString(record, data, field);
  }
  if (
    data.shippedAgentId &&
    !knownAgents.has(String(data.shippedAgentId))
  ) {
    addReason(
      record,
      "blocked",
      "unknown-shipped-agent-reference",
      "Request references an agent absent from the export",
      "shippedAgentId",
    );
  }
  // requestedBy is a display/business field, not authenticated provenance.
  requireProvenance(record, data, "createdBy", "createdAt");
}

function checkEvidence(record, knownAgents, knownVersions, redactionPaths) {
  const data = record.data;
  if (!isObject(data)) {
    addReason(record, "blocked", "malformed-record", "Evidence is not an object");
    return;
  }
  addReason(
    record,
    "blocked",
    "evidence-import-deferred-phase-6",
    "Evidence import is explicitly deferred until Phase 6",
  );
  if (data.legacyShape) {
    addReason(
      record,
      "blocked",
      "unsupported-legacy-evidence-shape",
      `Legacy ${data.legacyShape} is not governed evidence`,
    );
  }
  if (!data.agentId || !knownAgents.has(String(data.agentId))) {
    addReason(record, "blocked", "unknown-agent-reference", "Evidence agent is unknown");
  }
  if (
    !data.agentVersionId ||
    !knownVersions.has(String(data.agentVersionId))
  ) {
    addReason(
      record,
      "blocked",
      "missing-or-unknown-version-reference",
      "Evidence is unversioned or references an unknown version",
      "agentVersionId",
    );
  }
  if (!data.declaredArtifactDigest && !data.artifactDigest) {
    addReason(
      record,
      "blocked",
      "missing-artifact-digest",
      "Evidence has no declared artifact digest",
    );
  }
  if (!["real", "mock", "demo", "imported"].includes(data.source)) {
    addReason(
      record,
      "blocked",
      "missing-evidence-source",
      "Evidence source is absent or unsupported",
      "source",
    );
  } else if (data.source === "mock" || data.source === "demo") {
    addReason(
      record,
      "blocked",
      "synthetic-evidence",
      `${data.source} evidence is ineligible for governed import`,
      "source",
    );
  }
  if (!validActor(data.runBy)) {
    addReason(record, "blocked", "missing-runBy", "Evidence actor provenance is absent");
  }
  if (
    redactionPaths.some(
      (path) =>
        path === record.sourcePath || path.startsWith(`${record.sourcePath}.`),
    )
  ) {
    addReason(
      record,
      "blocked",
      "raw-payload-present-in-source",
      "Raw payload/source material existed in the source and was excluded",
    );
  }
}

function addCollisionReasons(agentRecords) {
  const byId = new Map();
  for (const record of agentRecords) {
    const data = record.data;
    if (!isObject(data)) continue;
    const id = String(data.displayId || data.id || "");
    if (!id) continue;
    const rows = byId.get(id) || [];
    rows.push(record);
    byId.set(id, rows);
  }
  for (const [id, rows] of byId) {
    const sources = new Set(rows.map((row) => row.source));
    if (sources.size < 2) continue;
    for (const row of rows) {
      addReason(
        row,
        "needs-review",
        "browser-service-id-collision",
        `${id} exists in multiple source stores; Phase 2 cannot choose authority`,
      );
    }
    for (const field of ["name", "owner", "version", "repoUrl"]) {
      const values = new Set(
        rows
          .map((row) => (isObject(row.data) ? row.data[field] : undefined))
          .filter((value) => value != null && value !== "")
          .map((value) => JSON.stringify(value)),
      );
      if (values.size > 1) {
        for (const row of rows) {
          addReason(
            row,
            "needs-review",
            `conflicting-${field}`,
            `${field} conflicts between stores for ${id}`,
            field,
          );
        }
      }
    }
  }
}

function evaluate(records, redactions) {
  const knownAgents = new Set(
    records.agents.flatMap((record) => {
      const data = record.data;
      return isObject(data)
        ? [data._id, data.displayId, data.id].filter(Boolean).map(String)
        : [];
    }),
  );
  const knownVersions = new Set(
    records.versions.flatMap((record) => {
      const data = record.data;
      return isObject(data)
        ? [data._id, data.id].filter(Boolean).map(String)
        : [];
    }),
  );
  const knownEvidence = new Set(
    records.evidence.flatMap((record) => {
      const data = record.data;
      return isObject(data)
        ? [data._id, data.id].filter(Boolean).map(String)
        : [];
    }),
  );
  const knownProposals = new Set(
    records.proposals.flatMap((record) => {
      const data = record.data;
      return isObject(data)
        ? [data._id, data.id].filter(Boolean).map(String)
        : [];
    }),
  );
  const redactionPaths = redactions.map((item) => item.path);

  records.agents.forEach(checkAgent);
  addCollisionReasons(records.agents);
  records.versions.forEach((record) => checkVersion(record, knownAgents));
  records.evals.forEach((record) =>
    checkEval(record, knownAgents, knownVersions, knownEvidence),
  );
  records.proposals.forEach((record) =>
    checkProposal(record, knownAgents, knownVersions),
  );
  records.reviewHistory.forEach((record) =>
    checkReview(record, knownProposals),
  );
  records.requests.forEach((record) => checkRequest(record, knownAgents));
  records.evidence.forEach((record) =>
    checkEvidence(record, knownAgents, knownVersions, redactionPaths),
  );
}

function readinessSummary(records, sourceIssues) {
  const all = TYPES.flatMap((type) => records[type]);
  const summary = { ready: 0, blocked: 0, "needs-review": 0 };
  for (const record of all) summary[record.readiness.status] += 1;
  const byType = Object.fromEntries(
    TYPES.map((type) => {
      const counts = { ready: 0, blocked: 0, "needs-review": 0 };
      for (const record of records[type]) counts[record.readiness.status] += 1;
      return [type, { total: records[type].length, ...counts }];
    }),
  );
  return { summary: { total: all.length, ...summary }, byType, sourceIssues };
}

/**
 * Closed vocabulary for why the service snapshot is absent. A fetch failure
 * carries server text and URLs; a reason recorded in a downloadable file must
 * be a category, not a relayed error string.
 */
export const SERVICE_FETCH_ISSUES = Object.freeze({
  unauthorised:
    "Loop service export refused the request as unauthorised; browser snapshot is still included",
  unavailable:
    "Loop service was unreachable; browser snapshot is still included",
  "server-error":
    "Loop service returned an error for the export; browser snapshot is still included",
  "not-attempted":
    "Loop service export was not attempted; browser snapshot is still included",
});

export function classifyServiceFetchIssue(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return "unauthorised";
  if (status >= 500) return "server-error";
  if (status >= 400) return "unavailable";
  return "unavailable";
}

export function buildMigrationExport({
  browserSnapshot,
  serviceSnapshot = null,
  serviceIssue = null,
  generatedAt = new Date().toISOString(),
}) {
  const sourceIssues = [];
  if (!browserSnapshot?.available) {
    sourceIssues.push({
      source: "browser-localStorage",
      status: "blocked",
      reason: browserSnapshot?.parseError || "localStorage key not found",
    });
  } else if (browserSnapshot.parseError) {
    sourceIssues.push({
      source: "browser-localStorage",
      status: "blocked",
      reason: browserSnapshot.parseError,
    });
  }
  if (!serviceSnapshot) {
    const code =
      serviceIssue && Object.hasOwn(SERVICE_FETCH_ISSUES, serviceIssue)
        ? serviceIssue
        : "unavailable";
    sourceIssues.push({
      source: "railway-file-store",
      status: "needs-review",
      code,
      reason: SERVICE_FETCH_ISSUES[code],
    });
  }

  const records = collectRecords(browserSnapshot, serviceSnapshot);
  const redactions = [
    ...(browserSnapshot?.redactions || []),
    ...(serviceSnapshot?.redactions || []),
  ];
  evaluate(records, redactions);

  return {
    schemaVersion: MIGRATION_EXPORT_VERSION,
    generatedAt,
    sources: {
      browserLocalStorage: browserSnapshot || null,
      railwayFileStore: serviceSnapshot || null,
    },
    records,
    readiness: readinessSummary(records, sourceIssues),
    redactions,
  };
}

export const MIGRATION_RECORD_TYPES = Object.freeze([...TYPES]);
export const MIGRATION_UNSAFE_KEYS = Object.freeze([...UNSAFE_KEYS]);
