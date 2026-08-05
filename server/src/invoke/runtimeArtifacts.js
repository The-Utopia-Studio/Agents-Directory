import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ARTIFACTS_ROOT = new URL("../artifacts/", import.meta.url);
// Declarable in artifact frontmatter. Must stay in step with KNOWN_CHECK_IDS
// in core/traceSafety.js, which also carries ids the runtime raises without
// them being declared (about_section_present). A test asserts no drift.
const RUNTIME_CHECKS = new Set([
  "about_hook_max_200_characters",
  "about_max_2600_characters",
  "headline_max_220_characters",
  "about_has_no_delimiter_separated_keyword_run",
  "about_closing_has_cta",
  "draft_has_no_em_dash",
  "draft_has_no_ai_cliche_phrase",
]);
// Length gates match success_criteria already declared on the artifact.
// about_max_2600 / headline_max_220 mirror about_hook_max_200 (visible-text
// character count). Historical v5/v6 eval snapshots keep their pinned check
// sets — live registration only, so those digests stay stable.

/** Exported so the boot-failure test can assert the same throw the module uses at import. */
export function snapshotArtifact(directoryUrl, primaryName) {
  let files;
  let primary;
  try {
    const allowedRoot = realpathSync(fileURLToPath(ARTIFACTS_ROOT));
    const directory = realpathSync(fileURLToPath(directoryUrl));
    if (
      directory !== allowedRoot &&
      !directory.startsWith(`${allowedRoot}${sep}`)
    ) {
      return null;
    }

    files = [];
    function walk(current) {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const path = resolve(current, entry.name);
        const name = relative(directory, path).split(sep).join("/");
        if (!name || name.startsWith("../") || resolve(directory, name) !== path) {
          return false;
        }
        if (entry.isSymbolicLink()) return false;
        if (entry.isDirectory()) {
          if (!walk(path)) return false;
          continue;
        }
        if (!entry.isFile() || !lstatSync(path).isFile()) return false;
        files.push({ name, data: readFileSync(path) });
      }
      return true;
    }
    if (!walk(directory)) return null;

    primary = files.find((file) => file.name === primaryName);
    if (!primary) return null;
  } catch {
    return null;
  }

  // Digesting is intentionally outside the resolution catch. Once bytes have
  // loaded, digest failure is contradictory and must fail boot visibly.
  const artifactDigest = createHash("sha256")
    .update(primary.data)
    .digest("hex");
  if (!artifactDigest) {
    throw new Error("Artifact loaded but SHA-256 digest was unavailable");
  }
  const content = primary.data.toString("utf8");
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  if (!frontmatter) {
    throw new Error("Artifact loaded without parseable frontmatter");
  }
  const artifactVersion = frontmatter.match(
    /^artifact_version:\s*([a-zA-Z0-9._-]+)\s*$/m,
  )?.[1];
  if (!artifactVersion) {
    throw new Error(
      "Artifact loaded without a valid artifact_version frontmatter field",
    );
  }
  // Generator pin lives in the digestable bytes so a model/provider change
  // moves the digest and forces a new released version — same gate as a prompt
  // edit. Absence is a defect: every hosted artifact must declare what runs it.
  const runtimeProvider = frontmatter.match(
    /^runtime_provider:\s*(openai|anthropic)\s*$/m,
  )?.[1];
  const runtimeModel = frontmatter.match(
    /^runtime_model:\s*([a-zA-Z0-9._/-]+)\s*$/m,
  )?.[1];
  if (!runtimeProvider || !runtimeModel) {
    throw new Error(
      "Artifact loaded without runtime_provider and runtime_model frontmatter",
    );
  }
  const guardrails = frontmatterList(frontmatter, "guardrails");
  const successCriteria = frontmatterList(frontmatter, "success_criteria");
  const checks = frontmatterList(frontmatter, "checks");
  // Declared beside the prompt so the manifest, the digest, and the executed
  // bytes cannot disagree. Absence is a defect, not an empty section.
  if (!guardrails.length || !successCriteria.length) {
    throw new Error(
      "Artifact loaded without frontmatter guardrails and success_criteria",
    );
  }
  if (!checks.length) {
    throw new Error("Artifact loaded without frontmatter checks");
  }
  const unknownChecks = checks.filter((check) => !RUNTIME_CHECKS.has(check));
  if (unknownChecks.length) {
    throw new Error(
      `Artifact loaded with unknown runtime check(s): ${unknownChecks.join(", ")}`,
    );
  }
  return {
    content,
    files,
    artifactVersion,
    runtimeProvider,
    runtimeModel,
    guardrails,
    successCriteria,
    checks,
    artifactDigest,
    artifactDigestAlgorithm: "sha256",
  };
}

/** Read a simple `key:` / `  - item` block from already-isolated frontmatter. */
function frontmatterList(frontmatter, key) {
  const block = frontmatter.match(
    new RegExp(`^${key}:\\s*\\n((?:[ \\t]+-[ \\t]+.+\\n?)+)`, "m"),
  )?.[1];
  if (!block) return [];
  return block
    .split("\n")
    .map((line) => line.replace(/^[ \t]+-[ \t]+/, "").trim())
    .filter(Boolean);
}

const BIOCRAFT_DIRECTORY = new URL("../artifacts/biocraft/", import.meta.url);
const BIOCRAFT_SNAPSHOT = snapshotArtifact(BIOCRAFT_DIRECTORY, "SKILL.md");
const BIOCRAFT_GAPFILL_DIRECTORY = new URL(
  "../artifacts/biocraft-gapfill/",
  import.meta.url,
);
const BIOCRAFT_GAPFILL_SNAPSHOT = snapshotArtifact(
  BIOCRAFT_GAPFILL_DIRECTORY,
  "SKILL.md",
);

const PASTE_UNSUPPORTED = Object.freeze([
  {
    label: "LinkedIn URL",
    reason:
      "no browser tool — paste your current LinkedIn About and headline instead",
  },
  {
    label: "Google Drive folder or pitch deck",
    reason:
      "no Drive tool — paste your pitch or venture notes instead",
  },
  {
    label: "Local file path",
    reason: "no filesystem access — paste the file contents instead",
  },
]);

/**
 * The run contract is server-owned. Field keys are stable identifiers, never
 * the agent record's display labels: those are editable in the directory, and
 * keying off them silently breaks the run the moment someone renames a field.
 */
const RUNTIME_ARTIFACTS = Object.freeze({
  A7: Object.freeze({
    directory: BIOCRAFT_DIRECTORY,
    url: new URL("../artifacts/biocraft/SKILL.md", import.meta.url),
    mode: "single-shot",
    slug: "biocraft",
    displayName: "Biocraft single-shot draft",
    snapshot: BIOCRAFT_SNAPSHOT,
    descriptions: Object.freeze({
      "SKILL.md":
        "The exact single-shot system artifact executed by the hosted runtime.",
    }),
    inputContract: Object.freeze({
      fields: Object.freeze([
        {
          key: "fellowName",
          label: "Fellow's name",
          required: true,
          multiline: false,
          aliases: ["Fellow name", "Fellow's name", "name"],
        },
        {
          key: "sourceMaterial",
          label: "Source material (paste the full text)",
          help: "LinkedIn profile text, venture material, or CV. Paste it; the server cannot fetch links.",
          required: true,
          multiline: true,
          aliases: [
            "All source material and interview answers (required upfront)",
            "pasted text or local file path",
            "Pasted text",
            "sourceText",
          ],
        },
        {
          key: "interviewAnswers",
          label: "Short-interview answers",
          help: "Optional. Anything not already covered by the source material.",
          required: false,
          multiline: true,
          aliases: ["short-interview answers", "interview"],
        },
      ]),
      // Declared so the UI can show why these are absent rather than asking
      // for material this mode has no tool to read.
      unsupported: PASTE_UNSUPPORTED,
    }),
  }),
  // Gap-fill is a separate agent from A7. Own artifact, own version history.
  // Display id is A10 — Convex A9 is a different agent ("Con") and stays untouched.
  A10: Object.freeze({
    directory: BIOCRAFT_GAPFILL_DIRECTORY,
    url: new URL("../artifacts/biocraft-gapfill/SKILL.md", import.meta.url),
    mode: "gap-fill",
    slug: "biocraft-gapfill",
    displayName: "Biocraft gap-fill",
    snapshot: BIOCRAFT_GAPFILL_SNAPSHOT,
    descriptions: Object.freeze({
      "SKILL.md":
        "The exact gap-fill system artifact executed by the hosted runtime.",
    }),
    inputContract: Object.freeze({
      fields: Object.freeze([
        {
          key: "fellowName",
          label: "Fellow's name",
          required: true,
          multiline: false,
          aliases: ["Fellow name", "Fellow's name", "name"],
        },
        {
          key: "sourceMaterial",
          label: "Source material (paste the full text)",
          help: "Paste your current LinkedIn About and headline, plus pitch or venture notes, CV, or other profile text. The server cannot fetch links.",
          required: true,
          multiline: true,
          aliases: [
            "pasted text or local file path",
            "Pasted text",
            "sourceText",
          ],
        },
        {
          key: "exclusions",
          label: "Anything that must NOT appear (optional)",
          help: "Sarah's exclusion question — always optional. Not detected as a gap from source material.",
          required: false,
          multiline: true,
          aliases: ["must not appear", "exclusions", "do not include"],
        },
      ]),
      unsupported: PASTE_UNSUPPORTED,
    }),
  }),
});

/**
 * Resolve prompt custody by server-owned agent id. The store's artifact pointer
 * is descriptive only: it never controls which file is read.
 *
 * Known limitation (TUS-2327): this registry is not an approved Convex
 * agentVersionId. Traces from it cannot support promotion.
 */
export async function loadRuntimeArtifact(agentId) {
  const artifact = RUNTIME_ARTIFACTS[agentId];
  if (!artifact) {
    const error = new Error(`No server-owned runtime artifact for ${agentId}`);
    error.status = 400;
    throw error;
  }
  if (!artifact.snapshot) {
    const error = new Error(`Server-owned runtime artifact unavailable for ${agentId}`);
    error.status = 503;
    throw error;
  }
  if (
    artifact.snapshot.content &&
    (!artifact.snapshot.artifactDigest ||
      artifact.snapshot.artifactDigestAlgorithm !== "sha256")
  ) {
    const error = new Error(
      `Runtime artifact for ${agentId} loaded without a SHA-256 digest`,
    );
    error.status = 500;
    throw error;
  }
  return artifact.snapshot.content;
}

export function getRuntimeArtifactMode(agentId) {
  return RUNTIME_ARTIFACTS[agentId]?.mode || null;
}

/** Shared custody record used by invocation, evaluation metadata, and export. */
export function getRuntimeArtifactDescriptor(agentId) {
  const artifact = RUNTIME_ARTIFACTS[agentId];
  if (!artifact?.snapshot) return null;
  return {
    directory: artifact.directory,
    url: artifact.url,
    mode: artifact.mode,
    slug: artifact.slug,
    displayName: artifact.displayName,
    artifactVersion: artifact.snapshot.artifactVersion,
    runtimeProvider: artifact.snapshot.runtimeProvider,
    runtimeModel: artifact.snapshot.runtimeModel,
    guardrails: [...artifact.snapshot.guardrails],
    successCriteria: [...artifact.snapshot.successCriteria],
    checks: [...artifact.snapshot.checks],
    artifactDigest: artifact.snapshot.artifactDigest,
    artifactDigestAlgorithm: artifact.snapshot.artifactDigestAlgorithm,
    files: artifact.snapshot.files.map((file) => ({
      name: file.name,
      data: Buffer.from(file.data),
    })),
    descriptions: artifact.descriptions,
  };
}

function markdownSection(output, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(output)
    .match(
      new RegExp(
        `^###\\s+${escaped}\\s*$\\n([\\s\\S]*?)(?=^###\\s+|(?![\\s\\S]))`,
        "m",
      ),
    )?.[1]
    ?.trim();
}

function visibleText(markdown) {
  return String(markdown)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const HOOK_CHARACTER_LIMIT = 200;
export const ABOUT_CHARACTER_LIMIT = 2600;
export const HEADLINE_CHARACTER_LIMIT = 220;

// Sarah's rule is "one or two final lines": one paragraph is too narrow, and
// anything wider is too generous. There is deliberately no expand-to-N-chars
// rule — on a short About that would swallow the whole section and pass a bio
// whose CTA sits mid-text, which is the opposite of what the check is for.
const CTA_WINDOW_PARAGRAPHS = 2;

// A contact channel. Pattern-only, so no phrase needs enumerating.
const CONTACT_CHANNEL =
  /(?:[\w.+-]+@[\w-]+\.[\w.]{2,}|https?:\/\/\S+|\b(?:www|linkedin|calendly|substack|github)\.[\w./-]+)/i;

// An imperative CTA is identified by sentence-initial POSITION of a contact
// verb, not by matching a whole phrase. "Book a call", "Book a slot" and
// "Book time with me" all fire on the same rule.
const IMPERATIVE_OPENER =
  /^(?:book|email|message|call|reach|contact|connect|send|visit|schedule|join|drop|ping|write|follow|apply|subscribe|hire|explore|start|get|say|tell)\b|^(?:let'?s\b|feel free\b)/i;

// The remaining branch is lexical, bounded by the artifact's own wording:
// "state what the fellow is open to, or how to reach out."
const INVITATION_FRAME =
  /\b(?:available (?:for|to)|open (?:to|for)|currently taking on|taking on new|now booking|accepting|happy to|looking to|reach out|get in touch|contact me|connect with me|(?:i )?would like to connect|email me|message me|send me|dm me|drop me|write to me|say hello|let'?s (?:connect|talk|chat)|work with me|hear from you|find me at|book a|schedule a)\b/i;

const KEYWORD_RUN = /(?:([·|•])[^·|•\n]*){2,}/;
const GENERATED_SECTIONS = Object.freeze([
  "LinkedIn About",
  "Spoken event introduction",
  "Suggested headline",
]);
const EM_DASH_OR_DOUBLE_HYPHEN = /—|--/;
const AI_CLICHE_SINGLE_TERMS = Object.freeze([
  "utilize", "leverage", "facilitate", "innovative", "robust", "seamless",
  "cutting-edge", "unlock", "elevate", "passionate", "synergy", "game-changer",
  "revolutionize", "revolutionary",
]);
const AI_CLICHE_PHRASES = Object.freeze(["sits at the intersection of"]);

function hasCompletePhrase(content, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(content);
}

/** The closing: at most the trailing two paragraphs, never more. */
function trailingWindow(paragraphs) {
  const picked = paragraphs.slice(-CTA_WINDOW_PARAGRAPHS);
  return { text: visibleText(picked.join("\n\n")), paragraphs: picked.length };
}

function ctaSignals(windowText) {
  const sentences = windowText
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    hasContactChannel: CONTACT_CHANNEL.test(windowText),
    hasImperativeOpener: sentences.some((s) => IMPERATIVE_OPENER.test(s)),
    hasInvitationFrame: INVITATION_FRAME.test(windowText),
  };
}

function pushHeadlineLengthFailure(failures, checks, output) {
  if (!checks.includes("headline_max_220_characters")) return;
  const headline = markdownSection(output, "Suggested headline");
  if (!headline) {
    failures.push({
      checkId: "headline_max_220_characters",
      message: "Suggested headline section is missing or not labelled exactly",
      section: "Suggested headline",
      sectionFound: false,
      headlineChars: 0,
      limit: HEADLINE_CHARACTER_LIMIT,
    });
    return;
  }
  const headlineVisible = visibleText(headline);
  if (headlineVisible.length > HEADLINE_CHARACTER_LIMIT) {
    failures.push({
      checkId: "headline_max_220_characters",
      message: `Suggested headline is ${headlineVisible.length} characters; maximum is ${HEADLINE_CHARACTER_LIMIT}`,
      section: "Suggested headline",
      sectionFound: true,
      headlineChars: headlineVisible.length,
      limit: HEADLINE_CHARACTER_LIMIT,
    });
  }
}

/**
 * Execute the checks declared in the same server-owned bytes used as the
 * system prompt. This prevents a `checks:` block from being documentation
 * that the runtime silently ignores.
 *
 * Returns one structured result per FAILED check: a closed-vocabulary id, a
 * human-readable message for the caller, and numeric/boolean facts about the
 * structure inspected. Facts exist so a parsing miss can be told apart from a
 * genuine omission; they never include matched text.
 */
export function validateRuntimeArtifactOutput(agentId, output) {
  const artifact = RUNTIME_ARTIFACTS[agentId];
  const checks = artifact?.snapshot?.checks || [];
  if (!checks.length) return [];

  const about = markdownSection(output, "LinkedIn About");
  if (!about) {
    const failures = [
      {
        checkId: "about_section_present",
        message: "LinkedIn About section is missing or not labelled exactly",
        sectionFound: false,
        paragraphCount: 0,
      },
    ];
    pushHeadlineLengthFailure(failures, checks, output);
    return failures;
  }

  const paragraphs = about.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const hook = visibleText(paragraphs[0] || "");
  const aboutVisible = visibleText(about);
  const failures = [];

  if (checks.includes("about_hook_max_200_characters") && hook.length > HOOK_CHARACTER_LIMIT) {
    failures.push({
      checkId: "about_hook_max_200_characters",
      message: `LinkedIn About hook is ${hook.length} characters; maximum is ${HOOK_CHARACTER_LIMIT}`,
      sectionFound: true,
      paragraphCount: paragraphs.length,
      hookChars: hook.length,
      limit: HOOK_CHARACTER_LIMIT,
    });
  }

  if (
    checks.includes("about_max_2600_characters") &&
    aboutVisible.length > ABOUT_CHARACTER_LIMIT
  ) {
    failures.push({
      checkId: "about_max_2600_characters",
      message: `LinkedIn About is ${aboutVisible.length} characters; maximum is ${ABOUT_CHARACTER_LIMIT}`,
      sectionFound: true,
      paragraphCount: paragraphs.length,
      aboutChars: aboutVisible.length,
      limit: ABOUT_CHARACTER_LIMIT,
    });
  }

  pushHeadlineLengthFailure(failures, checks, output);

  if (checks.includes("about_has_no_delimiter_separated_keyword_run")) {
    const match = about.match(KEYWORD_RUN);
    if (match) failures.push({
      checkId: "about_has_no_delimiter_separated_keyword_run",
      message: "LinkedIn About contains a delimiter-separated keyword run",
      section: "LinkedIn About",
      sectionFound: true,
      paragraphCount: paragraphs.length,
      delimiter: match[1],
      segmentCount: match[0].split(match[1]).filter(Boolean).length,
    });
  }

  if (checks.includes("about_closing_has_cta")) {
    const window = trailingWindow(paragraphs);
    const signals = ctaSignals(window.text);
    if (!signals.hasContactChannel && !signals.hasImperativeOpener && !signals.hasInvitationFrame) {
      failures.push({
        checkId: "about_closing_has_cta",
        // Detector language, not a verdict on the draft. No detector firing is
        // evidence to look, not proof the model omitted a CTA.
        message:
          "No CTA detected in the closing of the LinkedIn About (trailing two paragraphs)",
        sectionFound: true,
        paragraphCount: paragraphs.length,
        windowParagraphs: window.paragraphs,
        windowChars: window.text.length,
        ...signals,
      });
    }
  }

  if (checks.includes("draft_has_no_em_dash")) {
    for (const section of GENERATED_SECTIONS) {
      const content = section === "LinkedIn About" ? about : markdownSection(output, section);
      if (content && EM_DASH_OR_DOUBLE_HYPHEN.test(content)) failures.push({
        checkId: "draft_has_no_em_dash",
        message: `${section} contains an em dash or double-hyphen substitute`,
        section,
        sectionFound: true,
      });
    }
  }

  if (checks.includes("draft_has_no_ai_cliche_phrase")) {
    for (const section of GENERATED_SECTIONS) {
      const content = section === "LinkedIn About" ? about : markdownSection(output, section);
      const containsRegisteredCliche = content && [
        ...AI_CLICHE_SINGLE_TERMS,
        ...AI_CLICHE_PHRASES,
      ].some((phrase) => hasCompletePhrase(content, phrase));
      if (containsRegisteredCliche) failures.push({
        checkId: "draft_has_no_ai_cliche_phrase",
        message: `${section} contains a registered AI cliche term or phrase`,
        section,
        sectionFound: true,
      });
    }
  }

  return failures;
}

/** Public contract: stable keys, labels, and the inputs this mode cannot read. */
export function getRuntimeInputContract(agentId) {
  const contract = RUNTIME_ARTIFACTS[agentId]?.inputContract;
  if (!contract) return null;
  return {
    fields: contract.fields.map(({ aliases: _aliases, ...field }) => ({
      ...field,
    })),
    unsupported: contract.unsupported.map((entry) => ({ ...entry })),
  };
}

/**
 * Map a submitted payload onto the contract's stable keys. Accepts the stable
 * key first, then declared aliases, then a case-insensitive label match, so a
 * renamed directory label degrades to a warning rather than a false refusal.
 */
export function resolveRuntimeInputs(agentId, inputs = {}) {
  const contract = RUNTIME_ARTIFACTS[agentId]?.inputContract;
  if (!contract) return { values: {}, missing: [] };

  const submitted = new Map(
    Object.entries(inputs || {}).map(([key, value]) => [
      key.trim().toLowerCase(),
      value,
    ]),
  );
  const values = {};
  const missing = [];

  for (const field of contract.fields) {
    const candidates = [field.key, field.label, ...(field.aliases || [])];
    let found = "";
    for (const candidate of candidates) {
      const value = submitted.get(String(candidate).trim().toLowerCase());
      if (String(value || "").trim()) {
        found = String(value).trim();
        break;
      }
    }
    if (found) values[field.key] = found;
    else if (field.required) missing.push(field.label);
  }

  return { values, missing };
}

export async function hasRuntimeArtifact(agentId) {
  try {
    await loadRuntimeArtifact(agentId);
    return true;
  } catch {
    return false;
  }
}
