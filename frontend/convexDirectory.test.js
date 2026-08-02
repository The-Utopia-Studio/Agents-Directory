/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import appSource from "../app.js?raw";
import clientSource from "./convexDirectory.js?raw";
import {
  createConvexDirectoryClient,
  overlayGovernedPilotAgents,
} from "./convexDirectory";

const localAgents = Array.from({ length: 8 }, (_, index) => {
  const id = `A${index + 1}`;
  return {
    id,
    name: `Local ${id}`,
    tagline: `Local tagline ${id}`,
    platform: "Claude",
    status: "Experimental",
    category: "Other",
    owner: "Local owner",
    initials: "LO",
    version: "local",
    invocation: { type: "link" },
    usabilityModes: ["download-install"],
    objective: `Local objective ${id}`,
    successCriteria: ["Local criterion"],
    guardrails: ["Local guardrail"],
    inputs: ["Local input"],
    outputs: ["Local output"],
    skills: [],
    tools: [],
    context: [],
  };
});

const governedRows = [
  {
    agent: {
      displayId: "A7",
      name: "Biocraft single-shot draft",
      tagline: "Governed A7",
      platform: "Claude",
      status: "Experimental",
      category: "Personal Branding",
      owner: "Sarah",
      initials: "S",
      model: "Claude Sonnet 4.6",
      runner: "native",
      invocation: { type: "runtime", configRef: "server-owned:a7" },
      usabilityModes: ["hosted-run", "download-install"],
      executionContract: {
        inputs: [
          { key: "fellowName", required: true },
          { key: "sourceMaterial", required: true },
        ],
      },
      outcomeContract: {
        successCriteria: [{ id: "hook", label: "Hook is within limit" }],
      },
      guardrails: [{ id: "grounded", label: "No fabricated claims" }],
      skills: ["biocraft"],
      tools: [],
      context: [{ label: "Supplied source material" }],
    },
    version: {
      version: "biocraft-singleshot-v4",
      state: "candidate",
      artifact: {
        locator: "server/src/artifacts/biocraft/SKILL.md",
        declaredDigest: "a".repeat(64),
        declaredDigestAlgorithm: "sha256",
      },
    },
  },
  {
    agent: {
      displayId: "A8",
      name: "UX&QA",
      tagline: "Governed A8",
      platform: "Codex",
      status: "Experimental",
      category: "Design & Product",
      owner: "Aiden Kim",
      initials: "AK",
      model: "—",
      runner: "foreign-runtime-handoff",
      usabilityModes: ["prepared-handoff"],
      executionContract: {
        inputs: [{ key: "approvedBuild", required: true }],
      },
      outcomeContract: {
        successCriteria: [{ id: "issues", label: "Issue register returned" }],
      },
      guardrails: [],
      skills: [],
      tools: [],
      context: [],
      repoUrl: "https://github.com/aiden150/ux-qa-agent",
    },
    version: {
      version: "0.1.0",
      state: "draft",
      artifact: null,
      sourcePin: {
        kind: "git-commit",
        repoUrl: "https://github.com/aiden150/ux-qa-agent",
        commitSha: "2a8f2b9562c4d4569c156e2ae7559ab04a54b883",
        isContentDigest: false,
      },
    },
  },
];

function loadGovernedWriteHelpers() {
  const start = appSource.indexOf("function isGovernedPilot");
  const end = appSource.indexOf("function renderGovernedIdentity");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const context = createContext({});
  runInContext(appSource.slice(start, end), context);
  return context;
}

describe("Phase 4 Convex directory pilot", () => {
  test("a successful query overlays governed A7/A8 while A1-A6 stay local", async () => {
    const query = vi.fn().mockResolvedValue(governedRows);
    const client = createConvexDirectoryClient({
      url: "https://pilot.example.convex.cloud",
      clientFactory: () => ({ query }),
    });
    const result = await client.read(localAgents);

    expect(result.succeeded).toBe(true);
    expect(query).toHaveBeenCalledOnce();
    for (let index = 0; index < 6; index += 1) {
      expect(result.agents[index]).toBe(localAgents[index]);
      expect(result.agents[index].governedInConvex).toBeUndefined();
    }
    expect(result.agents[6]).toMatchObject({
      id: "A7",
      name: "Biocraft single-shot draft",
      version: "biocraft-singleshot-v4",
      runner: "native",
      invocation: { type: "runtime" },
      usabilityModes: ["hosted-run", "download-install"],
      governedInConvex: true,
      convexGovernance: {
        artifact: {
          digest: "a".repeat(64),
          algorithm: "sha256",
        },
      },
    });
    expect(result.agents[7]).toMatchObject({
      id: "A8",
      runner: "foreign-runtime-handoff",
      usabilityModes: ["prepared-handoff"],
      governedInConvex: true,
    });
    expect(appSource.match(/\$\{governedBadge\(a\)\}/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(appSource).toContain("${renderGovernedIdentity(a)}");
  });

  test("a failed Convex read returns the untouched local directory without governance labels", async () => {
    const client = createConvexDirectoryClient({
      url: "https://pilot.example.convex.cloud",
      clientFactory: () => ({
        query: vi.fn().mockRejectedValue(new Error("unavailable")),
      }),
    });
    const result = await client.read(localAgents);

    expect(result).toEqual({ agents: localAgents, succeeded: false });
    expect(result.agents.some((agent) => agent.governedInConvex)).toBe(false);
  });

  test("A8's Git commit remains a source pin and is never mapped as an artifact digest", () => {
    const overlaid = overlayGovernedPilotAgents(localAgents, governedRows);
    const a8 = overlaid.find((agent) => agent.id === "A8");

    expect(a8.convexGovernance.artifact).toBeNull();
    expect(a8.convexGovernance.sourcePin).toEqual({
      kind: "git-commit",
      repoUrl: "https://github.com/aiden150/ux-qa-agent",
      commitSha: "2a8f2b9562c4d4569c156e2ae7559ab04a54b883",
      isContentDigest: false,
    });
    expect(appSource).toContain("Git commit source pin:");
    expect(appSource).toContain(
      "Source pin only — not an artifact-content digest.",
    );
  });

  test("deployment-config.js is ignored and must not be a tracked source file", () => {
    const gitignore = readFileSync(
      new URL("../.gitignore", import.meta.url),
      "utf8",
    );
    expect(gitignore).toMatch(/^deployment-config\.js$/m);
    expect(appSource).not.toMatch(/https:\/\/[^\s"']+\.convex\.cloud/);
    expect(clientSource).not.toMatch(/https:\/\/[^\s"']+\.convex\.cloud/);
  });

  test("governed A7/A8 hide local Edit, Log eval, and Propose improvement controls", () => {
    const helpers = loadGovernedWriteHelpers();
    const overlaid = overlayGovernedPilotAgents(localAgents, governedRows);
    for (const id of ["A7", "A8"]) {
      const agent = overlaid.find((row) => row.id === id);
      expect(helpers.isGovernedPilot(agent)).toBe(true);
      expect(helpers.renderDetailEditControl(agent)).toBe("");
      expect(helpers.renderEvalTitleActions(agent)).toBe("");
      expect(helpers.renderGovernedPilotNotice(agent)).toContain(
        "This governed record is read-only during the Convex pilot. Editing, evaluation and proposals will move to Convex in a later phase.",
      );
      expect(helpers.renderEmptyEval(agent)).not.toContain("Log the first evaluation");
      expect(helpers.renderEmptyEval(agent)).not.toContain("openModal('eval'");
    }
  });

  test("A1-A6 keep their normal local Edit, Log eval, and Propose improvement controls", () => {
    const helpers = loadGovernedWriteHelpers();
    for (const agent of localAgents.slice(0, 6)) {
      expect(helpers.isGovernedPilot(agent)).toBe(false);
      expect(helpers.renderDetailEditControl(agent)).toContain(">Edit</button>");
      expect(helpers.renderEvalTitleActions(agent)).toContain("Propose improvement");
      expect(helpers.renderEvalTitleActions(agent)).toContain(">Log eval</button>");
      expect(helpers.renderGovernedPilotNotice(agent)).toBe("");
      expect(helpers.renderEmptyEval(agent)).toContain("Log the first evaluation");
    }
  });

  test("the browser pilot contains a query path and no mutation path", () => {
    expect(clientSource).toMatch(
      /makeFunctionReference\(\s*["']agents:listGovernedDirectoryPilot["']/,
    );
    expect(clientSource).toMatch(/client\.query\(\s*governedDirectoryQuery/);
    expect(clientSource).not.toMatch(/client\s*\.\s*mutation\s*\(/);
    expect(clientSource).not.toMatch(/api\.imports/);
    expect(appSource).not.toMatch(/client\s*\.\s*mutation\s*\(/);
    expect(appSource).not.toMatch(/ConvexHttpClient/);
  });
});
