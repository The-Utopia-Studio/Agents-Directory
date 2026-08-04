/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";
import appSource from "../app.js?raw";
import clientSource from "./convexDirectory.js?raw";
import {
  createConvexDirectoryClient,
  mapGovernedDirectoryRows,
} from "./convexDirectory";

const a7Digest = "a".repeat(64);
const a8Commit = "2a8f2b9562c4d4569c156e2ae7559ab04a54b883";
const governedRows = [
  {
    isCurrentApproved: true,
    agent: {
      _id: "agent-a7",
      displayId: "A7",
      name: "Biocraft single-shot draft",
      tagline: "Governed A7",
      platform: "Claude",
      status: "Experimental",
      category: "Personal Branding",
      owner: "Sarah",
      initials: "SA",
      model: "Claude Sonnet 4.6",
      description: "Governed A7 description",
      objective: "Governed A7 objective",
      whenToUse: "Use A7 from governed material",
      sop: "1. Use the governed SOP",
      outputs: ["Governed A7 output"],
      runner: "native",
      invocation: { type: "runtime", configRef: "server-owned:a7" },
      usabilityModes: ["hosted-run", "download-install"],
      executionContract: { inputs: [{ key: "sourceMaterial", required: true }] },
      evidenceContract: { acceptedTypes: ["run"], requiredReturnArtifact: false },
      outcomeContract: { successCriteria: [{ id: "hook", label: "Hook is within limit" }] },
      guardrails: [{ id: "grounded", label: "No fabricated claims" }],
      skills: ["biocraft"],
      tools: [],
      context: [{ label: "Supplied source material" }],
    },
    version: {
      version: "biocraft-singleshot-v5",
      state: "approved",
      artifact: {
        locator: "server/src/artifacts/biocraft/SKILL.md",
        declaredDigest: a7Digest,
        declaredDigestAlgorithm: "sha256",
      },
    },
  },
  {
    isCurrentApproved: false,
    agent: {
      _id: "agent-a8",
      displayId: "A8",
      name: "UX&QA Agent",
      tagline: "Governed A8",
      platform: "Codex",
      status: "Experimental",
      category: "Design & Product",
      owner: "Aiden Kim",
      initials: "AK",
      description: "Governed A8 description",
      objective: "Governed A8 objective",
      whenToUse: "Use A8 from governed material",
      sop: "1. Use the governed A8 SOP",
      outputs: ["Governed A8 output"],
      runner: "foreign-runtime-handoff",
      usabilityModes: ["prepared-handoff"],
      executionContract: { inputs: [{ key: "approvedBuild", required: true }] },
      evidenceContract: { acceptedTypes: ["test-report"], requiredReturnArtifact: true },
      outcomeContract: { successCriteria: [{ id: "issues", label: "Issue register returned" }] },
      guardrails: [],
      skills: [],
      tools: [],
      context: [],
      repoUrl: "https://github.com/aiden150/ux-qa-agent",
    },
    version: {
      version: "0.1.0",
      state: "draft",
      sourcePin: {
        kind: "git-commit",
        repoUrl: "https://github.com/aiden150/ux-qa-agent",
        commitSha: a8Commit,
        isContentDigest: false,
      },
    },
  },
];

function sliceSource(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

describe("Phase 5 Convex-only directory", () => {
  test("the read model is built only from Convex rows", async () => {
    const query = vi.fn().mockResolvedValue(governedRows);
    const client = createConvexDirectoryClient({
      url: "https://directory.example.convex.cloud",
      clientFactory: () => ({ query }),
    });
    const result = await client.read([{ id: "A1", name: "must be ignored" }]);
    expect(result.succeeded).toBe(true);
    expect(result.agents.map((agent) => agent.id)).toEqual(["A7", "A8"]);
    expect(result.agents[0]).toMatchObject({
      name: "Biocraft single-shot draft",
      objective: "Governed A7 objective",
      version: "biocraft-singleshot-v5",
      governedInConvex: true,
      convexGovernance: {
        isCurrentApproved: true,
        artifact: { digest: a7Digest, algorithm: "sha256" },
      },
    });
    for (const agent of result.agents) {
      expect(agent).not.toHaveProperty("evalHistory");
      expect(agent).not.toHaveProperty("changelog");
      expect(agent).not.toHaveProperty("costPerOutcome");
    }
  });

  test("A8's commit is a source pin, never an artifact digest", () => {
    const a8 = mapGovernedDirectoryRows(governedRows).find((agent) => agent.id === "A8");
    expect(a8.convexGovernance.artifact).toBeNull();
    expect(a8.convexGovernance.sourcePin).toEqual({
      kind: "git-commit",
      repoUrl: "https://github.com/aiden150/ux-qa-agent",
      commitSha: a8Commit,
      isContentDigest: false,
    });
  });

  test("failed and unconfigured reads return no fallback catalogue", async () => {
    const failed = createConvexDirectoryClient({
      url: "https://directory.example.convex.cloud",
      clientFactory: () => ({ query: vi.fn().mockRejectedValue(new Error("down")) }),
    });
    await expect(failed.read([{ id: "A1" }])).resolves.toEqual({ agents: [], succeeded: false });
    await expect(createConvexDirectoryClient({ url: "" }).read([{ id: "A1" }])).resolves.toEqual({
      agents: [],
      succeeded: false,
    });
    expect(appSource).toContain("Directory unavailable");
    expect(appSource).toContain("retryGovernedDirectory()");
    expect(appSource).not.toContain("reset demo data");
  });

  test("the catalogue has no browser persistence, hydration, or id allocator", () => {
    for (const forbidden of [
      "function persist(",
      "function hydrate(",
      "nextAgentNum",
      "nextReqNum",
      "reservedAgentIds",
      "mintAgentId",
      "refreshReservedAgentIds",
      "function resetData(",
    ]) {
      expect(appSource).not.toContain(forbidden);
    }
    expect(appSource).not.toMatch(/localStorage\.(setItem|removeItem)\(/);
    expect(appSource).toContain("LEGACY_STORE_KEY");
    expect(appSource).toContain("readBrowserMigrationSnapshot(localStorage,LEGACY_STORE_KEY)");
  });

  test("register, edit, create-request and update-request use authenticated Convex mutations", () => {
    expect(clientSource).toContain("agents:registerAgent");
    expect(clientSource).toContain("agents:updateAgent");
    expect(clientSource).toContain("requests:createRequest");
    expect(clientSource).toContain("requests:updateRequest");
    expect(clientSource).toContain("requests:listRequests");
    for (const marker of [
      "async function saveNewAgent(){",
      "async function saveEditAgent(id){",
      "async function saveNewRequest(){",
      "async function saveTriage(id){",
    ]) {
      const start = appSource.indexOf(marker);
      expect(start).toBeGreaterThan(-1);
      expect(appSource.slice(start, start + 900)).toContain("ConvexDirectory");
    }
  });

  test("eval and approval remain locked, request conversion is visibly deferred", () => {
    expect(sliceSource("function saveEval(id){", "async function saveTriage")).toContain(
      "toast(EVAL_LOCK_REASON)",
    );
    expect(sliceSource("async function approveImprovement", "async function rejectImprovement")).toContain(
      "toast(APPROVAL_LOCK_REASON)",
    );
    expect(appSource).toContain(
      "Request-to-agent conversion is deferred. Register the agent separately; linking a request to a released agent needs its own governed workflow.",
    );
  });

  test("proposal and reject have no browser-local stand-in", () => {
    const propose = sliceSource("async function proposeImprovement", "async function approveImprovement");
    const reject = sliceSource("async function rejectImprovement", "async function reopenVerifierRejectedImprovement");
    expect(propose).toContain("DirectoryAPI.runImprovement");
    expect(propose).toContain("setRailwayProposals");
    expect(reject).toContain("DirectoryAPI.reject");
    expect(reject).toContain("setRailwayProposals");
    expect(`${propose}\n${reject}`).not.toMatch(/\bpersist\s*\(|proposedImprovements\s*=|agents\.push/);
    expect(reject).toContain("Reject unavailable");
  });

  test("Railway affordances require the governed artifact or source pin", () => {
    const context = createContext({
      hasUsabilityMode: (agent, mode) => agent.usabilityModes.includes(mode),
      canInstall: (agent) => agent.usabilityModes.includes("download-install"),
      canHandoff: (agent) => agent.usabilityModes.includes("prepared-handoff"),
    });
    runInContext(
      sliceSource("const GOVERNED_RUNTIME_MISMATCH", "async function loadRunCapability"),
      context,
    );
    const [a7, a8] = mapGovernedDirectoryRows(governedRows);
    const a7Capability = {
      installArtifact: {
        available: true,
        artifactVersion: "biocraft-singleshot-v5",
        artifactDigest: a7Digest,
        artifactDigestAlgorithm: "sha256",
      },
    };
    expect(context.capabilityIdentityMatches(a7, a7Capability)).toBe(true);
    expect(
      context.capabilityIdentityMatches(a7, {
        installArtifact: { ...a7Capability.installArtifact, artifactDigest: "b".repeat(64) },
      }),
    ).toBe(false);
    expect(
      context.capabilityIdentityMatches(a8, {
        handoff: {
          available: true,
          repoUrl: "https://github.com/aiden150/ux-qa-agent",
          commitSha: a8Commit,
        },
      }),
    ).toBe(true);
    expect(appSource).toContain(
      "Runtime version does not match the governed version. Deployment or approval is incomplete.",
    );
  });

  test("required live affordances remain present", () => {
    for (const marker of [
      "DirectoryAPI.runAgent",
      "DirectoryAPI.downloadInstallArtifact",
      "DirectoryAPI.handoffBriefing",
      "DirectoryAPI.runImprovement",
      "DirectoryAPI.runLoop",
      "ConvexDirectory.registerAgent",
      "ConvexDirectory.updateAgent",
      "ConvexDirectory.createRequest",
    ]) {
      expect(appSource).toContain(marker);
    }
  });

  test("deployment config is generated and never committed", () => {
    const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
    expect(gitignore).toMatch(/^deployment-config\.js$/m);
    expect(appSource).not.toMatch(/https:\/\/[^\s"']+\.convex\.cloud/);
  });
});
