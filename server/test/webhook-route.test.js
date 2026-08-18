// Route-level wiring for the merge webhook. The two things that can only go
// wrong here: the raw body must survive JSON parsing (or every signature
// fails), and the route must be reachable without API_TOKEN (GitHub cannot
// send our bearer token) while staying HMAC-gated.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { createRouter } from "../src/http/router.js";
import { registerRoutes } from "../src/http/routes.js";

const SECRET = "route-test-secret";

function sign(body, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Minimal service double: only the method the webhook route calls. */
function serviceDouble(impl) {
  return {
    releaseFromMergedLoopPullRequest: impl,
    // registerRoutes touches nothing else at registration time.
  };
}

async function withServer(svc, config, run) {
  const router = createRouter({ apiToken: config.apiToken || "" });
  registerRoutes(router, svc, {}, config);
  const server = createServer(router.handler());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const CONFIG = {
  apiToken: "browser-visible-token",
  clerk: {},
  github: { webhookSecret: SECRET },
};

const PAYLOAD = {
  action: "closed",
  repository: { full_name: "The-Utopia-Studio/utopia-agents" },
  pull_request: {
    number: 17,
    merged: true,
    merge_commit_sha: "a".repeat(40),
    head: { ref: "loop/biocraft-imp_1" },
    merged_by: { id: 4242, login: "haniyahumair" },
  },
};

test("webhook route: a signed delivery reaches the service without API_TOKEN", async () => {
  // Deliberately formatted with irregular spacing so a re-serialised body
  // would produce a different HMAC than the one GitHub signed.
  const body = JSON.stringify(PAYLOAD, null, 2);
  let received = null;
  const res = await withServer(
    serviceDouble(async (args) => {
      received = args;
      return { released: true, pullRequestNumber: 17, resultingVersionId: "ver_new" };
    }),
    CONFIG,
    (base) =>
      fetch(`${base}/api/github/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery-1",
          "x-hub-signature-256": sign(body),
        },
        body,
      }),
  );

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.released, true);
  assert.equal(json.delivery, "delivery-1");
  assert.equal(received.eventName, "pull_request");
  assert.equal(received.payload.pull_request.number, 17);
});

test("webhook route: an unsigned delivery is refused even though it skips API_TOKEN", async () => {
  let called = false;
  const body = JSON.stringify(PAYLOAD);
  const res = await withServer(
    serviceDouble(async () => {
      called = true;
      return { released: true };
    }),
    CONFIG,
    (base) =>
      fetch(`${base}/api/github/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-github-event": "pull_request" },
        body,
      }),
  );
  assert.equal(res.status, 401);
  assert.equal(called, false, "an unsigned delivery must never reach the release path");
});

test("webhook route: a tampered body fails the signature", async () => {
  const signedBody = JSON.stringify(PAYLOAD);
  const tampered = signedBody.replace("haniyahumair", "attacker0000");
  assert.equal(tampered.length, signedBody.length, "same length isolates the HMAC check");
  let called = false;
  const res = await withServer(
    serviceDouble(async () => {
      called = true;
      return { released: true };
    }),
    CONFIG,
    (base) =>
      fetch(`${base}/api/github/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-hub-signature-256": sign(signedBody),
        },
        body: tampered,
      }),
  );
  assert.equal(res.status, 401);
  assert.equal(called, false);
});

test("webhook route: an unset webhook secret refuses every delivery", async () => {
  const body = JSON.stringify(PAYLOAD);
  const res = await withServer(
    serviceDouble(async () => ({ released: true })),
    { ...CONFIG, github: { webhookSecret: "" } },
    (base) =>
      fetch(`${base}/api/github/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-hub-signature-256": sign(body),
        },
        body,
      }),
  );
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /refuses every delivery/);
});

test("webhook route: a refusal answers with its code and says the pointer did not move", async () => {
  const body = JSON.stringify(PAYLOAD);
  const res = await withServer(
    serviceDouble(async () => {
      throw Object.assign(
        new Error("GitHub user drive-by is not in LOOP_RELEASE_APPROVERS. The pointer did not move."),
        { status: 403, code: "loop_release_approver_not_allowed" },
      );
    }),
    CONFIG,
    (base) =>
      fetch(`${base}/api/github/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-hub-signature-256": sign(body),
        },
        body,
      }),
  );
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.code, "loop_release_approver_not_allowed");
  assert.equal(json.released, false);
  assert.equal(json.pointerMoved, false);
  assert.match(json.error, /not in LOOP_RELEASE_APPROVERS/);
});

test("other routes still require API_TOKEN — the exemption is webhook-only", async () => {
  const res = await withServer(
    { listAgents: async () => [] },
    CONFIG,
    (base) => fetch(`${base}/api/agents`),
  );
  assert.equal(res.status, 401);
});

test("router captures the raw body verbatim for signature checks", async () => {
  // Irregular whitespace and key order that JSON.stringify(parsed) would not
  // reproduce. If rawBody were re-serialised, this HMAC would not verify.
  const body = '{\n  "b" : 2,\n  "a":   1\n}';
  let seenRaw = null;
  const router = createRouter({});
  router.post("/api/raw-probe", async ({ req }) => {
    seenRaw = req.rawBody.toString("utf8");
    return { ok: true };
  });
  const server = createServer(router.handler());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/raw-probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(seenRaw, body);
  assert.notEqual(seenRaw, JSON.stringify(JSON.parse(body)));
});
