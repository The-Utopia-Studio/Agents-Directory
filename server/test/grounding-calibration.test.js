import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { buildApp } from "../src/http/server.js";
import { config } from "../src/config.js";
import { seed } from "../src/scripts/seed.js";
import {
  digestSpan,
  findTextForDigest,
  summarizeCalibration,
  GROUNDING_VERDICT,
  SEED_CALIBRATION_FINDINGS,
  falsePositiveExclusions,
  isCalibratedFalsePositive,
  sanitizeFailingTraceForMaker,
  systematicFalsePositiveChecks,
} from "../src/eval/groundingCalibration.js";
import { collectDefects } from "../src/improve/heuristicOptimizer.js";
import {
  identityHeaders,
  testClerkOptions,
} from "./clerkTestIdentity.js";

async function listen(app, t) {
  const server = createServer(app.handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test("findTextForDigest recovers the span that produced a digest", () => {
  const source =
    "AI Intern at Rock River Research. Client work with Hutcheon Mearns on Pearlify.";
  const span = "Client work with Hutcheon Mearns";
  const digest = digestSpan(span);
  assert.equal(findTextForDigest(source, digest), span);
});

test("summarizeCalibration reports false-positive rate", () => {
  const summary = summarizeCalibration([
    { verdict: GROUNDING_VERDICT.FALSE_POSITIVE },
    { verdict: GROUNDING_VERDICT.TRUE_POSITIVE },
    { verdict: GROUNDING_VERDICT.FALSE_POSITIVE },
  ]);
  assert.equal(summary.labeled, 3);
  assert.equal(summary.falsePositive, 2);
  assert.equal(summary.truePositive, 1);
  assert.equal(summary.falsePositiveRate, 0.667);
});

test("calibrated false positives are excluded from maker defects", () => {
  const seed = SEED_CALIBRATION_FINDINGS[0];
  const exclusions = falsePositiveExclusions([seed], { agentId: "A7" });
  const trace = {
    id: seed.traceId,
    status: "fail",
    failureReason: "source_claim_employer_frame",
    checkResults: [
      {
        checkId: "source_claim_employer_frame",
        claimSpanDigest: seed.claimSpanDigest,
        sourceSpanDigest: seed.sourceSpanDigest,
      },
    ],
  };
  assert.equal(
    isCalibratedFalsePositive("source_claim_employer_frame", trace, exclusions),
    true,
  );
  assert.equal(
    sanitizeFailingTraceForMaker(trace, exclusions),
    null,
  );

  const other = {
    id: "traces_other",
    status: "fail",
    failureReason: "about_closing_has_cta",
    checkResults: [{ checkId: "about_closing_has_cta" }],
  };
  const kept = sanitizeFailingTraceForMaker(other, exclusions);
  assert.equal(kept.failureReason, "about_closing_has_cta");

  const defects = collectDefects(
    { id: "A7", guardrails: ["Never fabricate"] },
    {
      failingTraces: [trace, other].map((t) =>
        sanitizeFailingTraceForMaker(t, exclusions),
      ).filter(Boolean),
      defectSignals: ["about_closing_has_cta"],
      feedback: [],
      calibration: { checkProblems: [], falsePositiveExclusions: exclusions },
    },
    {
      text: "## Method\n\n1. Draft.\n\n## Guardrails\n\n1. Never fabricate.\n",
      checks: [],
    },
  );
  assert.ok(!defects.some((d) => d.key === "source_claim_employer_frame"));
  assert.ok(defects.some((d) => d.key === "about_closing_has_cta"));
});

test("systematic false positives surface as check problems, not agent defects", () => {
  const rows = [
    {
      verdict: GROUNDING_VERDICT.FALSE_POSITIVE,
      checkId: "source_claim_employer_frame",
      traceId: "t1",
    },
    {
      verdict: GROUNDING_VERDICT.FALSE_POSITIVE,
      checkId: "source_claim_employer_frame",
      traceId: "t2",
    },
  ];
  const problems = systematicFalsePositiveChecks(rows);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].checkId, "source_claim_employer_frame");
  assert.equal(problems[0].falsePositiveCases, 2);
  assert.match(problems[0].message, /fix the checker/);
});

test("grounding calibration seed and label endpoint", async (t) => {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-calib-")));
  await seed(store);
  const app = await buildApp({
    store,
    config: { ...config, apiToken: "", clerk: testClerkOptions() },
  });
  const base = await listen(app, t);

  const listed = await fetch(`${base}/api/agents/A7/grounding-calibration`);
  assert.equal(listed.status, 200);
  const body = await listed.json();
  assert.ok(body.findings.some((f) => f.id === SEED_CALIBRATION_FINDINGS[0].id));
  assert.equal(body.summary.falsePositive, 1);
  assert.equal(body.summary.falsePositiveRate, 1);

  const seedRow = SEED_CALIBRATION_FINDINGS[0];
  const recorded = await fetch(`${base}/api/agents/A7/grounding-calibration`, {
    method: "POST",
    headers: identityHeaders(),
    body: JSON.stringify({
      traceId: seedRow.traceId,
      checkId: seedRow.checkId,
      claimKind: seedRow.claimKind,
      claimSpanDigest: seedRow.claimSpanDigest,
      sourceSpanDigest: seedRow.sourceSpanDigest,
      verdict: "true_positive",
      notes: "counterfactual label for test only",
    }),
  });
  assert.equal(recorded.status, 201);
  const recordedBody = await recorded.json();
  assert.equal(recordedBody.recorded.verdict, "true_positive");
  assert.equal(recordedBody.summary.labeled >= 2, true);
});
