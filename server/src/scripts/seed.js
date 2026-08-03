// Seed the store with the catalogue agents. Legacy trace fixtures remain
// exported for offline tests, but production startup never writes traces.
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { createStore } from "../core/store.js";
import { backfillStoredUsabilityModes } from "../core/usabilityModes.js";
import { hasHandoffArtifact } from "../handoff/handoffArtifacts.js";
import { hasRuntimeArtifact } from "../invoke/runtimeArtifacts.js";

export const SEED_AGENTS = [
  { id: "A1", name: "LinkedIn Auditor", objective: "Prioritized, voice-preserving profile fixes, same-day.", version: "1.2",
    prompt: "You audit LinkedIn profiles and suggest prioritized fixes, preserving the person's voice.",
    usabilityModes: ["download-install"],
    skills: ["personal-branding", "copywriting"], tools: ["LinkedIn (scrape)"], context: ["Fellow profile", "Branding playbook"],
    evalHistory: [{ date: "2026-07-10", status: "Performing well", score: 81, notes: "Voice examples helped.", knownIssues: "Struggles with non-English profiles." }],
    changelog: [{ version: "1.2", date: "2026-07-10", note: "Added few-shot voice examples." }], proposedImprovements: [] },
  { id: "A2", name: "Bio Generator", objective: "Three on-voice bio options a fellow ships with light edits.", version: "1.0",
    prompt: "Write three SEO-optimized LinkedIn bios with CTAs, matching the fellow's voice.",
    skills: ["copywriting", "seo-writing"], tools: [], context: ["Fellow bio", "Voice glossary"],
    invocation: { type: "mock" },
    usabilityModes: ["hosted-run", "download-install"],
    autonomyLevel: "L1",
    goldenCases: [
      { input: "Founder bio, casual voice, 2 sample sentences", expected: "3 variants, first-person, ≤1 CTA, no buzzwords", rule: "voice-match ≥4/5 AND no banned buzzword", source: "fellow:sarah/bio-v1" },
      { input: "No voice samples provided", expected: "Agent asks for 2 anchor sentences before generating", rule: "must not generate without anchors", source: "incident 2026-07-08" },
    ],
    failureClasses: [
      { class: "voice mismatch", acceptableRate: "<10%", guardrail: "require ≥2 voice-anchor sentences" },
      { class: "aggressive CTA", acceptableRate: "0%", guardrail: "score CTA against confident-not-pushy rubric" },
    ],
    costPerOutcome: { target: 0.03 },
    evalHistory: [{ date: "2026-07-08", status: "Needs improvement", score: 58, notes: "Voice matching inconsistent.", knownIssues: "Generic corporate language without strong examples; CTAs too aggressive." }],
    changelog: [{ version: "1.0", date: "2026-06-30", note: "Initial build." }], proposedImprovements: [] },
  { id: "A3", name: "Post Suggester", objective: "5–10 on-trend post drafts a fellow can edit and publish.", version: "1.1",
    prompt: "Generate LinkedIn post drafts with hooks and CTAs from trending topics.",
    usabilityModes: ["download-install"],
    skills: ["social-content", "trend-research"], tools: ["Web search"], context: ["Industry", "News feed"],
    evalHistory: [{ date: "2026-07-12", status: "Performing well", score: 78, notes: "Strong hooks.", knownIssues: "Occasionally outdated trends." }],
    changelog: [{ version: "1.1", date: "2026-07-01", note: "Tightened recency window." }], proposedImprovements: [] },
  { id: "A4", name: "Marketing Scout", objective: "Weekly high-signal marketing tasks from internal chatter.", version: "0.3",
    prompt: "Mine Slack for marketing task and content opportunities; cite source threads.",
    usabilityModes: ["download-install"],
    skills: ["insight-synthesis"], tools: ["Slack (MCP)"], context: ["Approved channels"],
    evalHistory: [], changelog: [{ version: "0.3", date: "2026-07-09", note: "Early testing." }], proposedImprovements: [] },
  { id: "A5", name: "Design Agent", objective: "Design-system components + QA matching the ceramic system.", version: "0.2",
    prompt: "Generate design-system components and QA against ceramic tokens via MCP.",
    usabilityModes: ["download-install"],
    skills: ["design-review"], tools: ["Figma (MCP)", "GitHub (MCP)"], context: ["Ceramic tokens"],
    evalHistory: [], changelog: [{ version: "0.2", date: "2026-07-06", note: "Wiring MCP." }], proposedImprovements: [] },
  { id: "A6", name: "Research Assistant", objective: "A brief becomes a sourced findings doc for a call.", version: "1.0",
    prompt: "Turn a research brief into a structured, cited findings document.",
    usabilityModes: ["download-install"],
    skills: ["company-research", "competitive-analysis"], tools: ["Web search"], context: ["Brief", "Market notes"],
    evalHistory: [{ date: "2026-07-05", status: "Performing well", score: 84, notes: "Strong synthesis.", knownIssues: "Misses niche sources." }],
    changelog: [{ version: "1.0", date: "2026-06-28", note: "Initial build." }], proposedImprovements: [] },
  { id: "A7", name: "Biocraft single-shot draft", objective: "Draft a LinkedIn About bio, spoken event introduction, and headline from complete source material supplied in one request.", version: "1.0",
    successCriteria: [
      "LinkedIn About hook is 200 characters or fewer",
      "Full LinkedIn About text is 2,600 characters or fewer",
      "Suggested LinkedIn headline is 220 characters or fewer",
      "Spoken event introduction reads aloud in 20 to 30 seconds",
    ],
    guardrails: [
      "Never fabricate or alter a metric, achievement, employer relationship, credential, quote, role, or job title.",
      "Distinguish work done for a company from founding or owning that company.",
      "Preserve qualifiers such as Intern, Participant, and Apprenticeship.",
      "Do not use an em dash or a double hyphen as an em-dash substitute.",
      "Do not use emoji, exclamation points, hedging, or unnecessary passive voice.",
      "Remove AI cliche and these terms on sight: utilize, leverage, facilitate, innovative, robust, seamless, cutting-edge, unlock, elevate, passionate, synergy, game-changer, revolutionize, revolutionary.",
      "Do not use \"it is not X, it is Y\" contrast framing.",
      "Do not report or annotate character counts. The host validates limits; a model-generated count is not evidence.",
      "If a supplied quote is not grounded clearly enough to attribute, omit it.",
      "Do not add a CTA to the third-person event introduction. The required CTA belongs only in the LinkedIn About.",
    ],
    invocation: { type: "runtime", mode: "single-shot", artifact: "biocraft/SKILL.md" },
    usabilityModes: ["hosted-run", "download-install"],
    when: "When creating or updating a fellow's LinkedIn bio, spoken event introduction, or headline from complete supplied material. After drafting, check the LinkedIn About fold on a phone and refresh the bio every 2–3 months.",
    sop: "1. Gather the fellow's name, source material, achievements, mission, skills, contact preference, and exclusions before starting\n2. Paste everything into the single source-material field\n3. Run one text-only draft\n4. Review every claim before using the output\n5. Paste the About into LinkedIn and check the fold on a phone; the hook should fit before “See more”\n6. Set a reminder to refresh the bio in 2–3 months",
    skills: ["biocraft", "personal-branding", "copywriting"], tools: [], context: ["Complete fellow source material supplied up front"],
    evalHistory: [], changelog: [{ version: "1.0", date: "2026-08-01", note: "Stateless single-shot draft mode using a server-owned SKILL.md." }], proposedImprovements: [] },
  // A8 is prepared-handoff: the agent lives in Aiden's repo and runs in Codex,
  // so this record is a catalogue entry, not a copy of the instructions. The
  // engagement terms (checklist, prohibited actions, return protocol) live in
  // the handoff registry and point at the pinned commit rather than restating
  // it. Deliberately no hosted-run and no download-install: there is no
  // server-owned artifact to run or install.
  { id: "A8", name: "UX&QA", objective: "Run an independent UX and QA round against an approved non-production build and return a severity-ranked issue register with evidence per finding.", version: "0.1.0",
    invocation: { type: "link" },
    usabilityModes: ["prepared-handoff"],
    repoUrl: "https://github.com/aiden150/ux-qa-agent",
    when: "When a build is marked Ready for QA and needs verification independent of the product team's own testing.",
    sop: "Copy the engagement brief, complete its 12-item setup checklist, then hand over. The brief pins the commit to run and the protocol for returning results.",
    skills: [], tools: [], context: [],
    evalHistory: [], changelog: [{ version: "0.1.0", date: "2026-08-02", note: "Registered as a prepared handoff against a pinned commit." }], proposedImprovements: [] },
];

// Synthetic failing traces for A2 — the loop's raw material.
export const SEED_TRACES = [
  { id: "t_a2_1", agentId: "A2", status: "fail", score: 55, failureReason: "voice mismatch", ts: "2026-07-14T09:00:00Z", output: "As a results-driven professional leveraging synergies..." },
  { id: "t_a2_2", agentId: "A2", status: "fail", score: 61, failureReason: "voice mismatch", ts: "2026-07-14T11:00:00Z", output: "Passionate thought leader driving impact at scale..." },
  { id: "t_a2_3", agentId: "A2", status: "fail", score: 48, failureReason: "aggressive CTA", ts: "2026-07-15T10:00:00Z", output: "DM me NOW to 10x your network — don't miss out!" },
  { id: "t_a2_4", agentId: "A2", status: "ok", score: 82, failureReason: null, ts: "2026-07-15T14:00:00Z", output: "I help early founders tell clearer stories." },
  { id: "t_a2_5", agentId: "A2", status: "fail", score: 59, failureReason: "voice mismatch", ts: "2026-07-16T08:00:00Z", output: "Dynamic, forward-thinking innovator..." },
];

// seedIfEmpty is a first-boot path only: it will not touch a store that already
// has records, so a newly registered agent never reaches an existing deploy.
// An agent whose artifact the server owns must exist in the store regardless,
// or its capability endpoint 404s and the UI can offer nothing — that is how A8
// shipped a registered handoff brief with no way to reach it. Idempotent: it
// adds what is absent and never overwrites what an editor has changed.
async function upsertServerOwnedAgents(store) {
  const added = [];
  for (const agent of SEED_AGENTS) {
    const serverOwned =
      (await hasRuntimeArtifact(agent.id)) || hasHandoffArtifact(agent.id);
    if (!serverOwned) continue;
    if (await store.get("agents", agent.id)) continue;
    await store.put("agents", agent);
    added.push(agent.id);
  }
  return added;
}

export async function seed(store) {
  await store.ready();
  const a = await store.seedIfEmpty("agents", SEED_AGENTS);
  const serverOwnedAgentsAdded = await upsertServerOwnedAgents(store);
  await syncA7DisplayContract(store);
  const usabilityModesBackfilled = await backfillStoredUsabilityModes(store);
  return { agents: a, serverOwnedAgentsAdded, usabilityModesBackfilled };
}

// The Biocraft artifact owns these displayed contract fields. Refresh them on
// boot so a stored record cannot silently show v2's 300-character rule or omit
// a guardrail while the runtime executes v3.
async function syncA7DisplayContract(store) {
  const seededA7 = SEED_AGENTS.find((agent) => agent.id === "A7");
  const storedA7 = await store.get("agents", "A7");
  if (!storedA7) return;
  const artifactDisplayFields = [
    "name",
    "objective",
    "successCriteria",
    "guardrails",
    "invocation",
    "usabilityModes",
    "when",
    "sop",
    "skills",
    "tools",
    "context",
  ];
  const needsSync = artifactDisplayFields.some(
    (key) => JSON.stringify(storedA7[key]) !== JSON.stringify(seededA7[key]),
  );
  if (!needsSync) return;
  await store.put("agents", {
    ...storedA7,
    ...Object.fromEntries(
      artifactDisplayFields.map((key) => [key, seededA7[key]]),
    ),
  });
}

// Run directly: `npm run seed`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const store = createStore(config.dataDir);
  seed(store).then((r) => console.log("[seed]", r));
}
