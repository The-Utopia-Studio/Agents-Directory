// Supermemory adapter (recommended). The memory layer for AI agents — clean
// REST for both ingest and search, embeddings/chunking handled for you.
// Docs: https://supermemory.ai/docs  ·  base https://api.supermemory.ai
//
// namespace -> containerTag, so each agent/fellow gets an isolated memory space.
// Uses global fetch — no SDK dependency, keeping the service portable.
export function createSupermemory({ baseUrl = "https://api.supermemory.ai", apiKey, topK = 5 }) {
  if (!apiKey) throw new Error("Supermemory selected but SUPERMEMORY_API_KEY is unset");
  const base = baseUrl.replace(/\/$/, "");

  async function api(path, body) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Supermemory ${path} -> ${res.status} ${await res.text().catch(() => "")}`);
    return res.json();
  }

  const pickContent = (r) =>
    r.content || r.memory || (Array.isArray(r.chunks) ? r.chunks.map((c) => c.content || c.text).join(" ") : "") || "";

  return {
    name: "supermemory",

    async health() {
      try {
        await api("/v3/search", { q: "healthcheck", limit: 1 });
        return { ok: true, detail: base };
      } catch (e) {
        return { ok: false, detail: String(e.message || e) };
      }
    },

    async ingest(namespace, item) {
      const out = await api("/v3/documents", {
        content: item.content,
        containerTag: namespace,
        metadata: { ...item.metadata, namespace },
      });
      return { id: out.id || out.documentId, content: item.content, metadata: item.metadata };
    },

    async search(namespace, query, { limit = topK } = {}) {
      const out = await api("/v3/search", { q: query, containerTags: [namespace], limit });
      const results = out.results || out.documents || [];
      return results.map((r) => ({
        id: r.documentId || r.id,
        content: pickContent(r),
        score: r.score,
        metadata: r.metadata,
      }));
    },
  };
}
