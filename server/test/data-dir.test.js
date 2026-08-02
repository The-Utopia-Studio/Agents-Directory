import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertDataDirReady,
  isRailwayEnvironment,
  RAILWAY_VOLUME_MOUNT,
  resolveDataDir,
} from "../src/core/dataDir.js";
import { createStore } from "../src/core/store.js";
import { seed } from "../src/scripts/seed.js";

test("Railway without DATA_DIR refuses ephemeral fallback", () => {
  assert.equal(isRailwayEnvironment({}), false);
  assert.equal(
    isRailwayEnvironment({ RAILWAY_ENVIRONMENT: "production" }),
    true,
  );
  assert.throws(
    () =>
      resolveDataDir({
        RAILWAY_ENVIRONMENT: "production",
      }),
    /DATA_DIR must be set to the Railway volume mount path/,
  );
  assert.throws(
    () =>
      resolveDataDir({
        RAILWAY_SERVICE_ID: "svc_abc",
        DATA_DIR: "   ",
      }),
    /DATA_DIR must be set/,
  );
  assert.equal(
    resolveDataDir({
      RAILWAY_ENVIRONMENT: "production",
      DATA_DIR: RAILWAY_VOLUME_MOUNT,
    }),
    RAILWAY_VOLUME_MOUNT,
  );
});

test("Railway rejects DATA_DIR=/tmp — cannot redirect to arbitrary ephemeral storage", () => {
  // Application code cannot prove /data is a volume, but it can stop a
  // misconfig that points persistence at a writable ephemeral path.
  assert.throws(
    () =>
      resolveDataDir({
        RAILWAY_ENVIRONMENT: "production",
        DATA_DIR: "/tmp",
      }),
    /DATA_DIR must be \/data on Railway \(got \/tmp\)/,
  );
  assert.throws(
    () =>
      resolveDataDir({
        RAILWAY_ENVIRONMENT: "production",
        DATA_DIR: "/var/data",
      }),
    /DATA_DIR must be \/data on Railway/,
  );
});

test("local DATA_DIR may default; Railway never does", () => {
  const local = resolveDataDir({});
  assert.match(local, /data/);
  assert.equal(resolveDataDir({ DATA_DIR: "/tmp/agents-dir" }), "/tmp/agents-dir");
});

test("missing volume path fails boot instead of mkdir on ephemeral disk", async () => {
  const missing = join(
    await mkdtemp(join(tmpdir(), "adir-vol-missing-")),
    "not-mounted",
  );
  await assert.rejects(
    () => assertDataDirReady(missing, { requireExisting: true }),
    /missing or not mounted/,
  );
  // Without requireExisting, local boot may create the path.
  await assertDataDirReady(missing, { requireExisting: false });
});

test("unwritable DATA_DIR fails boot", async () => {
  if (process.getuid && process.getuid() === 0) {
    // Root can write almost anything; skip rather than invent a false green.
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "adir-vol-ro-"));
  await chmod(dir, 0o500);
  try {
    await assert.rejects(
      () => assertDataDirReady(dir, { requireExisting: true }),
      /not writable|rejected a write probe/,
    );
  } finally {
    await chmod(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty mounted volume is ready and seed is idempotent", async () => {
  // An empty Railway volume is an existing empty directory — not missing.
  const volume = await mkdtemp(join(tmpdir(), "adir-vol-empty-"));
  await assertDataDirReady(volume, { requireExisting: true });

  const store = createStore(volume, { createIfMissing: false });
  const first = await seed(store);
  assert.equal(first.agents, true);
  const agents = await store.all("agents");
  assert.ok(agents.some((a) => a.id === "A7"));
  assert.ok(agents.some((a) => a.id === "A8"));

  const second = await seed(store);
  assert.equal(second.agents, false);
  assert.deepEqual(second.serverOwnedAgentsAdded, []);
  assert.equal((await store.all("agents")).length, agents.length);
});

test("createStore will not mkdir when createIfMissing is false", async () => {
  const parent = await mkdtemp(join(tmpdir(), "adir-vol-nomkdir-"));
  const missing = join(parent, "absent");
  const store = createStore(missing, { createIfMissing: false });
  // ready() is a no-op for the directory; the first write then fails if the
  // caller skipped assertDataDirReady. That is deliberate: mkdir is not a
  // backdoor around the volume check.
  await store.ready();
  await assert.rejects(() => store.put("agents", { id: "X" }), /ENOENT/);
});

test("a file at DATA_DIR is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adir-vol-file-"));
  const file = join(dir, "not-a-dir");
  await writeFile(file, "nope");
  await assert.rejects(
    () => assertDataDirReady(file, { requireExisting: true }),
    /not a directory/,
  );
});
