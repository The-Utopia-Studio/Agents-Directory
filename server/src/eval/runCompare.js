// Orchestrate mechanical compare experiments. See compareExperiments.js.

import { loadHistoricalArtifact } from "./historicalArtifacts.js";
import { getGoldenCase } from "./goldenCases.js";
import { scoreMechanicalOutput } from "./scoreMechanicalOutput.js";
import {
  EXPERIMENT_CHECK_COVERAGE,
  EXPERIMENT_OUTPUT_QUALITY,
  assertExperiment,
  buildCheckCoverageResult,
  buildOutputQualityResult,
  comparabilityForVersions,
} from "./compareExperiments.js";
import { generateUnderHistoricalArtifact } from "./invokeHistorical.js";
import {
  buildMechanicalResultRecord,
  recordMechanicalResult,
} from "./mechanicalResults.js";

function refuse(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function scoreWith({
  output,
  scoringArtifact,
  sourceGroundingRules,
  sourceText,
  scoreLabelVersion,
}) {
  // scoreLabelVersion is what we stamp on the result for provenance when the
  // scoring check set comes from the ruler rather than the generating artifact.
  return scoreMechanicalOutput({
    output,
    artifactVersion: scoreLabelVersion || scoringArtifact.artifactVersion,
    artifactDigest: scoringArtifact.artifactDigest,
    declaredChecks: scoringArtifact.checks,
    sourceGroundingRules,
    sourceText,
    checkSetVersion: scoringArtifact.artifactVersion,
  });
}

/**
 * Score one golden case against one artifact version.
 * canned = plumbing / offline; live = paid Anthropic under that artifact prompt.
 * Never writes evalHistory.
 */
export async function runMechanicalScore({
  caseId,
  artifactVersion,
  outputSource = "canned",
  agentId = "A7",
  config = {},
  store = null,
}) {
  const golden = getGoldenCase(caseId);
  if (!golden) refuse(`Unknown golden case: ${caseId}`, 404);

  let artifact;
  try {
    artifact = loadHistoricalArtifact(artifactVersion);
  } catch (error) {
    return {
      ok: false,
      verification: "failed",
      label: "mechanical_check_score",
      artifactVersion,
      error: error.message,
      feedsFleetHealth: false,
      writesEvalHistory: false,
    };
  }

  let output;
  let generation = null;
  if (outputSource === "canned") {
    output = golden.getCannedBadOutput();
  } else if (outputSource === "live") {
    generation = await generateUnderHistoricalArtifact({
      agentId,
      artifactVersion,
      golden,
      config,
    });
    output = generation.output;
  } else {
    refuse(`Unknown outputSource "${outputSource}". Use canned or live.`);
  }

  const score = scoreWith({
    output,
    scoringArtifact: artifact,
    sourceGroundingRules: golden.sourceGroundingRules,
    sourceText: golden.input,
  });

  const result = {
    ok: true,
    verification: "ok",
    label: "mechanical_check_score",
    experiment: null,
    caseId,
    agentId,
    outputSource,
    outputProvenance:
      outputSource === "live" ? "live_generation" : "canned_fixtures",
    answersDidImprovementHelp: false,
    findingKind:
      outputSource === "live" ? "single_version_live_score" : "plumbing_verification",
    artifactVersion: artifact.artifactVersion,
    artifactDigest: artifact.artifactDigest,
    artifactDigestAlgorithm: "sha256",
    checkSetVersion: score.checkSetVersion,
    declaredChecks: [...artifact.checks],
    mechanicalCheckScore: score.mechanicalCheckScore,
    scoreableCount: score.scoreableCount,
    stylePassRate: score.stylePassRate,
    styleScoreableCount: score.styleScoreableCount,
    byCategory: score.byCategory,
    passed: [...score.passed],
    failed: [...score.failed],
    notScoreable: [...score.notScoreable],
    checkResults: score.checkResults.map((row) => ({
      id: row.id,
      checkId: row.id,
      passed: row.passed,
      why: row.why,
      severity: row.severity,
      category: row.category,
      status: row.status,
      family: row.family,
      ...(row.historicalImplementation
        ? { historicalImplementation: true }
        : {}),
      ...(row.section ? { section: row.section } : {}),
    })),
    feedsFleetHealth: false,
    writesEvalHistory: false,
    ...(generation
      ? {
          generation: {
            provider: generation.provider,
            modelId: generation.modelId,
            latencyMs: generation.latencyMs,
            inputTokens: generation.inputTokens,
            outputTokens: generation.outputTokens,
          },
        }
      : {}),
  };

  if (store) {
    const recorded = await recordMechanicalResult(
      store,
      buildMechanicalResultRecord({
        agentId,
        goldenCaseId: caseId,
        score,
        outputSource,
      }),
    );
    result.recordedId = recorded.id;
  }

  return result;
}

/**
 * check_coverage: identical output scored under each version's declared checks.
 */
export function runCheckCoverageCompare({
  caseId,
  leftVersion,
  rightVersion,
  outputSource = "canned",
}) {
  assertExperiment(EXPERIMENT_CHECK_COVERAGE);
  const golden = getGoldenCase(caseId);
  if (!golden) refuse(`Unknown golden case: ${caseId}`, 404);
  if (outputSource !== "canned") {
    refuse(
      "check_coverage currently supports outputSource=canned only (same fixed output)",
    );
  }

  const output = golden.getCannedBadOutput();
  const leftArtifact = loadHistoricalArtifact(leftVersion);
  const rightArtifact = loadHistoricalArtifact(rightVersion);

  const left = scoreWith({
    output,
    scoringArtifact: leftArtifact,
    sourceGroundingRules: golden.sourceGroundingRules,
    sourceText: golden.input,
  });
  const right = scoreWith({
    output,
    scoringArtifact: rightArtifact,
    sourceGroundingRules: golden.sourceGroundingRules,
    sourceText: golden.input,
  });

  return buildCheckCoverageResult({
    caseId,
    left,
    right,
    leftVersion,
    rightVersion,
    outputSource,
  });
}

/**
 * output_quality: generate under each artifact (or load fixture outputs), score
 * BOTH with one ruler check set.
 */
export async function runOutputQualityCompare({
  caseId,
  leftVersion,
  rightVersion,
  rulerVersion,
  outputSource = "canned",
  agentId = "A7",
  config = {},
}) {
  assertExperiment(EXPERIMENT_OUTPUT_QUALITY);
  const golden = getGoldenCase(caseId);
  if (!golden) refuse(`Unknown golden case: ${caseId}`, 404);
  if (!rulerVersion) {
    refuse(
      "output_quality requires rulerVersion — the shared check set that scores both outputs",
    );
  }

  const leftArtifact = loadHistoricalArtifact(leftVersion);
  const rightArtifact = loadHistoricalArtifact(rightVersion);
  const ruler = loadHistoricalArtifact(rulerVersion);
  const comparability = comparabilityForVersions(leftArtifact, rightArtifact);

  // Without a ruler, differing check sets are not comparable as quality.
  // With a ruler we proceed and record that note in the result.
  if (
    comparability.checkSetsDiffer &&
    !rulerVersion
  ) {
    refuse(comparability.note);
  }

  let leftGeneration;
  let rightGeneration;
  let leftOutput;
  let rightOutput;

  if (outputSource === "canned") {
    // Offline fixture pair: bad output stands for a weak prompt run; improved
    // stands for a stronger one. Digests still come from the artifact versions
    // named in the request — generation is not live.
    leftOutput = golden.getCannedBadOutput();
    rightOutput = golden.getCannedImprovedOutput
      ? golden.getCannedImprovedOutput()
      : refuse("Golden case has no canned improved output for quality fixtures");
    leftGeneration = {
      artifactVersion: leftArtifact.artifactVersion,
      artifactDigest: leftArtifact.artifactDigest,
      provider: "fixture",
      modelId: null,
    };
    rightGeneration = {
      artifactVersion: rightArtifact.artifactVersion,
      artifactDigest: rightArtifact.artifactDigest,
      provider: "fixture",
      modelId: null,
    };
  } else if (outputSource === "live") {
    leftGeneration = await generateUnderHistoricalArtifact({
      agentId,
      artifactVersion: leftVersion,
      golden,
      config,
    });
    rightGeneration = await generateUnderHistoricalArtifact({
      agentId,
      artifactVersion: rightVersion,
      golden,
      config,
    });
    leftOutput = leftGeneration.output;
    rightOutput = rightGeneration.output;
    // Drop raw text from persisted generation metadata below.
  } else {
    refuse(`Unknown outputSource "${outputSource}". Use canned or live.`);
  }

  const left = scoreWith({
    output: leftOutput,
    scoringArtifact: ruler,
    sourceGroundingRules: golden.sourceGroundingRules,
    sourceText: golden.input,
    scoreLabelVersion: ruler.artifactVersion,
  });
  // Stamp generating artifact digests separately from scoring provenance.
  left.generatingArtifactVersion = leftArtifact.artifactVersion;
  left.generatingArtifactDigest = leftArtifact.artifactDigest;

  const right = scoreWith({
    output: rightOutput,
    scoringArtifact: ruler,
    sourceGroundingRules: golden.sourceGroundingRules,
    sourceText: golden.input,
    scoreLabelVersion: ruler.artifactVersion,
  });
  right.generatingArtifactVersion = rightArtifact.artifactVersion;
  right.generatingArtifactDigest = rightArtifact.artifactDigest;

  const result = buildOutputQualityResult({
    caseId,
    left,
    right,
    leftArtifactVersion: leftVersion,
    rightArtifactVersion: rightVersion,
    rulerVersion: ruler.artifactVersion,
    rulerChecks: ruler.checks,
    outputSource,
    leftGeneration: {
      ...leftGeneration,
      output: undefined,
    },
    rightGeneration: {
      ...rightGeneration,
      output: undefined,
    },
  });

  // Never return draft text on the compare API response.
  return result;
}

export async function runMechanicalCompare(store, opts) {
  const experiment = assertExperiment(opts.experiment);
  let result;
  if (experiment === EXPERIMENT_CHECK_COVERAGE) {
    result = runCheckCoverageCompare(opts);
  } else {
    result = await runOutputQualityCompare(opts);
  }

  if (store) {
    const leftScore = {
      artifactVersion:
        result.left.generatingArtifactVersion || result.left.artifactVersion,
      artifactDigest:
        result.left.generatingArtifactDigest || result.left.artifactDigest,
      checkSetVersion: result.left.checkSetVersion,
      passed: result.left.passed,
      failed: result.left.failed,
      notScoreable: result.left.notScoreable,
      mechanicalCheckScore: result.left.mechanicalCheckScore,
      scoreableCount: result.left.scoreableCount,
      stylePassRate: result.left.stylePassRate,
      styleScoreableCount: result.left.styleScoreableCount,
      byCategory: result.left.byCategory,
      checkResults: result.left.checkResults,
    };
    const rightScore = {
      artifactVersion:
        result.right.generatingArtifactVersion || result.right.artifactVersion,
      artifactDigest:
        result.right.generatingArtifactDigest || result.right.artifactDigest,
      checkSetVersion: result.right.checkSetVersion,
      passed: result.right.passed,
      failed: result.right.failed,
      notScoreable: result.right.notScoreable,
      mechanicalCheckScore: result.right.mechanicalCheckScore,
      scoreableCount: result.right.scoreableCount,
      stylePassRate: result.right.stylePassRate,
      styleScoreableCount: result.right.styleScoreableCount,
      byCategory: result.right.byCategory,
      checkResults: result.right.checkResults,
    };
    const leftRec = await recordMechanicalResult(
      store,
      buildMechanicalResultRecord({
        agentId: opts.agentId || "A7",
        goldenCaseId: opts.caseId,
        score: leftScore,
        outputSource: opts.outputSource || "canned",
        experiment,
        comparedTo: opts.rightVersion,
      }),
    );
    const rightRec = await recordMechanicalResult(
      store,
      buildMechanicalResultRecord({
        agentId: opts.agentId || "A7",
        goldenCaseId: opts.caseId,
        score: rightScore,
        outputSource: opts.outputSource || "canned",
        experiment,
        comparedTo: opts.leftVersion,
      }),
    );
    result = { ...result, recorded: { leftId: leftRec.id, rightId: rightRec.id } };
  }

  return result;
}

/** Preview: would these versions be comparable without choosing an experiment? */
export function previewVersionComparability(leftVersion, rightVersion) {
  const left = loadHistoricalArtifact(leftVersion);
  const right = loadHistoricalArtifact(rightVersion);
  const comparability = comparabilityForVersions(left, right);
  return {
    leftVersion,
    rightVersion,
    leftChecks: [...left.checks],
    rightChecks: [...right.checks],
    ...comparability,
    experiments: {
      check_coverage: {
        allowed: true,
        meaning:
          "Same output, each version's check set. Lower score = better detection.",
      },
      output_quality: {
        allowed: true,
        requiresRuler: comparability.checkSetsDiffer,
        meaning:
          "Generate under each artifact; score both with one ruler. Higher score = better output under that ruler.",
        refuseWithoutRuler: comparability.checkSetsDiffer
          ? comparability.note
          : null,
      },
    },
  };
}
