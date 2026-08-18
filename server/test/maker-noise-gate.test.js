// The maker's noise gate: no proposal without a classified, non-advisory
// defect observed on the artifact running now.
//
// The regression this exists for is concrete. The maker emitted a proposal —
// with an Approve button, and now a path to moving the Convex pointer — off
// seeded trace traces_msechv2w_be6i: pinned to biocraft-singleshot-v5 under
// anthropic/claude-sonnet-4-6, two artifact generations behind live, whose two
// tokens were an unregistered runtime string and an advisory CTA observation.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAKER_REFUSAL,
  assertMakerDefectGate,
  evaluateMakerDefectGate,
} from "../src/improve/makerNoiseGate.js";
import { getRuntimeArtifactDescriptor } from "../src/invoke/runtimeArtifacts.js";

const LIVE = getRuntimeArtifactDescriptor("A7");
const LIVE_DIGEST = LIVE.artifactDigest;

const liveTrace = (fields) => ({
  id: "traces_live_1",
  artifactVersion: LIVE.artifactVersion,
  artifactDigest: LIVE_DIGEST,
  outputSource: "live",
  ...fields,
});

function gate(evidence, liveArtifactDigest = LIVE_DIGEST) {
  return evaluateMakerDefectGate({ evidence, liveArtifactDigest });
}

// ── The three named refusals ─────────────────────────────────────────────────

test("REFUSAL 1: empty evidence", () => {
  const verdict = gate({ failingTraces: [], mechanicalResults: [], feedback: [], defectSignals: [] });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.refusal.code, MAKER_REFUSAL.NO_EVIDENCE);
  assert.match(verdict.refusal.message, /no evidence at all/);
  assert.equal(verdict.qualifying.length, 0);
});

test("REFUSAL 2: seeded fixture data — the exact stale trace that caused this", () => {
  // Verbatim shape of traces_msechv2w_be6i from the seeded store.
  const seeded = {
    id: "traces_msechv2w_be6i",
    status: "fail",
    source: "real",
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    artifactVersion: "biocraft-singleshot-v5",
    artifactDigest:
      "c5cc1a587a10deb6fb1b2ee73fed0c31fcad96fa12ed58bc5907544e408df92b",
    failureReason:
      "generated_sections_have_no_delimiter_separated_keyword_run, about_closing_has_cta",
  };
  const verdict = gate({ failingTraces: [seeded], feedback: [], mechanicalResults: [] });

  assert.equal(verdict.ok, false, "the stale seeded trace must NOT produce a proposal");
  assert.equal(verdict.refusal.code, MAKER_REFUSAL.FIXTURE_EVIDENCE_ONLY);
  assert.match(verdict.refusal.message, /superseded/);
  assert.equal(verdict.sawLiveEvidence, false);
  // It names which artifact it was pinned to rather than just saying "stale".
  assert.match(
    verdict.rejected[0].detail,
    /pinned to superseded artifact biocraft-singleshot-v5/,
  );

  // A canned mechanical row is refused the same way.
  const canned = gate({
    mechanicalResults: [
      { id: "m1", artifactDigest: LIVE_DIGEST, outputSource: "canned", failed: ["draft_has_no_em_dash"] },
    ],
  });
  assert.equal(canned.ok, false);
  assert.equal(canned.refusal.code, MAKER_REFUSAL.FIXTURE_EVIDENCE_ONLY);
  assert.match(canned.rejected[0].detail, /outputSource canned, not live/);
});

test("REFUSAL 3: unclassified runtime failure strings", () => {
  const verdict = gate({
    failingTraces: [
      liveTrace({ failureReason: "generated_sections_have_no_delimiter_separated_keyword_run" }),
    ],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.refusal.code, MAKER_REFUSAL.UNCLASSIFIED_ONLY);
  assert.match(
    verdict.refusal.message,
    /generated_sections_have_no_delimiter_separated_keyword_run/,
  );
  // The point: it is a registry gap, not a prompt defect.
  assert.match(verdict.refusal.message, /registry gap to reconcile/);
  assert.equal(verdict.sawLiveEvidence, true, "the row WAS live — the token is the problem");
});

// ── The advisory case, which the same stale trace also hits ──────────────────

test("advisory-only live evidence refuses by its own name", () => {
  const verdict = gate({
    failingTraces: [liveTrace({ failureReason: "about_closing_has_cta" })],
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.refusal.code, MAKER_REFUSAL.ADVISORY_ONLY);
  assert.match(verdict.rejected[0].detail, /advisory — an observation, never a defect/);
});

// ── What DOES clear the gate ─────────────────────────────────────────────────

test("a classified scored defect on the live artifact clears the gate", () => {
  const verdict = gate({
    failingTraces: [liveTrace({ failureReason: "draft_has_no_em_dash" })],
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.refusal, null);
  assert.deepEqual(verdict.qualifying.map((q) => q.checkId), ["draft_has_no_em_dash"]);
  assert.equal(verdict.qualifying[0].artifactDigest, LIVE_DIGEST);
});

test("a live mechanical row with a scored failure clears the gate", () => {
  const verdict = gate({
    mechanicalResults: [
      {
        id: "m1",
        artifactDigest: LIVE_DIGEST,
        outputSource: "live",
        failed: ["about_has_no_delimiter_separated_keyword_run"],
      },
    ],
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.qualifying.map((q) => q.checkId), [
    "about_has_no_delimiter_separated_keyword_run",
  ]);
});

test("prose that resolves in a closed catalogue is classified; prose that does not is refused", () => {
  // "Classified" means resolves in SOME closed vocabulary. The thing excluded
  // is the maker's own unclassified:<token> fallback for an unrecognised string.
  const catalogued = gate({
    failingTraces: [liveTrace({ failureReason: "voice mismatch" })],
  });
  assert.equal(catalogued.ok, true);
  assert.equal(catalogued.qualifying[0].checkId, "trace-defect:voice");

  const uncatalogued = gate({
    failingTraces: [liveTrace({ failureReason: "the model seemed a bit off today" })],
  });
  assert.equal(uncatalogued.ok, false);
  assert.match(
    uncatalogued.rejected[0].detail,
    /matches no registered check id and no trace-defect catalogue entry/,
  );
});

test("one classified defect is enough even beside noise", () => {
  const verdict = gate({
    failingTraces: [
      liveTrace({
        id: "t_mixed",
        failureReason:
          "about_closing_has_cta, made_up_future_check, draft_has_no_em_dash",
      }),
    ],
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.qualifying.map((q) => q.checkId), ["draft_has_no_em_dash"]);
  // The noise is still reported, not silently dropped.
  assert.equal(verdict.rejected.length, 2);
});

// ── Scope ────────────────────────────────────────────────────────────────────

test("an agent with no runtime artifact is skipped with a stated reason, not silently", () => {
  const verdict = evaluateMakerDefectGate({
    evidence: { feedback: [{ id: "f1", notes: "tone is off" }] },
    liveArtifactDigest: null,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.skipped, true);
  assert.match(verdict.skipReason, /no runtime artifact/);
});

test("the throwing form carries the code and status", () => {
  assert.throws(
    () => assertMakerDefectGate({ evidence: {}, liveArtifactDigest: LIVE_DIGEST }),
    (error) => {
      assert.equal(error.status, 422);
      assert.equal(error.code, MAKER_REFUSAL.NO_EVIDENCE);
      assert.ok(Array.isArray(error.detail.rejected));
      return true;
    },
  );
});
