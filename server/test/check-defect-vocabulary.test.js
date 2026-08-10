import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/core/store.js";
import { createLoopService } from "../src/core/loopService.js";
import { getObservability } from "../src/observability/index.js";
import { getOptimizer } from "../src/improve/index.js";
import { getMemory } from "../src/memory/index.js";
import { getVerifier } from "../src/verify/index.js";
import { seed } from "../src/scripts/seed.js";
import { config } from "../src/config.js";
import {
  collectDefects,
  createHeuristicOptimizer,
} from "../src/improve/heuristicOptimizer.js";
import {
  listCheckDefectVocabulary,
  resolveCheckDefect,
} from "../src/improve/checkDefectRegistry.js";
import { KNOWN_CHECK_IDS } from "../src/core/traceSafety.js";

test("check defect vocabulary covers every KNOWN_CHECK_ID", () => {
  const vocab = listCheckDefectVocabulary();
  for (const id of KNOWN_CHECK_IDS) {
    assert.ok(resolveCheckDefect(id), id);
    assert.ok(vocab.some((entry) => entry.id === id));
  }
  assert.equal(resolveCheckDefect("draft_has_no_em_dash").category, "style");
  assert.equal(
    resolveCheckDefect("source_no_employer_frame_for_marked_non_employer")
      .category,
    "grounding",
  );
});

test("collectDefects maps check-id failureReasons and keeps unclassified tokens", () => {
  const agent = { id: "A7" };
  const artifact = {
    text: "# Method\n# Guardrails\nDo not use an em dash.",
    checks: ["draft_has_no_em_dash", "about_closing_has_cta"],
  };
  const defects = collectDefects(
    agent,
    {
      failingTraces: [
        {
          id: "t1",
          failureReason: "draft_has_no_em_dash, draft_has_no_em_dash",
          checkResults: [
            { checkId: "draft_has_no_em_dash", section: "LinkedIn About" },
            {
              checkId: "draft_has_no_em_dash",
              section: "Spoken event introduction",
            },
          ],
        },
        {
          id: "t2",
          failureReason: "about_closing_has_cta",
          checkResults: [{ checkId: "about_closing_has_cta" }],
        },
        {
          id: "t3",
          failureReason: "made_up_future_check",
          checkResults: [],
        },
      ],
      defectSignals: [
        "draft_has_no_em_dash",
        "about_closing_has_cta",
        "made_up_future_check",
      ],
      feedback: [],
    },
    artifact,
  );
  const keys = defects.map((d) => d.key).sort();
  assert.deepEqual(keys, [
    "about_closing_has_cta",
    "unclassified:made_up_future_check",
  ]);
  const cta = defects.find((d) => d.key === "about_closing_has_cta");
  assert.equal(cta.category, "style");
  assert.match(cta.description, /call to action/i);
  // Em-dash is post-processed in the host — not a maker defect class.
  assert.equal(
    defects.some((d) => d.key === "draft_has_no_em_dash"),
    false,
  );
  const unk = defects.find((d) => d.key === "unclassified:made_up_future_check");
  assert.equal(unk.unclassified, true);
});

test("maker proposes from A7 check-id failing traces", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adir-checkdef-"));
  const store = createStore(dir);
  await seed(store);
  const obs = getObservability(config, { store });
  // Force-persist via store so FILE_TRACE_WRITES_ENABLED does not block.
  await store.append("traces", {
    agentId: "A7",
    status: "fail",
    failureReason: "about_closing_has_cta",
    checkResults: [{ checkId: "about_closing_has_cta" }],
    ts: new Date().toISOString(),
    source: "real",
    metadata: { via: "runtime" },
  });
  const svc = createLoopService({
    store,
    obs,
    optimizer: createHeuristicOptimizer(),
    memory: getMemory(config, { store }),
    verifier: getVerifier(config),
    config: { ...config, optimizer: { ...config.optimizer, provider: "heuristic" } },
  });
  const proposals = await svc.runImprovement("A7");
  assert.ok(proposals.length >= 1);
  const keys = proposals.map((p) => p.defectKey).sort();
  assert.ok(keys.includes("about_closing_has_cta"));
  assert.equal(keys.includes("draft_has_no_em_dash"), false);
  assert.ok(proposals.every((p) => p.status === "proposed"));
});

test("optimizer surfaces unclassified failure reasons instead of dropping them", async () => {
  const optimizer = createHeuristicOptimizer();
  const proposals = await optimizer.propose(
    { id: "A7" },
    {
      traces: [{ id: "t1" }],
      failingTraces: [
        { id: "t1", failureReason: "totally_unknown_check", checkResults: [] },
      ],
      feedback: [],
      lowRatings: [],
      defectSignals: ["totally_unknown_check"],
      artifact: {
        text: "# Guardrails\nKeep drafts clean.",
        checks: [],
      },
    },
  );
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].defectKey, "unclassified:totally_unknown_check");
  assert.equal(proposals[0].unclassified, true);
  assert.match(proposals[0].summary, /Unclassified/);
});
