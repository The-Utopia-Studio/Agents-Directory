// prepared-handoff exports a BRIEFING, never an install-shaped skill file.
// These cover the split gate, the pinned-entry requirement, and the document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { buildApp } from "../src/http/server.js";
import {
  buildHandoffBriefing,
  getHandoffCapability,
  getHandoffDescriptor,
  hasHandoffArtifact,
} from "../src/handoff/handoffArtifacts.js";

async function listen(app, t) {
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

const FIXTURE = getHandoffDescriptor("A8");

async function agentWithModes(t, modes) {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-handoff-")));
  const app = await buildApp({ store });
  const base = await listen(app, t);
  const agent = await app.svc.getAgent("A1");
  await app.svc.putAgent({ ...agent, usabilityModes: modes });
  return { app, base };
}

test("A8 is registered at the verified UX/QA commit", () => {
  assert.equal(hasHandoffArtifact("A8"), true);
  assert.equal(FIXTURE.repoUrl, "https://github.com/aiden150/ux-qa-agent");
  assert.equal(
    FIXTURE.commitSha,
    "2a8f2b9562c4d4569c156e2ae7559ab04a54b883",
  );
  assert.equal(FIXTURE.owner, "Aiden Kim");
  assert.equal(FIXTURE.version, "0.1.0");
  assert.equal(FIXTURE.runtime, "Codex");
  assert.equal(FIXTURE.setupChecklist.length, 12);
  assert.equal(FIXTURE.artifactFiles.length, 8);
  assert.equal(FIXTURE.returnProtocol.length, 5);
});

test("prepared-handoff without a registry entry explains itself, no fallback export", async (t) => {
  const { base } = await agentWithModes(t, ["prepared-handoff"]);

  const capability = await (
    await fetch(`${base}/api/agents/A1/invocation-capability`)
  ).json();
  assert.equal(capability.handoff.available, false);
  assert.match(capability.handoff.reason, /No pinned handoff package/);
  assert.match(capability.handoff.reason, /commit SHA/);
  // The install path must not stand in for the missing briefing.
  assert.deepEqual(capability.installArtifact, { available: false });

  const brief = await fetch(`${base}/api/agents/A1/handoff-briefing`);
  assert.equal(brief.status, 404);
  assert.match((await brief.json()).error, /No pinned handoff package/);
});

test("A8 capability and endpoint serve only the registered pinned briefing", async (t) => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-handoff-a8-")));
  const app = await buildApp({ store });
  const base = await listen(app, t);
  const seedAgent = await app.svc.getAgent("A1");
  await app.svc.putAgent({
    ...seedAgent,
    id: "A8",
    name: "UX&QA",
    owner: "Aiden Kim",
    version: "0.1.0",
    usabilityModes: ["prepared-handoff"],
  });

  const capability = await (
    await fetch(`${base}/api/agents/A8/invocation-capability`)
  ).json();
  assert.deepEqual(capability.installArtifact, { available: false });
  assert.equal(capability.handoff.available, true);
  assert.equal(capability.handoff.repoUrl, FIXTURE.repoUrl);
  assert.equal(capability.handoff.commitSha, FIXTURE.commitSha);
  assert.equal(capability.handoff.briefVersion, FIXTURE.briefVersion);

  const response = await fetch(`${base}/api/agents/A8/handoff-briefing`);
  assert.equal(response.status, 200);
  const exported = await response.json();
  assert.equal(exported.kind, "briefing");
  assert.equal(exported.repoUrl, FIXTURE.repoUrl);
  assert.equal(exported.commitSha, FIXTURE.commitSha);
  assert.equal(
    exported.filename,
    "A8-ux-qa-handoff-v0.1.0-2a8f2b9-BRIEF.md",
  );
  assert.match(exported.content, /This document is the engagement brief, not the agent/);
  assert.doesNotMatch(exported.content, /^---\n/);
});

test("download-install alone is never offered a briefing", async (t) => {
  const { base } = await agentWithModes(t, ["download-install"]);
  const capability = await (
    await fetch(`${base}/api/agents/A1/invocation-capability`)
  ).json();
  assert.deepEqual(capability.handoff, { available: false });

  const brief = await fetch(`${base}/api/agents/A1/handoff-briefing`);
  assert.equal(brief.status, 404);
  assert.match((await brief.json()).error, /not available for prepared handoff/);
});

test("capability keys the briefing off prepared-handoff, not the install gate", () => {
  const base = { id: "A8", name: "UX/QA" };
  assert.deepEqual(
    getHandoffCapability({ ...base, usabilityModes: ["download-install"] }),
    { available: false },
  );
  const handoff = getHandoffCapability({
    ...base,
    usabilityModes: ["prepared-handoff"],
  });
  assert.equal(handoff.available, true);
  assert.equal(handoff.kind, "briefing");
  assert.equal(handoff.commitSha, FIXTURE.commitSha);
  assert.equal(handoff.owner, "Aiden Kim");
  assert.equal(handoff.version, "0.1.0");
  assert.equal(handoff.runtime, "Codex");
});

test("a registered entry produces a pinned brief, not a skill file", () => {
  const agent = { id: "A8", name: "UX&QA" };
  const brief = buildHandoffBriefing(agent, FIXTURE);

  // It must say plainly that it is not the agent, and never instruct the
  // reader to open the agent as though this file were it.
  assert.match(brief, /This document is the engagement brief, not the agent/);
  assert.match(brief, /It runs in Codex;\nthere is no endpoint/);
  assert.doesNotMatch(brief, /^---\n/, "a brief is not frontmatter-wrapped");
  assert.doesNotMatch(brief, /You are UX&QA/);
  assert.doesNotMatch(brief, /Open the agent in Codex/);

  assert.match(brief, /Repository: https:\/\/github\.com\/aiden150\/ux-qa-agent/);
  assert.match(brief, new RegExp(`Pinned commit: \`${FIXTURE.commitSha}\``));
  assert.match(brief, /Pinned tree: https:\/\/github\.com\/aiden150\/ux-qa-agent\/tree\//);
  assert.match(
    brief,
    /quote this when returning a result: `ux-qa-handoff-v0\.1\.0`/,
  );

  for (const section of [
    "## Where the agent actually lives",
    "## Setup checklist — complete before handing over",
    "## Prohibited actions",
    "## Status integrity",
    "## Inputs the agent needs",
    "## Returning results",
  ]) {
    assert.ok(brief.includes(section), `brief must contain ${section}`);
  }
  assert.equal(brief.match(/^- \[ \] /gm).length, 12);
  assert.match(brief, /- \[ \] product owner and QA owner named/);
  assert.match(
    brief,
    /- \[ \] execution approval: scenario matrix reviewed BEFORE browser execution/,
  );
  assert.match(
    brief,
    /\[`AGENT\.md`\]\(https:\/\/github\.com\/aiden150\/ux-qa-agent\/blob\/2a8f2b9562c4d4569c156e2ae7559ab04a54b883\/AGENT\.md\)/,
  );
  assert.doesNotMatch(brief, /Do not run against production data/);
  assert.match(
    brief,
    /"Not reproducible"[\s\S]*must not silently become "Verified"/,
  );
  for (const file of FIXTURE.artifactFiles) {
    assert.match(
      brief,
      new RegExp(
        `/${FIXTURE.commitSha}/${file.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  }

  const returnBlock = brief.split("## Returning results")[1];
  assert.match(returnBlock, /Return all five items/);
  assert.equal(returnBlock.match(/^\d+\. /gm).length, 5);
  assert.match(returnBlock, /1\. issue register \(severity-ranked, evidence per finding\)/);
  assert.match(returnBlock, /3\. the commit SHA above/);
  assert.match(returnBlock, /4\. rating \+ notes/);
});

test("an unpinned or partial entry is rejected rather than briefed", () => {
  const agent = { id: "A8", name: "UX&QA" };
  const cases = [
    ["commitSha", { ...FIXTURE, commitSha: "4d1f0a9" }, /40-character/],
    ["branch name", { ...FIXTURE, commitSha: "main" }, /40-character/],
    ["missing commit", { ...FIXTURE, commitSha: "" }, /40-character/],
    ["http repo", { ...FIXTURE, repoUrl: "http://example.com/x" }, /https repo URL/],
    ["missing repo", { ...FIXTURE, repoUrl: "" }, /https repo URL/],
    [
      "missing artifact path",
      {
        ...FIXTURE,
        artifactFiles: [{ path: "", description: "invalid" }],
      },
      /needs a path/,
    ],
    ["empty checklist", { ...FIXTURE, setupChecklist: [] }, /setupChecklist/],
    ["blank checklist item", { ...FIXTURE, setupChecklist: ["  "] }, /setupChecklist/],
    [
      "no prohibited actions reference",
      { ...FIXTURE, prohibitedActionsReference: "" },
      /prohibitedActionsReference/,
    ],
    [
      "unknown prohibited actions reference",
      { ...FIXTURE, prohibitedActionsReference: "PROHIBITED.md" },
      /registered artifact file/,
    ],
    ["no inputs", { ...FIXTURE, requiredInputs: [] }, /requiredInputs/],
    ["no return protocol", { ...FIXTURE, returnProtocol: [] }, /returnProtocol/],
    ["no brief version", { ...FIXTURE, briefVersion: "" }, /briefVersion/],
  ];
  for (const [name, entry, expected] of cases) {
    assert.throws(
      () => buildHandoffBriefing(agent, entry),
      expected,
      `${name} must be rejected`,
    );
  }
});
