import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { buildApp } from "../src/http/server.js";
import { config } from "../src/config.js";
import { seed } from "../src/scripts/seed.js";
import {
  identityHeaders,
  testClerkOptions,
  testClerkToken,
} from "./clerkTestIdentity.js";

async function listen(app, t) {
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function appConfig() {
  return {
    ...config,
    apiToken: "",
    clerk: testClerkOptions(),
  };
}

test("store.removeWhere deletes matching docs and leaves others", async () => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-rm-")));
  await store.append("mechanicalResults", { agentId: "A7", ts: "2026-01-01" });
  await store.append("mechanicalResults", { agentId: "A10", ts: "2026-01-02" });
  await store.append("mechanicalResults", { agentId: "A7", ts: "2026-01-03" });

  const removed = await store.removeWhere(
    "mechanicalResults",
    (row) => row.agentId === "A7",
  );
  assert.equal(removed.length, 2);
  const left = await store.all("mechanicalResults");
  assert.equal(left.length, 1);
  assert.equal(left[0].agentId, "A10");
});

test("clear mechanical results requires approver + reason and reports deletions", async (t) => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-clear-")));
  await seed(store);
  await store.append("mechanicalResults", {
    agentId: "A7",
    ts: "2026-08-01T00:00:00.000Z",
    artifactVersion: "biocraft-singleshot-v10",
    checkSetId: "cs1",
    outputSource: "live",
    provider: "openai",
    modelId: "gpt-5.6-terra",
  });
  await store.append("mechanicalResults", {
    agentId: "A7",
    ts: "2026-08-02T00:00:00.000Z",
    artifactVersion: "biocraft-singleshot-v8",
    checkSetId: "cs0",
    outputSource: "canned",
  });
  await store.append("mechanicalResults", {
    agentId: "A10",
    ts: "2026-08-03T00:00:00.000Z",
    artifactVersion: "gapfill-v3",
  });

  const app = await buildApp({ store, config: appConfig() });
  const base = await listen(app, t);

  const anon = await fetch(`${base}/api/agents/A7/mechanical-results/clear`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "stale after check-set change" }),
  });
  assert.equal(anon.status, 401);

  const member = await fetch(`${base}/api/agents/A7/mechanical-results/clear`, {
    method: "POST",
    headers: identityHeaders(testClerkToken({ role: "member" })),
    body: JSON.stringify({ reason: "stale after check-set change" }),
  });
  assert.equal(member.status, 403);

  const noReason = await fetch(`${base}/api/agents/A7/mechanical-results/clear`, {
    method: "POST",
    headers: identityHeaders(),
    body: JSON.stringify({}),
  });
  assert.equal(noReason.status, 400);

  const cleared = await fetch(`${base}/api/agents/A7/mechanical-results/clear`, {
    method: "POST",
    headers: identityHeaders(),
    body: JSON.stringify({
      reason: "stale after check-set / grounding comparability change",
    }),
  });
  assert.equal(cleared.status, 200);
  const body = await cleared.json();
  assert.equal(body.agentId, "A7");
  assert.equal(body.deletedCount, 2);
  assert.equal(body.deleted.length, 2);
  assert.ok(body.deleted.every((row) => row.id && row.artifactVersion));
  assert.ok(body.auditId);
  assert.match(body.reason, /comparability/);
  assert.equal(body.clearedBy.role, "approver");

  const remaining = await store.all("mechanicalResults");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].agentId, "A10");

  const audits = await store.all("adminAudit");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].kind, "mechanical_results_cleared");
  assert.equal(audits[0].deletedCount, 2);
  assert.deepEqual(audits[0].deletedIds.sort(), body.deleted.map((r) => r.id).sort());

  const listed = await fetch(`${base}/api/agents/A7/admin-audit`);
  assert.equal(listed.status, 200);
  const listedBody = await listed.json();
  assert.equal(listedBody.audits.length, 1);
  assert.equal(listedBody.audits[0].id, body.auditId);
});
