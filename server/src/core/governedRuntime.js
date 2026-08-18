export const GOVERNED_RUNTIME_MISMATCH = "GOVERNED_RUNTIME_MISMATCH";

export function formatGovernedRuntimeMismatch(expectedDigest, actualDigest) {
  return (
    `${GOVERNED_RUNTIME_MISMATCH}: expected digest ${expectedDigest || "(none)"}, ` +
    `actual digest ${actualDigest || "(none)"}`
  );
}

/**
 * Compare a Convex current-approved digest pin to the live install/runtime digest.
 * No pin means this process cannot see Convex — callers skip the gate.
 */
export function governedRuntimeVerdict({
  pin,
  actualDigest,
  actualAlgorithm = "sha256",
} = {}) {
  if (!pin) {
    return {
      matched: true,
      skipped: true,
      expectedDigest: null,
      actualDigest: actualDigest || null,
    };
  }
  const expectedDigest = pin.digest || pin.expectedDigest || null;
  const expectedAlgorithm = pin.algorithm || pin.expectedAlgorithm || "sha256";
  const approved = pin.isCurrentApproved !== false;
  const matched =
    approved &&
    Boolean(expectedDigest) &&
    expectedDigest === actualDigest &&
    expectedAlgorithm === actualAlgorithm;
  return {
    matched,
    skipped: false,
    code: matched ? null : GOVERNED_RUNTIME_MISMATCH,
    reason: matched
      ? null
      : formatGovernedRuntimeMismatch(expectedDigest, actualDigest),
    expectedDigest,
    actualDigest: actualDigest || null,
  };
}
