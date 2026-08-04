import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { requireClerkApprover, verifyClerkJwt } from "../src/auth/clerkJwt.js";

const ISSUER = "https://valid-collie-71.clerk.accounts.dev";
const NOW = 1_800_000_000_000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

function token(claimOverrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    aud: "convex",
    sub: "user_signed_approver",
    role: "approver",
    name: "Signed Approver",
    iat: Math.floor(NOW / 1000) - 30,
    exp: Math.floor(NOW / 1000) + 300,
    ...claimOverrides,
  })).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

const fetchJwks = async () => ({
  ok: true,
  async json() { return { keys: [publicJwk] }; },
});

test("a real signed JWT shape produces the recorded approver identity", async () => {
  const actor = await requireClerkApprover(
    { headers: { "x-directory-identity-token": token() } },
    { issuer: ISSUER, audience: "convex", fetchImpl: fetchJwks, nowMs: NOW },
  );
  assert.deepEqual(actor, {
    subject: "user_signed_approver",
    issuer: ISSUER,
    role: "approver",
    name: "Signed Approver",
  });
});

test("approval rejects missing, wrong-role, wrong-audience and tampered tokens", async () => {
  const options = { issuer: ISSUER, audience: "convex", fetchImpl: fetchJwks, nowMs: NOW };
  await assert.rejects(() => requireClerkApprover({ headers: {} }, options), (error) => {
    assert.equal(error.status, 401);
    assert.match(error.message, /Signed-in Clerk identity is required/);
    return true;
  });
  await assert.rejects(
    () => requireClerkApprover(
      { headers: { "x-directory-identity-token": token({ role: "member" }) } },
      options,
    ),
    (error) => error.status === 403,
  );
  await assert.rejects(() => verifyClerkJwt(token({ aud: "other" }), options), (error) => error.status === 401);
  const signed = token();
  const tampered = `${signed.slice(0, -1)}${signed.endsWith("a") ? "b" : "a"}`;
  await assert.rejects(() => verifyClerkJwt(tampered, options), (error) => error.status === 401);
});

test("approval fails closed when the trusted issuer is not configured", async () => {
  await assert.rejects(
    () => verifyClerkJwt(token(), { issuer: "", fetchImpl: fetchJwks, nowMs: NOW }),
    (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /Signed identity is unavailable/);
      return true;
    },
  );
});
