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
          "This is not the full /biocraft agent. It makes one OpenAI Responses call with no conversation state, browser tools, Drive tools, or HTML rendering.",
        platform: "OpenAI",
        status: "Experimental",
        category: "Personal Branding",
        owner: "Sarah",
        initials: "SA",
        model: "gpt-5.6-terra",
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
        repoUrl: "https://github.com/The-Utopia-Studio/utopia-agents/tree/main/biocraft",
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
            { key: "repoUrl", value: "https://github.com/The-Utopia-Studio/ux-qa-agent" },
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
        repoUrl: "https://github.com/The-Utopia-Studio/ux-qa-agent",
      },
      version: {
        version: "0.1.0",
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

// SHA-256(stableStringify(MERGED_REIMPORT_SPEC)); tests bind this literal to
// the exact approved spec so an edited merge cannot execute silently.
//
// Re-sealed for the same reason as APPROVED_IMPORT_MANIFEST_DIGEST: 0c9a7d9
// corrected A7's platform/model here (Claude → OpenAI/gpt-5.6-terra) and did
// not re-bless the seal, so this test has been red since. The spec is correct;
// the constant was stale.
export const MERGED_REIMPORT_MANIFEST_DIGEST =
  "c5e3f344679aa0736fc56fa25c75a89df1c715f62c043993e09fdf40306083f1";

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

export const A7_V8_RELEASE_SPEC = {
  agentDisplayId: "A7",
  priorVersion: "biocraft-singleshot-v7",
  priorArtifactSha256:
    "751912f479d4ca65144e927bb18fe6e6c66c34ab63be557cab24ad28bc77fa26",
  version: {
    version: "biocraft-singleshot-v8",
    state: "candidate",
    artifact: {
      scheme: "git",
      locator: "server/src/artifacts/biocraft/SKILL.md",
      declaredDigest:
        "e1e8a7459606ab61c6ee4802e22437fb9fcba5f1a7d74e43d40d9f79df332ab2",
      declaredDigestAlgorithm: "sha256",
    },
  },
  proposalSummary:
    "Biocraft v8 switches the hosted generator to OpenAI Responses / gpt-5.6-terra and pins runtime_provider/runtime_model in the artifact frontmatter so the digest moves with the model. Traces, ratings, and mechanical scores against v7-on-Sonnet are not comparable to v8-on-Terra.",
} as const;

// SHA-256(stableStringify(A7_V8_RELEASE_SPEC)). A test binds this literal to
// the exact release contract before the approver mutation may create v8.
export const A7_V8_RELEASE_MANIFEST_DIGEST =
  "f5d7905dd44304326eaebc4dca97e2f98c9fb1da6483422ff73a1da488553c7f";

export const A7_V9_RELEASE_SPEC = {
  agentDisplayId: "A7",
  priorVersion: "biocraft-singleshot-v8",
  priorArtifactSha256:
    "e1e8a7459606ab61c6ee4802e22437fb9fcba5f1a7d74e43d40d9f79df332ab2",
  version: {
    version: "biocraft-singleshot-v9",
    state: "candidate",
    artifact: {
      scheme: "git",
      locator: "server/src/artifacts/biocraft/SKILL.md",
      declaredDigest:
        "e229c64f44bcf3b6e8f57ea7dc74c868b7987ddfc7f92379ad4723761fa4314e",
      declaredDigestAlgorithm: "sha256",
    },
  },
  proposalSummary:
    "Biocraft v9 generalises the employer-relationship guardrail: tools, platforms, and events must not be framed as workplaces, and an entity may be named as an employer only when the source describes it as one. Ratings against v8 are not comparable to v9.",
} as const;

// SHA-256(stableStringify(A7_V9_RELEASE_SPEC)). A test binds this literal to
// the exact release contract before the approver mutation may create v9.
export const A7_V9_RELEASE_MANIFEST_DIGEST =
  "ecc2e1b3e6febf0a80d28c9d427f55cb50b9c88bf4847aa8b08c0e29e80b2cc1";

// First release of Biocraft gap-fill as A10. Convex A9 ("Con") stays untouched —
// no priorVersion; the mutation creates the agent + candidate + open proposal.
export const A10_V1_RELEASE_SPEC = {
  agentDisplayId: "A10",
  agent: {
    name: "Biocraft gap-fill",
    tagline:
      "Sarah's interview bank as batched gaps, then a text draft. Paste material; answer only what is still missing.",
    description:
      "Hosted gap-fill mode adapted from /biocraft. Call 1 returns structured gaps against a fixed question bank; Call 2 drafts three labelled text sections. No Chrome, Drive, or HTML file write.",
    platform: "OpenAI",
    status: "Experimental",
    category: "Personal Branding",
    owner: "Sarah",
    initials: "SA",
    model: "gpt-5.6-terra",
    objective:
      "Detect structured gaps against Sarah's fixed interview bank, then draft a LinkedIn About, spoken event introduction, and headline from pasted material plus answers.",
    whenToUse:
      "When creating or updating a fellow's LinkedIn bio from incomplete pasted material that may still need Sarah's interview answers. After drafting, check the LinkedIn About fold on a phone.",
    sop:
      "1. Paste the fellow's name and whatever source material you have (LinkedIn About/headline, pitch or venture notes)\n2. Optionally note anything that must NOT appear\n3. Run gap detection; answer only the returned questions\n4. Review every claim before using the output\n5. Paste the About into LinkedIn and check the fold on a phone",
    outputs: [
      "Structured gaps or draft LinkedIn About",
      "Draft spoken event introduction",
      "Draft suggested headline",
    ],
    runner: "native",
    usabilityModes: ["hosted-run", "download-install"],
    invocation: {
      type: "runtime",
      configRef: "server-owned:biocraft-gapfill-v2",
    },
    autonomyLevel: "L1",
    executionContract: {
      inputs: [
        { key: "fellowName", required: true },
        { key: "sourceMaterial", required: true },
        { key: "exclusions", required: false },
      ],
      runnerConfig: [
        { key: "mode", value: "gap-fill" },
        {
          key: "artifactLocator",
          value: "server/src/artifacts/biocraft-gapfill/SKILL.md",
        },
        { key: "artifactVersion", value: "biocraft-gapfill-v2" },
        { key: "runtimeProvider", value: "openai" },
        { key: "runtimeModel", value: "gpt-5.6-terra" },
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
          label: "Spoken event introduction reads aloud in 20 to 30 seconds",
        },
      ],
      evalSetId: null,
    },
    optimisableUnit: {
      kind: "artifact",
      pointer: "server/src/artifacts/biocraft-gapfill/SKILL.md",
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
      {
        id: "honour-exclusions",
        label:
          "Honour exclusions when supplied; never invent exclusions or treat them as gaps.",
      },
    ],
    skills: ["biocraft", "personal-branding", "copywriting"],
    tools: [],
    context: [
      { label: "Pasted fellow source material" },
      { label: "Gap answers when needed" },
    ],
  },
  version: {
    version: "biocraft-gapfill-v2",
    state: "candidate",
    artifact: {
      scheme: "git",
      locator: "server/src/artifacts/biocraft-gapfill/SKILL.md",
      declaredDigest:
        "2aa5470f9daeccb39f83d609c67618c64992ae4a024a0627fd9a9a928b61f1fd",
      declaredDigestAlgorithm: "sha256",
    },
  },
  proposalSummary:
    "First governed release of Biocraft gap-fill as A10 (Convex A9 / Con stays untouched). Pins biocraft-gapfill-v2 with OpenAI Responses / gpt-5.6-terra via artifact frontmatter and runnerConfig runtimeProvider/runtimeModel.",
} as const;

// SHA-256(stableStringify(A10_V1_RELEASE_SPEC)). A test binds this literal to
// the exact release contract before the approver mutation may create A10.
export const A10_V1_RELEASE_MANIFEST_DIGEST =
  "9399061ab61c71a7ac4603eabb173259baba7fb2cea3e36847f66736533b147e";

export const A10_V3_RELEASE_SPEC = {
  agentDisplayId: "A10",
  priorVersion: "biocraft-gapfill-v2",
  priorArtifactSha256:
    "2aa5470f9daeccb39f83d609c67618c64992ae4a024a0627fd9a9a928b61f1fd",
  version: {
    version: "biocraft-gapfill-v3",
    state: "candidate",
    artifact: {
      scheme: "git",
      locator: "server/src/artifacts/biocraft-gapfill/SKILL.md",
      declaredDigest:
        "8ccee5f24ac47dc16643954020309b85602109ca824a34cb54655bfaabd40fb4",
      declaredDigestAlgorithm: "sha256",
    },
  },
  proposalSummary:
    "Biocraft gap-fill v3 generalises the employer-relationship guardrail (tools/platforms/events are not workplaces; employer framing must be source-grounded) and keeps the mechanical checks block. Convex A9 (Con) stays untouched. Ratings against gapfill-v2 are not comparable to v3.",
} as const;

// SHA-256(stableStringify(A10_V3_RELEASE_SPEC)). A test binds this literal to
// the exact release contract before the approver mutation may create v3.
export const A10_V3_RELEASE_MANIFEST_DIGEST =
  "81db0f635550d3dd94aae5c536121b31fe1c32dc0a7321566b508cdda5613b81";

// ── v10 / gapfill-v4: the SKILL.md edits of 2026-08-16 ───────────────────────
//
// The tier work (scored / named_hit / advisory) and the four widened style
// detectors changed the governed bytes of both artifacts. Convex still holds
// the pre-edit digests, so Run and download answer 409 GOVERNED_RUNTIME_MISMATCH
// until these release.
//
// These are NEW versions, not re-pins. An earlier attempt edited
// A7_V9_RELEASE_SPEC's declaredDigest in place; that is what a version being
// immutable forbids, and executeApprovedA7V9Release would have refused it at
// assertExact. Changed bytes are always a new version chained to the old one.

export const A7_V10_RELEASE_SPEC = {
  agentDisplayId: "A7",
  priorVersion: "biocraft-singleshot-v9",
  priorArtifactSha256:
    "e229c64f44bcf3b6e8f57ea7dc74c868b7987ddfc7f92379ad4723761fa4314e",
  version: {
    version: "biocraft-singleshot-v10",
    state: "candidate",
    artifact: {
      scheme: "git",
      locator: "server/src/artifacts/biocraft/SKILL.md",
      declaredDigest:
        "c1028caa64ef7965ff2ee052f3ac300509ea47e19346ab6c42aa9075aaacd7c1",
      declaredDigestAlgorithm: "sha256",
    },
  },
  proposalSummary:
    "Biocraft v10 makes check tiers first-class (scored / named_hit / advisory) and widens four style detectors that the false-pass matrix defeated: en dash as an em-dash substitute, inflected and near-variant cliches, / as a keyword delimiter, and a non-CTA closing passing on a sentence-initial imperative. checkSetId changes, so no score recorded under v9 is comparable to v10.",
} as const;

// SHA-256(stableStringify(A7_V10_RELEASE_SPEC)). A test binds this literal to
// the exact release contract before the approver mutation may create v10.
export const A7_V10_RELEASE_MANIFEST_DIGEST =
  "f892dad7392ff31657d375d20ee532c1c2a0bcf726af4ed21ec4565ab17cfd18";

export const A10_V4_RELEASE_SPEC = {
  agentDisplayId: "A10",
  priorVersion: "biocraft-gapfill-v3",
  priorArtifactSha256:
    "8ccee5f24ac47dc16643954020309b85602109ca824a34cb54655bfaabd40fb4",
  version: {
    version: "biocraft-gapfill-v4",
    state: "candidate",
    artifact: {
      scheme: "git",
      locator: "server/src/artifacts/biocraft-gapfill/SKILL.md",
      declaredDigest:
        "7a3e5bc0a1531e34d04f33249c2e53c332a1d4f4e3f6fc7f9849242637b0bd11",
      declaredDigestAlgorithm: "sha256",
    },
  },
  proposalSummary:
    "Biocraft gap-fill v4 carries the same tier model and widened style detectors as A7 v10, so both governed artifacts score under one check vocabulary. Convex A9 (Con) stays untouched. checkSetId changes, so no score recorded under gapfill-v3 is comparable to v4.",
} as const;

// SHA-256(stableStringify(A10_V4_RELEASE_SPEC)).
export const A10_V4_RELEASE_MANIFEST_DIGEST =
  "a066599a997a1cbbd7de373e946b9efe44859acc8afdcad26be1b4c3c9c1cd4f";
