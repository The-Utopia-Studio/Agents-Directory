import { test } from "node:test";
import assert from "node:assert/strict";
import { createConvexAuthorityClient } from "../src/convex/authorityClient.js";

test("authority client stays disabled without url or deploy key", () => {
  assert.equal(createConvexAuthorityClient({ url: "", deployKey: "" }).enabled(), false);
  assert.equal(
    createConvexAuthorityClient({
      url: "https://example.convex.cloud",
      deployKey: "",
    }).enabled(),
    false,
  );
});

test("recordHostedRunEvidence posts the internal mutation path with Convex admin auth", async () => {
  let seen;
  const client = createConvexAuthorityClient({
    url: "https://example.convex.cloud",
    deployKey: "test-deploy-key",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: "success", value: "evidence_fixture_id" };
        },
      };
    },
  });
  assert.equal(client.enabled(), true);
  const id = await client.recordHostedRunEvidence({
    displayId: "A7",
    artifactDigest: "a".repeat(64),
  });
  assert.equal(id, "evidence_fixture_id");
  assert.equal(seen.url, "https://example.convex.cloud/api/mutation");
  assert.equal(seen.init.headers.authorization, "Convex test-deploy-key");
  const body = JSON.parse(seen.init.body);
  assert.equal(body.path, "evidence:recordHostedRunEvidence");
  assert.equal(body.args[0].displayId, "A7");
  assert.equal(body.args[0].artifactDigest, "a".repeat(64));
});
