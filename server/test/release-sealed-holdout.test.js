// The release path reaches a proposal by a different route than the maker
// (merge webhook → branch → stored proposal), so it gets its own sealed-holdout
// assertion rather than assuming the maker-side P3 guard covers it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { assertProposalCarriesNoSealedMaterial } from "../src/core/loopService.js";
import { getGoldenCase, listGoldenCases } from "../src/eval/goldenCases.js";
import { listGoldenCasesByHoldout } from "../src/eval/holdout.js";

const SEALED_A7 = "a7-jonas-park-v1";
const SEALED_A10 = "a10-priya-venkat-v1";

function sealedCasesFor(agentId) {
  return listGoldenCasesByHoldout(agentId).sealed;
}

function cleanProposal(overrides = {}) {
  return {
    id: "imp_clean_0",
    summary: "Tighten the About closing",
    changes: [
      {
        surface: "prompt",
        target: "About",
        current: "Old text about the method section.",
        proposed: "New text about the method section.",
        rationale: "Failing check about_max_2600_characters on unsealed cases",
        evidence: ["trace_1", "a7-mira-okonkwo-v1"],
      },
    ],
    ...overrides,
  };
}

test("the sealed fixtures this guard protects actually exist and are sealed", () => {
  assert.equal(getGoldenCase(SEALED_A7)?.sealed, true);
  assert.equal(getGoldenCase(SEALED_A10)?.sealed, true);
  assert.equal(sealedCasesFor("A7").map((c) => c.id).includes(SEALED_A7), true);
  // An unsealed case is not caught — the guard must not block every release.
  assert.equal(getGoldenCase("a7-mira-okonkwo-v1")?.sealed, false);
});

test("a clean proposal passes and an unsealed case id is not a leak", () => {
  assert.doesNotThrow(() =>
    assertProposalCarriesNoSealedMaterial(cleanProposal(), sealedCasesFor("A7")),
  );
});

test("a sealed case id anywhere in the proposal refuses the release", () => {
  for (const proposal of [
    cleanProposal({ summary: `Fix regression seen on ${SEALED_A7}` }),
    cleanProposal({
      changes: [{ ...cleanProposal().changes[0], evidence: ["trace_1", SEALED_A7] }],
    }),
    cleanProposal({
      changes: [
        { ...cleanProposal().changes[0], rationale: `Fails on ${SEALED_A7}` },
      ],
    }),
    // Nested somewhere nobody thought to check.
    cleanProposal({ promotionGate: { notes: { detail: SEALED_A7 } } }),
  ]) {
    assert.throws(
      () => assertProposalCarriesNoSealedMaterial(proposal, sealedCasesFor("A7")),
      (err) => {
        assert.equal(err.status, 422);
        assert.equal(err.code, "sealed_material_in_release");
        assert.match(err.message, /Sealed holdout material reached the release path/);
        return true;
      },
    );
  }
});

test("verbatim sealed source text refuses even with the case id scrubbed", () => {
  const sealed = getGoldenCase(SEALED_A7);
  const span = String(sealed.input).slice(0, 200);
  assert.ok(span.length >= 64, "fixture must be long enough to sample");
  // The id never appears — only the case's own prose does.
  const proposal = cleanProposal({
    changes: [{ ...cleanProposal().changes[0], current: span }],
  });
  assert.equal(JSON.stringify(proposal).includes(SEALED_A7), false);
  assert.throws(
    () => assertProposalCarriesNoSealedMaterial(proposal, sealedCasesFor("A7")),
    /verbatim source of sealed case/,
  );
});

test("verbatim sealed canned bad output refuses — its failures are material too", () => {
  const sealed = getGoldenCase(SEALED_A7);
  const canned = String(sealed.getCannedBadOutput());
  const span = canned.slice(Math.floor(canned.length / 2), Math.floor(canned.length / 2) + 120);
  assert.ok(span.length >= 64);
  assert.throws(
    () =>
      assertProposalCarriesNoSealedMaterial(
        cleanProposal({ changes: [{ ...cleanProposal().changes[0], proposed: span }] }),
        sealedCasesFor("A7"),
      ),
    /verbatim canned bad output of sealed case/,
  );
});

test("a sealed mechanical result on the proposal refuses via the shared holdout guard", () => {
  assert.throws(
    () =>
      assertProposalCarriesNoSealedMaterial(
        cleanProposal({
          makerMechanicalResults: [{ goldenCaseId: SEALED_A7, outputSource: "live" }],
        }),
        sealedCasesFor("A7"),
      ),
    /Sealed golden cases cannot reach the maker/,
  );
});

test("the A10 sealed case is caught on the A10 release path", () => {
  assert.throws(
    () =>
      assertProposalCarriesNoSealedMaterial(
        cleanProposal({ summary: `Delimiter run seen on ${SEALED_A10}` }),
        sealedCasesFor("A10"),
      ),
    /sealed case id a10-priya-venkat-v1/,
  );
});

test("every sealed case in the registry is covered, not just the two named here", () => {
  // Guards against a third sealed case being added and silently unprotected.
  for (const agentId of ["A7", "A10"]) {
    for (const sealed of sealedCasesFor(agentId)) {
      assert.throws(
        () =>
          assertProposalCarriesNoSealedMaterial(
            cleanProposal({ summary: `mentions ${sealed.id}` }),
            sealedCasesFor(agentId),
          ),
        new RegExp(sealed.id),
        `sealed case ${sealed.id} is not protected on the release path`,
      );
    }
  }
  assert.ok(listGoldenCases("A7").length > 0);
});
