import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP_SOURCE = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
const CONVEX_AGENTS_SOURCE = readFileSync(
  new URL("../../convex/agents.ts", import.meta.url),
  "utf8",
);

test("the browser no longer allocates catalogue or request ids", () => {
  for (const forbidden of [
    "nextAgentNum",
    "nextReqNum",
    "reservedAgentIds",
    "mintAgentId",
    "refreshReservedAgentIds",
  ]) {
    assert.doesNotMatch(APP_SOURCE, new RegExp(forbidden));
  }
  assert.match(CONVEX_AGENTS_SOURCE, /const displayId = nextDisplayId\(/);
});

test("catalogue registration delegates display-id allocation to Convex", () => {
  const start = APP_SOURCE.indexOf("async function saveNewAgent(){");
  const end = APP_SOURCE.indexOf("async function saveEditAgent", start);
  const body = APP_SOURCE.slice(start, end);
  assert.match(body, /ConvexDirectory\.registerAgent/);
  assert.doesNotMatch(body, /displayId\s*:|\bid\s*:/);
});
