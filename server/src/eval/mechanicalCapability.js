// Mechanical score/compare/inventory require a live runtime artifact that
// declares a checks: block. Agent id is not the capability.

import { getRuntimeArtifactDescriptor } from "../invoke/runtimeArtifacts.js";

export function mechanicalCheckCapability(agentId) {
  const live = getRuntimeArtifactDescriptor(agentId);
  const checks = Array.isArray(live?.checks) ? live.checks : [];
  if (live && checks.length > 0) {
    return {
      ok: true,
      agentId,
      artifactVersion: live.artifactVersion,
      artifactDigest: live.artifactDigest,
      checkCount: checks.length,
      checks: [...checks],
      guardrails: [...(live.guardrails || [])],
    };
  }
  const missing = [];
  if (!live) missing.push("a runtime artifact");
  else if (checks.length === 0) missing.push("a checks: block on the runtime artifact");
  return {
    ok: false,
    agentId,
    missing,
    reason:
        `Mechanical inventory/score/compare is unavailable for ${agentId}: missing ${missing.join(" and ")}.`,
  };
}

export function assertMechanicalCheckCapability(agentId) {
  const cap = mechanicalCheckCapability(agentId);
  if (!cap.ok) {
    throw Object.assign(new Error(cap.reason), { status: 400 });
  }
  return cap;
}
