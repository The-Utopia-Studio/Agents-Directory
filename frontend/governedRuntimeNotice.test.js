// The panel must be able to tell "verified" from "never verified", and must
// show what the service said about the execution proof.
//
// These tests EXECUTE the functions lifted out of app.js rather than matching
// their source. A source match passes on code that computes the right string
// and then drops it — which is the defect this file exists to catch.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

/** Lift named functions out of app.js and make them callable. */
function load(...names) {
  const bodies = names.map((name) => {
    const start = appSource.indexOf(`function ${name}(`);
    expect(start, `${name} must exist in app.js`).toBeGreaterThan(-1);
    const nextFn = appSource.indexOf("\nfunction ", start + 1);
    const nextAsync = appSource.indexOf("\nasync function ", start + 1);
    const end = Math.min(...[nextFn, nextAsync].filter((i) => i > -1));
    return appSource.slice(start, end > start ? end : undefined);
  });
  const escHtml = (v) =>
    String(v).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return new Function(
    "escHtml",
    `${bodies.join("\n")}\nreturn {${names.join(",")}};`,
  )(escHtml);
}

describe("an unverified gate does not render as a verified one", () => {
  const { governedRuntimeState, governedRuntimeNotice } = load(
    "governedRuntimeState",
    "governedRuntimeNotice",
  );

  test("the verdict distinguishes all four states", () => {
    expect(governedRuntimeState({ governedRuntime: { matched: true, skipped: false } })).toBe("verified");
    expect(governedRuntimeState({ governedRuntime: { matched: true, skipped: true } })).toBe("unverified");
    expect(governedRuntimeState({ governedRuntime: { matched: false } })).toBe("refused");
    // The pre-fix server stripped the verdict on skip. That shape must not
    // resolve to "verified" — it is the exact case that hid an ungoverned
    // download behind a 200.
    expect(governedRuntimeState({})).toBe("absent");
  });

  test("a skipped gate produces a notice that says the bytes are unchecked", () => {
    const notice = governedRuntimeNotice({ governedRuntime: { matched: true, skipped: true } });
    expect(notice).not.toBe("");
    expect(notice).toContain("Runtime not verified");
    expect(notice).toContain("WITHOUT a digest check");
    expect(notice).toContain("may not be the approved bytes");
  });

  test("a stripped verdict is reported as unknown, not as success", () => {
    const notice = governedRuntimeNotice({ invocationType: "link" });
    expect(notice).toContain("not reported");
    expect(notice).toContain("unknown");
  });

  test("a verified gate adds no noise", () => {
    expect(governedRuntimeNotice({ governedRuntime: { matched: true, skipped: false } })).toBe("");
  });
});

describe("the preview surfaces what the service said about the proof", () => {
  // The proof block is an expression inside maintPreviewCandidate. Lift and
  // evaluate it against a response object, so this asserts the RENDERED text.
  function renderProof(r) {
    const start = appSource.indexOf("    const proof=r.executionProofRecorded===true");
    expect(start, "the proof block must exist").toBeGreaterThan(-1);
    const end = appSource.indexOf("    const spend=", start);
    const escHtml = (v) => String(v);
    return new Function("r", "escHtml", `${appSource.slice(start, end)}\nreturn proof;`)(r, escHtml);
  }

  test("a recorded proof says the attestation has something to consume", () => {
    const html = renderProof({ executionProofRecorded: true });
    expect(html).toContain("Execution proof recorded");
    expect(html).not.toContain("EXECUTION_PROOF_REQUIRED");
  });

  test("an unrecorded proof shows the REASON and predicts the 409", () => {
    // This is the hour that was lost: the service returned this reason and the
    // panel discarded it, so the failure first appeared as a bare 409 on a
    // later click with nothing linking it back to the preview.
    const html = renderProof({
      executionProofRecorded: false,
      executionProofReason: "Convex authority is not configured on this service",
    });
    expect(html).toContain("EXECUTION PROOF NOT RECORDED");
    expect(html).toContain("Convex authority is not configured on this service");
    expect(html).toContain("EXECUTION_PROOF_REQUIRED");
    expect(html).toContain("409");
    // And it must not imply the preview failed — it ran, and it cost money.
    expect(html).toContain("the spend is real");
  });

  test("a missing reason still renders rather than printing undefined", () => {
    const html = renderProof({ executionProofRecorded: false });
    expect(html).toContain("the service gave no reason");
    expect(html).not.toContain("undefined");
  });
});
