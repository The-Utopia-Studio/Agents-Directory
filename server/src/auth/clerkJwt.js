import { createPublicKey, verify as verifySignature } from "node:crypto";

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function decodeJson(part, label) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw httpError(401, `Invalid Clerk JWT ${label}`);
  }
}

function audienceMatches(value, expected) {
  return Array.isArray(value) ? value.includes(expected) : value === expected;
}

/** Verify the actual Clerk signature and claims; browser-supplied actor fields are never trusted. */
export async function verifyClerkJwt(
  token,
  { issuer, audience = "convex", fetchImpl = fetch, nowMs = Date.now() } = {},
) {
  const trustedIssuer = String(issuer || "").replace(/\/+$/, "");
  if (!trustedIssuer) throw httpError(503, "Human approval is unavailable: Clerk issuer is not configured");
  let issuerUrl;
  try { issuerUrl = new URL(trustedIssuer); } catch { issuerUrl = null; }
  if (!issuerUrl || issuerUrl.protocol !== "https:" || issuerUrl.username || issuerUrl.password) {
    throw httpError(503, "Human approval is unavailable: Clerk issuer configuration is invalid");
  }

  const compact = String(token || "").trim();
  const parts = compact.split(".");
  if (parts.length !== 3) throw httpError(401, "A signed Clerk approver token is required");
  const header = decodeJson(parts[0], "header");
  const claims = decodeJson(parts[1], "payload");
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) {
    throw httpError(401, "Unsupported Clerk JWT signing key");
  }

  const response = await fetchImpl(`${trustedIssuer}/.well-known/jwks.json`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw httpError(503, "Human approval is unavailable: Clerk signing keys could not be loaded");
  const jwks = await response.json();
  const jwk = Array.isArray(jwks?.keys)
    ? jwks.keys.find((candidate) => candidate?.kid === header.kid && candidate?.kty === "RSA")
    : null;
  if (!jwk) throw httpError(401, "Clerk JWT signing key is not trusted");
  let key;
  try { key = createPublicKey({ key: jwk, format: "jwk" }); } catch {
    throw httpError(503, "Human approval is unavailable: Clerk signing key is invalid");
  }
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], "base64url"),
  );
  if (!valid) throw httpError(401, "Clerk JWT signature is invalid");

  const now = Math.floor(nowMs / 1000);
  if (claims.iss !== trustedIssuer || !audienceMatches(claims.aud, audience)) {
    throw httpError(401, "Clerk JWT issuer or audience is invalid");
  }
  if (typeof claims.exp !== "number" || claims.exp <= now) throw httpError(401, "Clerk JWT has expired");
  if (typeof claims.nbf === "number" && claims.nbf > now) throw httpError(401, "Clerk JWT is not active yet");
  if (typeof claims.sub !== "string" || !claims.sub) throw httpError(401, "Clerk JWT has no subject");

  return {
    subject: claims.sub,
    issuer: claims.iss,
    role: typeof claims.role === "string" ? claims.role : "",
    ...(typeof claims.name === "string" && claims.name ? { name: claims.name } : {}),
  };
}

export async function requireClerkApprover(req, options) {
  const actor = await verifyClerkJwt(req?.headers?.["x-directory-identity-token"], options);
  if (actor.role !== "approver") throw httpError(403, "Release approver role required");
  return actor;
}
