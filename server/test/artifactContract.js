// Read identifiers from the loaded artifact; assert behaviour yourself.
//
// A test that hardcodes a check id is asserting artifact content from outside
// the artifact — the same class of defect as a fixture whose bytes drifted from
// the version it claims to be. The artifact declares which checks it runs; the
// test's job is to assert what those checks DO on concrete input.
//
// These helpers source only the IDENTIFIER. Every caller must still state the
// input, the expected pass/fail, and the reason. "Whatever it declared, fired"
// proves nothing and is not what these are for.

import { getRuntimeArtifactDescriptor } from "../src/invoke/runtimeArtifacts.js";
import { isClicheCheckId } from "../src/eval/checkTiers.js";

/** Declared check ids for the live artifact of `agentId`. */
export function declaredChecks(agentId) {
  const live = getRuntimeArtifactDescriptor(agentId);
  if (!live?.checks?.length) {
    throw new Error(`${agentId} has no runtime artifact with a checks: block`);
  }
  return [...live.checks];
}

/**
 * The cliche check id THIS artifact declares.
 *
 * v9 declares draft_has_no_ai_cliche_phrase; v10 declares
 * draft_registered_ai_cliche_lemma. Same detector, same named_hit tier — the
 * rename is exactly why hardcoding either one made tests fail on the other.
 */
export function declaredClicheCheckId(agentId) {
  const found = declaredChecks(agentId).filter(isClicheCheckId);
  if (found.length !== 1) {
    throw new Error(
      `${agentId} must declare exactly one cliche check; found ${found.length}: ${found.join(", ")}`,
    );
  }
  return found[0];
}

/** The live artifact version + digest, for tests that assert pinning. */
export function liveArtifact(agentId) {
  const live = getRuntimeArtifactDescriptor(agentId);
  return {
    artifactVersion: live.artifactVersion,
    artifactDigest: live.artifactDigest,
    checks: [...live.checks],
  };
}
