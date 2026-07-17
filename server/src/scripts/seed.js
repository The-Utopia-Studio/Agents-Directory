// Seed the store with the six agents and a set of synthetic traces for the
// Bio Generator (A2) so the improvement loop has real failing signal to work
// with out of the box. Idempotent — only seeds empty collections.
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { createStore } from "../core/store.js";

export const SEED_AGENTS = [
  { id: "A1", name: "LinkedIn Auditor", objective: "Prioritized, voice-preserving profile fixes, same-day.", version: "1.2",
    prompt: "You audit LinkedIn profiles and suggest prioritized fixes, preserving the person's voice.",
    skills: ["personal-branding", "copywriting"], tools: ["LinkedIn (scrape)"], context: ["Fellow profile", "Branding playbook"],
    evalHistory: [{ date: "2026-07-10", status: "Performing well", score: 81, notes: "Voice examples helped.", knownIssues: "Struggles with non-English profiles." }],
    changelog: [{ version: "1.2", date: "2026-07-10", note: "Added few-shot voice examples." }], proposedImprovement: null },
  { id: "A2", name: "Bio Generator", objective: "Three on-voice bio options a fellow ships with light edits.", version: "1.0",
    prompt: "Write three SEO-optimized LinkedIn bios with CTAs, matching the fellow's voice.",
    skills: ["copywriting", "seo-writing"], tools: [], context: ["Fellow bio", "Voice glossary"],
    evalHistory: [{ date: "2026-07-08", status: "Needs improvement", score: 58, notes: "Voice matching inconsistent.", knownIssues: "Generic corporate language without strong examples; CTAs too aggressive." }],
    changelog: [{ version: "1.0", date: "2026-06-30", note: "Initial build." }], proposedImprovement: null },
  { id: "A3", name: "Post Suggester", objective: "5–10 on-trend post drafts a fellow can edit and publish.", version: "1.1",
    prompt: "Generate LinkedIn post drafts with hooks and CTAs from trending topics.",
    skills: ["social-content", "trend-research"], tools: ["Web search"], context: ["Industry", "News feed"],
    evalHistory: [{ date: "2026-07-12", status: "Performing well", score: 78, notes: "Strong hooks.", knownIssues: "Occasionally outdated trends." }],
    changelog: [{ version: "1.1", date: "2026-07-01", note: "Tightened recency window." }], proposedImprovement: null },
  { id: "A4", name: "Marketing Scout", objective: "Weekly high-signal marketing tasks from internal chatter.", version: "0.3",
    prompt: "Mine Slack for marketing task and content opportunities; cite source threads.",
    skills: ["insight-synthesis"], tools: ["Slack (MCP)"], context: ["Approved channels"],
    evalHistory: [], changelog: [{ version: "0.3", date: "2026-07-09", note: "Early testing." }], proposedImprovement: null },
  { id: "A5", name: "Design Agent", objective: "Design-system components + QA matching the ceramic system.", version: "0.2",
    prompt: "Generate design-system components and QA against ceramic tokens via MCP.",
    skills: ["design-review"], tools: ["Figma (MCP)", "GitHub (MCP)"], context: ["Ceramic tokens"],
    evalHistory: [], changelog: [{ version: "0.2", date: "2026-07-06", note: "Wiring MCP." }], proposedImprovement: null },
  { id: "A6", name: "Research Assistant", objective: "A brief becomes a sourced findings doc for a call.", version: "1.0",
    prompt: "Turn a research brief into a structured, cited findings document.",
    skills: ["company-research", "competitive-analysis"], tools: ["Web search"], context: ["Brief", "Market notes"],
    evalHistory: [{ date: "2026-07-05", status: "Performing well", score: 84, notes: "Strong synthesis.", knownIssues: "Misses niche sources." }],
    changelog: [{ version: "1.0", date: "2026-06-28", note: "Initial build." }], proposedImprovement: null },
];

// Synthetic failing traces for A2 — the loop's raw material.
export const SEED_TRACES = [
  { id: "t_a2_1", agentId: "A2", status: "fail", score: 55, failureReason: "voice mismatch", ts: "2026-07-14T09:00:00Z", output: "As a results-driven professional leveraging synergies..." },
  { id: "t_a2_2", agentId: "A2", status: "fail", score: 61, failureReason: "voice mismatch", ts: "2026-07-14T11:00:00Z", output: "Passionate thought leader driving impact at scale..." },
  { id: "t_a2_3", agentId: "A2", status: "fail", score: 48, failureReason: "aggressive CTA", ts: "2026-07-15T10:00:00Z", output: "DM me NOW to 10x your network — don't miss out!" },
  { id: "t_a2_4", agentId: "A2", status: "ok", score: 82, failureReason: null, ts: "2026-07-15T14:00:00Z", output: "I help early founders tell clearer stories." },
  { id: "t_a2_5", agentId: "A2", status: "fail", score: 59, failureReason: "voice mismatch", ts: "2026-07-16T08:00:00Z", output: "Dynamic, forward-thinking innovator..." },
];

export async function seed(store) {
  await store.ready();
  const a = await store.seedIfEmpty("agents", SEED_AGENTS);
  const t = await store.seedIfEmpty("traces", SEED_TRACES);
  return { agents: a, traces: t };
}

// Run directly: `npm run seed`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const store = createStore(config.dataDir);
  seed(store).then((r) => console.log("[seed]", r));
}
