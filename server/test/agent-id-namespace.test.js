// Agent ids are one namespace shared between the browser catalog and this
// service. A browser-minted id that matches a server-owned one resolves against
// the server's record, so evals, proposals and briefings for a local agent
// would land on someone else's. These tests pin the mint rules for the current
// TEMPORARY collision mitigation: when the loop service is reachable and
// responds before minting, the browser avoids ids currently known to it. This
// is not an atomic reservation — Convex becomes the sole allocator in Phase 5.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { createStore } from "../src/core/store.js";
import { seed } from "../src/scripts/seed.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP_SOURCE = await readFile(new URL("../../app.js", import.meta.url), "utf8");

/**
 * The mint helpers are pure, so they can be evaluated directly instead of
 * asserted against as text. Everything they touch is injected below.
 */
function mintHarness({ agents = [], reservedAgentIds = [], nextAgentNum = 1 }) {
  const block = APP_SOURCE.slice(
    APP_SOURCE.indexOf("function agentIdNumber"),
    APP_SOURCE.indexOf("async function refreshReservedAgentIds"),
  );
  assert.ok(block.includes("function mintAgentId"), "mint helpers not found in app.js");
  const context = createContext({
    agents: agents.map((id) => ({ id })),
    reservedAgentIds,
    nextAgentNum,
  });
  runInContext(block, context);
  return context;
}

const LOCAL_SEED = ["A1", "A2", "A3", "A4", "A5", "A6", "A7"];

test("when the service responds before minting, the browser avoids ids known to it", async () => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-ids-")));
  await seed(store);
  const serverIds = (await store.all("agents")).map((agent) => agent.id);
  assert.ok(serverIds.includes("A8"), "A8 must exist server-side for this to be a real case");

  // The exact pre-fix bug: the browser seed stops at A7, so the next mint was
  // A8 — the service's UX&QA agent.
  const context = mintHarness({ agents: LOCAL_SEED, reservedAgentIds: serverIds });
  const minted = context.mintAgentId();
  assert.equal(minted, "A9");
  assert.equal(serverIds.includes(minted), false);
});

test("the floor is derived from what is taken, not from a stored counter", () => {
  // A stale or reset counter must not reissue a live id.
  const context = mintHarness({
    agents: LOCAL_SEED,
    reservedAgentIds: ["A8"],
    nextAgentNum: 2,
  });
  assert.equal(context.mintAgentId(), "A9");
});

test("minting stays in the A<n> namespace and skips gaps that are taken", () => {
  const context = mintHarness({
    agents: ["A1"],
    reservedAgentIds: ["A2", "A3"],
  });
  const first = context.mintAgentId();
  const second = context.mintAgentId();
  // Convex's nextDisplayId matches ^A(\d+)$ only, so a local prefix would be
  // invisible to it and need renaming mid-migration.
  for (const id of [first, second]) assert.match(id, /^A\d+$/);
  assert.deepEqual([first, second], ["A4", "A5"]);
});

test("new catalog registration delegates display-id allocation to Convex", () => {
  // The temporary browser mitigation remains only for legacy local data. New
  // agents no longer mint or persist an id in the browser.
  assert.match(APP_SOURCE, /await ConvexDirectory\.registerAgent\(convexRegistrationArgs\(f\)\)/);
  assert.doesNotMatch(
    APP_SOURCE.slice(APP_SOURCE.indexOf("async function saveNewAgent()"), APP_SOURCE.indexOf("async function saveEditAgent")),
    /mintAgentId\(|refreshReservedAgentIds\(|\bpersist\s*\(/,
  );
  // The observed set must come from the service's own list.
  assert.match(APP_SOURCE, /DirectoryAPI\.listAgents\(\)/);
  // No hardcoded ceiling: the legacy helper is still honest until its later
  // removal, and Convex owns all new display ids.
  assert.doesNotMatch(APP_SOURCE, /nextAgentNum=Math\.max\(Number\(nextAgentNum\)\|\|1,8\)/);
  assert.doesNotMatch(APP_SOURCE, /id:"A"\+nextAgentNum\+\+/);
});
