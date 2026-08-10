// Machine-sealed Phase 2.5B scope approved on 2026-08-02.
//
// This file contains directory metadata and contract decisions only. It never
// contains run payloads, prompts, source material, feedback text, or an actor.
// The actor is derived inside Convex from the authenticated approver.

export const PHASE25_SOURCE_EXPORT_SHA256 =
  "cf7a313d0dc42d54e6e6567baca0653aa4ac3f5e15dbeed78f1d7c5143b227e1";
export const PHASE25_DRY_RUN_MANIFEST_SHA256 =
  "6fd05ad99abcd5637f267ef88b9496f0b65eb9cda650e0e5f430e9f167bef223";

export const APPROVED_IMPORT_SPEC = {
  schemaVersion: "agents-directory-phase2.5b-approved-import-v1",
  approvedAt: "2026-08-02T18:24:00.000Z",
  scope: ["A7", "A8"],
  sourceExportSha256: PHASE25_SOURCE_EXPORT_SHA256,
  dryRunManifestSha256: PHASE25_DRY_RUN_MANIFEST_SHA256,
  exclusions: {
    agents: ["A1", "A2", "A3", "A4", "A5", "A6"],
    legacyChangelogVersions: "exclude-all",
    legacyEvalHistory: "exclude-all",
    requests: "exclude-all",
    tracesAndFeedback: "defer-to-phase-6",
  },
  imports: {
    A7: {
      displayId: "A7",
      agent: {
        name: "Biocraft single-shot draft",
        tagline:
          "A stateless text-only draft mode inspired by /biocraft. It requires all source material up front and has no Chrome or Drive tools.",
        description:
          "This is not the full /biocraft agent. It makes one Anthropic call with no conversation state, browser tools, Drive tools, or HTML rendering.",
        platform: "Claude",
        status: "Experimental",
        category: "Personal Branding",
        owner: "Sarah",
        initials: "S",
        model: "Claude Sonnet 4.6",
        runner: "native",
        usabilityModes: ["hosted-run", "download-install"],
        invocation: {
          type: "runtime",
          configRef: "server-owned:biocraft-singleshot-v4",
        },
        autonomyLevel: "L1",
        executionContract: {
          inputs: [
            { key: "fellowName", required: true },
            { key: "sourceMaterial", required: true },
            { key: "interviewAnswers", required: false },
          ],
          runnerConfig: [
            { key: "mode", value: "single-shot" },
            {
              key: "artifactLocator",
              value: "server/src/artifacts/biocraft/SKILL.md",
            },
            { key: "artifactVersion", value: "biocraft-singleshot-v4" },
          ],
        },
        evidenceContract: {
          acceptedTypes: ["run", "feedback"],
          requiredReturnArtifact: false,
        },
        outcomeContract: {
          successCriteria: [
            {
              id: "linkedin-about-hook-max-200",
              label: "LinkedIn About hook is 200 characters or fewer",
            },
            {
              id: "linkedin-about-max-2600",
              label: "Full LinkedIn About text is 2,600 characters or fewer",
            },
            {
              id: "linkedin-headline-max-220",
              label: "Suggested LinkedIn headline is 220 characters or fewer",
            },
            {
              id: "spoken-intro-20-to-30-seconds",
              label:
                "Spoken event introduction reads aloud in 20 to 30 seconds",
            },
          ],
          evalSetId: null,
        },
        optimisableUnit: {
          kind: "artifact",
          pointer: "server/src/artifacts/biocraft/SKILL.md",
        },
        guardrails: [
          {
            id: "no-fabricated-or-altered-claims",
            label:
              "Never fabricate or alter a metric, achievement, employer relationship, credential, quote, role, or job title.",
          },
          {
            id: "preserve-company-relationship",
            label:
              "Distinguish work done for a company from founding or owning that company.",
          },
          {
            id: "preserve-role-qualifiers",
            label:
              "Preserve qualifiers such as Intern, Participant, and Apprenticeship.",
          },
          {
            id: "no-em-dash",
            label:
              "Do not use an em dash or a double hyphen as an em-dash substitute.",
          },
          {
            id: "no-emoji-exclamation-hedging-passive",
            label:
              "Do not use emoji, exclamation points, hedging, or unnecessary passive voice.",
          },
          {
            id: "remove-ai-cliches",
            label:
              "Remove AI cliche and these terms on sight: utilize, leverage, facilitate, innovative, robust, seamless, cutting-edge, unlock, elevate, passionate, synergy, game-changer, revolutionize, revolutionary.",
          },
          {
            id: "no-not-x-but-y-framing",
            label: 'Do not use "it is not X, it is Y" contrast framing.',
          },
          {
            id: "no-model-character-count-claims",
            label:
              "Do not report or annotate character counts. The host validates limits; a model-generated count is not evidence.",
          },
          {
            id: "omit-ungrounded-quotes",
            label:
              "If a supplied quote is not grounded clearly enough to attribute, omit it.",
          },
          {
            id: "cta-about-only",
            label:
              "Do not add a CTA to the third-person event introduction. The required CTA belongs only in the LinkedIn About.",
          },
        ],
        skills: ["biocraft", "personal-branding", "copywriting"],
        tools: [],
        context: [
          { label: "Complete fellow source material supplied up front" },
        ],
      },
      version: {
        version: "biocraft-singleshot-v4",
        state: "candidate",
        // Custody limitation (honest): `declaredDigest` is the SHA-256 that
        // identifies the exact imported artifact bytes, and `locator` is a
        // repo-relative path. This is NOT yet a Git commit pin or a canonical
        // artifact-storage location, so the locator alone cannot be trusted to
        // reproduce these bytes later. A real Git pin / canonical storage is a
        // later decision (do not backfill it onto this immutable version).
        artifact: {
          scheme: "git",
          locator: "server/src/artifacts/biocraft/SKILL.md",
          declaredDigest:
            "991cadea10401307215254098644342ccb551f7f498eb64994e328eafdf0b6f9",
          declaredDigestAlgorithm: "sha256",
        },
      },
      release: {
        createProposal: true,
        proposalSummary:
          "Phase 2.5B canonical import of the approved live Biocraft single-shot artifact.",
        approveThroughReviews: true,
      },
    },
    A8: {
      displayId: "A8",
      agent: {
        name: "UX&QA",
        tagline:
          "Independent UX and QA round against an approved non-production build.",
        description:
          "Prepared handoff to Aiden's pinned UX&QA agent. There is no hosted run and no downloadable install package in this directory; the Git commit is a source pin, not an artifact-content digest.",
        platform: "Codex",
        status: "Experimental",
        category: "Design & Product",
        owner: "Aiden Kim",
        initials: "AK",
        model: "—",
        runner: "foreign-runtime-handoff",
        usabilityModes: ["prepared-handoff"],
        autonomyLevel: "L1",
        executionContract: {
          inputs: [
            { key: "completedSetupChecklist", required: true },
            { key: "approvedBuild", required: true },
          ],
          runnerConfig: [
            {
              key: "repoUrl",
              value: "https://github.com/The-Utopia-Studio/ux-qa-agent",
            },
            {
              key: "pinnedGitCommitSha",
              value: "2a8f2b9562c4d4569c156e2ae7559ab04a54b883",
            },
            {
              key: "pinType",
              value: "git-commit-not-content-digest",
            },
          ],
        },
        evidenceContract: {
          acceptedTypes: ["test-report", "manual-attestation", "feedback"],
          requiredReturnArtifact: true,
          returnArtifactKind: "issue register and executed scenario matrix",
        },
        outcomeContract: {
          successCriteria: [
            {
              id: "severity-ranked-evidenced-findings",
              label:
                "Severity-ranked issue register with evidence per finding",
            },
            {
              id: "scenario-matrix-as-executed",
              label: "Scenario matrix returned as executed",
            },
            {
              id: "pinned-commit-attribution",
              label: "Results attributed to the pinned commit SHA",
            },
          ],
          evalSetId: null,
        },
        optimisableUnit: { kind: "not-safely-changeable" },
        guardrails: [
          {
            id: "connector-availability-not-authorisation",
            label: "Do not treat connector availability as authorisation",
          },
          {
            id: "preserve-not-reproducible-status",
            label:
              'Do not silently rewrite "Not reproducible" as "Verified"',
          },
          {
            id: "separate-internal-and-independent-verification",
            label:
              "Product-team internal verification stays separate from independent UX/QA verification",
          },
        ],
        skills: [],
        tools: [],
        context: [],
        repoUrl: "https://github.com/The-Utopia-Studio/ux-qa-agent",
      },
      version: {
        version: "0.1.0",
        state: "draft",
        artifact: null,
        sourcePin: {
          kind: "git-commit",
          repoUrl: "https://github.com/The-Utopia-Studio/ux-qa-agent",
          commitSha: "2a8f2b9562c4d4569c156e2ae7559ab04a54b883",
          isContentDigest: false,
        },
      },
    },
  },
} as const;

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(object[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// The **Approved import-spec digest**: the SHA-256 of the canonical, stable
// import specification, computed as sha256(stableStringify(APPROVED_IMPORT_SPEC)).
// It is NOT the byte hash of the formatted JSON manifest file — that file byte
// hash is `dryRunManifestSha256` / PHASE25_DRY_RUN_MANIFEST_SHA256 above.
// Reformatting the JSON changes the file bytes but not this spec digest.
// Tests bind this value to APPROVED_IMPORT_SPEC so an edited spec cannot deploy
// quietly. The machine argument/field keeps the name `manifestDigest` for
// schema and import-behaviour stability; the human-facing name is
// "Approved import-spec digest".
export const APPROVED_IMPORT_MANIFEST_DIGEST =
  "2da90d8095b37eeca8e91fcf1accf5283c037c5bf5b73f3871d1dc90191e91ac";
