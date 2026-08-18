// GitHub webhook authenticity. The webhook route cannot use API_TOKEN — GitHub
// does not send it — so the HMAC is the only thing standing between the open
// internet and a mutation that moves currentApprovedVersionId. Fail closed.

import { createHmac, timingSafeEqual } from "node:crypto";

export class WebhookAuthError extends Error {
  constructor(message, { status = 401, code = "webhook_unauthenticated" } = {}) {
    super(message);
    this.name = "WebhookAuthError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Verify X-Hub-Signature-256 over the exact raw request bytes.
 *
 * Takes the raw body, never a re-serialised object: JSON.stringify of a parsed
 * body reorders keys and changes whitespace, which would make every valid
 * signature fail and tempt someone to "fix" it by skipping verification.
 *
 * @param {{ rawBody: Buffer|string, signatureHeader: string, secret: string }} args
 */
export function verifyGithubSignature({ rawBody, signatureHeader, secret }) {
  const configured = String(secret || "").trim();
  if (!configured) {
    throw new WebhookAuthError(
      "GITHUB_WEBHOOK_SECRET is not configured — the webhook refuses every delivery rather than accept an unverified one.",
      { status: 503, code: "webhook_secret_missing" },
    );
  }
  const provided = String(signatureHeader || "").trim();
  if (!provided) {
    throw new WebhookAuthError(
      "Missing X-Hub-Signature-256 header.",
      { status: 401, code: "webhook_signature_missing" },
    );
  }
  if (!provided.startsWith("sha256=")) {
    throw new WebhookAuthError(
      "X-Hub-Signature-256 must use the sha256= prefix.",
      { status: 401, code: "webhook_signature_algorithm" },
    );
  }
  if (rawBody === undefined || rawBody === null) {
    throw new WebhookAuthError(
      "Raw request body was not captured — cannot verify the signature, so the delivery is refused.",
      { status: 500, code: "webhook_raw_body_missing" },
    );
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  const expected = `sha256=${createHmac("sha256", configured).update(body).digest("hex")}`;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new WebhookAuthError(
      "X-Hub-Signature-256 does not match the request body.",
      { status: 401, code: "webhook_signature_mismatch" },
    );
  }
  return true;
}
