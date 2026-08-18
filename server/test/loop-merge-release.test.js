import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  classifyDelivery,
  handleMergedLoopPullRequest,
  loginIsAllowed,
  parseReleaseApprovers,
  resolveMergingIdentity,
} from "../src/github/loopMergeRelease.js";
import {
  WebhookAuthError,
  verifyGithubSignature,
} from "../src/github/webhookSignature.js";

const SECRET = "webhook-test-secret";

function sign(body, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function mergedPayload(overrides = {}) {
  const pr = {
    number: 17,
    merged: true,
    merge_commit_sha: "a".repeat(40),
    head: { ref: "loop/biocraft-imp_test_0" },
    merged_by: { id: 4242, login: "haniyahumair" },
    ...(overrides.pull_request || {}),
  };
  return {
    action: "closed",
    repository: { full_name: "The-Utopia-Studio/utopia-agents" },
    ...overrides,
    pull_request: pr,
  };
}

/** Recording harness so every test can assert what did and did not happen. */
function harness({
  link = {
    agentId: "A7",
    proposalId: "imp_test_0",
    convexProposalId: "convex_prop_1",
    proposal: { id: "imp_test_0" },
  },
  releaseImpl = async () => ({
    reviewEventId: "ev_1",
    resultingVersionId: "ver_new",
    priorApprovedVersionId: "ver_old",
    status: "approved",
  }),
  approverAllowlist = ["haniyahumair"],
} = {}) {
  const calls = { release: [], refusals: [], released: [], logs: [] };
  return {
    calls,
    args: {
      approverAllowlist,
      findProposalByBranch: async () => link,
      release: async (a) => {
        calls.release.push(a);
        return releaseImpl(a);
      },
      recordRefusal: async (a) => {
        calls.refusals.push(a);
        return { reviewEventId: "ev_refusal" };
      },
      onReleased: async (a) => {
        calls.released.push(a);
      },
      log: (m) => calls.logs.push(m),
      now: () => 1_760_000_000_000,
    },
  };
}

// ── Signature ────────────────────────────────────────────────────────────────

test("webhook signature: unset secret refuses every delivery", () => {
  const body = JSON.stringify(mergedPayload());
  assert.throws(
    () => verifyGithubSignature({ rawBody: body, signatureHeader: sign(body), secret: "" }),
    (err) => {
      assert.ok(err instanceof WebhookAuthError);
      assert.equal(err.code, "webhook_secret_missing");
      assert.equal(err.status, 503);
      return true;
    },
  );
  // Whitespace-only is not a secret either.
  assert.throws(
    () => verifyGithubSignature({ rawBody: body, signatureHeader: sign(body), secret: "   " }),
    /refuses every delivery/,
  );
});

test("webhook signature: accepts a correct HMAC and rejects tampering", () => {
  const body = JSON.stringify(mergedPayload());
  assert.equal(
    verifyGithubSignature({ rawBody: body, signatureHeader: sign(body), secret: SECRET }),
    true,
  );
  // Same secret, altered body.
  const tampered = body.replace('"haniyahumair"', '"attacker"');
  assert.throws(
    () => verifyGithubSignature({ rawBody: tampered, signatureHeader: sign(body), secret: SECRET }),
    /does not match the request body/,
  );
  // Right body, wrong secret.
  assert.throws(
    () =>
      verifyGithubSignature({
        rawBody: body,
        signatureHeader: sign(body, "other-secret"),
        secret: SECRET,
      }),
    /does not match the request body/,
  );
  assert.throws(
    () => verifyGithubSignature({ rawBody: body, signatureHeader: "", secret: SECRET }),
    /Missing X-Hub-Signature-256/,
  );
  assert.throws(
    () =>
      verifyGithubSignature({
        rawBody: body,
        signatureHeader: `sha1=${"0".repeat(40)}`,
        secret: SECRET,
      }),
    /sha256= prefix/,
  );
});

test("webhook signature: an uncaptured raw body refuses rather than guesses", () => {
  const body = JSON.stringify(mergedPayload());
  assert.throws(
    () =>
      verifyGithubSignature({
        rawBody: undefined,
        signatureHeader: sign(body),
        secret: SECRET,
      }),
    /Raw request body was not captured/,
  );
});

// ── Allowlist ────────────────────────────────────────────────────────────────

test("allowlist: unset, empty, and whitespace-only all parse to zero approvers", () => {
  assert.deepEqual(parseReleaseApprovers(undefined), []);
  assert.deepEqual(parseReleaseApprovers(""), []);
  assert.deepEqual(parseReleaseApprovers("   "), []);
  assert.deepEqual(parseReleaseApprovers(" , ,, "), []);
  assert.deepEqual(parseReleaseApprovers(" a , b "), ["a", "b"]);
});

test("allowlist: case-insensitive and trimmed, but exact — no prefix matching", () => {
  const list = ["haniyahumair"];
  assert.equal(loginIsAllowed("haniyahumair", list), true);
  assert.equal(loginIsAllowed("  HaniyahUmair ", list), true);
  // A prefix or superstring of an allowed login is a different person.
  assert.equal(loginIsAllowed("haniyahumair2", list), false);
  assert.equal(loginIsAllowed("haniyah", list), false);
  assert.equal(loginIsAllowed("xhaniyahumairx", list), false);
  assert.equal(loginIsAllowed("", list), false);
  assert.equal(loginIsAllowed("haniyahumair", []), false);
});

// ── Delivery classification ──────────────────────────────────────────────────

test("classify: only a merged loop/ PR on utopia-agents is a release", () => {
  assert.equal(
    classifyDelivery({ eventName: "pull_request", payload: mergedPayload() }).kind,
    "release",
  );
  const ignores = [
    { eventName: "ping", payload: {} },
    { eventName: "push", payload: {} },
    { eventName: "pull_request", payload: mergedPayload({ action: "opened" }) },
    {
      eventName: "pull_request",
      payload: mergedPayload({ pull_request: { merged: false } }),
    },
    {
      eventName: "pull_request",
      payload: mergedPayload({ pull_request: { head: { ref: "hotfix/manual" } } }),
    },
    {
      eventName: "pull_request",
      payload: mergedPayload({ repository: { full_name: "The-Utopia-Studio/Agents-Directory" } }),
    },
  ];
  for (const delivery of ignores) {
    const out = classifyDelivery(delivery);
    assert.equal(out.kind, "ignore", JSON.stringify(delivery));
    // An ignore always names itself — never a silent skip.
    assert.ok(out.reason && out.reason.length > 10);
  }
});

// ── Identity ─────────────────────────────────────────────────────────────────

test("identity: resolved from merged_by numeric id, never from a login alone", () => {
  assert.deepEqual(
    resolveMergingIdentity({ merged_by: { id: 4242, login: "haniyahumair" } }),
    {
      subject: "github:4242",
      issuer: "https://github.com",
      name: "haniyahumair",
      login: "haniyahumair",
    },
  );
  assert.equal(resolveMergingIdentity({ merged_by: null }), null);
  assert.equal(resolveMergingIdentity({ merged_by: { login: "haniyahumair" } }), null);
  assert.equal(resolveMergingIdentity({ merged_by: { id: 4242 } }), null);
  assert.equal(resolveMergingIdentity({ merged_by: { id: 0, login: "x" } }), null);
  // Never falls back to the PR author or the sender.
  assert.equal(
    resolveMergingIdentity({ user: { id: 1, login: "author" }, merged_by: null }),
    null,
  );
});

// ── End to end ───────────────────────────────────────────────────────────────

test("release: a merged loop/ PR by an allowed approver moves the pointer", async () => {
  const h = harness();
  const out = await handleMergedLoopPullRequest({
    eventName: "pull_request",
    payload: mergedPayload(),
    ...h.args,
  });

  assert.equal(out.released, true);
  assert.equal(out.resultingVersionId, "ver_new");
  assert.equal(h.calls.refusals.length, 0);
  assert.equal(h.calls.release.length, 1);

  const sent = h.calls.release[0];
  assert.equal(sent.proposalId, "convex_prop_1");
  // The human goes to Convex as onBehalfOf, keyed by numeric id.
  assert.deepEqual(sent.onBehalfOf, {
    subject: "github:4242",
    issuer: "https://github.com",
    name: "haniyahumair",
  });
  // The merge event travels as the primary evidence.
  assert.equal(sent.releaseTrigger.mergeCommitSha, "a".repeat(40));
  assert.equal(sent.releaseTrigger.pullRequestNumber, 17);
  assert.deepEqual(sent.releaseTrigger.approverAllowlist, ["haniyahumair"]);
  // The response never presents the human as having signed in.
  assert.equal(out.executedBy.issuer, "service:agents-directory");
  assert.equal(out.approvedBy.login, "haniyahumair");
});

test("release: an unresolvable merger refuses, records, and never substitutes the service", async () => {
  const h = harness();
  await assert.rejects(
    handleMergedLoopPullRequest({
      eventName: "pull_request",
      payload: mergedPayload({ pull_request: { merged_by: null } }),
      ...h.args,
    }),
    (err) => {
      assert.equal(err.code, "loop_release_merger_unresolved");
      assert.match(err.message, /pointer did not move/i);
      return true;
    },
  );
  assert.equal(h.calls.release.length, 0);
  assert.equal(h.calls.refusals.length, 1);
  const refusal = h.calls.refusals[0];
  assert.equal(refusal.refusalCode, "loop_release_merger_unresolved");
  // No onBehalfOf: identity resolution is exactly what failed.
  assert.equal(refusal.onBehalfOf, undefined);
  assert.ok(refusal.refusalMessage.length > 20);
});

test("release: a login not on the allowlist refuses and the refusal is recorded", async () => {
  const h = harness();
  await assert.rejects(
    handleMergedLoopPullRequest({
      eventName: "pull_request",
      payload: mergedPayload({
        pull_request: { merged_by: { id: 99, login: "drive-by" } },
      }),
      ...h.args,
    }),
    (err) => {
      assert.equal(err.code, "loop_release_approver_not_allowed");
      return true;
    },
  );
  assert.equal(h.calls.release.length, 0);
  const refusal = h.calls.refusals[0];
  // The rejected login is logged AND recorded in Convex.
  assert.match(refusal.refusalMessage, /drive-by/);
  assert.deepEqual(refusal.onBehalfOf, {
    subject: "github:99",
    issuer: "https://github.com",
    name: "drive-by",
  });
  assert.ok(h.calls.logs.some((l) => /drive-by/.test(l) && /REFUSED/.test(l)));
});

test("release: an unset allowlist refuses every release", async () => {
  const h = harness({ approverAllowlist: [] });
  await assert.rejects(
    handleMergedLoopPullRequest({
      eventName: "pull_request",
      payload: mergedPayload(),
      ...h.args,
    }),
    (err) => {
      assert.equal(err.code, "loop_release_allowlist_unset");
      assert.match(err.message, /never permissive/);
      return true;
    },
  );
  assert.equal(h.calls.release.length, 0);
  assert.equal(h.calls.refusals.length, 1);
});

test("release: Convex refusing on promotion evidence is surfaced, not swallowed", async () => {
  const h = harness({
    releaseImpl: async () => {
      throw new Error(
        "PROMOTION_EVIDENCE_REQUIRED: candidate has no evalResult whose evidence is eligibleForPromotion",
      );
    },
  });
  await assert.rejects(
    handleMergedLoopPullRequest({
      eventName: "pull_request",
      payload: mergedPayload(),
      ...h.args,
    }),
    (err) => {
      assert.equal(err.code, "loop_release_promotion_evidence_required");
      assert.match(err.message, /currentApprovedVersionId was NOT moved/);
      return true;
    },
  );
  assert.equal(h.calls.released.length, 0);
  const refusal = h.calls.refusals[0];
  assert.equal(refusal.refusalCode, "loop_release_promotion_evidence_required");
  assert.match(refusal.refusalMessage, /PROMOTION_EVIDENCE_REQUIRED/);
  assert.ok(
    h.calls.logs.some((l) => /REFUSED/.test(l) && /PROMOTION_EVIDENCE_REQUIRED/.test(l)),
    "the refusal must be loud in the logs",
  );
});

test("release: a branch with no linked Convex proposal refuses instead of guessing", async () => {
  const h = harness({ link: { agentId: "A7", proposalId: "imp_x", convexProposalId: null } });
  await assert.rejects(
    handleMergedLoopPullRequest({
      eventName: "pull_request",
      payload: mergedPayload(),
      ...h.args,
    }),
    (err) => {
      assert.equal(err.code, "loop_release_unlinked_branch");
      return true;
    },
  );
  assert.equal(h.calls.release.length, 0);
});

test("release: a hand-merged non-loop branch is ignored with a stated reason", async () => {
  const h = harness();
  const out = await handleMergedLoopPullRequest({
    eventName: "pull_request",
    payload: mergedPayload({ pull_request: { head: { ref: "hotfix/hand-merged" } } }),
    ...h.args,
  });
  assert.equal(out.released, false);
  assert.equal(out.ignored, true);
  assert.match(out.reason, /hand-merged PRs never release/);
  assert.equal(h.calls.release.length, 0);
  assert.equal(h.calls.refusals.length, 0);
});

test("release: a failure to record the refusal does not erase the refusal", async () => {
  const calls = { release: [], logs: [] };
  await assert.rejects(
    handleMergedLoopPullRequest({
      eventName: "pull_request",
      payload: mergedPayload({
        pull_request: { merged_by: { id: 99, login: "drive-by" } },
      }),
      approverAllowlist: ["haniyahumair"],
      findProposalByBranch: async () => ({
        agentId: "A7",
        proposalId: "imp_test_0",
        convexProposalId: "convex_prop_1",
      }),
      release: async (a) => calls.release.push(a),
      recordRefusal: async () => {
        throw new Error("convex unreachable");
      },
      log: (m) => calls.logs.push(m),
      now: () => 1,
    }),
    (err) => {
      assert.equal(err.code, "loop_release_approver_not_allowed");
      assert.equal(err.refusalRecordError, "convex unreachable");
      return true;
    },
  );
  assert.equal(calls.release.length, 0);
  assert.ok(
    calls.logs.some((l) => /REFUSAL NOT RECORDED IN CONVEX/.test(l)),
    "an unrecordable refusal must say so rather than look recorded",
  );
});
