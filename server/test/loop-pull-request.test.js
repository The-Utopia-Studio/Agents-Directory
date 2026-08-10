import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOOP_PR_LABEL,
  LOOP_PR_REPO,
  applyProposalChangeToSkill,
  branchNameForProposal,
  buildLoopPrBody,
  buildLoopPrTitle,
  loopTokenFromEnv,
  openLoopPullRequest,
  skillFilePathForAgent,
} from "../src/github/loopPullRequest.js";

test("loop token refuses missing and never reads skills token", () => {
  assert.throws(
    () => loopTokenFromEnv({}),
    (err) => {
      assert.match(err.message, /GITHUB_LOOP_TOKEN is missing/);
      return true;
    },
  );
  assert.throws(
    () =>
      loopTokenFromEnv({
        GITHUB_SKILLS_TOKEN: "skills-only",
      }),
    /GITHUB_LOOP_TOKEN is missing/,
  );
  assert.equal(loopTokenFromEnv({ GITHUB_LOOP_TOKEN: " loop " }), "loop");
  assert.throws(
    () =>
      loopTokenFromEnv({
        GITHUB_LOOP_TOKEN: "same",
        GITHUB_SKILLS_TOKEN: "same",
      }),
    /must not be the same secret/,
  );
});

test("branch and skill path mapping", () => {
  assert.equal(skillFilePathForAgent("A7"), "biocraft/SKILL.md");
  assert.equal(
    branchNameForProposal("A7", "prop_abc"),
    "loop/biocraft-prop_abc",
  );
  assert.equal(LOOP_PR_REPO, "The-Utopia-Studio/utopia-agents");
  assert.equal(LOOP_PR_LABEL, "agents-directory-loop");
});

test("applyProposalChangeToSkill is exact and unique", () => {
  const content = "aaa KEEP bbb KEEP ccc";
  assert.equal(
    applyProposalChangeToSkill(content, {
      current: "bbb",
      proposed: "BBB",
    }),
    "aaa KEEP BBB KEEP ccc",
  );
  assert.throws(
    () =>
      applyProposalChangeToSkill(content, {
        current: "KEEP",
        proposed: "x",
      }),
    /more than once/,
  );
  assert.throws(
    () =>
      applyProposalChangeToSkill(content, {
        current: "missing",
        proposed: "x",
      }),
    /not found/,
  );
});

test("PR body carries evidence fields a reviewer needs", () => {
  const body = buildLoopPrBody({
    agent: { id: "A7", name: "BioCraft" },
    proposal: {
      id: "p1",
      summary: "Tighten CTA",
      changes: [
        {
          surface: "prompt",
          target: "server/src/artifacts/biocraft/SKILL.md#method",
          current: "old",
          proposed: "new",
          rationale: "CTA drifted in failing traces",
          evidence: ["trace_1"],
        },
      ],
    },
    promotionGate: {
      incumbentArtifactVersion: "biocraft-singleshot-v9",
      candidateArtifactVersion: "biocraft-singleshot-v9-candidate",
      scoreDelta: { comparable: true, value: 10 },
    },
    incumbentScore: {
      id: "inc_1",
      checkSetId: "a".repeat(64),
      outputSource: "live",
      byCategory: {
        grounding: { passRate: 40 },
        style: { passRate: 80 },
      },
      checkResults: [
        { id: "g", category: "grounding", passed: true },
        { id: "s", category: "style", passed: false },
      ],
    },
    candidateScore: {
      id: "can_1",
      checkSetId: "a".repeat(64),
      outputSource: "live",
      byCategory: {
        grounding: { passRate: 50 },
        style: { passRate: 90 },
      },
      checkResults: [
        { id: "g", category: "grounding", passed: true },
        { id: "s", category: "style", passed: true },
      ],
      guardrailGate: {
        passed: true,
        coverage: {
          summary: "5 of 10 evaluated, 5 passed, 5 not executable",
        },
      },
    },
  });
  assert.match(body, /CTA drifted/);
  assert.match(body, /checkSetId: `a{64}`/);
  assert.match(body, /Same checkSetId on both sides: \*\*yes\*\*/);
  assert.match(body, /Grounding delta/);
  assert.match(body, /Style delta/);
  assert.match(body, /5 of 10 evaluated/);
  assert.match(body, /Incumbent: `live`/);
  assert.match(body, /inc_1/);
  assert.equal(buildLoopPrTitle({ name: "BioCraft" }, { summary: "Tighten CTA" }), "BioCraft: Tighten CTA");
});

test("openLoopPullRequest is idempotent on stored loopPr", async () => {
  const result = await openLoopPullRequest({
    agent: { id: "A7", name: "BioCraft" },
    proposal: {
      id: "p1",
      loopPr: {
        number: 42,
        url: "https://github.com/The-Utopia-Studio/utopia-agents/pull/42",
        branch: "loop/biocraft-p1",
      },
      changes: [{ current: "a", proposed: "b" }],
    },
    fetchImpl: async () => {
      throw new Error("must not call GitHub when loopPr is stored");
    },
  });
  assert.equal(result.reused, true);
  assert.equal(result.number, 42);
});

test("openLoopPullRequest creates branch, commits one file, opens labeled PR", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    calls.push({ method, u, body: init.body ? JSON.parse(init.body) : null });
    if (u.endsWith("/repos/The-Utopia-Studio/utopia-agents") && method === "GET") {
      return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
    }
    if (u.includes("/pulls?state=open")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (u.includes("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: "basesha" } }), { status: 200 });
    }
    if (u.includes("/contents/biocraft/SKILL.md?") && method === "GET") {
      return new Response(
        JSON.stringify({
          sha: "filesha",
          content: Buffer.from("hello CURRENT world", "utf8").toString("base64"),
        }),
        { status: 200 },
      );
    }
    if (u.endsWith("/git/refs") && method === "POST") {
      return new Response(JSON.stringify({ ref: "refs/heads/loop/biocraft-p9" }), {
        status: 201,
      });
    }
    if (u.endsWith("/contents/biocraft/SKILL.md") && method === "PUT") {
      return new Response(JSON.stringify({ content: { path: "biocraft/SKILL.md" } }), {
        status: 200,
      });
    }
    if (u.endsWith("/pulls") && method === "POST") {
      return new Response(
        JSON.stringify({
          number: 77,
          html_url: "https://github.com/The-Utopia-Studio/utopia-agents/pull/77",
        }),
        { status: 201 },
      );
    }
    if (u.includes("/issues/77/labels") && method === "POST") {
      return new Response(JSON.stringify([{ name: LOOP_PR_LABEL }]), { status: 200 });
    }
    return new Response(JSON.stringify({ message: `unexpected ${method} ${u}` }), {
      status: 500,
    });
  };

  const result = await openLoopPullRequest({
    agent: { id: "A7", name: "BioCraft" },
    proposal: {
      id: "p9",
      summary: "Fix voice",
      changes: [
        {
          surface: "prompt",
          target: "server/src/artifacts/biocraft/SKILL.md#method",
          current: "CURRENT",
          proposed: "PROPOSED",
          rationale: "voice mismatch",
        },
      ],
    },
    promotionGate: {
      incumbentArtifactVersion: "biocraft-singleshot-v9",
      candidateArtifactVersion: "challenger",
      scoreDelta: { comparable: true, value: 5 },
    },
    incumbentScore: {
      id: "i",
      checkSetId: "c".repeat(64),
      outputSource: "live",
      byCategory: { grounding: { passRate: 10 }, style: { passRate: 10 } },
      checkResults: [],
    },
    candidateScore: {
      id: "c",
      checkSetId: "c".repeat(64),
      outputSource: "live",
      byCategory: { grounding: { passRate: 15 }, style: { passRate: 10 } },
      checkResults: [],
      guardrailGate: {
        passed: true,
        coverage: { summary: "1 of 1 evaluated, all passed" },
      },
    },
    token: "loop-token",
    fetchImpl,
  });

  assert.equal(result.number, 77);
  assert.equal(result.branch, "loop/biocraft-p9");
  assert.ok(calls.some((c) => c.method === "PUT" && c.u.includes("/contents/biocraft/SKILL.md")));
  const put = calls.find((c) => c.method === "PUT");
  const decoded = Buffer.from(put.body.content, "base64").toString("utf8");
  assert.equal(decoded, "hello PROPOSED world");
  assert.ok(calls.some((c) => c.method === "POST" && c.u.endsWith("/pulls")));
  assert.ok(
    calls.some(
      (c) =>
        c.method === "POST" &&
        c.u.includes("/labels") &&
        c.body.labels.includes(LOOP_PR_LABEL),
    ),
  );
  // Never touch main as head.
  assert.ok(
    calls.every(
      (c) => !(c.method === "POST" && c.u.endsWith("/pulls") && c.body.head === "main"),
    ),
  );
});
