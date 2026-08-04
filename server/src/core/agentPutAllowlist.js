// Railway PUT /api/agents/:id must not body-spread. The prompt field and loop
// custody fields are the injection / mutation paths designed around in Convex
// (editableAgentFields) and left open here until this allowlist.

/** Catalogue-safe fields a signed caller may update on the Railway agent record. */
export const AGENT_PUT_ALLOWLIST = Object.freeze([
  "name",
  "tagline",
  "description",
  "platform",
  "status",
  "category",
  "owner",
  "initials",
  "model",
  "objective",
  "when",
  "sop",
  "inputs",
  "outputs",
  "runner",
  "usabilityModes",
  "invocation",
  "autonomyLevel",
  "successCriteria",
  "guardrails",
  "skills",
  "tools",
  "context",
  "accessUrl",
  "repoUrl",
  "costPerOutcome",
  "failureClasses",
  "goldenCases",
]);

/**
 * Fields that must never arrive via PUT even if a caller invents them.
 * Documented so a future allowlist expansion cannot quietly re-open them.
 */
export const AGENT_PUT_FORBIDDEN = Object.freeze([
  "id",
  "prompt",
  "proposedImprovements",
  "proposedImprovement",
  "evalHistory",
  "changelog",
  "version",
  "artifactVersion",
  "artifactDigest",
  "artifactDigestAlgorithm",
  "ownerIdentity",
  "displayId",
  "currentApprovedVersionId",
]);

/**
 * Build the next agent record from an existing one + allowlisted patch.
 * Unknown and forbidden keys are dropped — never merged.
 */
export function applyAgentPutAllowlist(existing, body, agentId) {
  if (!existing || typeof existing !== "object") {
    throw Object.assign(new Error(`No agent ${agentId}`), { status: 404 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Agent update body must be a JSON object"), {
      status: 400,
    });
  }

  const patch = {};
  const rejected = [];
  for (const [key, value] of Object.entries(body)) {
    if (key === "id") continue;
    if (AGENT_PUT_FORBIDDEN.includes(key) || !AGENT_PUT_ALLOWLIST.includes(key)) {
      rejected.push(key);
      continue;
    }
    patch[key] = value;
  }

  if (rejected.includes("prompt")) {
    throw Object.assign(
      new Error(
        "Refusing to update prompt via PUT — prompt is not an allowlisted catalogue field",
      ),
      { status: 400, rejectedFields: rejected },
    );
  }

  return {
    next: {
      ...existing,
      ...patch,
      id: agentId,
    },
    rejectedFields: rejected,
    appliedFields: Object.keys(patch),
  };
}
