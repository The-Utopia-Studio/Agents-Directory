// Helpers to score a golden case's canned output against historical fixtures.
import { loadHistoricalArtifact } from "./historicalArtifacts.js";
import { getGoldenCase } from "./goldenCases.js";
import {
  compareMechanicalScores,
  scoreMechanicalOutput,
} from "./scoreMechanicalOutput.js";
import {
  buildMechanicalResultRecord,
  recordMechanicalResult,
} from "./mechanicalResults.js";

export function scoreGoldenCannedAgainstVersion(caseId, artifactVersion) {
  const golden = getGoldenCase(caseId);
  if (!golden) {
    throw Object.assign(new Error(`Unknown golden case: ${caseId}`), {
      status: 404,
    });
  }
  const artifact = loadHistoricalArtifact(artifactVersion);
  return scoreMechanicalOutput({
    output: golden.getCannedBadOutput(),
    artifactVersion: artifact.artifactVersion,
    artifactDigest: artifact.artifactDigest,
    declaredChecks: artifact.checks,
    sourceGroundingRules: golden.sourceGroundingRules,
  });
}

export function compareGoldenCannedVersions(
  caseId,
  leftVersion,
  rightVersion,
) {
  const left = scoreGoldenCannedAgainstVersion(caseId, leftVersion);
  const right = scoreGoldenCannedAgainstVersion(caseId, rightVersion);
  return {
    left,
    right,
    compare: compareMechanicalScores(left, right),
  };
}

/** Persist metadata-only records for both sides of a canned compare. */
export async function recordGoldenCannedCompare(
  store,
  { caseId, leftVersion, rightVersion, agentId },
) {
  const { left, right, compare } = compareGoldenCannedVersions(
    caseId,
    leftVersion,
    rightVersion,
  );
  const leftRec = await recordMechanicalResult(
    store,
    buildMechanicalResultRecord({
      agentId,
      goldenCaseId: caseId,
      score: left,
      outputSource: "canned",
      comparedTo: rightVersion,
    }),
  );
  const rightRec = await recordMechanicalResult(
    store,
    buildMechanicalResultRecord({
      agentId,
      goldenCaseId: caseId,
      score: right,
      outputSource: "canned",
      comparedTo: leftVersion,
    }),
  );
  return { left, right, compare, leftRec, rightRec };
}
