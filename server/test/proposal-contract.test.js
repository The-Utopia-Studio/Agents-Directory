import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROPOSAL_FIELD_LIMITS,
  validateProposal,
} from "../src/improve/proposalContract.js";
import { createGepaOptimizer } from "../src/improve/gepaAdapter.js";

const LONG_NOTE =
  "The checker treated an ordinary word as an AI cliche because a phrase list and a word list were collapsed. The prompt also needs a general instruction against generic positioning language.";

const evidence = {
  traces: [{ id: "traces_1", agentId: "A7" }],
  feedback: [
    {
      id: "feedback_1",
      agentId: "A7",
      traceId: "traces_1",
      notes: LONG_NOTE,
    },
  ],
};

const valid = {
  source: "test",
  status: "proposed",
  date: "2026-08-02",
  summary: "Separate phrase and word checks",
  detail: "One checker edit backed by a reviewer record.",
  changes: [
    {
      surface: "check",
      target: "about_has_no_ai_cliche_phrase",
      current: "Phrase and word matching are not separated.",
      proposed: "Match configured phrases whole; match banned words by exact token.",
      rationale: "This prevents ordinary words from inheriting phrase-level bans.",
      evidence: ["feedback_1"],
    },
  ],
};

test("proposal contract accepts bounded structured changes with real evidence ids", () => {
  assert.deepEqual(validateProposal(valid, evidence).changes, valid.changes);
});

test("proposal contract refuses zero changes and missing evidence records", () => {
  assert.throws(
    () => validateProposal({ ...valid, changes: [] }, evidence),
    (error) => error.status === 422 && /at least one concrete change/.test(error.message),
  );
  assert.throws(
    () =>
      validateProposal(
        {
          ...valid,
          changes: [{ ...valid.changes[0], evidence: ["feedback_missing"] }],
        },
        evidence,
      ),
    (error) => error.status === 422 && /missing record/.test(error.message),
  );
  assert.throws(
    () =>
      validateProposal(
        {
          ...valid,
          changes: [{ ...valid.changes[0], evidence: [""] }],
        },
        evidence,
      ),
    (error) => error.status === 422 && /non-empty id/.test(error.message),
  );
});

test("proposal contract bounds edit text and refuses inlined feedback", () => {
  assert.throws(
    () =>
      validateProposal(
        {
          ...valid,
          changes: [
            {
              ...valid.changes[0],
              proposed: "x".repeat(PROPOSAL_FIELD_LIMITS.proposed + 1),
            },
          ],
        },
        evidence,
      ),
    (error) => error.status === 422 && /characters or fewer/.test(error.message),
  );
  assert.throws(
    () =>
      validateProposal(
        {
          ...valid,
          changes: [{ ...valid.changes[0], current: LONG_NOTE }],
        },
        evidence,
      ),
    (error) => error.status === 422 && /inlines feedback/.test(error.message),
  );
});

test("proposal targets are check ids or file paths with sections", () => {
  assert.throws(
    () =>
      validateProposal(
        {
          ...valid,
          changes: [{ ...valid.changes[0], target: "runtime checker prose" }],
        },
        evidence,
      ),
    /target must be a check id/,
  );
  assert.throws(
    () =>
      validateProposal(
        {
          ...valid,
          changes: [
            {
              ...valid.changes[0],
              surface: "prompt",
              target: "server/src/artifact.md",
            },
          ],
        },
        evidence,
      ),
    /file path plus #section/,
  );
});

test("GEPA refuses because its current result is prompt-only", async () => {
  const gepa = createGepaOptimizer({ endpoint: "https://example.test", model: "x" });
  await assert.rejects(
    () => gepa.propose({ id: "A7" }, { defectSignals: ["defect"] }),
    (error) =>
      error.status === 422 &&
      /prompt-only.*structured changes\[\]/.test(error.message),
  );
});
