// Langfuse observability adapter. Same interface as the local one, backed by
// Langfuse's public API. Swaps in with OBS_PROVIDER=langfuse once keys are set.
//
// Uses global fetch (Node 18+). No SDK dependency — the ingestion and query
// endpoints are simple enough to call directly, which keeps this service
// dependency-free and portable.
function basicAuth(pk, sk) {
  return "Basic " + Buffer.from(`${pk}:${sk}`).toString("base64");
}

export function createLangfuseObservability({ host, publicKey, secretKey, lowScoreThreshold = 70 }) {
  if (!publicKey || !secretKey) {
    throw new Error("Langfuse selected but LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are unset");
  }
  const auth = basicAuth(publicKey, secretKey);
  const base = host.replace(/\/$/, "");

  async function api(path, init = {}) {
    const res = await fetch(base + path, {
      ...init,
      headers: { "content-type": "application/json", authorization: auth, ...(init.headers || {}) },
    });
    if (!res.ok) throw new Error(`Langfuse ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
    return res.status === 204 ? null : res.json();
  }

  /** Map a Langfuse trace object onto our Trace shape. */
  function normalize(t) {
    const score = t.scores?.find?.((s) => typeof s.value === "number")?.value;
    const status =
      t.metadata?.status ||
      (t.level === "ERROR"
        ? "error"
        : score != null && score < lowScoreThreshold
          ? "fail"
          : "ok");
    return {
      id: t.id,
      agentId: t.metadata?.agentId || t.name,
      status,
      score: score != null ? Math.round(score) : undefined,
      latencyMs: t.metadata?.latencyMs ?? t.latency,
      costUsd: t.metadata?.costUsd ?? t.totalCost,
      source: t.metadata?.source,
      provider: t.metadata?.provider,
      modelId: t.metadata?.modelId,
      inputTokens: t.metadata?.inputTokens,
      outputTokens: t.metadata?.outputTokens,
      totalTokens: t.metadata?.totalTokens,
      agentVersion: t.metadata?.agentVersion,
      artifactVersion: t.metadata?.artifactVersion,
      artifactDigest: t.metadata?.artifactDigest,
      artifactDigestAlgorithm: t.metadata?.artifactDigestAlgorithm,
      outputDigest: t.metadata?.outputDigest,
      outputDigestAlgorithm: t.metadata?.outputDigestAlgorithm,
      ts: t.timestamp,
      metadata: t.metadata,
    };
  }

  return {
    name: "langfuse",

    async health() {
      try {
        await api("/api/public/traces?limit=1");
        return { ok: true, detail: base };
      } catch (e) {
        return { ok: false, detail: String(e.message || e) };
      }
    },

    async recordTrace(trace) {
      // Ingestion API — batch of one event.
      const id = trace.id || crypto.randomUUID();
      await api("/api/public/ingestion", {
        method: "POST",
        body: JSON.stringify({
          batch: [{
            id: crypto.randomUUID(),
            type: "trace-create",
            timestamp: new Date().toISOString(),
            body: {
              id,
              name: trace.agentId,
              timestamp: trace.ts || new Date().toISOString(),
              metadata: {
                agentId: trace.agentId,
                status: trace.status,
                source: trace.source,
                provider: trace.provider,
                modelId: trace.modelId,
                inputTokens: trace.inputTokens,
                outputTokens: trace.outputTokens,
                totalTokens: trace.totalTokens,
                latencyMs: trace.latencyMs,
                costUsd: trace.costUsd,
                agentVersion: trace.agentVersion,
                artifactVersion: trace.artifactVersion,
                artifactDigest: trace.artifactDigest,
                artifactDigestAlgorithm: trace.artifactDigestAlgorithm,
                outputDigest: trace.outputDigest,
                outputDigestAlgorithm: trace.outputDigestAlgorithm,
                ...trace.metadata,
              },
            },
          }],
        }),
      });
      return { ...trace, id };
    },

    async listTraces(agentId, { limit = 50 } = {}) {
      const data = await api(`/api/public/traces?limit=${limit}&name=${encodeURIComponent(agentId)}`);
      return (data.data || []).map(normalize);
    },

    async getFailingTraces(agentId, { limit = 50 } = {}) {
      const all = await this.listTraces(agentId, { limit: Math.max(limit, 100) });
      return all.filter((t) => t.status !== "ok").slice(0, limit);
    },
  };
}
