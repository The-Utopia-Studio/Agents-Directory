import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
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

test("a corrupt collection file fails closed instead of being seeded over", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adir-corrupt-store-"));
  await writeFile(join(dir, "agents.json"), "{ not valid JSON", "utf8");
  const store = createStore(dir);

  await assert.rejects(
    () => seed(store),
    /Cannot load agents store.*Refusing to treat existing data as an empty collection/,
  );
});

test("an already-populated store still gains agents whose artifact the server owns", async () => {
  const store = await tempStore();
  // seedIfEmpty is a no-op here, which is exactly how A8 stayed missing from a
  // live deploy while its handoff brief was registered and unreachable.
  await store.seedIfEmpty("agents", [
    { id: "A1", invocation: { type: "link" }, usabilityModes: ["download-install"] },
  ]);

  const first = await seed(store);
  assert.deepEqual(first.serverOwnedAgentsAdded, ["A7", "A8"]);

  const app = await buildApp({ store });
  const capability = await app.svc.getInvocationCapability("A8");
  assert.equal(capability.handoff.available, true);
  assert.equal(capability.handoff.kind, "briefing");
  // prepared-handoff is not an install tier: no ZIP, no pinned SKILL.md.
  assert.equal(capability.installArtifact.available, false);
  assert.equal(capability.serverRun, false);

  // Idempotent, and it must not revert an edit made through the directory.
  const edited = { ...(await store.get("agents", "A8")), name: "UX&QA (renamed)" };
  await store.put("agents", edited);
  const second = await seed(store);
  assert.deepEqual(second.serverOwnedAgentsAdded, []);
  assert.equal((await store.get("agents", "A8")).name, "UX&QA (renamed)");
});

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

test("server refreshes A7 display contract to match Biocraft v3", async () => {
  const store = await tempStore();
  await store.seedIfEmpty("agents", [
    {
      id: "A7",
      name: "Biocraft single-shot draft",
      version: "1.0",
      invocation: { type: "runtime", mode: "single-shot" },
      usabilityModes: ["hosted-run", "download-install"],
      successCriteria: ["LinkedIn About hook is 300 characters or fewer"],
      guardrails: ["stale v2 display guardrail"],
      when: "stale",
      sop: "stale",
    },
  ]);

  await seed(store);
  const a7 = await store.get("agents", "A7");
  assert.equal(a7.successCriteria.length, 4);
  assert.equal(
    a7.successCriteria[0],
    "LinkedIn About hook is 200 characters or fewer",
  );
  assert.equal(a7.guardrails.length, 10);
  assert.match(
    a7.guardrails.at(-1),
    /CTA belongs only in the LinkedIn About/,
  );
  assert.match(a7.when, /refresh the bio every 2–3 months/);
  assert.match(a7.sop, /check the fold on a phone/);
  assert.match(a7.sop, /Set a reminder to refresh the bio in 2–3 months/);
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
