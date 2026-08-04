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
      description: "Governed A7 description",
      objective: "Governed A7 objective",
      whenToUse: "Use A7 from governed material",
      sop: "1. Use the governed SOP",
      outputs: ["Governed A7 output"],
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
      description: "Governed A8 description",
      objective: "Governed A8 objective",
      whenToUse: "Use A8 from governed material",
      sop: "1. Use the governed A8 SOP",
      outputs: ["Governed A8 output"],
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

function sliceSource(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

const escHtmlStub = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );

/** Evaluates the write-lock block plus the governed render helpers together. */
function loadWriteGuards({ convexReadActive = false, catalogSource, authStatus = "signed-in" } = {}) {
  const context = createContext({
    escHtml: escHtmlStub,
    toast: () => {},
    window: {
      ConvexDirectory: { enabled: true },
      DirectoryAuth: {
        getState: () => ({ status: authStatus, detail: "Auth fixture" }),
      },
    },
  });
  runInContext(
    sliceSource("// ── WRITE LOCK", "// ── END WRITE LOCK"),
    context,
  );
  runInContext(
    sliceSource("function isGovernedPilot", "function renderGovernedIdentity"),
    context,
  );
  if (catalogSource) context.setCatalogSource(catalogSource);
  else context.setConvexReadActive(convexReadActive);
  return context;
}

function loadGovernedWriteHelpers() {
  return loadWriteGuards();
}

describe("Phase 4 Convex directory pilot", () => {
  test("a successful query merges complete Convex rows and retains only unmatched local fixtures", async () => {
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
      description: "Governed A7 description",
      objective: "Governed A7 objective",
      when: "Use A7 from governed material",
      sop: "1. Use the governed SOP",
      outputs: ["Governed A7 output"],
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
      description: "Governed A8 description",
      objective: "Governed A8 objective",
      when: "Use A8 from governed material",
      sop: "1. Use the governed A8 SOP",
      outputs: ["Governed A8 output"],
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

  test("the Convex client receives and clears the Clerk token without changing public reads", () => {
    const setAuth = vi.fn();
    const clearAuth = vi.fn();
    const client = createConvexDirectoryClient({
      url: "https://pilot.example.convex.cloud",
      clientFactory: () => ({ query: vi.fn(), setAuth, clearAuth }),
    });
    client.setAuthToken("signed-clerk-jwt");
    client.setAuthToken(null);
    expect(setAuth).toHaveBeenCalledWith("signed-clerk-jwt");
    expect(clearAuth).toHaveBeenCalledOnce();
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

  test("governed A7/A8 permit Convex edits while manual evals stay locked and proposals stay live", () => {
    const helpers = loadWriteGuards({ catalogSource: "convex" });
    const overlaid = overlayGovernedPilotAgents(localAgents, governedRows);
    for (const id of ["A7", "A8"]) {
      const agent = overlaid.find((row) => row.id === id);
      expect(helpers.isGovernedPilot(agent)).toBe(true);
      expect(helpers.renderDetailEditControl(agent)).toContain("onclick");
      expect(helpers.renderEvalTitleActions(agent)).toContain(
        `onclick="proposeImprovement('${id}')"`,
      );
      expect(helpers.renderEvalTitleActions(agent)).toContain("Log eval");
      expect(helpers.renderEvalTitleActions(agent)).toContain("disabled");
      expect(helpers.renderEvalTitleActions(agent)).toContain(
        "ungoverned score would affect fleet health",
      );
      expect(helpers.renderGovernedPilotNotice(agent)).toContain(
        "runs, feedback and reversible proposals continue in the loop service",
      );
      expect(helpers.renderEmptyEval(agent)).not.toContain("Log the first evaluation");
      expect(helpers.renderEmptyEval(agent)).not.toContain("openModal('eval'");
    }
  });

  test("signed-out catalog controls visibly request sign-in instead of silently appearing read-only", () => {
    const helpers = loadWriteGuards({ catalogSource: "local", authStatus: "signed-out" });
    expect(helpers.writeActionButton("Add agent", "openModal('addAgent')", "btn-primary")).toContain(
      "Sign in to register, edit, or request",
    );
    expect(helpers.renderDetailEditControl({ id: "A7" })).toContain(
      "Sign in to register, edit, or request",
    );
  });

  test("hydration/boot never writes localStorage before the Convex outcome", () => {
    const hydrateBody = sliceSource("function hydrate()", "function agentIdNumber");
    // Comment may mention persist; executable lines must not invoke it or touch storage.
    const hydrateCode = hydrateBody
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    expect(hydrateCode).not.toMatch(/\bpersist\s*\(/);
    expect(hydrateCode).not.toMatch(/localStorage\.(setItem|removeItem)\s*\(/);
    // Existing local A7/A8 records are left alone — seed only fills a missing card.
    expect(hydrateBody).toMatch(/if\(!agents\.some\(a=>a\.id==="A7"\)\)/);
    expect(hydrateBody).toMatch(/if\(!agents\.some\(a=>a\.id==="A8"\)\)/);
    expect(hydrateBody).not.toMatch(/fields\.some\(key=>JSON\.stringify\(prior/);

    // Boot starts pending-locked so persist cannot fire until resolution.
    const pending = loadWriteGuards({ catalogSource: "pending" });
    expect(pending.writesLocked()).toBe(true);
    expect(pending.catalogPending()).toBe(true);
    expect(pending.renderWriteLockBanner()).toContain(
      "Waiting for the Convex catalog read",
    );
    expect(pending.writeActionButton("+ Add agent", "openModal('addAgent')")).toContain(
      "disabled",
    );
    expect(pending.writeActionButton("+ Add agent", "openModal('addAgent')")).not.toContain(
      "onclick",
    );

    // Unconfigured / failed Convex unlocks only after that outcome is recorded.
    const pilot = sliceSource(
      "async function loadGovernedDirectoryPilot()",
      "let reservedAgentIds",
    );
    expect(pilot).toMatch(
      /if\(!\(window\.ConvexDirectory&&ConvexDirectory\.enabled\)\)\{[\s\S]*?setCatalogSource\("local"\)/,
    );
    expect(pilot).toMatch(/setCatalogSource\(succeeded\?"convex":"local"\)/);
    expect(pilot).toMatch(/catch\(_error\)\{[\s\S]*?setCatalogSource\("local"\)/);

    const unlocked = loadWriteGuards({ catalogSource: "local" });
    expect(unlocked.writesLocked()).toBe(false);
    expect(unlocked.renderWriteLockBanner()).toBe("");
  });

  test("local fixtures are visibly read-only rather than silently writing browser state", () => {
    const helpers = loadGovernedWriteHelpers();
    expect(helpers.writesLocked()).toBe(false);
    for (const agent of localAgents.slice(0, 6)) {
      expect(helpers.isGovernedPilot(agent)).toBe(false);
      expect(helpers.renderDetailEditControl(agent)).toContain("disabled");
      expect(helpers.renderDetailEditControl(agent)).toContain("local fixture is read-only");
      expect(helpers.renderEvalTitleActions(agent)).toContain("proposeImprovement(");
      expect(helpers.renderEvalTitleActions(agent)).not.toContain("openModal('eval'");
      expect(helpers.renderGovernedPilotNotice(agent)).toBe("");
      expect(helpers.renderEmptyEval(agent)).not.toContain("Log the first evaluation");
      expect(helpers.writeActionButton("+ Add agent", "openModal('addAgent')")).toContain("disabled");
    }
    expect(helpers.renderWriteLockBanner()).toBe("");
  });

  test("an active Convex read exposes Convex-backed registration while local fixtures remain read-only", () => {
    const helpers = loadWriteGuards({ convexReadActive: true });
    expect(helpers.writesLocked()).toBe(true);
    expect(helpers.convexReadActive()).toBe(true);
    expect(helpers.renderWriteLockBanner()).toContain(
      "Catalog is read-only while Convex is the source.",
    );

    for (const label of ["+ Add agent", "Request an Agent", "+ New request"]) {
      const button = helpers.writeActionButton(label, "openModal('addAgent')");
      expect(button).toContain("onclick");
    }

    // A1-A6 are ordinary local records, but the view is Convex-rendered, so a
    // saved edit here would diverge from what another browser shows.
    for (const agent of localAgents.slice(0, 6)) {
      expect(helpers.isGovernedPilot(agent)).toBe(false);
      expect(helpers.isReadOnlyRecord(agent)).toBe(true);
      expect(helpers.renderDetailEditControl(agent)).not.toContain("onclick");
      expect(helpers.renderEvalTitleActions(agent)).toContain("proposeImprovement(");
      expect(helpers.renderEvalTitleActions(agent)).not.toContain("openModal('eval'");
      expect(helpers.renderEmptyEval(agent)).not.toContain("openModal('eval'");
      expect(helpers.renderGovernedPilotNotice(agent)).toContain("Convex is the catalog source");
    }
  });

  test("Run automations stays live under b′ and does not bump a catalog version", () => {
    // Under the catalog lock the button remains a real control — not a title-
    // only disabled state. runCycle writes Railway proposals/queue/learnings
    // only; auto-apply is dead so no version bump.
    const autoBody = sliceSource(
      "async function loadAutomations()",
      "// ── Using an agent across platforms",
    );
    expect(autoBody).toMatch(
      /<button class="btn btn-sm btn-primary" onclick="runLoopNow\(this\)">Run automations now<\/button>/,
    );
    expect(autoBody).toContain("AUTOMATION_LIVE_NOTE");
    const runLoopBody = sliceSource(
      "async function runLoopNow(btn){",
      "// ── Using an agent across platforms",
    );
    expect(runLoopBody).toMatch(/Allowed under the catalog lock \(b′\)/);
    expect(runLoopBody).not.toMatch(/if\(writesLocked\(\)\)return refuseLockedWrite\(\)/);
    const runLoopCode = runLoopBody
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n");
    expect(runLoopCode).not.toMatch(/approveImprovement|DirectoryAPI\.approve/);
    expect(appSource).toContain(
      "A separately configured Railway scheduler sits outside this UI lock",
    );
  });

  test("new Convex form paths never call local persistence", () => {
    // persist() is the only writer of the catalogue blob, and resetData() is the
    // only remover. Both must refuse while the view renders Convex.
    const persistBody = sliceSource("function persist()", "function hydrate()");
    expect(persistBody).toMatch(/if\(writesLocked\(\)\)return false/);

    const localWriteEntryPoints = [
      "function saveEval(id){",
      "function saveTriage(id){",
      "function shipRequestAsAgent(id){",
      "async function approveImprovement(id,proposalId){",
    ];
    for (const entry of localWriteEntryPoints) {
      const index = appSource.indexOf(entry);
      expect(index, `${entry} not found`).toBeGreaterThan(-1);
      expect(
        appSource.slice(index, index + 420),
        `${entry} is missing a write-lock guard`,
      ).toMatch(/if\(writesLocked\(\)\)return refuseLockedWrite\(\)/);
    }

    for (const entry of ["async function saveNewAgent(){", "async function saveEditAgent(id){", "async function saveNewRequest(){"]) {
      const start = appSource.indexOf(entry);
      const next = appSource.slice(start, appSource.indexOf("\nfunction ", start + entry.length));
      expect(next, `${entry} not found`).toContain("ConvexDirectory");
      expect(next).not.toMatch(/\bpersist\s*\(/);
      expect(next).not.toMatch(/\bagents\.push\s*\(/);
      expect(next).not.toMatch(/\brequests\.push\s*\(/);
    }

    expect(appSource).toMatch(
      /function resetData\(\)\{\s*if\(writesLocked\(\)\)return refuseLockedWrite\(\)/,
    );
    // Exactly two direct localStorage mutations remain: persist and resetData.
    expect(appSource.match(/localStorage\.(setItem|removeItem)\(/g)).toHaveLength(2);
  });

  test("proposal and reject use the Railway overlay without localStorage writes under the lock", () => {
    const proposeBody = sliceSource(
      "async function proposeImprovement(id){",
      "async function approveImprovement(id,proposalId){",
    );
    expect(proposeBody).not.toMatch(
      /if\(writesLocked\(\)\)return refuseLockedWrite\(\)/,
    );
    expect(proposeBody).toMatch(
      /if\(writesLocked\(\)&&setRailwayProposals\(id,proposals\)\)/,
    );

    const rejectBody = sliceSource(
      "async function rejectImprovement(id,proposalId){",
      "// ── RENDER",
    );
    expect(rejectBody).not.toMatch(
      /if\(writesLocked\(\)\)return refuseLockedWrite\(\)/,
    );
    expect(rejectBody).toMatch(
      /if\(writesLocked\(\)&&setRailwayProposals\(id,remaining\)\)/,
    );
    expect(appSource).toContain(
      "Loop-service proposal · Railway file store · pilot-only.",
    );
    expect(appSource).toContain(
      "This reversible proposal is read from Railway evidence and is not governed Convex catalog state.",
    );
    expect(appSource).toMatch(/const prop=pendingProposalsOf\(a\)/);
    // Each defect is decided on its own, so a rejection under the lock replaces
    // the overlay with the survivors rather than clearing the whole set.
    expect(rejectBody).toMatch(
      /const remaining=proposalsOf\(displayed\)\.filter\(p=>p!==target\)/,
    );
  });

  test("approval remains locked and visibly explains the Railway catalog bump", () => {
    const approveBody = sliceSource(
      "async function approveImprovement(id,proposalId){",
      "async function rejectImprovement(id,proposalId){",
    );
    expect(approveBody).toMatch(
      /if\(writesLocked\(\)\)return refuseLockedWrite\(\)/,
    );
    expect(appSource).toContain(
      "Approval stays locked during the pilot because it bumps the Railway catalog version",
    );
    expect(appSource).toContain(
      "const approveLabel=`Record approval → catalog v${bumpVersion(a.version)}`",
    );
    expect(appSource).toContain(
      "lockedControl(approveLabel,APPROVAL_LOCK_REASON,",
    );
  });

  test("the agent page distinguishes maker refusal from a retained verifier rejection", () => {
    expect(appSource).toContain("Maker produced no proposal.");
    expect(appSource).toContain("AUTO-REJECTED BY VERIFIER");
    expect(appSource).toContain("Re-open for human review");
    expect(appSource).toContain("reopenVerifierRejectedImprovement");
    expect(appSource).toContain("Verifier-rejected proposals are retained below.");
  });

  test("the browser directory uses only the three allowlisted Convex mutations", () => {
    expect(clientSource).toMatch(
      /makeFunctionReference\(\s*["']agents:listGovernedDirectoryPilot["']/,
    );
    expect(clientSource).toMatch(/client\.query\(\s*governedDirectoryQuery/);
    expect(clientSource).toMatch(/agents:registerAgent/);
    expect(clientSource).toMatch(/agents:updateAgent/);
    expect(clientSource).toMatch(/requests:createRequest/);
    expect(clientSource).not.toMatch(/api\.imports/);
    expect(appSource).not.toMatch(/client\s*\.\s*mutation\s*\(/);
    expect(appSource).not.toMatch(/ConvexHttpClient/);
  });
});
