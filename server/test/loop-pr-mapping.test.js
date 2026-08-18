// Every AGENT_SKILL_FILE_PATHS entry must point at the SAME agent it is keyed
// by. A10 mapped to con-linkedin-audit/SKILL.md — that is Con, Convex A9. A
// merged A10 proposal would have rewritten a different agent's skill file with
// edits derived from the gap-fill artifact, and nothing would have said so.
//
// The invariant is checked offline against each agent's own runtime slug, so
// it runs in the normal suite with no network and no token. An optional
// frontmatter check against the live utopia-agents file runs only when
// GITHUB_LOOP_TOKEN is present.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_SKILL_FILE_PATHS,
  LoopPullRequestError,
  skillFilePathForAgent,
} from "../src/github/loopPullRequest.js";
import { getRuntimeArtifactDescriptor } from "../src/invoke/runtimeArtifacts.js";

test("every mapped agent resolves to a directory named for that same agent", () => {
  const entries = Object.entries(AGENT_SKILL_FILE_PATHS);
  assert.ok(entries.length > 0, "the mapping must not be empty");

  const crossAgent = [];
  for (const [agentId, path] of entries) {
    const live = getRuntimeArtifactDescriptor(agentId);
    assert.ok(live, `${agentId} is mapped but has no runtime artifact`);
    const directory = String(path).split("/")[0];
    if (directory !== live.slug) {
      crossAgent.push(
        `${agentId} maps to ${path} but its runtime slug is "${live.slug}" — ` +
          `a merged PR would write another agent's skill file`,
      );
    }
    assert.match(path, /\/SKILL\.md$/, `${agentId} must map to a SKILL.md`);
  }
  assert.deepEqual(crossAgent, [], crossAgent.join("\n  "));
});

test("A10 is unmapped and refuses by name rather than guessing", () => {
  // utopia-agents has no gap-fill skill, so there is no correct path. Refusing
  // is the honest outcome; a plausible-looking directory would be a guess.
  assert.equal(AGENT_SKILL_FILE_PATHS.A10, undefined);
  assert.throws(
    () => skillFilePathForAgent("A10"),
    (error) => {
      assert.ok(error instanceof LoopPullRequestError);
      assert.equal(error.code, "loop_pr_unmapped_agent");
      assert.match(error.message, /No utopia-agents skill path mapped for agent A10/);
      return true;
    },
  );
});

test("con-linkedin-audit is never reachable from any mapping", () => {
  // The specific cross-agent write this test exists to prevent.
  for (const [agentId, path] of Object.entries(AGENT_SKILL_FILE_PATHS)) {
    assert.ok(
      !path.startsWith("con-linkedin-audit/"),
      `${agentId} maps into Con's skill directory`,
    );
  }
});

test("an unknown agent refuses rather than defaulting to a path", () => {
  for (const id of ["A1", "A99", "", null, undefined]) {
    assert.throws(() => skillFilePathForAgent(id), /No utopia-agents skill path mapped/);
  }
});

test("the mapped utopia-agents file names the same agent (network, token-gated)", async (t) => {
  const token = String(process.env.GITHUB_LOOP_TOKEN || "").trim();
  if (!token) {
    t.skip("GITHUB_LOOP_TOKEN not set — offline slug invariant above still applies");
    return;
  }
  for (const [agentId, path] of Object.entries(AGENT_SKILL_FILE_PATHS)) {
    const res = await fetch(
      `https://api.github.com/repos/The-Utopia-Studio/utopia-agents/contents/${path}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } },
    );
    assert.ok(res.ok, `${agentId}: ${path} is not readable in utopia-agents (${res.status})`);
    const body = await res.json();
    const text = Buffer.from(body.content || "", "base64").toString("utf8");
    const name = text.match(/^name:\s*(\S+)/m)?.[1] || "";
    const live = getRuntimeArtifactDescriptor(agentId);
    // The skill's own name must share the agent's slug stem. utopia-agents
    // "biocraft" vs hosted "biocraft-single-shot" is the same agent in two
    // runtimes; "con-linkedin-audit" against a gap-fill slug is not.
    const stem = live.slug.split("-")[0];
    assert.ok(
      name.includes(stem),
      `${agentId}: utopia-agents ${path} declares name "${name}" which does not name ${live.slug}`,
    );
  }
});
