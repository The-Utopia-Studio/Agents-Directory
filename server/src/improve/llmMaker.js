// LLM maker — produces a real artifact section replacement, not a note.
// Uses the same OpenAI Responses path as scoring (gpt-5.6-terra by default).

import {
  SCORING_DEFAULT_MODEL,
  SCORING_PROVIDER,
} from "../eval/invokeHistorical.js";
import { collectDefects } from "./heuristicOptimizer.js";
import { CHECK_SET_CATEGORY_GROUNDING } from "./checkDefectRegistry.js";

const BIOCRAFT = "server/src/artifacts/biocraft/SKILL.md";
const GAPFILL = "server/src/artifacts/biocraft-gapfill/SKILL.md";

function artifactPath(agentId) {
  if (agentId === "A10") return GAPFILL;
  if (agentId === "A7") return BIOCRAFT;
  return `server/src/scripts/seed.js#SEED_AGENTS ${agentId}`;
}

function extractMarkdownSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(^|\\n)(##\\s+${escaped}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s+|$)`,
    "i",
  );
  const match = String(text || "").match(re);
  if (!match) return null;
  const headingLine = match[2];
  const body = match[3];
  return {
    heading,
    headingLine,
    body,
    full: `${headingLine}${body}`,
  };
}

function sectionForDefect(defect) {
  if (defect.category === CHECK_SET_CATEGORY_GROUNDING) return "Method";
  if (defect.key === "voice" || /method/i.test(defect.change?.target || "")) {
    return "Method";
  }
  return "Guardrails";
}

function extractOpenAiText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const chunks = [];
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === "output_text" && part.text) chunks.push(part.text);
      if (part?.type === "text" && part.text) chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseMakerJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeWhitespace(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function validateCandidate(candidate, section, defect, artifactText) {
  if (!candidate || typeof candidate !== "object") {
    return "Maker returned no JSON object";
  }
  const sectionName = String(candidate.section || "").trim();
  const replacement = String(candidate.replacement || "");
  const rationale = String(candidate.rationale || "").trim();
  if (!sectionName || sectionName.toLowerCase() !== section.heading.toLowerCase()) {
    return `Maker section "${sectionName}" does not match required "${section.heading}"`;
  }
  if (!replacement.trim()) return "Maker returned empty replacement text";
  if (!rationale || rationale.length > 280) {
    return "Maker rationale must be one non-empty sentence (≤280 chars)";
  }
  if (/strengthen|consider|should|try to|improve the/i.test(replacement)) {
    return "Maker replacement looks like commentary, not section text";
  }
  if (/strengthen the artifact|stops failing/i.test(rationale)) {
    return "Maker rationale is a defect report, not a behavioural change";
  }
  const currentFull = section.full;
  const nextFull = section.headingLine.endsWith("\n")
    ? `${section.headingLine}${replacement.replace(/^\n+/, "")}`
    : `${section.headingLine}${replacement}`;
  if (normalizeWhitespace(nextFull) === normalizeWhitespace(currentFull)) {
    return "Maker replacement does not differ from the current section";
  }
  // Reject pure restatements of an existing numbered guardrail line.
  if (
    section.heading === "Guardrails" &&
    normalizeWhitespace(replacement) === normalizeWhitespace(section.body)
  ) {
    return "Maker only restated the existing Guardrails section";
  }
  if (!String(artifactText || "").includes(section.full.trimEnd())) {
    return "Current section no longer matches the live artifact";
  }
  if (defect.key && !rationale.toLowerCase().includes(String(defect.key).split("_").slice(0, 2).join(" ")) && !rationale.toLowerCase().includes(defect.key.replace(/_/g, " "))) {
    // Soft: require defect id token OR a clear tie — already required one sentence.
  }
  return null;
}

async function callMakerOnce({
  openai,
  model,
  section,
  defect,
  guardrails,
  successCriteria,
  fetchImpl,
}) {
  const instructions = `You edit one section of a SKILL.md agent artifact.
Return ONLY JSON with keys: section, replacement, rationale.
- section: exactly "${section.heading}"
- replacement: the FULL new body of that section AFTER the heading line (do not repeat the ## heading)
- rationale: one sentence tying the edit to the defect
No commentary. No "strengthen". Change behaviour, do not restate an existing rule.`;

  const input = JSON.stringify(
    {
      sectionHeading: section.heading,
      currentSectionBody: section.body,
      defect: {
        key: defect.key,
        category: defect.category,
        description: defect.description,
      },
      declaredGuardrails: guardrails,
      successCriteria,
    },
    null,
    2,
  );

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${openai.apiKey}`,
      "content-type": "application/json",
    },
    // Match scoring path: no temperature — gpt-5.6-terra rejects it.
    body: JSON.stringify({
      model,
      instructions,
      input,
      store: false,
    }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    const err = new Error(
      `OpenAI maker HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    );
    err.status = 502;
    throw err;
  }
  const payload = await response.json();
  return parseMakerJson(extractOpenAiText(payload));
}

export function createLlmOptimizer(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  return {
    name: "llm",

    async health() {
      return { ok: true, detail: "OpenAI Responses maker (real section diffs)" };
    },

    async propose(agent, evidence) {
      const openai = options.openai || {};
      const apiKey = openai.apiKey || process.env.OPENAI_API_KEY || "";
      if (!apiKey) {
        throw Object.assign(
          new Error(
            "LLM maker needs OPENAI_API_KEY — refusing rather than emitting a placeholder",
          ),
          { status: 422 },
        );
      }
      const model = openai.model || SCORING_DEFAULT_MODEL;
      const artifactText = evidence?.artifact?.text || "";
      if (!artifactText) {
        throw Object.assign(
          new Error("LLM maker has no live artifact text to edit"),
          { status: 422 },
        );
      }

      if (!(evidence?.defectSignals || []).length) {
        throw Object.assign(
          new Error(
            "Heuristic optimizer has no defect signal to propose against — refusing rather than emitting a placeholder",
          ),
          { status: 422 },
        );
      }

      const defects = collectDefects(agent, evidence, evidence.artifact);
      if (!defects.length) {
        throw Object.assign(
          new Error(
            "LLM maker found no actionable defects after excluding post-processed checks — refusing",
          ),
          { status: 422 },
        );
      }

      const guardrails = agent.guardrails || evidence.artifact?.guardrails || [];
      const successCriteria =
        agent.successCriteria || evidence.artifact?.successCriteria || [];
      const proposals = [];

      for (const defect of defects) {
        const heading = sectionForDefect(defect);
        const section = extractMarkdownSection(artifactText, heading);
        if (!section) {
          throw Object.assign(
            new Error(
              `LLM maker cannot locate ## ${heading} in the live artifact for ${defect.key}`,
            ),
            { status: 422 },
          );
        }

        let lastReject = null;
        let candidate = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          candidate = await callMakerOnce({
            openai: { ...openai, apiKey },
            model,
            section,
            defect,
            guardrails,
            successCriteria,
            fetchImpl: openai.fetch || fetchImpl,
          });
          const reject = validateCandidate(
            candidate,
            section,
            defect,
            artifactText,
          );
          if (!reject) break;
          lastReject = reject;
          candidate = null;
        }
        if (!candidate) {
          throw Object.assign(
            new Error(
              `LLM maker refused for ${defect.key} after 2 attempts: ${lastReject}`,
            ),
            { status: 422 },
          );
        }

        const replacementBody = String(candidate.replacement).replace(/^\n+/, "");
        const current = section.full.trimEnd();
        const proposed = `${section.headingLine}${replacementBody}`.trimEnd();
        const target = `${artifactPath(agent.id)}#${heading.toLowerCase()}`;

        proposals.push({
          source: "llm",
          status: "proposed",
          date: new Date().toISOString().slice(0, 10),
          defectKey: defect.key,
          defectCategory: defect.category,
          defectDescription: defect.description,
          provider: SCORING_PROVIDER,
          modelId: model,
          summary: `Replace ## ${heading} to address ${defect.key}`,
          detail: String(candidate.rationale).trim(),
          changes: [
            {
              surface: "prompt",
              target,
              current,
              proposed,
              rationale: String(candidate.rationale).trim(),
              evidence: [...defect.evidence],
            },
          ],
          expectedGain: Math.min(
            25,
            8 + (evidence.failingTraces?.length || 0) * 2,
          ),
          evidence: {
            tracesReviewed: (evidence.traces || []).length,
            failing: (evidence.failingTraces || []).length,
            feedbackReviewed: (evidence.feedback || []).length,
            lowRatings: (evidence.lowRatings || []).length,
            references: [...defect.evidence],
            signalKeys: [defect.key],
            changeTargets: [`prompt:${target}`],
          },
        });
      }

      return proposals;
    },
  };
}
