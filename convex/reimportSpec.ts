// Approved merged re-import scope, 2026-08-03.
//
// The original browser exports disagreed at field level. This spec is the
// human-approved resolution, not a last-writer-wins merge. It contains only
// directory metadata and stable contract identifiers — never run payloads,
// prompts, source material, feedback, credentials, or an actor.

export const MERGED_REIMPORT_SPEC = {
  schemaVersion: "agents-directory-merged-reimport-v1",
  approvedOn: "2026-08-03",
  scope: ["A7", "A8"],
  sources: {
    safariBrowserExportSha256:
      "cf7a313d0dc42d54e6e6567baca0653aa4ac3f5e15dbeed78f1d7c5143b227e1",
    chromeBrowserExportSha256:
      "ad16cd62e51634fb86b218c7b6725f2daf87343b3b4d3dcae0b6d334ed794d0f",
    authoredA8RecordSha256:
      "065a3a6aa254848a9d555499fb793b9076e7fc7afaa26c536e0cf3b15e983167",
    authoredA8Basis: "Aiden agent.yaml and REGISTRY_FORM.md at commit 2a8f2b9",
  },
  fieldSources: {
    A7: {
      name: "both-browser-exports",
      tagline: "both-browser-exports",
      description: "both-browser-exports",
      platform: "both-browser-exports",
      status: "both-browser-exports",
      category: "safari-browser-export (human-selected)",
      owner: "both-browser-exports",
      initials: "safari-browser-export (human-selected)",
      model: "both-browser-exports",
      objective: "both-browser-exports",
      whenToUse: "both-browser-exports",
      sop: "both-browser-exports",
      outputs: "both-browser-exports",
      contracts: "approved-existing-governed-mapping",
      guardrails: "repo-owned-v5-artifact",
      repoUrl: "chrome-browser-export (human-selected)",
      version: "repo-owned-v5-artifact",
    },
    A8: {
      platform: "both-browser-exports (human-selected Codex)",
      name: "authored-a8-record (human-selected)",
      tagline: "authored-a8-record (human-selected)",
      description: "authored-a8-record (human-selected)",
      objective: "authored-a8-record (human-selected)",
      whenToUse: "authored-a8-record (human-selected)",
      sop: "authored-a8-record (human-selected)",
      executionInputs: "authored-a8-record (human-selected)",
      outputs: "authored-a8-record (human-selected)",
      skills: "authored-a8-record (human-selected)",
      tools: "authored-a8-record (human-selected)",
      context: "authored-a8-record (human-selected)",
      successCriteria: "authored-a8-record (human-selected)",
      guardrails: "authored-a8-record (human-selected)",
      sourcePin: "approved-existing-governed-mapping",
      model: "human-selected absent",
    },
  },
  imports: {
    A7: {
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
        initials: "SA",
        model: "Claude Sonnet 4.6",
        objective:
          "Draft a LinkedIn About bio, spoken event introduction, and headline from complete source material supplied in one request.",
        whenToUse:
          "When creating or updating a fellow's LinkedIn bio, spoken event introduction, or headline from complete supplied material. After drafting, check the LinkedIn About fold on a phone and refresh the bio every 2–3 months.",
        sop:
          "1. Gather the fellow's name, source material, achievements, mission, skills, contact preference, and exclusions before starting\n2. Paste everything into the single source-material field\n3. Run one text-only draft\n4. Review every claim before using the output\n5. Paste the About into LinkedIn and check the fold on a phone; the hook should fit before “See more”\n6. Set a reminder to refresh the bio in 2–3 months",
        outputs: [
          "Draft LinkedIn About bio",
          "Draft spoken event introduction",
          "Draft suggested headline",
        ],
        runner: "native",
        usabilityModes: ["hosted-run", "download-install"],
        invocation: {
          type: "runtime",
          configRef: "server-owned:biocraft-singleshot-v5",
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
            { key: "artifactVersion", value: "biocraft-singleshot-v5" },
          ],
        },
        evidenceContract: {
          acceptedTypes: ["run", "feedback"],
          requiredReturnArtifact: false,
        },
        outcomeContract: {
          successCriteria: [
            { id: "linkedin-about-hook-max-200", label: "LinkedIn About hook is 200 characters or fewer" },
            { id: "linkedin-about-max-2600", label: "Full LinkedIn About text is 2,600 characters or fewer" },
            { id: "linkedin-headline-max-220", label: "Suggested LinkedIn headline is 220 characters or fewer" },
            { id: "spoken-intro-20-to-30-seconds", label: "Spoken event introduction reads aloud in 20 to 30 seconds" },
          ],
          evalSetId: null,
        },
        optimisableUnit: { kind: "artifact", pointer: "server/src/artifacts/biocraft/SKILL.md" },
        guardrails: [
          { id: "no-fabricated-or-altered-claims", label: "Never fabricate or alter a metric, achievement, employer relationship, credential, quote, role, or job title." },
          { id: "preserve-company-relationship", label: "Distinguish work done for a company from founding or owning that company." },
          { id: "preserve-role-qualifiers", label: "Preserve qualifiers such as Intern, Participant, and Apprenticeship." },
          { id: "no-em-dash", label: "Do not use an em dash or a double hyphen as an em-dash substitute." },
          { id: "no-emoji-exclamation-hedging-passive", label: "Do not use emoji, exclamation points, hedging, or unnecessary passive voice." },
          { id: "remove-ai-cliches", label: "Remove AI cliche and these terms on sight: utilize, leverage, facilitate, innovative, robust, seamless, cutting-edge, unlock, elevate, passionate, synergy, game-changer, revolutionize, revolutionary." },
          { id: "no-not-x-but-y-framing", label: 'Do not use "it is not X, it is Y" contrast framing.' },
          { id: "no-model-character-count-claims", label: "Do not report or annotate character counts. The host validates limits; a model-generated count is not evidence." },
          { id: "omit-ungrounded-quotes", label: "If a supplied quote is not grounded clearly enough to attribute, omit it." },
          { id: "cta-about-only", label: "Do not add a CTA to the third-person event introduction. The required CTA belongs only in the LinkedIn About." },
        ],
        skills: ["biocraft", "personal-branding", "copywriting"],
        tools: [],
        context: [{ label: "Complete fellow source material supplied up front" }],
        repoUrl: "https://github.com/haniyahumair19/utopia-agents/tree/main/biocraft",
      },
      version: {
        version: "biocraft-singleshot-v5",
        state: "candidate",
        artifact: {
          scheme: "git",
          locator: "server/src/artifacts/biocraft/SKILL.md",
          declaredDigest: "c5cc1a587a10deb6fb1b2ee73fed0c31fcad96fa12ed58bc5907544e408df92b",
          declaredDigestAlgorithm: "sha256",
        },
      },
      release: {
        proposalSummary:
          "Approved merged re-import: Biocraft v5 widens delimiter-separated keyword-run checks to every generated section. Ratings against v4 are not comparable to v5.",
      },
    },
    A8: {
      agent: {
        name: "UX&QA Agent",
        tagline: "Evidence-driven UX/QA for authenticated web products: personas, breakpoints, data states, permissions",
        description:
          "Evidence-driven UX/UI quality assurance for teams validating authenticated web products across user journeys, personas, responsive breakpoints, data states, and role permissions. Runs in Codex against a non-production environment with dedicated test accounts. Produces a scenario matrix for human approval before execution, then captures screenshot evidence and a severity-ranked issue register. Independent regression retest stays separate from the product team's own verification.",
        platform: "Codex",
        status: "Experimental",
        category: "Design & Product",
        owner: "Aiden Kim",
        initials: "AK",
        objective: "Produce evidence-based UX/QA verification of a web product before release or after remediation.",
        whenToUse: "When a team needs evidence-based UX/UI testing of a web product before release or after remediation, especially for authenticated journeys, multiple roles, responsive layouts, data states, and workflow persistence.",
        sop: "1. Open the agent in Codex or the approved Studio OS runtime.\n2. Provide the non-production product URL.\n3. Provide the test scope, personas, role expectations, and acceptance criteria.\n4. Provide dedicated test accounts through an approved secret-sharing method or open an authenticated browser session.\n5. Identify test fixtures, reset instructions, and actions the agent must not complete.\n6. Review and approve the proposed scenario matrix.\n7. Let the agent execute the journeys and capture evidence.\n8. Review the issue register and send the remediation handoff to the product owner.\n9. When the product owner returns a Ready for QA build, ask the agent to run an independent regression retest.\n10. Publish the final Verified, Reopened, and Blocked results.",
        outputs: ["UX-QA test plan", "scenario matrix", "screenshot evidence", "severity-ranked issue register", "engineering remediation handoff", "regression verification report"],
        runner: "foreign-runtime-handoff",
        usabilityModes: ["prepared-handoff"],
        autonomyLevel: "L1",
        executionContract: {
          inputs: [
            { key: "testingEnvironmentUrl", required: true },
            { key: "testScopeAndAcceptanceCriteria", required: true },
            { key: "personasAndRoleExpectations", required: true },
            { key: "dedicatedTestAccountsOrAuthenticatedBrowserSession", required: true },
            { key: "testFixturesAndResetInstructions", required: true },
            { key: "prohibitedOrHighRiskActions", required: true },
          ],
          runnerConfig: [
            { key: "repoUrl", value: "https://github.com/aiden150/ux-qa-agent" },
            { key: "pinnedGitCommitSha", value: "2a8f2b9562c4d4569c156e2ae7559ab04a54b883" },
            { key: "pinType", value: "git-commit-not-content-digest" },
          ],
        },
        evidenceContract: {
          acceptedTypes: ["test-report", "manual-attestation", "feedback"],
          requiredReturnArtifact: true,
          returnArtifactKind: "issue register and executed scenario matrix",
        },
        outcomeContract: {
          successCriteria: [
            { id: "scenario-matrix-human-approved", label: "Scenario matrix reviewed and approved by a human before any execution" },
            { id: "severity-ranked-evidenced-findings", label: "Issue register is severity-ranked and every finding carries evidence" },
            { id: "backend-persistence-proven", label: "Backend persistence proven by API or subsequent-state evidence, not a screenshot" },
            { id: "independent-regression-retest", label: "Regression retest is run independently of the product team's own verification" },
            { id: "scenario-results-published", label: "Verified, Reopened and Blocked results published per scenario" },
          ],
          evalSetId: null,
        },
        optimisableUnit: { kind: "not-safely-changeable" },
        guardrails: [
          { id: "no-production-testing-or-mutation", label: "Never test against production or mutate production data" },
          { id: "no-real-commercial-submissions", label: "No real payments, purchases, refunds, bookings or order submissions" },
          { id: "no-real-external-system-submissions", label: "No records submitted to real external systems" },
          { id: "no-real-communications", label: "No real email, SMS, invitations, alerts, notifications or Slack messages" },
          { id: "no-publishing-or-customer-facing-changes", label: "No publishing or customer-facing changes" },
          { id: "no-destructive-record-actions", label: "No deleting, archiving, cancelling, revoking or overwriting non-disposable records" },
          { id: "no-security-or-access-control-changes", label: "No changes to membership, roles, permissions, authentication or security settings" },
          { id: "no-credential-handling", label: "Never create, rotate, expose, store or transmit credentials or tokens" },
          { id: "no-sensitive-data-in-artifacts", label: "No credentials or customer data in screenshots, reports, prompts, logs or Git" },
          { id: "no-security-control-bypass", label: "No bypassing authentication, CAPTCHA, rate limits, paywalls or security controls" },
          { id: "test-accounts-only", label: "No impersonating real users or using personal accounts where test accounts are required" },
          { id: "hidden-control-not-authorisation-proof", label: "A hidden control is not proof that backend authorization is enforced" },
          { id: "ui-success-not-persistence-proof", label: "A screenshot, toast or success message is not proof that data persisted" },
          { id: "no-unverified-findings", label: "A finding is not Verified on a developer statement or internal test result alone" },
          { id: "preserve-reproduction-conditions", label: "Do not change the original reproduction conditions and then claim a regression is fixed" },
          { id: "no-false-multi-agent-claim", label: "Do not describe this as a parallel multi-agent system unless multiple agents actually ran" },
          { id: "preserve-not-reproducible-status", label: "Not reproducible must never silently become Verified" },
        ],
        skills: ["scenario matrix design", "persona and permission testing", "responsive breakpoint testing", "severity ranking", "evidence capture", "regression verification"],
        tools: [
          { label: "Browser (authenticated app under test)" },
          { label: "8090" },
          { label: "GitHub" },
          { label: "Linear (requires separate approval)" },
          { label: "Slack (requires separate approval)" },
          { label: "Figma (requires separate approval)" },
          { label: "Google Drive (requires separate approval)" },
          { label: "Vercel report dashboard (requires separate approval)" },
        ],
        context: [
          { label: "test scope and acceptance criteria" },
          { label: "personas and expected permissions" },
          { label: "test fixtures and account states" },
          { label: "prior findings and issue register" },
          { label: "reset and replay instructions" },
        ],
        repoUrl: "https://github.com/aiden150/ux-qa-agent",
      },
      version: {
        version: "0.1.0",
        sourcePin: {
          kind: "git-commit",
          repoUrl: "https://github.com/aiden150/ux-qa-agent",
          commitSha: "2a8f2b9562c4d4569c156e2ae7559ab04a54b883",
          isContentDigest: false,
        },
      },
    },
  },
} as const;

// SHA-256(stableStringify(MERGED_REIMPORT_SPEC)); tests bind this literal to
// the exact approved spec so an edited merge cannot execute silently.
export const MERGED_REIMPORT_MANIFEST_DIGEST =
  "23b04a0348e35976bdae5d7354c2524932aa8ede04edcf34aa249b57dbcae48d";

export const A7_V6_RELEASE_SPEC = {
  agentDisplayId: "A7",
  priorVersion: "biocraft-singleshot-v5",
  priorArtifactSha256:
    "c5cc1a587a10deb6fb1b2ee73fed0c31fcad96fa12ed58bc5907544e408df92b",
  version: {
    version: "biocraft-singleshot-v6",
    state: "candidate",
    artifact: {
      scheme: "git",
      locator: "server/src/artifacts/biocraft/SKILL.md",
      declaredDigest:
        "a8c08f4e98cd88f018764754eda760a20113e6fcf8a3362a192254b6bca81a10",
      declaredDigestAlgorithm: "sha256",
    },
  },
  proposalSummary:
    "Biocraft v6 corrects mechanical-check scope and CTA detection, and registers em-dash and multi-word AI-cliche checks. Ratings against v5 are not comparable to v6.",
} as const;

// SHA-256(stableStringify(A7_V6_RELEASE_SPEC)). A test binds this literal to
// the exact release contract before the approver mutation may create v6.
export const A7_V6_RELEASE_MANIFEST_DIGEST =
  "4bcac2ca329e4b91bc54308dffce9db3d5c283a1b4b202407325638499592841";

export const A7_V7_RELEASE_SPEC = {
  agentDisplayId: "A7",
  priorVersion: "biocraft-singleshot-v6",
  priorArtifactSha256:
    "a8c08f4e98cd88f018764754eda760a20113e6fcf8a3362a192254b6bca81a10",
  version: {
    version: "biocraft-singleshot-v7",
    state: "candidate",
    artifact: {
      scheme: "git",
      locator: "server/src/artifacts/biocraft/SKILL.md",
      declaredDigest:
        "751912f479d4ca65144e927bb18fe6e6c66c34ab63be557cab24ad28bc77fa26",
      declaredDigestAlgorithm: "sha256",
    },
  },
  proposalSummary:
    "Biocraft v7 registers About/headline length checks and adds an explicit relationship-and-title verification pass to the final cut. Ratings against v6 are not comparable to v7.",
} as const;

// SHA-256(stableStringify(A7_V7_RELEASE_SPEC)). A test binds this literal to
// the exact release contract before the approver mutation may create v7.
export const A7_V7_RELEASE_MANIFEST_DIGEST =
  "5e660d7c33d6786f312297bf34fa9571380005d4ea8ae06d7f171c2e727fdf82";
