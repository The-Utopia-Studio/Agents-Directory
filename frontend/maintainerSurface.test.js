// The maintainer surface: the only place approver-only mutations are reachable.
//
// requireApprover reads a top-level `role` claim carried only by the named
// "convex" Clerk JWT template. The default __session cookie has sub/sid/iss/exp
// and no role, which is why the Clerk CLI and the Convex dashboard both fail
// these calls. That makes this panel load-bearing, not a convenience.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("./convexDirectory.js", import.meta.url), "utf8");
const authSource = readFileSync(new URL("./clerkAuth.js", import.meta.url), "utf8");

describe("the token that carries the role claim", () => {
  test("the client requests the named convex template, not the default session", () => {
    expect(authSource).toContain('const CONVEX_TEMPLATE = "convex"');
    expect(authSource).toContain("getToken({ template: CONVEX_TEMPLATE })");
  });

  test("the role is read from the token actually being sent", () => {
    expect(authSource).toContain("decodeClaims");
    expect(authSource).toMatch(/role: typeof claims\.role === "string" \? claims\.role : null/);
    // Absent must stay absent — "" would read as a role that is merely wrong.
    expect(authSource).not.toMatch(/claims\.role \|\| ""/);
  });

  test("decoding is explicitly not verification", () => {
    expect(authSource).toMatch(/Decode only, never verify/);
  });
});

describe("the gate names the missing claim", () => {
  test("no role claim explains which claim requireApprover needs", () => {
    expect(appSource).toContain("carries no <code>role</code> claim");
    expect(appSource).toContain('requireApprover needs a top-level');
    // It reports the claims that WERE present, so the diagnosis is checkable.
    expect(appSource).toContain("claimNames");
  });

  test("a wrong role reports the value it actually carries", () => {
    expect(appSource).toMatch(/but requireApprover requires/);
  });

  test("a blocked session renders the reason instead of dead buttons", () => {
    const start = appSource.indexOf("function maintainerPanelHtml()");
    const body = appSource.slice(start, start + 1200);
    expect(body).toContain("Cannot act as approver");
    // The action fieldsets are only emitted on the unblocked path.
    const blockedReturn = body.indexOf("Cannot act as approver");
    const fieldsets = body.indexOf("<fieldset>");
    expect(blockedReturn).toBeLessThan(fieldsets);
  });
});

describe("separation from the run panel is structural", () => {
  test("the maintainer route replaces the view and never renders the run panel", () => {
    expect(appSource).toContain("maintainerRouteActive()");
    const start = appSource.indexOf("function render(){");
    const body = appSource.slice(start, start + 700);
    expect(body).toMatch(/if\(maintainerRouteActive\(\)\)\{app\.innerHTML=maintainerPanelHtml\(\);return\}/);
  });

  test("the maintainer surface never records witnessed-run evidence", () => {
    const start = appSource.indexOf("// ── MAINTAINER SURFACE ──");
    const end = appSource.indexOf("// ── BOOT ──", start);
    const body = appSource.slice(start, end);
    expect(body.length).toBeGreaterThan(500);
    expect(body).not.toContain("recordVerifiedHumanRunEvidence");
    expect(body).not.toContain("recordWitnessedRun");
  });

  test("the run path still never authors an eval result", () => {
    const start = appSource.indexOf("async function recordWitnessedRun(");
    const body = appSource.slice(start, start + 1600);
    expect(body).not.toMatch(/recordEvalResult|createEvalSet|createEvalCase/);
  });
});

describe("eval results must name what was checked", () => {
  test("the panel refuses an empty criterion set before the round trip", () => {
    expect(appSource).toContain("EVAL_RESULT_NAMES_NOTHING");
    expect(appSource).toContain("An eval result must NAME WHAT WAS CHECKED");
  });

  test("a rubric with no criteria cannot create an eval set", () => {
    expect(appSource).toMatch(/at least one rubric criterion are required/);
  });
});

describe("every outcome is rendered with its reason", () => {
  test("refusals surface code, status and message", () => {
    expect(appSource).toContain("function maintErrText(");
    expect(appSource).toMatch(/code: \$\{data\.code\}/);
    expect(appSource).toMatch(/status: \$\{data\.status\}/);
  });

  test("both success and refusal render — nothing returns silently", () => {
    const start = appSource.indexOf("async function maintRun(");
    const body = appSource.slice(start, start + 500);
    expect(body).toContain("— OK");
    expect(body).toContain("— REFUSED");
    expect(body).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\}/);
  });

  test("a not-sent action says why rather than doing nothing", () => {
    expect(appSource).toContain("— NOT SENT");
  });
});

describe("the candidate preview", () => {
  test("preview never writes evidence — attesting is a separate explicit action", () => {
    const start = appSource.indexOf("async function maintPreviewCandidate(");
    const body = appSource.slice(start, appSource.indexOf("async function maintAttestPreview("));
    expect(body).not.toContain("recordCandidatePreviewEvidence");
    // The panel reports the SERVICE's evidenceRecorded flag and its stated next
    // action, rather than a hardcoded sentence that would keep claiming "no
    // evidence recorded" even if that stopped being true.
    expect(body).toContain("r.evidenceRecorded===true");
    expect(body).toContain("r.nextRequiredAction");
    // The attest button exists, so the human must choose.
    expect(body).toContain('data-maint="attest-preview"');
    expect(body).toContain('data-maint="discard-preview"');
  });

  test("attesting refuses when no preview was read", () => {
    const start = appSource.indexOf("async function maintAttestPreview(");
    const body = appSource.slice(start, start + 700);
    expect(body).toMatch(/No preview is awaiting a decision/);
    expect(body).toContain("evidence must attest output you actually read");
  });

  test("discarding leaves no half-state and says the cost still stands", () => {
    const start = appSource.indexOf("function maintDiscardPreview(");
    const body = appSource.slice(start, start + 700);
    expect(body).toContain("No evidence was recorded");
    expect(body).toContain("the pointer has not moved");
    expect(body).toContain("the money was spent");
  });

  test("the candidate digest is required before a preview is sent", () => {
    const start = appSource.indexOf("async function maintPreviewCandidate(");
    const body = appSource.slice(start, start + 900);
    expect(body).toContain("NOT SENT");
    expect(body).toMatch(/verified against that digest at run time/);
  });

  test("cost is reported, and an unrecorded spend says so", () => {
    const start = appSource.indexOf("async function maintPreviewCandidate(");
    const body = appSource.slice(start, appSource.indexOf("async function maintAttestPreview("));
    expect(body).toContain("costRecorded");
    expect(body).toContain("COST NOT RECORDED");
    expect(body).toContain("real model call and costs real money");
  });

  test("check results are rendered with tiers, and a blocking failure refuses", () => {
    const start = appSource.indexOf("async function maintPreviewCandidate(");
    const body = appSource.slice(start, appSource.indexOf("async function maintAttestPreview("));
    // The preview must be at least as informative as the scorer on the same
    // bytes — results, tiers, and the check set that produced them.
    expect(body).toContain("checkResults");
    expect(body).toContain("checkSetId");
    expect(body).toContain("groundingPassRate");
    expect(body).toContain("NOT ATTESTABLE");
    expect(body).toContain("Recording evidence is refused");
    // Refused, not warned: the plain attest button only appears when clean.
    expect(body).toContain("Override and record evidence");
  });

  test("an override without a stated reason is not sent", () => {
    const start = appSource.indexOf("async function maintAttestPreview(");
    const body = appSource.slice(start, start + 1200);
    expect(body).toContain("Attesting is refused without a stated reason");
    expect(body).toContain("overrideReason");
    expect(body).toContain("blockingCheckIds");
  });

  test("the source kind is shown to the human but never sent by the browser", () => {
    // Displayed, so the reader knows what was executed.
    expect(appSource).toContain("synthetic golden fixture");
    expect(appSource).toContain("pasted material");
    expect(appSource).toContain("leave blank to fall back to the synthetic golden fixture");
    // NOT sent: the mutation reads provenance off the service execution proof.
    // A browser saying what a run executed against is the attester grading
    // their own homework, which is how a fixture run could be labelled real.
    const start = clientSource.indexOf("async recordCandidatePreviewEvidence(");
    const body = clientSource.slice(start, start + 700);
    expect(body).not.toMatch(/previewSourceKind\s*[,:]/);
    expect(body).not.toMatch(/blockingCheckIds\s*[,:]/);
    expect(body).toContain("overrideReason");
  });

  test("executionKind is rendered wherever evidence provenance is shown", () => {
    expect(appSource).toContain("function maintExecutionKindLabel(");
    expect(appSource).toContain("CANDIDATE PREVIEW — not a run any fellow received");
    // An absent kind must read as legacy/production, never as blank.
    expect(appSource).toContain("execution kind not recorded");
  });
});

describe("the client exposes exactly the confirmed scope", () => {
  test("all six approver-only functions are wired", () => {
    for (const ref of [
      "evidenceIntegrity:listServicePromotionViolations",
      "evidenceIntegrity:backfillServicePromotionEligibility",
      "reimports:executeApprovedA7V10Release",
      "reimports:executeApprovedA10V4Release",
      "evalSets:createEvalSet",
      "evalSets:createEvalCase",
      "evalResults:recordEvalResult",
      "reviews:approve",
      "evidence:recordCandidatePreviewEvidence",
    ]) {
      expect(clientSource).toContain(ref);
    }
  });

  test("approve is pinned to no-edit rather than taking an edit category", () => {
    expect(clientSource).toContain('editCategory: "no-edit"');
  });

  test("the release digest is caller-supplied, not hardcoded in the client", () => {
    expect(clientSource).toContain("executeA7V10Release(releaseManifestDigest)");
    expect(clientSource).not.toMatch(/f892dad7|a066599a/);
  });
});
