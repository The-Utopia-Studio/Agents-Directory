// Phase 2.5A canonical import manifest.
//
// This is intentionally a selector and classifier, not an importer. It accepts
// the already-sanitized Phase 2 export and emits references, fixed reasons, and
// human questions. It never carries source record data into the manifest.

export const MANIFEST_SCHEMA_VERSION =
  "agents-directory-phase2.5a-manifest-v1";
export const SOURCE_EXPORT_SCHEMA_VERSION =
  "agents-directory-phase2-export-v1";

const ACTIONS = new Set([
  "import",
  "exclude",
  "requires-human-decision",
]);

function sourceRef(collection, record) {
  return {
    exportCollection: collection,
    source: String(record?.source || "unknown"),
    sourceId: String(record?.sourceId || "unknown"),
    sourcePath: String(record?.sourcePath || "unknown"),
  };
}

function provenance(requiredToImport, reason) {
  return {
    authenticatedApproverMustSupplyOrAttest: requiredToImport,
    supplied: false,
    reason,
  };
}

function absentArtifact() {
  return {
    status: "absent",
    declaredDigest: null,
    declaredDigestAlgorithm: null,
    pinnedGitCommitSha: null,
    locator: null,
    note: "No artifact reference or content digest is present in the export.",
  };
}

function artifactIdentity(reference) {
  const artifact = reference?.data?.artifact;
  if (
    reference?.data?.agentId === "A7" &&
    artifact?.declaredDigestAlgorithm === "sha256" &&
    /^[a-f0-9]{64}$/.test(String(artifact.declaredDigest || ""))
  ) {
    return {
      status: "real-content-digest",
      declaredDigest: artifact.declaredDigest,
      declaredDigestAlgorithm: "sha256",
      pinnedGitCommitSha: null,
      locator: artifact.locator || null,
      note:
        "SHA-256 was computed from the server-owned single-shot artifact bytes.",
    };
  }
  if (
    reference?.data?.agentId === "A8" &&
    /^[a-f0-9]{40}$/.test(String(reference.data.pinnedCommitSha || "")) &&
    !artifact?.declaredDigest
  ) {
    return {
      status: "pinned-git-commit-not-content-digest",
      declaredDigest: null,
      declaredDigestAlgorithm: null,
      pinnedGitCommitSha: reference.data.pinnedCommitSha,
      locator: artifact?.locator || null,
      note:
        "The SHA pins a Git commit. It is not a digest of the agent package bytes and must never populate declaredDigest.",
    };
  }
  if (artifact?.declaredDigest) {
    return {
      status: "declared-only",
      declaredDigest: artifact.declaredDigest,
      declaredDigestAlgorithm: artifact.declaredDigestAlgorithm || null,
      pinnedGitCommitSha: reference?.data?.pinnedCommitSha || null,
      locator: artifact.locator || null,
      note:
        "A digest is declared in the export, but this manifest cannot attest how it was computed.",
    };
  }
  return absentArtifact();
}

function commonAgentDecisions(agentId, artifact) {
  const decisions = [
    {
      field: "canonicalSource",
      question:
        "Approve browser localStorage as canonical metadata instead of the Railway seeded catalogue copy?",
    },
    {
      field: "displayId",
      question:
        `Approve preserving ${agentId}; the current registerAgent mutation allocates display IDs and is not an import path.`,
    },
    {
      field: "runner",
      question:
        "Choose the governed runner value; legacy usability/invocation fields do not decide it automatically.",
    },
    {
      field: "invocation",
      question:
        "Approve an invocation mapping compatible with the chosen runner, or explicitly omit invocation.",
    },
    {
      field: "executionContract",
      question:
        "Define executionContract.inputs[] and executionContract.runnerConfig[] from an authoritative contract.",
    },
    {
      field: "evidenceContract",
      question:
        "Define acceptedTypes[] and requiredReturnArtifact without inferring them from legacy prose.",
    },
    {
      field: "outcomeContract",
      question:
        "Define structured successCriteria[] and decide the initial evalSetId policy; no eval set is imported in this phase.",
    },
    {
      field: "guardrails",
      question:
        "Approve stable IDs and labels for legacy string guardrails.",
    },
    {
      field: "provenance",
      question:
        "An authenticated approver must attest the canonical-source decision and become the import provenance actor.",
    },
    {
      field: "initialVersion",
      question:
        "Choose the initial version label and state; legacy changelog entries are not immutable versions.",
    },
    {
      field: "approvalStatus",
      question:
        "Decide whether the imported version remains draft; no approved release status is inferred.",
    },
  ];
  if (artifact.status === "absent") {
    decisions.push({
      field: "artifactReference",
      question:
        "Decide whether the initial draft legitimately omits an artifact or supply a verified artifact reference and content digest.",
    });
  }
  return decisions;
}

function agentRecord(record, artifactByAgent) {
  const agentId = String(record?.sourceId || "");
  const isBrowser = record?.source === "browser-localStorage";
  const artifact = isBrowser
    ? artifactByAgent.get(agentId) || absentArtifact()
    : absentArtifact();
  const candidate = agentId === "A7" || agentId === "A8";
  const realityDecision =
    agentId >= "A1" && agentId <= "A6"
      ? {
          field: "agentExistence",
          question:
            "Confirm this seed-derived entry is a real, current directory agent rather than demo catalogue data.",
        }
      : {
          field: "agentScope",
          question:
            "Confirm the current directory entry and its stated usability mode are the record intended for canonical import.",
        };

  return {
    manifestRecordId: `agent:${record.source}:${agentId}`,
    recordType: "agent",
    sourceRef: sourceRef("agents", record),
    proposedCanonicalSource: "browser-localStorage",
    action: "requires-human-decision",
    recommendedAction: isBrowser ? "import" : "exclude",
    reason: isBrowser
      ? candidate
        ? `${agentId} is a candidate for canonical import from the richer browser metadata, pending explicit contract, provenance, and version decisions.`
        : `${agentId} browser metadata is richer than the Railway seed, but a human must first confirm this is a real current agent and approve it as canonical.`
      : `Railway ${agentId} is a seeded catalogue copy proposed for exclusion only if a human approves the browser record as canonical; no automatic merge rule is applied.`,
    intendedConvexTargetTable: "agents",
    provenance: provenance(
      true,
      "Legacy owner/requestedBy-style text is not authenticated creator provenance.",
    ),
    artifactIdentity: artifact,
    missingDecisions: [
      realityDecision,
      ...commonAgentDecisions(agentId, artifact),
      ...(agentId === "A7"
        ? [
            {
              field: "artifactAttestation",
              question:
                "Attest that the preserved SHA-256 and locator identify the single-shot artifact intended for the initial draft.",
            },
          ]
        : []),
      ...(agentId === "A8"
        ? [
            {
              field: "preparedHandoff",
              question:
                "Confirm prepared-handoff remains the canonical usability mode without inferring a runner.",
            },
            {
              field: "artifactContentDigest",
              question:
                "Decide whether the draft omits artifactReference or supply a content digest; the pinned Git commit is not declaredDigest.",
            },
          ]
        : []),
    ],
    executable: false,
  };
}

function excludedRecord(collection, record, type, targetTable, reason) {
  return {
    manifestRecordId: `${type}:${record.source}:${record.sourceId}`,
    recordType: type,
    sourceRef: sourceRef(collection, record),
    proposedCanonicalSource: null,
    action: "exclude",
    reason,
    intendedConvexTargetTable: targetTable,
    provenance: provenance(
      false,
      "The record is excluded from Phase 2.5B; provenance would be required if a later approved plan reconsidered it.",
    ),
    artifactIdentity: absentArtifact(),
    missingDecisions: [],
    executable: false,
  };
}

function artifactRecord(record) {
  const agentId = String(record?.data?.agentId || "unknown");
  const artifact = artifactIdentity(record);
  return {
    manifestRecordId: `artifact-version:${agentId}:${record.sourceId}`,
    recordType: "artifact-version-candidate",
    sourceRef: sourceRef("versions", record),
    proposedCanonicalSource: "railway-artifact-registry",
    action: "requires-human-decision",
    recommendedAction: agentId === "A7" ? "import" : "requires-human-decision",
    reason:
      agentId === "A7"
        ? "A7 has a real SHA-256 content digest and is a candidate for an initial draft version, but version state and authenticated provenance remain undecided."
        : "A8 has a pinned Git commit, not an artifact-content digest; it cannot populate declaredDigest without a separate human-approved content identity decision.",
    intendedConvexTargetTable: "agentVersions",
    provenance: provenance(
      true,
      "The initial immutable version must be created by an authenticated import actor after human approval.",
    ),
    artifactIdentity: artifact,
    missingDecisions: [
      {
        field: "agentId",
        question:
          "Resolve the approved canonical agent record to its Convex document ID.",
      },
      {
        field: "versionState",
        question:
          "Choose draft or candidate; no state is inferred from legacy labels.",
      },
      {
        field: "versionLabel",
        question: "Approve the artifact/version label for the immutable row.",
      },
      ...(agentId === "A8"
        ? [
            {
              field: "declaredDigest",
              question:
                "Supply and attest a content digest or approve omitting artifactReference on a draft; do not use the Git commit SHA as the digest.",
            },
          ]
        : []),
    ],
    executable: false,
  };
}

function validateSourceExport(exportData) {
  if (
    !exportData ||
    exportData.schemaVersion !== SOURCE_EXPORT_SCHEMA_VERSION ||
    !exportData.records ||
    typeof exportData.records !== "object"
  ) {
    throw new Error(
      `Expected a ${SOURCE_EXPORT_SCHEMA_VERSION} Phase 2 export`,
    );
  }
}

function assertExpectedAgentSources(records) {
  for (let number = 1; number <= 8; number += 1) {
    const id = `A${number}`;
    const matching = records.filter((row) => row.sourceId === id);
    const sources = new Set(matching.map((row) => row.source));
    if (
      matching.length !== 2 ||
      !sources.has("browser-localStorage") ||
      !sources.has("railway-file-store")
    ) {
      throw new Error(
        `${id} must have exactly one browser and one Railway source record`,
      );
    }
  }
}

export function buildCanonicalImportManifest(
  exportData,
  {
    generatedAt = new Date().toISOString(),
    sourceFileSha256 = null,
    sourceFilename = null,
  } = {},
) {
  validateSourceExport(exportData);
  const agentSources = exportData.records.agents || [];
  assertExpectedAgentSources(agentSources);

  const artifactRows = (exportData.records.versions || []).filter(
    (record) =>
      record?.data?.legacyShape ===
      "artifact-reference-without-version-row",
  );
  const artifactByAgent = new Map(
    artifactRows.map((record) => [
      String(record.data.agentId),
      artifactIdentity(record),
    ]),
  );

  const records = [];
  for (const record of agentSources) {
    records.push(agentRecord(record, artifactByAgent));
  }

  for (const record of exportData.records.versions || []) {
    if (
      record?.data?.legacyShape ===
      "artifact-reference-without-version-row"
    ) {
      records.push(artifactRecord(record));
    } else {
      records.push(
        excludedRecord(
          "versions",
          record,
          "legacy-changelog-version",
          "agentVersions",
          "Excluded: a mutable legacy changelog entry is not an immutable agentVersions snapshot.",
        ),
      );
    }
  }

  for (const record of exportData.records.evals || []) {
    records.push(
      excludedRecord(
        "evals",
        record,
        "legacy-eval",
        "evalResults",
        "Excluded: legacy eval history lacks evalSetId, evalCaseId, agentVersionId, evidenceId, criterion results, guardrail results, and an authenticated evaluator.",
      ),
    );
  }

  for (const record of exportData.records.requests || []) {
    const row = excludedRecord(
      "requests",
      record,
      "legacy-request",
      "requests",
      "Excluded by default: requestedBy is display text, not authenticated creator provenance. Reconsider only if a human supplies authoritative creator provenance.",
    );
    row.provenance = provenance(
      true,
      "Authoritative creator provenance is required to change this record from exclude to import.",
    );
    records.push(row);
  }

  for (const record of exportData.records.evidence || []) {
    const kind =
      record?.data?.evidenceKind === "feedback"
        ? "legacy-feedback"
        : "legacy-trace";
    const row = excludedRecord(
      "evidence",
      record,
      kind,
      "evidence",
      "Excluded from Phase 2.5: all trace and feedback evidence import remains deferred to Phase 6.",
    );
    row.provenance = provenance(
      true,
      "A later Phase 6 evidence import must resolve authenticated run/evaluator provenance.",
    );
    records.push(row);
  }

  for (const record of exportData.records.proposals || []) {
    records.push(
      excludedRecord(
        "proposals",
        record,
        "legacy-proposal",
        "proposals",
        "Excluded: no legacy proposal may become a governed proposal without an approved candidate version and authenticated provenance.",
      ),
    );
  }
  for (const record of exportData.records.reviewHistory || []) {
    records.push(
      excludedRecord(
        "reviewHistory",
        record,
        "legacy-review",
        "reviewEvents",
        "Excluded: no legacy review may become an append-only review event without a governed proposal and authenticated actor.",
      ),
    );
  }

  for (const record of records) {
    if (!ACTIONS.has(record.action)) {
      throw new Error(`Invalid manifest action ${record.action}`);
    }
  }

  const actionCounts = { import: 0, exclude: 0, "requires-human-decision": 0 };
  const typeCounts = {};
  for (const record of records) {
    actionCounts[record.action] += 1;
    typeCounts[record.recordType] = (typeCounts[record.recordType] || 0) + 1;
  }

  const unresolved = records.filter(
    (record) => record.action === "requires-human-decision",
  );

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt,
    mode: "dry-run-only",
    executable: false,
    sourceExport: {
      schemaVersion: exportData.schemaVersion,
      generatedAt: exportData.generatedAt || null,
      filename: sourceFilename,
      fileSha256: sourceFileSha256,
      embeddedSourceRecords: false,
    },
    policy: {
      phase: "2.5A",
      nextPhase: "2.5B requires a separately approved manifest",
      sourceWrites: false,
      convexMutations: false,
      railwayWrites: false,
      localStorageWrites: false,
      rawPayloadsIncluded: false,
      feedbackTextIncluded: false,
      personalSourceMaterialIncluded: false,
      automaticMergeRules: false,
    },
    summary: {
      totalRecords: records.length,
      actionCounts,
      typeCounts,
      unresolvedHumanDecisions: unresolved.length,
    },
    records,
    requiredHumanApprovals: [
      "Approve or reject browser localStorage as canonical metadata for each A1–A8 record; Railway copies are not auto-merged.",
      "Confirm A1–A6 are real current directory agents before any import.",
      "Approve required runner, invocation, execution, evidence, outcome, guardrail, version, and provenance decisions separately for each imported agent.",
      "Attest A7's preserved SHA-256 as the real single-shot artifact identity and approve its locator/version state.",
      "Approve A8 as prepared-handoff and decide artifact treatment while keeping its Git commit SHA distinct from a content digest.",
      "Either keep all legacy eval and changelog rows excluded or approve a separate governed reconstruction process; this manifest does not reconstruct them.",
      "Either keep requests excluded or supply authoritative authenticated creator provenance record by record.",
      "Keep traces and feedback excluded until the separate Phase 6 evidence import.",
      "Name the authenticated import actor who will attest provenance during Phase 2.5B.",
    ],
  };
}

export function buildExecutableImportPlan(manifest) {
  const unresolved = (manifest?.records || []).filter(
    (record) => record.action === "requires-human-decision",
  );
  if (unresolved.length) {
    const error = new Error(
      `Import plan refused: ${unresolved.length} record(s) require human decision`,
    );
    error.code = "HUMAN_DECISION_REQUIRED";
    throw error;
  }
  if (manifest?.mode === "dry-run-only" || manifest?.executable !== true) {
    const error = new Error(
      "Import plan refused: Phase 2.5A manifests are dry-run-only",
    );
    error.code = "DRY_RUN_ONLY";
    throw error;
  }
  return (manifest.records || []).filter(
    (record) => record.action === "import",
  );
}
