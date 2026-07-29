import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { createLocalObservability } from "../src/observability/localAdapter.js";
import { seed } from "../src/scripts/seed.js";
import { buildApp } from "../src/http/server.js";

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), "adir-invariants-"));
  return createStore(dir);
}

test("server backfills stored usability modes without client inference", async () => {
  const store = await tempStore();
  await store.seedIfEmpty("agents", [
    { id: "A1", invocation: { type: "link" } },
    { id: "A2", invocation: { type: "mock" } },
  ]);

  const result = await seed(store);
  assert.equal(result.usabilityModesBackfilled, 2);
  assert.deepEqual((await store.get("agents", "A1")).usabilityModes, [
    "download-install",
  ]);
  assert.deepEqual((await store.get("agents", "A2")).usabilityModes, [
    "hosted-run",
    "download-install",
  ]);

  const app = await buildApp({ store });
  const agent = await app.svc.getAgent("A1");
  await assert.rejects(
    () => app.svc.putAgent({ ...agent, usabilityModes: [] }),
    /requires a non-empty, valid usabilityModes array/,
  );
});

test("file trace writes are a visible no-op and persist no raw input", async () => {
  const store = await tempStore();
  const obs = createLocalObservability({ store });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const result = await obs.recordTrace({
      agentId: "A2",
      input: JSON.stringify({ token: "must-not-persist" }),
      output: "",
      status: "error",
    });
    assert.deepEqual(result, {
      id: null,
      status: "error",
      persisted: false,
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.match(warnings.join("\n"), /file trace write disabled/);
  assert.deepEqual(await store.all("traces"), []);
});

test("append-only file-store records throw on in-place replacement", async () => {
  const store = await tempStore();
  for (const collection of ["traces", "loopRuns", "learnings"]) {
    const created = await store.append(collection, { value: "original" });
    await assert.rejects(
      () => store.put(collection, { ...created, value: "mutated" }),
      new RegExp(`${collection} records are immutable`),
    );
  }
});
