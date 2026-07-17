// Activeloop / Deep Lake adapter — for the Utopia org's Tensor Database.
// Docs: https://docs-v3.activeloop.ai  ·  query API https://app.activeloop.ai/api/query/v1
//
// Deep Lake is a vector+tensor data lake: its REST surface is QUERY-first (TQL),
// and YOU own the embedding step. So this adapter:
//   • search — fully wired: embed the query (EMBED_ENDPOINT) -> TQL cosine search
//   • ingest — requires writing tensors, which Deep Lake does via its Python SDK.
//     We support an optional ACTIVELOOP_INGEST_ENDPOINT (a small deeplake sidecar);
//     without it, ingest throws a clear, actionable error.
// This asymmetry is exactly why Supermemory is the lighter fit for agent memory —
// but the seam lets you point Context here to leverage the existing org.
async function embed(embedEndpoint, text) {
  if (!embedEndpoint) throw new Error("Activeloop needs EMBED_ENDPOINT to embed queries (bring-your-own embeddings)");
  const res = await fetch(embedEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: text }),
  });
  if (!res.ok) throw new Error(`embed endpoint ${res.status}`);
  const out = await res.json();
  return out.embedding || out.data?.[0]?.embedding;
}

export function createActiveloop({ baseUrl = "https://app.activeloop.ai/api/query/v1", token, org, dataset = "agent_memory", embedEndpoint, ingestEndpoint, topK = 5 }) {
  if (!token || !org) throw new Error("Activeloop selected but ACTIVELOOP_TOKEN / ACTIVELOOP_ORG are unset");
  const datasetPath = `hub://${org}/${dataset}`;

  async function tql(query) {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Activeloop query -> ${res.status} ${await res.text().catch(() => "")}`);
    return res.json();
  }

  return {
    name: "activeloop",

    async health() {
      try {
        await tql(`SELECT * FROM "${datasetPath}" LIMIT 1`);
        return { ok: true, detail: datasetPath };
      } catch (e) {
        return { ok: false, detail: String(e.message || e) };
      }
    },

    async ingest(namespace, item) {
      if (!ingestEndpoint) {
        throw new Error(
          "Activeloop ingest needs a deeplake writer. Set ACTIVELOOP_INGEST_ENDPOINT to a sidecar that appends " +
          "{text, embedding, namespace} to " + datasetPath + " (tensor_db), or ingest via the Python SDK."
        );
      }
      const embedding = await embed(embedEndpoint, item.content);
      const res = await fetch(ingestEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ dataset: datasetPath, text: item.content, embedding, metadata: { ...item.metadata, namespace } }),
      });
      if (!res.ok) throw new Error(`Activeloop ingest -> ${res.status}`);
      const out = await res.json().catch(() => ({}));
      return { id: out.id || `al_${Date.now().toString(36)}`, content: item.content, metadata: item.metadata };
    },

    async search(namespace, query, { limit = topK } = {}) {
      const vec = await embed(embedEndpoint, query);
      const arr = `ARRAY[${vec.join(",")}]`;
      // Scope by namespace in metadata; cosine similarity over the embedding tensor.
      const tqlQuery =
        `SELECT text, metadata, cosine_similarity(embedding, ${arr}) AS score ` +
        `FROM "${datasetPath}" WHERE metadata['namespace'] == '${namespace}' ` +
        `ORDER BY score DESC LIMIT ${limit}`;
      const out = await tql(tqlQuery);
      const rows = out.data || out.results || [];
      return rows.map((r, i) => ({
        id: r.id || `al_${i}`,
        content: r.text,
        score: r.score,
        metadata: r.metadata,
      }));
    },
  };
}
