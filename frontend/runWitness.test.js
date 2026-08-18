// The Run → evidence wiring, asserted against app.js source.
//
// The row asserts a human saw output. So it may only be written when output
// actually reached the browser, and it must name the digest the run reported
// having SERVED — not the digest we expected. Attesting to expected bytes when
// different bytes ran is the fabrication this path exists to prevent.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const clientSource = readFileSync(
  new URL("./convexDirectory.js", import.meta.url),
  "utf8",
);

function fn(name) {
  const start = appSource.indexOf(`async function ${name}(`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const next = appSource.indexOf("\nasync function ", start + 1);
  const alt = appSource.indexOf("\nfunction ", start + 1);
  const end = Math.min(...[next, alt].filter((i) => i > -1));
  return appSource.slice(start, end > start ? end : undefined);
}

describe("the browser writes the evidence, not Railway", () => {
  test("the mutation is called through the Convex client, not the Railway API", () => {
    expect(clientSource).toContain("evidence:recordVerifiedHumanRunEvidence");
    // If this went through DirectoryAPI it would be a Railway call with the
    // deploy key, which can only ever produce actorKind "service".
    expect(appSource).not.toMatch(
      /DirectoryAPI\.\w*[Ee]vidence|DirectoryAPI\.recordVerifiedHumanRun/,
    );
    expect(appSource).toContain(
      "ConvexDirectory.recordVerifiedHumanRunEvidence",
    );
  });
});

describe("only a run that returned output writes evidence", () => {
  const body = fn("recordWitnessedRun");

  test("empty or missing output writes nothing", () => {
    expect(body).toMatch(/if\(!output\.trim\(\)\)return null/);
  });

  test("needs_input writes nothing", () => {
    expect(body).toMatch(/needs_input/);
    expect(body).toMatch(/return null/);
  });

  test("a non-terminal run status writes nothing", () => {
    expect(body).toMatch(/result\.status!=="ok"&&result\.status!=="fail"/);
  });

  test("the call sits inside the try, after renderRunResult", () => {
    // A throw — including the digest gate's 409 — must never reach it.
    const run = fn("runAgentUI");
    const rendered = run.indexOf("renderRunResult(id,r)");
    const witnessed = run.indexOf("recordWitnessedRun(id,r)");
    const caught = run.indexOf("}catch(e)");
    expect(rendered).toBeGreaterThan(-1);
    expect(witnessed).toBeGreaterThan(rendered);
    expect(witnessed).toBeLessThan(caught);
  });

  test("the gap-fill completion path is wired the same way", () => {
    const gap = fn("continueGapFillUI");
    expect(gap).toContain("recordWitnessedRun(id,r)");
    const witnessed = gap.indexOf("recordWitnessedRun(id,r)");
    expect(witnessed).toBeLessThan(gap.indexOf("}catch(e)"));
  });
});

describe("the digest recorded is the one actually served", () => {
  const body = fn("recordWitnessedRun");

  test("it reads the digest off the run result", () => {
    expect(body).toContain("result.artifactDigest");
  });

  test("it never reads the expected pin from runCapabilities", () => {
    expect(body).not.toContain("runCapabilities");
    expect(body).not.toMatch(/expectedDigest/);
  });

  test("a malformed or absent served digest records nothing and says so", () => {
    expect(body).toMatch(/\^\[a-f0-9\]\{64\}\$/i);
    expect(body).toContain("reported no served artifact digest");
  });
});

describe("the evalResult stays off this surface", () => {
  test("the run path never creates an eval result or eval set", () => {
    for (const body of [fn("recordWitnessedRun"), fn("runAgentUI"), fn("continueGapFillUI")]) {
      expect(body).not.toMatch(/recordEvalResult|createEvalSet|createEvalCase/);
    }
  });

  test("the run wiring never reaches the eval-result mutation", () => {
    // The client DOES expose recordEvalResult, because the maintainer surface
    // authors eval results — it is the only surface that can, since
    // requireApprover needs the convex-template role claim. The separation
    // that matters is that no run-path code can reach it, so it is asserted on
    // the run functions rather than on the client's method list.
    expect(clientSource).toContain("evidence:recordVerifiedHumanRunEvidence");
    expect(clientSource).toContain("evalResults:recordEvalResult");
    for (const body of [fn("recordWitnessedRun"), fn("runAgentUI"), fn("continueGapFillUI")]) {
      expect(body).not.toMatch(/recordEvalResult|createEvalSet|createEvalCase|approveProposal/);
    }
  });

  test("the notice tells the human evidence is not promotion", () => {
    expect(appSource).toContain("This is not an eval result");
    expect(appSource).toContain("promotion additionally requires one, recorded separately");
  });
});

describe("a failure to record is surfaced, never swallowed", () => {
  const body = fn("recordWitnessedRun");

  test("a thrown mutation returns a stated reason rather than null", () => {
    expect(body).toMatch(/catch\(e\)\{\s*return\{recorded:false,reason:/);
  });

  test("the notice says the promotion gate got nothing", () => {
    expect(appSource).toContain("The promotion gate has nothing from this run");
  });
});
