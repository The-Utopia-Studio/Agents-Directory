// Server-owned handoff registry, keyed by agent id. Parallel to
// runtimeArtifacts.js: the client picks an agent, the server decides what that
// means. A repo URL, a commit SHA, or a checklist may never arrive from the
// browser.
//
// A prepared-handoff agent is NOT installed and NOT hosted. Its artifact lives
// in someone else's repo, so the only honest export is a BRIEFING: a pinned
// pointer to that artifact plus the engagement terms. A generated skill file
// that instructs the reader to go open the agent is not the agent, and is
// worse than no export.
//
// Entries are validated at module load. A malformed or partial entry throws
// rather than shipping a brief with a hole in it: an unpinned brief cannot
// attribute a returned rating to anything.

const REQUIRED_LISTS = [
  "artifactFiles",
  "setupChecklist",
  "requiredInputs",
  "returnProtocol",
];

/** Reasons the UI shows instead of a generic export. Never a fallback brief. */
export const HANDOFF_UNAVAILABLE =
  "No pinned handoff package is registered for this agent. A briefing needs a " +
  "repo URL, a commit SHA, an artifact file inventory, a setup checklist, a " +
  "pinned prohibited-actions reference, required inputs, and a return protocol.";

function validateEntry(agentId, entry) {
  const fail = (why) => {
    throw new Error(`Handoff registry entry ${agentId} ${why}`);
  };

  if (!entry || typeof entry !== "object") fail("is not an object");
  if (!/^https:\/\/[^\s]+$/.test(String(entry.repoUrl || ""))) {
    fail("needs an https repo URL");
  }
  // A pinned brief means a full commit SHA. A branch name, a short SHA, or a
  // placeholder all silently drift and cannot anchor a returned rating.
  if (!/^[a-f0-9]{40}$/.test(String(entry.commitSha || ""))) {
    fail("needs a full 40-character lowercase commit SHA");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(String(entry.briefVersion || ""))) {
    fail("needs a briefVersion label");
  }
  for (const key of REQUIRED_LISTS) {
    const list = entry[key];
    if (!Array.isArray(list) || !list.length) {
      fail(`needs a non-empty ${key} array`);
    }
  }
  if (
    entry.artifactFiles.some(
      (file) =>
        !String(file?.path || "").trim() ||
        (file.description !== undefined &&
          !String(file.description || "").trim()),
    )
  ) {
    fail("needs a path and any supplied description must be non-blank");
  }
  for (const key of ["setupChecklist", "requiredInputs", "returnProtocol"]) {
    if (entry[key].some((value) => !String(value || "").trim())) {
      fail(`needs non-blank ${key} entries`);
    }
  }
  if (!String(entry.prohibitedActionsReference || "").trim()) {
    fail("needs a prohibitedActionsReference");
  }
  if (
    !entry.artifactFiles.some(
      (file) => file.path === entry.prohibitedActionsReference,
    )
  ) {
    fail("prohibitedActionsReference must name a registered artifact file");
  }
  if (!String(entry.displayName || "").trim()) fail("needs a displayName");
  if (!String(entry.owner || "").trim()) fail("needs an owner");
  if (!String(entry.version || "").trim()) fail("needs a version");
  if (!String(entry.runtime || "").trim()) fail("needs a runtime");
  if (!String(entry.statusIntegrityNote || "").trim()) {
    fail("needs a statusIntegrityNote");
  }
  return entry;
}

function freezeEntry(agentId, entry) {
  validateEntry(agentId, entry);
  return Object.freeze({
    ...entry,
    artifactFiles: Object.freeze(
      entry.artifactFiles.map((file) => Object.freeze({ ...file })),
    ),
    setupChecklist: Object.freeze([...entry.setupChecklist]),
    requiredInputs: Object.freeze([...entry.requiredInputs]),
    returnProtocol: Object.freeze([...entry.returnProtocol]),
  });
}

/**
 * Register ONLY agents whose pinned handoff details are real and confirmed by
 * the agent owner.
 *
 * Registry text should point to source files instead of copying their contents.
 * In particular, prohibited actions belong in pinned AGENT.md, not in a second
 * list here that can drift independently.
 */
const HANDOFF_ARTIFACTS = Object.freeze(
  Object.fromEntries(
    Object.entries({
      A8: {
        repoUrl: "https://github.com/aiden150/ux-qa-agent",
        commitSha: "2a8f2b9562c4d4569c156e2ae7559ab04a54b883",
        briefVersion: "ux-qa-handoff-v0.1.0",
        version: "0.1.0",
        owner: "Aiden Kim",
        displayName: "UX&QA",
        runtime: "Codex",
        artifactFiles: [
          {
            path: "AGENT.md",
            description:
              "core instructions, principles, workflow, finding quality bar, status definitions",
          },
          {
            path: "README.md",
          },
          {
            path: "workflows/ux-qa-round.md",
            description:
              "the 6-phase round: intake, plan, execute, synthesize, handoff, independent retest",
          },
          {
            path: "docs/connectors.md",
            description: "connector authorisation",
          },
          {
            path: "templates/finding.md",
            description: "finding format",
          },
          {
            path: "templates/remediation-handoff.md",
          },
          {
            path: "agent.yaml",
            description: "metadata",
          },
          {
            path: "REGISTRY_FORM.md",
            description: "registration answers",
          },
        ],
        setupChecklist: [
          "product owner and QA owner named",
          "approved non-production URL + build identifier",
          "scope: journeys, surfaces, roles, devices, known findings — and what is OUT",
          "personas and expected permissions, including what each role must NOT do",
          "dedicated non-production test accounts via an approved secret-sharing method (never in prompts, reports, screenshots or Git)",
          "test data: fixtures, account states, run IDs, reset/cleanup/replay, freshness thresholds",
          "requirements and acceptance criteria (gaps recorded as assumption/question/blocker)",
          "safety boundaries: the exact point the agent must stop",
          "evidence handling: where artefacts may be stored, what must be redacted",
          "authorized connectors — availability is NOT authorisation",
          "execution approval: scenario matrix reviewed BEFORE browser execution",
          "handoff and retest: who may mark a build Ready for QA; product-team internal verification stays separate from independent UX/QA verification",
        ],
        prohibitedActionsReference: "AGENT.md",
        requiredInputs: [
          "The completed 12-item setup checklist above.",
        ],
        returnProtocol: [
          "issue register (severity-ranked, evidence per finding)",
          "scenario matrix as executed",
          "the commit SHA above",
          "rating + notes",
          "environment and build identifier tested against",
        ],
        statusIntegrityNote:
          'The pinned AGENT.md status vocabulary includes "Not reproducible", with an explicit rule that it must not silently become "Verified".',
      },
    }).map(([agentId, entry]) => [agentId, freezeEntry(agentId, entry)]),
  ),
);

export function hasHandoffArtifact(agentId) {
  return Boolean(HANDOFF_ARTIFACTS[agentId]);
}

/** Shared custody record. Returns a copy; callers must not alias the registry. */
export function getHandoffDescriptor(agentId) {
  const entry = HANDOFF_ARTIFACTS[agentId];
  if (!entry) return null;
  return {
    ...entry,
    artifactFiles: entry.artifactFiles.map((file) => ({ ...file })),
    setupChecklist: [...entry.setupChecklist],
    requiredInputs: [...entry.requiredInputs],
    returnProtocol: [...entry.returnProtocol],
  };
}

function numbered(values) {
  return values.map((value, index) => `${index + 1}. ${value}`).join("\n");
}

function bullets(values) {
  return values.map((value) => `- ${value}`).join("\n");
}

function checkboxes(values) {
  return values.map((value) => `- [ ] ${value}`).join("\n");
}

/**
 * Build the engagement brief. Exported pure so the document can be tested
 * without a registry entry, and so the registry stays the only place a repo or
 * SHA can enter.
 */
export function buildHandoffBriefing(agent, entry) {
  validateEntry(agent.id, entry);
  const pin = `${entry.repoUrl}/tree/${entry.commitSha}`;
  const pinnedFile = (path) =>
    `${entry.repoUrl}/blob/${entry.commitSha}/${path}`;
  const fileInventory = entry.artifactFiles
    .map((file) => {
      // Plain text on purpose. Markdown links look fine in the app but lose
      // their link text when the brief is copied — leaving bare "—" lines and
      // empty bullets for files with no description. The inventory is the
      // pointer to his files; the filename and URL must survive as prose.
      const url = pinnedFile(file.path);
      return file.description
        ? `- ${file.path} — ${url} — ${file.description}`
        : `- ${file.path} — ${url}`;
    })
    .join("\n");

  return `# ${entry.displayName} — engagement brief

**This document is the engagement brief, not the agent.** The agent itself
lives at the pinned repository and commit below. It runs in ${entry.runtime};
there is no endpoint. Nothing here is a runnable or installable copy of it,
and no part of this file should be pasted into a model as though it were the
agent's instructions.

- Agent: ${entry.displayName}
- Owner: ${entry.owner}
- Agent version: ${entry.version}
- Directory display ID: ${agent.id}
- Directory record name: ${agent.name}
- Repository: ${entry.repoUrl}
- Pinned commit: \`${entry.commitSha}\`
- Pinned tree: ${pin}
- Brief version — quote this when returning a result: \`${entry.briefVersion}\`

## Where the agent actually lives

The instruction package is the following set of files at the pinned commit.
These links are authoritative; this brief points to them rather than copying
their contents:

${fileInventory}

Clone or browse the repository at the pinned commit above. Do not run a
different revision and report the result against this brief; if you need a
newer revision, ask the owner for an updated brief.

## Setup checklist — complete before handing over

${checkboxes(entry.setupChecklist)}

## Prohibited actions

The authoritative prohibited actions are in
[\`${entry.prohibitedActionsReference}\`](${pinnedFile(entry.prohibitedActionsReference)})
at the pinned commit. Read and follow that file before execution. They are not
copied into this registry because a second list could drift from the agent.

## Status integrity

${entry.statusIntegrityNote}

## Inputs the agent needs

${bullets(entry.requiredInputs)}

## Returning results

Return all five items below. The commit SHA attributes the result to the
version actually run:

${numbered(entry.returnProtocol)}
`;
}

/** Capability payload for the UI. Never returns a partial or fallback brief. */
export function getHandoffCapability(agent) {
  if (!agent?.usabilityModes?.includes("prepared-handoff")) {
    return { available: false };
  }
  const entry = getHandoffDescriptor(agent.id);
  if (!entry) {
    return { available: false, reason: HANDOFF_UNAVAILABLE };
  }
  return {
    available: true,
    kind: "briefing",
    label: entry.displayName,
    repoUrl: entry.repoUrl,
    commitSha: entry.commitSha,
    shortCommit: entry.commitSha.slice(0, 7),
    briefVersion: entry.briefVersion,
    owner: entry.owner,
    version: entry.version,
    runtime: entry.runtime,
    filename: `${agent.id}-${entry.briefVersion}-${entry.commitSha.slice(0, 7)}-BRIEF.md`,
  };
}

export function loadHandoffBriefing(agent) {
  if (!agent?.usabilityModes?.includes("prepared-handoff")) {
    throw Object.assign(
      new Error("Agent is not available for prepared handoff"),
      { status: 404 },
    );
  }
  const entry = getHandoffDescriptor(agent.id);
  if (!entry) {
    throw Object.assign(new Error(HANDOFF_UNAVAILABLE), { status: 404 });
  }
  return {
    content: buildHandoffBriefing(agent, entry),
    filename: `${agent.id}-${entry.briefVersion}-${entry.commitSha.slice(0, 7)}-BRIEF.md`,
    kind: "briefing",
    repoUrl: entry.repoUrl,
    commitSha: entry.commitSha,
    briefVersion: entry.briefVersion,
  };
}
