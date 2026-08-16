// Orchestrate mechanical compare experiments. See compareExperiments.js.

import { loadHistoricalArtifact, HISTORICAL_ARTIFACT_REGISTRY } from "./historicalArtifacts.js";
import { getGoldenCase, listGoldenCases } from "./goldenCases.js";
import { getRuntimeArtifactDescriptor } from "../invoke/runtimeArtifacts.js";
import { holdoutSplitForCase, scoresByHoldout } from "./holdout.js";
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

function loadScoringArtifact(agentId, artifactVersion) {
  if (artifactVersion && HISTORICAL_ARTIFACT_REGISTRY[artifactVersion]) {
    return loadHistoricalArtifact(artifactVersion);
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

function scoreWith({
  output,
  scoringArtifact,
  sourceGroundingRules,
  sourceText,
  generatingArtifact = null,
  rulerVersion = null,
}) {
  // When a ruler scores another artifact's output:
  //   artifactVersion/digest = generating prompt (never the ruler)
  //   checks / checkSetId / guardrails = scoring (ruler) artifact
  //   rulerVersion = identity of the shared check set source
  const generating = generatingArtifact || scoringArtifact;
  return scoreMechanicalOutput({
    output,
    artifactVersion: generating.artifactVersion,
    artifactDigest: generating.artifactDigest,
    declaredChecks: scoringArtifact.checks,
    sourceGroundingRules,
    sourceText,
    guardrails: scoringArtifact.guardrails || [],
    rulerVersion,
    checkSetVersion: null,
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
  if (golden.agentId && agentId && golden.agentId !== agentId) {
    refuse(
      `Golden case ${caseId} belongs to ${golden.agentId}, not ${agentId}`,
      400,
    );
  }

  let artifact;
  try {
    artifact = loadScoringArtifact(agentId, artifactVersion);
  } catch (error) {
    return {
      ok: false,
      verification: "failed",
      label: "mechanical_check_score",
      artifactVersion: artifactVersion || null,
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
    sealed: golden.sealed === true,
    holdout: holdoutSplitForCase(caseId),
    outputSource,
    outputProvenance:
      outputSource === "live" ? "live_generation" : "canned_fixtures",
    answersDidImprovementHelp: false,
    findingKind:
      outputSource === "live" ? "single_version_live_score" : "plumbing_verification",
    artifactVersion: artifact.artifactVersion,
    artifactDigest: artifact.artifactDigest,
    artifactDigestAlgorithm: "sha256",
    checkSetId: score.checkSetId,
    checkSetVersion: score.checkSetVersion,
    rulerVersion: score.rulerVersion || null,
    guardrailGate: score.guardrailGate,
    declaredChecks: [...artifact.checks],
    groundingPassRate: score.groundingPassRate,
    groundingScoreableCount: score.groundingScoreableCount,
    groundingBasisCheckIds: score.groundingBasisCheckIds,
    stylePassRate: score.stylePassRate,
    styleScoreableCount: score.styleScoreableCount,
    styleBasisCheckIds: score.styleBasisCheckIds,
    byCategory: score.byCategory,
    passed: [...score.passed],
    failed: [...score.failed],
    notScoreable: [...score.notScoreable],
    observations: [...(score.observations || [])],
    checkResults: score.checkResults.map((row) => ({
      id: row.id,
      checkId: row.id,
      passed: row.passed,
      why: row.why,
      severity: row.severity,
      category: row.category,
      status: row.status,
      tier: row.tier,
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
        generation,
        sealed: golden.sealed === true,
      }),
    );
    result.recordedId = recorded.id;
  }

  return result;
}

/**
 * Score every golden case for an agent. Sealed and unsealed are reported as
 * separate lists — never averaged into one number.
 */
export async function runMechanicalScoresByHoldout(opts) {
  const { agentId, artifactVersion, outputSource = "canned", config, store } = opts;
  const cases = listGoldenCases(agentId);
  const results = [];
  for (const golden of cases) {
    results.push(
      await runMechanicalScore({
        caseId: golden.id,
        artifactVersion,
        outputSource,
        agentId,
        config,
        store,
      }),
    );
  }
  const split = scoresByHoldout(results);
  return {
    ok: results.every((r) => r.ok),
    label: "mechanical_check_scores_by_holdout",
    agentId,
    artifactVersion: artifactVersion || null,
    outputSource,
    unsealed: split.unsealed,
    sealed: split.sealed,
    averaged: false,
    feedsFleetHealth: false,
    writesEvalHistory: false,
  };
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
    generatingArtifact: leftArtifact,
    rulerVersion: ruler.artifactVersion,
  });

  const right = scoreWith({
    output: rightOutput,
    scoringArtifact: ruler,
    sourceGroundingRules: golden.sourceGroundingRules,
    sourceText: golden.input,
    generatingArtifact: rightArtifact,
    rulerVersion: ruler.artifactVersion,
  });

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
      artifactVersion: result.left.artifactVersion,
      artifactDigest: result.left.artifactDigest,
      checkSetId: result.left.checkSetId,
      checkSetVersion: result.left.checkSetVersion,
      rulerVersion: result.left.rulerVersion || result.rulerVersion || null,
      guardrailGate: result.left.guardrailGate,
      passed: result.left.passed,
      failed: result.left.failed,
      notScoreable: result.left.notScoreable,
      groundingPassRate: result.left.groundingPassRate,
      groundingScoreableCount: result.left.groundingScoreableCount,
      groundingBasisCheckIds: result.left.groundingBasisCheckIds,
      stylePassRate: result.left.stylePassRate,
      styleScoreableCount: result.left.styleScoreableCount,
      styleBasisCheckIds: result.left.styleBasisCheckIds,
      byCategory: result.left.byCategory,
      checkResults: result.left.checkResults,
    };
    const rightScore = {
      artifactVersion: result.right.artifactVersion,
      artifactDigest: result.right.artifactDigest,
      checkSetId: result.right.checkSetId,
      checkSetVersion: result.right.checkSetVersion,
      rulerVersion: result.right.rulerVersion || result.rulerVersion || null,
      guardrailGate: result.right.guardrailGate,
      passed: result.right.passed,
      failed: result.right.failed,
      notScoreable: result.right.notScoreable,
      groundingPassRate: result.right.groundingPassRate,
      groundingScoreableCount: result.right.groundingScoreableCount,
      groundingBasisCheckIds: result.right.groundingBasisCheckIds,
      stylePassRate: result.right.stylePassRate,
      styleScoreableCount: result.right.styleScoreableCount,
      styleBasisCheckIds: result.right.styleBasisCheckIds,
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
        generation: result.left.generation || null,
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
        generation: result.right.generation || null,
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
