// Shared Clerk JWT fixtures for route and approval tests. Not production code.
import { generateKeyPairSync, sign } from "node:crypto";

export const TEST_CLERK_ISSUER = "https://valid-collie-71.clerk.accounts.dev";
export const TEST_CLERK_NOW_MS = 1_800_000_000_000;

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};

export function testClerkToken(claimOverrides = {}) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: TEST_CLERK_ISSUER,
      aud: "convex",
      sub: "user_test_signed",
      role: "approver",
      name: "Test Signer",
      iat: Math.floor(TEST_CLERK_NOW_MS / 1000) - 30,
      exp: Math.floor(TEST_CLERK_NOW_MS / 1000) + 300,
      ...claimOverrides,
    }),
  ).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

export function testClerkFetchJwks() {
  return async () => ({
    ok: true,
    async json() {
      return { keys: [publicJwk] };
    },
  });
}

/** Clerk options for buildApp / verifyClerkJwt in tests. */
export function testClerkOptions(overrides = {}) {
  return {
    issuer: TEST_CLERK_ISSUER,
    audience: "convex",
    fetchImpl: testClerkFetchJwks(),
    nowMs: TEST_CLERK_NOW_MS,
    ...overrides,
  };
}

export function identityHeaders(token = testClerkToken()) {
  return {
    "content-type": "application/json",
    "x-directory-identity-token": token,
  };
}
