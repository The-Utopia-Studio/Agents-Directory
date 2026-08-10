// LLM grounding checker — additive to mechanical checks. Finds relabelled /
// fabricated claims that regex cannot. Never blended into a style score.
//
// Three outcomes — never collapse "not run" into "no findings":
//   passed      — checker ran; no contradictions
//   failed      — checker ran; findings present
//   skipped     — not requested (disabled / nothing to check)
//   unavailable — requested but could not run (missing key / API error)
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

export const LLM_GROUNDING_STATUS = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
  UNAVAILABLE: "unavailable",
});

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

/** Closed-vocabulary copy for the run response — never raw fellow/source spans. */
const GROUNDING_MESSAGES = Object.freeze({
  tenure_years:
    "Draft tenure/years claim is not supported by the source as stated.",
  role_title:
    "Draft role or title claim is not supported by the source as stated.",
  employer_frame:
    "Draft employer/workplace framing is not supported by the source.",
  metric: "Draft metric or achievement claim is not supported by the source.",
  credential: "Draft credential claim is not supported by the source.",
  quote: "Draft quote attribution is not supported by the source.",
  other: "Draft claim is not supported by the source.",
});

function normalizeClaimText(text) {
  let out = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  // Drop lead-in framing the model sometimes includes around the same claim.
  out = out.replace(
    /^(?:i\s+have|i'?ve|with|including|claiming|stating)\s+/i,
    "",
  );
  return out.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function digestSpan(text) {
  const normalized = normalizeClaimText(text);
  if (!normalized) return null;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Gating identity: claimKind + normalised claim text.
 * Digests are provenance of that normalised claim, not a separate identity key.
 */
export function groundingIdentityKey(claimKind, claimSpan) {
  return `${claimKind}:${normalizeClaimText(claimSpan)}`;
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
    message: GROUNDING_MESSAGES[claimKind] || GROUNDING_MESSAGES.other,
    claimSpanDigest: digestSpan(claimSpan),
    sourceSpanDigest: digestSpan(sourceSpan),
    // Evidence-store only — callers that persist Railway traces must strip these.
    claimSpan,
    sourceSpan,
    why: null,
  };
}

/** Trace-safe row: digests + enums + closed message, never raw fellow text. */
export function toTraceSafeGroundingResult(finding) {
  if (!finding) return null;
  return {
    checkId: finding.checkId,
    claimKind: finding.claimKind,
    category: CHECK_SET_CATEGORY_GROUNDING,
    family: finding.family || "source-grounding-llm",
    status: "fail",
    message:
      finding.message ||
      GROUNDING_MESSAGES[finding.claimKind] ||
      GROUNDING_MESSAGES.other,
    claimSpanDigest: finding.claimSpanDigest,
    sourceSpanDigest: finding.sourceSpanDigest,
    sectionFound: true,
  };
}

function resultShape(status, findings = [], reason = null) {
  return {
    status,
    findings,
    ...(reason ? { reason } : {}),
  };
}

function groundingEnabled(config) {
  if (config?.grounding?.llmEnabled === false) return false;
  if (config?.grounding?.llmEnabled === true) return true;
  return process.env.LLM_GROUNDING_ENABLED === "true";
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
Do not invent findings. Prefer precision over recall.
For claimSpan and sourceSpan: quote the minimal contradictory phrase only —
no leading subject ("I have"), no trailing punctuation, no surrounding sentence.`;

/**
 * @returns {Promise<{status: string, findings: object[], reason?: string}>}
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
  const enabled = groundingEnabled(config);

  if (!enabled) {
    return resultShape(LLM_GROUNDING_STATUS.SKIPPED, [], "disabled");
  }
  if (!source || !draft) {
    // Enabled but nothing to check — not a clean pass.
    return resultShape(
      LLM_GROUNDING_STATUS.UNAVAILABLE,
      [],
      !draft ? "empty_draft" : "empty_source",
    );
  }

  const openai = config?.runtime?.openai || {};
  const apiKey = openai.apiKey || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return resultShape(
      LLM_GROUNDING_STATUS.UNAVAILABLE,
      [],
      "missing_api_key",
    );
  }

  const model = openai.model || SCORING_DEFAULT_MODEL;
  const fetchFn = openai.fetch || fetchImpl;
  let response;
  try {
    response = await fetchFn("https://api.openai.com/v1/responses", {
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
  } catch (error) {
    return resultShape(
      LLM_GROUNDING_STATUS.UNAVAILABLE,
      [],
      `request_failed:${String(error?.message || error).slice(0, 80)}`,
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 120);
    } catch {
      /* ignore */
    }
    return resultShape(
      LLM_GROUNDING_STATUS.UNAVAILABLE,
      [],
      `http_${response.status}${detail ? `:${detail}` : ""}`.slice(0, 160),
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return resultShape(
      LLM_GROUNDING_STATUS.UNAVAILABLE,
      [],
      "invalid_response_json",
    );
  }

  const findings = parseFindingsJson(extractOpenAiText(payload))
    .map(normalizeFinding)
    .filter(Boolean)
    .map((row) => (includeRawSpans ? row : toTraceSafeGroundingResult(row)));

  if (findings.length) {
    return resultShape(LLM_GROUNDING_STATUS.FAILED, findings);
  }
  return resultShape(LLM_GROUNDING_STATUS.PASSED, []);
}

/**
 * Run the checker N times.
 * Stability for gating = claimKind + normalised claim (not raw-span digest jitter).
 */
export async function measureGroundingVariance(args, runs = 3) {
  const signatures = [];
  for (let i = 0; i < runs; i++) {
    const result = await runLlmGroundingCheck({
      ...args,
      includeRawSpans: true,
    });
    const findings = result.findings || [];
    const identity = findings
      .map((f) => groundingIdentityKey(f.claimKind, f.claimSpan))
      .sort()
      .join("|");
    const claimKindSig = findings
      .map((f) => `${f.checkId}:${f.claimKind}`)
      .sort()
      .join("|");
    const digestSig = findings
      .map((f) => `${f.checkId}:${f.claimSpanDigest}:${f.sourceSpanDigest}`)
      .sort()
      .join("|");
    signatures.push({
      run: i + 1,
      status: result.status,
      count: findings.length,
      identity,
      claimKindSignature: claimKindSig,
      digestSignature: digestSig,
      signature: identity,
      findings: findings.map((f) =>
        args.includeRawSpans ? f : toTraceSafeGroundingResult(f),
      ),
    });
  }
  const uniqueIdentity = new Set(signatures.map((s) => s.identity));
  const uniqueClaimKinds = new Set(
    signatures.map((s) => s.claimKindSignature),
  );
  const uniqueDigests = new Set(signatures.map((s) => s.digestSignature));
  const statuses = new Set(signatures.map((s) => s.status));
  return {
    runs,
    uniqueIdentities: uniqueIdentity.size,
    uniqueClaimKindSignatures: uniqueClaimKinds.size,
    uniqueDigestSignatures: uniqueDigests.size,
    claimKindStable: uniqueClaimKinds.size <= 1,
    identityStable: uniqueIdentity.size <= 1,
    statusStable: statuses.size <= 1,
    // Gate-worthy when claimKind + normalised claim hold across runs.
    stable:
      uniqueIdentity.size <= 1 &&
      uniqueClaimKinds.size <= 1 &&
      statuses.size <= 1 &&
      ![...statuses].includes(LLM_GROUNDING_STATUS.UNAVAILABLE),
    signatures,
    provider: SCORING_PROVIDER,
    modelId: args?.config?.runtime?.openai?.model || SCORING_DEFAULT_MODEL,
  };
}

export {
  SCORING_DEFAULT_MODEL,
  SCORING_PROVIDER,
  digestSpan,
  normalizeClaimText,
};
