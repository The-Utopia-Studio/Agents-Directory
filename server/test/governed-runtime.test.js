import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { buildApp } from "../src/http/server.js";
import { config } from "../src/config.js";
import { GOVERNED_RUNTIME_MISMATCH } from "../src/core/governedRuntime.js";
import { identityHeaders, testClerkOptions } from "./clerkTestIdentity.js";

async function listen(app, t) {
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test("run and ZIP download refuse a forced governed-runtime digest mismatch", async (t) => {
  const expectedDigest = "0".repeat(64);
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-gov-rt-")));
  const app = await buildApp({
    store,
    config: {
      ...config,
      apiToken: "",
      clerk: testClerkOptions(),
      convex: { url: "", deployKey: "" },
    },
    getGovernedRuntimePin: async () => ({
      digest: expectedDigest,
      algorithm: "sha256",
      isCurrentApproved: true,
    }),
  });
  const base = await listen(app, t);

  const zip = await fetch(`${base}/api/agents/A7/install-artifact/download`);
  assert.equal(zip.status, 409);
  const zipBody = await zip.json();
  assert.equal(zipBody.code, GOVERNED_RUNTIME_MISMATCH);
  assert.equal(zipBody.expectedDigest, expectedDigest);
  assert.match(String(zipBody.actualDigest), /^[a-f0-9]{64}$/);
  assert.notEqual(zipBody.actualDigest, expectedDigest);
  assert.match(zipBody.error, /GOVERNED_RUNTIME_MISMATCH/);
  assert.match(zipBody.error, new RegExp(expectedDigest));
  assert.match(zipBody.error, new RegExp(zipBody.actualDigest));

  const run = await fetch(`${base}/api/agents/A7/run`, {
    method: "POST",
    headers: identityHeaders(),
    body: JSON.stringify({ inputs: { fellowName: "Test Fellow" } }),
  });
  assert.equal(run.status, 409);
  const runBody = await run.json();
  assert.equal(runBody.code, GOVERNED_RUNTIME_MISMATCH);
  assert.equal(runBody.expectedDigest, expectedDigest);
  assert.equal(runBody.actualDigest, zipBody.actualDigest);
  assert.match(runBody.error, /GOVERNED_RUNTIME_MISMATCH/);
  assert.match(runBody.error, new RegExp(expectedDigest));
  assert.match(runBody.error, new RegExp(runBody.actualDigest));
});
