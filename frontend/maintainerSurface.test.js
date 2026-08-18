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
