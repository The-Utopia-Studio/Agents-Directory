import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMigrationExport,
  classifyServiceFetchIssue,
  readBrowserMigrationSnapshot,
} from "../../migrationExport.js";
import {
  buildServiceMigrationSnapshot,
  MIGRATION_COLLECTIONS,
} from "../src/migration/export.js";
import { config } from "../src/config.js";
import { createStore } from "../src/core/store.js";
import { buildApp } from "../src/http/server.js";

async function exportService(t, overrides) {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-export-")));
  const app = await buildApp({ store, config: { ...config, ...overrides } });
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

const actor = {
  subject: "user_real",
  issuer: "https://issuer.example",
};

function completeAgent(overrides = {}) {
  return {
    displayId: "A100",
    name: "Complete Agent",
    tagline: "A complete governed registration candidate",
    platform: "Cursor",
    status: "Experimental",
    category: "Other",
    owner: "Owner",
    runner: "none",
    usabilityModes: ["approval-queue"],
    executionContract: { inputs: [], runnerConfig: [] },
    evidenceContract: {
      acceptedTypes: ["approval-decision"],
      requiredReturnArtifact: false,
    },
    outcomeContract: { successCriteria: [], evalSetId: null },
    createdBy: actor,
    createdAt: 1,
    ...overrides,
  };
}

function browserSnapshot(data) {
  return readBrowserMigrationSnapshot({
    getItem: () => JSON.stringify(data),
    setItem: () => {
      throw new Error("export must not write localStorage");
    },
    removeItem: () => {
      throw new Error("export must not remove localStorage");
    },
  });
}

test("Phase 2 export performs no source-store writes", async () => {
  const calls = [];
  const store = {
    async all(collection) {
      calls.push(["all", collection]);
      return collection === "agents" ? [completeAgent()] : [];
    },
    async put() {
      throw new Error("export must not put");
    },
    async append() {
      throw new Error("export must not append");
    },
    async seedIfEmpty() {
      throw new Error("export must not seed");
    },
  };

  const browser = browserSnapshot({ agents: [completeAgent()], requests: [] });
  const service = await buildServiceMigrationSnapshot(store, {
    now: () => "2026-08-02T00:00:00.000Z",
  });
  buildMigrationExport({
    browserSnapshot: browser,
    serviceSnapshot: service,
    generatedAt: "2026-08-02T00:00:00.000Z",
  });

  assert.deepEqual(
    calls.map((call) => call[0]),
    MIGRATION_COLLECTIONS.map(() => "all"),
  );
  assert.deepEqual(
    calls.map((call) => call[1]).sort(),
    [...MIGRATION_COLLECTIONS].sort(),
  );
});

test("raw trace payloads, source material, credentials, and feedback text are excluded", async () => {
  const rows = {
    agents: [
      {
        id: "A1",
        evalHistory: [
          {
            score: 70,
            notes: "quoted fellow wording",
            knownIssues: "private review detail",
          },
        ],
        goldenCases: [
          {
            input: "private fixture input",
            expected: "private expected bio",
            source: "fellow:private",
          },
        ],
      },
    ],
    traces: [
      {
        id: "trace_1",
        agentId: "A1",
        input: { sourceMaterial: "private profile" },
        output: "private generated bio",
        prompt: "server prompt bytes",
        token: "secret-token",
        inputTokens: 12,
        outputTokens: 4,
        status: "ok",
      },
    ],
    feedback: [
      {
        id: "feedback_1",
        agentId: "A1",
        traceId: "trace_1",
        rating: 3,
        notes: "specific reviewer reasoning",
      },
    ],
  };
  const store = {
    async all(collection) {
      return rows[collection] || [];
    },
  };
  const service = await buildServiceMigrationSnapshot(store);
  const encoded = JSON.stringify(service);

  assert.doesNotMatch(
    encoded,
    /private profile|private generated bio|server prompt bytes|secret-token|specific reviewer reasoning|quoted fellow wording|private review detail|private fixture input|private expected bio|fellow:private/,
  );
  assert.equal(service.collections.traces[0].inputTokens, 12);
  assert.equal(service.collections.traces[0].outputTokens, 4);
  assert.equal(service.collections.feedback[0].notesPresent, true);
  assert.equal(service.collections.feedback[0].notesLength, 27);
  assert.equal(
    service.collections.agents[0].evalHistory[0].knownIssuesPresent,
    true,
  );
  assert.ok(service.redactions.some((item) => item.path.endsWith(".input")));
  assert.ok(service.redactions.some((item) => item.path.endsWith(".output")));

  const browser = browserSnapshot(rows);
  assert.doesNotMatch(
    JSON.stringify(browser),
    /quoted fellow wording|private review detail|private fixture input|private expected bio|fellow:private/,
  );
});

test("artifact references preserve real digest and handoff pin without conflating them", async () => {
  const store = {
    async all(collection) {
      return collection === "agents" ? [{ id: "A7" }, { id: "A8" }] : [];
    },
  };
  const service = await buildServiceMigrationSnapshot(store);
  const a7 = service.artifactReferences.find((row) => row.agentId === "A7");
  const a8 = service.artifactReferences.find((row) => row.agentId === "A8");

  assert.equal(a7.artifact.declaredDigestAlgorithm, "sha256");
  assert.match(a7.artifact.declaredDigest, /^[a-f0-9]{64}$/);
  assert.equal(
    a8.pinnedCommitSha,
    "2a8f2b9562c4d4569c156e2ae7559ab04a54b883",
  );
  assert.equal(a8.artifact.declaredDigest, undefined);
  assert.match(a8.artifact.locator, new RegExp(a8.pinnedCommitSha));
});

test("a complete unambiguous agent record is ready", () => {
  const report = buildMigrationExport({
    browserSnapshot: browserSnapshot({
      agents: [completeAgent()],
      requests: [],
    }),
    generatedAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(report.records.agents.length, 1);
  assert.deepEqual(report.records.agents[0].readiness, {
    status: "ready",
    reasons: [],
  });
});

test("missing, ambiguous, synthetic, unversioned, and unknown-reference records are flagged", () => {
  const browser = browserSnapshot({
    agents: [
      completeAgent({
        displayId: "A1",
        usabilityModes: [],
        executionContract: undefined,
        evidenceContract: undefined,
        outcomeContract: undefined,
      }),
    ],
    requests: [
      {
        id: "R1",
        title: "Legacy request",
        desc: "Missing authenticated provenance",
        requestedBy: "Display name",
        date: "Aug 2, 2026",
        shippedAgentId: "A404",
      },
    ],
  });
  const service = {
    collections: {
      agents: [completeAgent({ displayId: "A1", name: "Conflicting name" })],
      agentVersions: [
        {
          id: "version_1",
          agentId: "A1",
          version: "1.0",
          state: "candidate",
          createdBy: actor,
          createdAt: 1,
        },
      ],
      evalResults: [],
      proposals: [],
      reviewEvents: [],
      requests: [],
      evidence: [],
      traces: [
        {
          id: "trace_1",
          agentId: "A1",
          status: "fail",
          source: "mock",
          legacyShape: "trace",
        },
      ],
      feedback: [],
    },
    artifactReferences: [],
    redactions: [{ path: "service.traces[0].output", reason: "excluded" }],
  };
  const report = buildMigrationExport({
    browserSnapshot: browser,
    serviceSnapshot: service,
  });
  const codes = (record) =>
    new Set(record.readiness.reasons.map((reason) => reason.code));

  assert.equal(report.records.agents[0].readiness.status, "blocked");
  assert.ok(codes(report.records.agents[0]).has("missing-usabilityModes"));
  assert.ok(codes(report.records.agents[0]).has("missing-executionContract"));
  assert.ok(codes(report.records.agents[0]).has("missing-evidenceContract"));
  assert.ok(codes(report.records.agents[0]).has("missing-outcomeContract"));
  assert.ok(codes(report.records.agents[0]).has("browser-service-id-collision"));
  assert.ok(codes(report.records.agents[0]).has("conflicting-name"));

  const version = report.records.versions.find(
    (record) => record.data?.id === "version_1",
  );
  assert.equal(version.readiness.status, "blocked");
  assert.ok(codes(version).has("missing-artifact-reference"));

  const request = report.records.requests[0];
  assert.equal(request.readiness.status, "blocked");
  assert.ok(codes(request).has("missing-displayId"));
  assert.ok(codes(request).has("missing-createdBy"));
  assert.ok(codes(request).has("unknown-shipped-agent-reference"));

  const evidence = report.records.evidence[0];
  assert.equal(evidence.readiness.status, "blocked");
  assert.ok(codes(evidence).has("synthetic-evidence"));
  assert.ok(codes(evidence).has("missing-or-unknown-version-reference"));
  assert.ok(codes(evidence).has("raw-payload-present-in-source"));
});

test("malformed records and invalid localStorage JSON do not crash the report", () => {
  const malformed = buildMigrationExport({
    browserSnapshot: browserSnapshot({
      agents: [null, "not-an-agent", completeAgent({ displayId: "" })],
      requests: [42],
    }),
  });
  assert.equal(malformed.records.agents.length, 3);
  assert.ok(
    malformed.records.agents.every(
      (record) => record.readiness.status === "blocked",
    ),
  );
  assert.equal(malformed.records.requests[0].readiness.status, "blocked");

  const invalid = readBrowserMigrationSnapshot({
    getItem: () => "{not json",
  });
  const report = buildMigrationExport({ browserSnapshot: invalid });
  assert.match(report.readiness.sourceIssues[0].reason, /Invalid JSON/);
  assert.equal(report.readiness.summary.total, 0);
});

test("a deployed service refuses the bulk export until API_TOKEN is configured", async (t) => {
  const base = await exportService(t, {
    apiToken: "",
    requireAuthenticatedExport: true,
  });
  const response = await fetch(`${base}/api/migration/export`);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.match(body.error, /API_TOKEN/);
  assert.equal(body.collections, undefined);
});

test("with API_TOKEN set, the export needs the bearer and serves it only then", async (t) => {
  const base = await exportService(t, {
    apiToken: "test-export-token",
    requireAuthenticatedExport: true,
  });

  const anonymous = await fetch(`${base}/api/migration/export`);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).collections, undefined);

  const wrong = await fetch(`${base}/api/migration/export`, {
    headers: { authorization: "Bearer not-the-token" },
  });
  assert.equal(wrong.status, 401);

  const authorized = await fetch(`${base}/api/migration/export`, {
    headers: { authorization: "Bearer test-export-token" },
  });
  assert.equal(authorized.status, 200);
  const snapshot = await authorized.json();
  assert.equal(snapshot.schemaVersion, "agents-directory-service-export-v1");
  assert.ok(snapshot.collections.agents.length > 0);
});

test("local development keeps the export reachable without a token", async (t) => {
  const base = await exportService(t, {
    apiToken: "",
    requireAuthenticatedExport: false,
  });
  const response = await fetch(`${base}/api/migration/export`);
  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).schemaVersion,
    "agents-directory-service-export-v1",
  );
});

test("a failed service fetch records a category, never the thrown error text", () => {
  assert.equal(
    classifyServiceFetchIssue(Object.assign(new Error("x"), { status: 401 })),
    "unauthorised",
  );
  assert.equal(
    classifyServiceFetchIssue(Object.assign(new Error("x"), { status: 403 })),
    "unauthorised",
  );
  assert.equal(
    classifyServiceFetchIssue(Object.assign(new Error("x"), { status: 500 })),
    "server-error",
  );
  assert.equal(classifyServiceFetchIssue(new TypeError("Failed to fetch")), "unavailable");

  const leaky = Object.assign(
    new Error("GET https://loop.internal/api/migration/export -> 401 secret"),
    { status: 401 },
  );
  const report = buildMigrationExport({
    browserSnapshot: browserSnapshot({ agents: [], requests: [] }),
    serviceSnapshot: null,
    serviceIssue: classifyServiceFetchIssue(leaky),
  });
  const issue = report.readiness.sourceIssues.find(
    (row) => row.source === "railway-file-store",
  );
  assert.equal(issue.code, "unauthorised");
  assert.equal(issue.status, "needs-review");
  assert.doesNotMatch(JSON.stringify(report), /loop\.internal|secret/);

  // An unrecognised code cannot smuggle text into the downloaded file.
  const spoofed = buildMigrationExport({
    browserSnapshot: browserSnapshot({ agents: [], requests: [] }),
    serviceIssue: "https://loop.internal failed: token abc",
  });
  const spoofedIssue = spoofed.readiness.sourceIssues.find(
    (row) => row.source === "railway-file-store",
  );
  assert.equal(spoofedIssue.code, "unavailable");
  assert.doesNotMatch(JSON.stringify(spoofed), /loop\.internal|abc/);
});
