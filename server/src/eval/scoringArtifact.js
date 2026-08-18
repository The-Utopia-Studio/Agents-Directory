// ONE resolver for "which artifact and which check set", shared by every path
// that scores output.
//
// This exists because the preview path re-derived it and got it wrong twice:
// first by not running checks at all, then by going straight to the historical
// registry so any agent without a registry entry (A10 gap-fill) could never be
// previewed — while runMechanicalScore, on the same agent and the same bytes,
// worked fine via its live-runtime fallback.
//
// Both defects were the same shape: a second implementation that is less
// capable than the first. Extracting it means a future path cannot drift,
// because there is nothing left to drift from.

import {
  HISTORICAL_ARTIFACT_REGISTRY,
  loadHistoricalArtifact,
} from "./historicalArtifacts.js";
import { getRuntimeArtifactDescriptor } from "../invoke/runtimeArtifacts.js";

function refuse(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

/**
 * Resolve the artifact whose declared checks should score this output.
 *
 * A registered historical version wins and is digest-verified against its
 * sealed fixture. Otherwise the LIVE runtime descriptor is used, but only when
 * the caller asked for the live version — never as a silent substitute for a
 * version that does not exist.
 *
 * @returns {{agentId, artifactVersion, artifactDigest, artifactDigestAlgorithm,
 *            checks: string[], guardrails: string[], source: "historical-fixture"|"live-runtime"}}
 */
export function resolveScoringArtifact(agentId, artifactVersion) {
  if (artifactVersion && HISTORICAL_ARTIFACT_REGISTRY[artifactVersion]) {
    const historical = loadHistoricalArtifact(artifactVersion);
    return { ...historical, source: "historical-fixture" };
  }
  const live = getRuntimeArtifactDescriptor(agentId);
  if (live?.checks?.length) {
    if (
      !artifactVersion ||
      artifactVersion === "live" ||
      artifactVersion === live.artifactVersion
    ) {
      return {
        agentId,
        artifactVersion: live.artifactVersion,
        artifactDigest: live.artifactDigest,
        artifactDigestAlgorithm: live.artifactDigestAlgorithm || "sha256",
        checks: [...live.checks],
        guardrails: [...(live.guardrails || [])],
        source: "live-runtime",
      };
    }
  }
  refuse(
    `No scoring artifact for ${agentId} version ${artifactVersion || "live"}. ` +
      (live
        ? `Live artifact is ${live.artifactVersion}.`
        : "No runtime artifact with a checks: block."),
    400,
  );
}

/** The declared check ids that would score this agent/version. */
export function resolveDeclaredChecks(agentId, artifactVersion) {
  return [...resolveScoringArtifact(agentId, artifactVersion).checks];
}
