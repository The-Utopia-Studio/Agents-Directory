// LLM grounding checker — additive to mechanical checks. Finds relabelled /
// fabricated claims that regex cannot. Never blended into a style score.
//
// Storage contract for Railway traces: digests + enums only. Raw spans stay
// off the trace (optional evidence payload returned for privileged stores).

import { createHash } from "node:crypto";
import {
  CHECK_SET_CATEGORY_GROUNDING,
} from "./checkSetId.js";
import {
  SCORING_DEFAULT_MODEL,
  SCORING_PROVIDER,
} from "./invokeHistorical.js";

export const GROUNDING_CHECK_IDS = Object.freeze([
  "source_claim_tenure_years",
  "source_claim_role_title",
  "source_claim_employer_frame",
  "source_claim_metric",
  "source_claim_credential",
  "source_claim_quote",
  "source_claim_other",
]);

export const CLAIM_KINDS = Object.freeze([
  "tenure_years",
  "role_title",
  "employer_frame",
  "metric",
  "credential",
  "quote",
  "other",
]);

const CLAIM_KIND_TO_CHECK = Object.freeze({
  tenure_years: "source_claim_tenure_years",
  role_title: "source_claim_role_title",
  employer_frame: "source_claim_employer_frame",
  metric: "source_claim_metric",
  credential: "source_claim_credential",
  quote: "source_claim_quote",
  other: "source_claim_other",
});

function digestSpan(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  return createHash("sha256").update(raw, "utf8").digest("hex");
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

function parseFindingsJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed?.findings) ? parsed.findings : [];
  } catch {
    return [];
  }
}

function normalizeFinding(row) {
  const claimKind = CLAIM_KINDS.includes(row?.claimKind)
    ? row.claimKind
    : "other";
  const checkId = CLAIM_KIND_TO_CHECK[claimKind];
  const claimSpan = String(row?.claimSpan || "").trim();
  const sourceSpan = String(row?.sourceSpan || "").trim();
  if (!claimSpan || !sourceSpan) return null;
  return {
    checkId,
    claimKind,
    category: CHECK_SET_CATEGORY_GROUNDING,
    family: "source-grounding-llm",
    status: "fail",
    claimSpanDigest: digestSpan(claimSpan),
    sourceSpanDigest: digestSpan(sourceSpan),
    // Evidence-store only — callers that persist Railway traces must strip these.
    claimSpan,
    sourceSpan,
    why: null,
  };
}

/** Trace-safe row: digests + enums, never raw fellow text. */
export function toTraceSafeGroundingResult(finding) {
  if (!finding) return null;
  return {
    checkId: finding.checkId,
    claimKind: finding.claimKind,
    category: CHECK_SET_CATEGORY_GROUNDING,
    family: finding.family || "source-grounding-llm",
    status: "fail",
    claimSpanDigest: finding.claimSpanDigest,
    sourceSpanDigest: finding.sourceSpanDigest,
    sectionFound: true,
  };
}

const SYSTEM = `You are a grounding checker for LinkedIn bio drafts.
Compare the DRAFT against the SOURCE. Report only contradictions where the draft
relabels, inflates, or invents a fact the source does not support.

Examples of contradictions:
- Tenure: "8 years of experience in AI" when source supports 8 years total at one
  employer and fewer years in the AI role.
- Role title / employer framing / metrics / credentials / quotes that the source
  does not establish.

Return ONLY JSON:
{"findings":[{"claimKind":"tenure_years|role_title|employer_frame|metric|credential|quote|other","claimSpan":"...","sourceSpan":"..."}]}
If nothing contradicts, return {"findings":[]}.
Do not invent findings. Prefer precision over recall.`;

/**
 * @returns {Promise<object[]>} trace-safe grounding fail rows (empty if unset/skip)
 */
export async function runLlmGroundingCheck({
  output,
  sourceText,
  config,
  fetchImpl = globalThis.fetch,
  includeRawSpans = false,
} = {}) {
  const source = String(sourceText || "").trim();
  const draft = String(output || "").trim();
  if (!source || !draft) return [];

  const openai = config?.runtime?.openai || {};
  const apiKey = openai.apiKey || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    const err = new Error("LLM grounding check needs OPENAI_API_KEY");
    err.status = 503;
    throw err;
  }
  // Opt-in gate: variance must pass before production enablement.
  if (config?.grounding?.llmEnabled === false) return [];
  if (
    config?.grounding?.llmEnabled !== true &&
    process.env.LLM_GROUNDING_ENABLED !== "true"
  ) {
    return [];
  }

  const model = openai.model || SCORING_DEFAULT_MODEL;
  const fetchFn = openai.fetch || fetchImpl;
  const response = await fetchFn("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    // Match scoring path: no temperature — gpt-5.6-terra rejects it.
    body: JSON.stringify({
      model,
      instructions: SYSTEM,
      input: `SOURCE:\n${source}\n\nDRAFT:\n${draft}`,
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
      `OpenAI grounding check HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
    );
    err.status = 502;
    throw err;
  }
  const payload = await response.json();
  const findings = parseFindingsJson(extractOpenAiText(payload))
    .map(normalizeFinding)
    .filter(Boolean);

  return findings.map((row) =>
    includeRawSpans ? row : toTraceSafeGroundingResult(row),
  );
}

/**
 * Run the checker N times; return unique checkId+digest signatures and spread.
 * claimKindStable can hold while digestStable fails (span boundary jitter).
 */
export async function measureGroundingVariance(args, runs = 3) {
  const signatures = [];
  for (let i = 0; i < runs; i++) {
    const findings = await runLlmGroundingCheck({
      ...args,
      includeRawSpans: false,
    });
    const sig = findings
      .map((f) => `${f.checkId}:${f.claimSpanDigest}:${f.sourceSpanDigest}`)
      .sort()
      .join("|");
    const claimKindSig = findings
      .map((f) => `${f.checkId}:${f.claimKind}`)
      .sort()
      .join("|");
    signatures.push({
      run: i + 1,
      count: findings.length,
      signature: sig,
      claimKindSignature: claimKindSig,
      findings,
    });
  }
  const unique = new Set(signatures.map((s) => s.signature));
  const uniqueClaimKinds = new Set(
    signatures.map((s) => s.claimKindSignature),
  );
  return {
    runs,
    uniqueSignatures: unique.size,
    uniqueClaimKindSignatures: uniqueClaimKinds.size,
    digestStable: unique.size <= 1,
    claimKindStable: uniqueClaimKinds.size <= 1,
    // Hard gate requires digest-level stability — span jitter is still noise.
    stable: unique.size <= 1,
    signatures,
    provider: SCORING_PROVIDER,
    modelId: args?.config?.runtime?.openai?.model || SCORING_DEFAULT_MODEL,
  };
}

export { SCORING_DEFAULT_MODEL, SCORING_PROVIDER, digestSpan };
