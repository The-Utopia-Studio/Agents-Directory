// Execute a candidate version's PINNED FIXTURE so a human can read the output
// before the version is approved.
//
// Why this exists: witnessing production bytes cannot attest a candidate. To
// serve candidate bytes you must put them on main, which makes the served
// digest disagree with the approved one, which 409s the run — so the only run
// that could produce candidate evidence is the run the digest gate refuses.
//
// Fellows can never receive this. The fixture lives under
// server/src/eval-artifacts/; the fellow-facing loader (runtimeArtifacts
// .snapshotArtifact) realpath-confines itself to server/src/artifacts/ and
// returns null for anything outside it. Two roots, enforced by construction,
// not by a route nobody links to.
//
// This is NOT an ungated path. loadHistoricalArtifact verifies the fixture
// bytes against the registry's declared digest, and this module additionally
// verifies that digest equals the digest the CANDIDATE declares — at run time,
// at the moment of use. The preview's entire honesty rests on that equality;
// asserting it only in CI would mean the claim is checked everywhere except
// where it is relied upon.

import { loadHistoricalArtifact } from "./historicalArtifacts.js";
import { generateUnderHistoricalArtifact } from "./invokeHistorical.js";
import { costUsdFromUsage } from "../invoke/llm/pricing.js";
import { scoreMechanicalOutput } from "./scoreMechanicalOutput.js";
import { isBlockingCheckResult } from "./checkTiers.js";

export class PreviewRefusal extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "PreviewRefusal";
    this.code = code;
    this.status = status;
  }
}

/**
 * Run-time equality check between the fixture that is about to execute and the
 * digest the candidate declares. Exported so the refusal path is testable.
 */
export function assertFixtureMatchesCandidate({
  artifactVersion,
  fixtureDigest,
  candidateDeclaredDigest,
}) {
  const fixture = String(fixtureDigest || "").trim().toLowerCase();
  const declared = String(candidateDeclaredDigest || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fixture)) {
    throw new PreviewRefusal(
      "PREVIEW_FIXTURE_DIGEST_MISSING",
      `PREVIEW_FIXTURE_DIGEST_MISSING: the fixture for ${artifactVersion} produced no sha256 digest; refusing to execute unverified bytes.`,
      500,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(declared)) {
    throw new PreviewRefusal(
      "PREVIEW_CANDIDATE_DIGEST_MISSING",
      `PREVIEW_CANDIDATE_DIGEST_MISSING: no declared digest was supplied for candidate ${artifactVersion}; there is nothing to verify the fixture against.`,
      400,
    );
  }
  if (fixture !== declared) {
    throw new PreviewRefusal(
      "PREVIEW_FIXTURE_DIGEST_MISMATCH",
      `PREVIEW_FIXTURE_DIGEST_MISMATCH: the fixture for ${artifactVersion} hashes ${fixture.slice(0, 12)} but the candidate declares ${declared.slice(0, 12)}. ` +
        `Previewing these bytes would attest output the candidate never produces.`,
    );
  }
  return fixture;
}

/**
 * Execute the candidate fixture and return output + attributable cost.
 *
 * Cost is computed here and returned unconditionally, so the caller can record
 * spend BEFORE the human decides whether to attest. Declining must not make
 * the money invisible.
 *
 * @param {{agentId: string, artifactVersion: string, candidateDeclaredDigest: string,
 *          golden: object, config: object}} args
 */
export async function previewCandidateVersion({
  agentId,
  artifactVersion,
  candidateDeclaredDigest,
  golden,
  sourceText = "",
  config = {},
}) {
  let artifact;
  try {
    // Verifies the fixture against the REGISTRY's declared digest.
    artifact = loadHistoricalArtifact(artifactVersion);
  } catch (error) {
    throw new PreviewRefusal(
      "PREVIEW_FIXTURE_UNAVAILABLE",
      `PREVIEW_FIXTURE_UNAVAILABLE: ${error.message}`,
      error.status || 500,
    );
  }
  if (artifact.agentId && agentId && artifact.agentId !== agentId) {
    throw new PreviewRefusal(
      "PREVIEW_AGENT_MISMATCH",
      `PREVIEW_AGENT_MISMATCH: ${artifactVersion} belongs to ${artifact.agentId}, not ${agentId}.`,
      400,
    );
  }

  // ...and this verifies it against the CANDIDATE's declared digest, at the
  // moment of use. The registry and Convex are two separate records; agreeing
  // with one is not agreeing with the other.
  const verifiedDigest = assertFixtureMatchesCandidate({
    artifactVersion,
    fixtureDigest: artifact.artifactDigest,
    candidateDeclaredDigest,
  });

  // The check set comes from the CANDIDATE's own declared checks — the same
  // artifact-declared set runMechanicalScore uses. A preview that reported no
  // check results was strictly less informative than an existing scorer on the
  // same bytes, which is the defect underneath everything else here.
  const declaredChecks = [...(artifact.checks || [])];

  const generation = await generateUnderHistoricalArtifact({
    agentId,
    artifactVersion,
    golden,
    config,
  });

  // A preview is a real model call and costs real money. Computed here so the
  // caller can persist it regardless of what the human decides.
  const costUsd = costUsdFromUsage(generation.modelId, {
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
  });

  const score = scoreMechanicalOutput({
    output: generation.output,
    artifactVersion,
    artifactDigest: verifiedDigest,
    declaredChecks,
    sourceGroundingRules: golden?.sourceGroundingRules || [],
    sourceText: sourceText || golden?.input || "",
    guardrails: artifact.guardrails || [],
  });
  const blocking = score.checkResults.filter(isBlockingCheckResult);

  return {
    executionKind: "candidate-preview",
    declaredChecks,
    checkSetId: score.checkSetId,
    groundingPassRate: score.groundingPassRate,
    stylePassRate: score.stylePassRate,
    checkResults: score.checkResults.map((row) => ({
      checkId: row.checkId,
      tier: row.tier,
      status: row.status,
      passed: row.passed,
      category: row.category,
      why: row.why || null,
    })),
    // Scored fail or named_hit fail. Advisory never blocks.
    blockingFailures: blocking.map((row) => ({
      checkId: row.checkId,
      tier: row.tier,
      why: row.why || null,
    })),
    attestable: blocking.length === 0,
    agentId,
    artifactVersion,
    artifactDigest: verifiedDigest,
    artifactDigestAlgorithm: "sha256",
    output: generation.output,
    provider: generation.provider,
    modelId: generation.modelId,
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
    // undefined when the model is unpriced — never a fabricated zero.
    costUsd,
    costAttributable: typeof costUsd === "number",
  };
}
