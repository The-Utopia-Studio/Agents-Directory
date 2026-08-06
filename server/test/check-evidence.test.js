// A mechanical check failure has to survive as evidence. Before this, the
// checker's verdict was stripped twice — once by the loopService allowlist and
// again by the observability adapter — so `failureReason` was always empty and
// the maker refused with 422 on an agent that had genuinely failed runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { createLocalObservability } from "../src/observability/localAdapter.js";
import { createLoopService } from "../src/core/loopService.js";
import { getOptimizer } from "../src/improve/index.js";
import { getMemory } from "../src/memory/index.js";
import {
  KNOWN_CHECK_IDS,
  sanitizeCheckResults,
  sanitizeFailureReason,
} from "../src/core/traceSafety.js";
import { seed } from "../src/scripts/seed.js";

const FAILED_CHECK = {
  checkId: "about_closing_has_cta",
  message: "No CTA detected in the closing of the LinkedIn About",
  sectionFound: true,
  paragraphCount: 4,
  windowParagraphs: 2,
  windowChars: 180,
  hasContactChannel: false,
  hasImperativeOpener: false,
  hasInvitationFrame: false,
};

async function serviceWithCheckFailure() {
  const store = createStore(await mkdtemp(join(tmpdir(), "adir-checkev-")));
  await seed(store);
  const config = {
    observability: { lowScoreThreshold: 70, feedbackNotes: true, feedbackNotesMaxChars: 2000 },
    optimizer: { provider: "heuristic" },
    memory: { provider: "local", topK: 5 },
    loop: {},
  };
  const obs = createLocalObservability({ store, lowScoreThreshold: 70 });
  const svc = createLoopService({
    store,
    obs,
    optimizer: getOptimizer(config),
    memory: getMemory(config, { store }),
    verifier: null,
    config,
  });
  return { store, obs, svc };
}

test("a check failure is status fail, not error, and keeps the check id", async () => {
  const { obs, svc, store } = await serviceWithCheckFailure();
  await obs.recordTrace(
    {
      agentId: "A7",
      status: "fail",
      source: "real",
      failureReason: "about_closing_has_cta",
      checkResults: [FAILED_CHECK],
      inputTokens: 900,
      outputTokens: 400,
      totalTokens: 1300,
      metadata: { via: "runtime", mode: "single-shot" },
    },
    { persistRuntime: true },
  );

  const [trace] = await store.all("traces");
  assert.equal(trace.status, "fail");
  assert.equal(trace.failureReason, "about_closing_has_cta");
  assert.equal(trace.checkResults[0].hasContactChannel, false);
  // Spend stays attributable even though the run missed the bar.
  assert.equal(trace.totalTokens, 1300);

  // "fail" (ran, missed the bar) and "error" (did not run) must both surface.
  const failing = await obs.getFailingTraces("A7", { limit: 10 });
  assert.equal(failing.length, 1);
  assert.equal(failing[0].failureReason, "about_closing_has_cta");
  assert.ok(svc);
});

test("a check failure reaches the maker, which refuses an ambiguous edit", async () => {
  const { obs, svc } = await serviceWithCheckFailure();

  // Before any evidence exists the maker must still refuse.
  await assert.rejects(
    () => svc.runImprovement("A7"),
    (error) => {
      assert.equal(error.status, 422);
      return true;
    },
  );

  await obs.recordTrace(
    {
      agentId: "A7",
      status: "fail",
      source: "real",
      failureReason: "about_closing_has_cta",
      checkResults: [FAILED_CHECK],
      metadata: { via: "runtime", mode: "single-shot" },
    },
    { persistRuntime: true },
  );

  const evidence = await svc.collectImprovementEvidence(
    "A7",
    await svc.getAgent("A7"),
  );
  assert.equal(evidence.failingTraces.length, 1);
  assert.deepEqual(evidence.defectSignals, ["about_closing_has_cta"]);

  // The mechanically-generated signal reaches the optimizer, but three false
  // detector booleans cannot tell it whether the draft or checker is wrong.
  // Refusal is safer than inventing a prompt/check edit.
  await assert.rejects(
    () => svc.runImprovement("A7"),
    (error) => {
      assert.equal(error.status, 422);
          assert.match(error.message, /could not be classified into an exact/);
      return true;
    },
  );
});

test("the trace boundary is a closed vocabulary, not a shape check", () => {
  // Registered ids pass.
  assert.equal(
    sanitizeFailureReason("about_closing_has_cta"),
    "about_closing_has_cta",
  );
  assert.equal(
    sanitizeFailureReason("about_hook_max_200_characters, empty_output"),
    "about_hook_max_200_characters, empty_output",
  );

  // Anything that could carry model output or a fellow's details does not.
  for (const unsafe of [
    "Anthropic Messages API returned 502",
    "Haniyah Umair",
    "hook was: I help venture teams turn complex ideas into practical tools",
    "Runtime output failed mechanical checks: LinkedIn About closing has no CTA",
  ]) {
    assert.equal(sanitizeFailureReason(unsafe), null, `must reject: ${unsafe}`);
  }

  // Membership, not shape: an unregistered token that LOOKS like an id is
  // rejected, and it poisons the whole string rather than being dropped.
  assert.equal(sanitizeFailureReason("plausible_looking_id"), null);
  assert.equal(
    sanitizeFailureReason("about_closing_has_cta, invented_later"),
    null,
  );
  assert.deepEqual(sanitizeCheckResults([{ checkId: "not_registered" }]), []);

  // Facts survive; anything text-shaped is dropped, including the message and
  // any matched excerpt a future caller might attach.
  const [clean] = sanitizeCheckResults([
    {
      ...FAILED_CHECK,
      matchedText: "reach out to me at hello@example.com",
      excerpt: "I help venture teams",
      finalParagraph: "The work stays grounded.",
    },
  ]);
  assert.equal(clean.checkId, "about_closing_has_cta");
  assert.equal(clean.windowChars, 180);
  assert.equal(clean.hasContactChannel, false);
  assert.equal("message" in clean, false);
  assert.equal("matchedText" in clean, false);
  assert.equal("excerpt" in clean, false);
  assert.equal("finalParagraph" in clean, false);

  assert.deepEqual(sanitizeCheckResults([{ checkId: "Not A Check Id" }]), []);
  assert.deepEqual(sanitizeCheckResults("nope"), []);
});

test("the trace vocabulary does not drift from the declarable checks", async () => {
  // traceSafety duplicates the id list to keep observability free of artifact
  // loading. Duplication is only safe with a guard against the two diverging.
  const source = await readFile(
    new URL("../src/invoke/runtimeArtifacts.js", import.meta.url),
    "utf8",
  );
  const declarable = [
    ...source
      .match(/const RUNTIME_CHECKS = new Set\(\[([\s\S]*?)\]\)/)[1]
      .matchAll(/"([a-z0-9_]+)"/g),
  ].map((m) => m[1]);

  for (const id of declarable) {
    assert.ok(
      KNOWN_CHECK_IDS.includes(id),
      `${id} is declarable in frontmatter but cannot be recorded on a trace`,
    );
  }
  // Every id the runtime can emit, declarable or not, must be recordable.
  assert.ok(KNOWN_CHECK_IDS.includes("about_section_present"));
  assert.ok(
    KNOWN_CHECK_IDS.includes("source_no_employer_frame_for_marked_non_employer"),
  );
});
