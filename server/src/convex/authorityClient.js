// Trusted Convex caller for the loop service (state B).
// Records the durable service actor shape; call auth is the deploy key until
// state D verifies short-lived JWTs from issuer service:agents-directory.
// Never uses actingAsIdentity — that would fabricate a Clerk principal.
// Zero npm deps: raw HTTP to Convex, same wire format as ConvexHttpClient.

/**
 * @param {{ url: string, deployKey: string, fetchImpl?: typeof fetch }} config
 */
export function createConvexAuthorityClient(config) {
  const url = String(config.url || "").replace(/\/+$/, "");
  const deployKey = String(config.deployKey || "").trim();
  const fetchImpl = config.fetchImpl || fetch;

  function enabled() {
    return Boolean(url && deployKey);
  }

  /**
   * Encode a plain JSON value in Convex's convex_encoded_json wire form.
   * Enough for strings, numbers, booleans, null, plain objects, and arrays.
   */
  function encode(value) {
    if (value === null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new Error("Convex args cannot include non-finite numbers");
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(encode);
    if (typeof value === "object") {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        if (child !== undefined) out[key] = encode(child);
      }
      return out;
    }
    throw new Error(`Unsupported Convex arg type: ${typeof value}`);
  }

  async function mutation(path, args) {
    if (!enabled()) {
      throw new Error("Convex authority client is not configured");
    }
    const response = await fetchImpl(`${url}/api/mutation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Convex ${deployKey}`,
        "convex-client": "agents-directory-loop-0.1.0",
      },
      body: JSON.stringify({
        path,
        format: "convex_encoded_json",
        args: [encode(args || {})],
      }),
    });
    if (!response.ok && response.status !== 560) {
      throw new Error(
        `Convex mutation ${path} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`,
      );
    }
    const payload = await response.json();
    if (payload.status === "success") return payload.value;
    throw new Error(
      payload.errorMessage || `Convex mutation ${path} failed`,
    );
  }

  return {
    enabled,
    /**
     * One evidence row for a scored A7 hosted run. Digest must match a
     * governed agentVersions row — Convex looks up, never creates.
     */
    async recordHostedRunEvidence({ displayId, artifactDigest, cost }) {
      return mutation("evidence:recordHostedRunEvidence", {
        displayId,
        artifactDigest,
        ...(cost ? { cost } : {}),
      });
    },
  };
}
