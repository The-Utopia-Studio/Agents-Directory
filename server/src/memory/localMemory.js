// Local memory — offline, no embeddings, no external calls. Stores items in
// the file store and ranks by token-overlap (a simple TF score). Good enough
// to exercise the Context pillar end-to-end; swap for supermemory/activeloop
// when you want real semantic recall. Implements MemoryProvider.
const STOP = new Set(["the", "a", "an", "to", "of", "and", "or", "is", "in", "on", "for", "with", "it", "as", "at", "by"]);
const tokens = (s) => (String(s).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((w) => !STOP.has(w));

export function createLocalMemory({ store }) {
  return {
    name: "local",

    async health() {
      await store.ready();
      return { ok: true, detail: "file-backed, token-overlap ranking" };
    },

    async ingest(namespace, item) {
      await store.ready();
      const doc = {
        id: item.id || undefined,
        namespace,
        content: item.content,
        metadata: item.metadata || {},
        ts: new Date().toISOString(),
      };
      const saved = item.id ? await store.put("memories", { ...doc, id: item.id }) : await store.append("memories", doc);
      return { id: saved.id, content: saved.content, metadata: saved.metadata, ts: saved.ts };
    },

    async search(namespace, query, { limit = 5 } = {}) {
      const q = [...new Set(tokens(query))];
      if (!q.length) return [];
      // Light prefix matching so near-forms overlap (cta/ctas, brand/branding).
      // No real stemming — that's what the supermemory / activeloop adapters add.
      const overlaps = (w) => q.some((t) => w === t || (w.length >= 3 && t.length >= 3 && (w.startsWith(t) || t.startsWith(w))));
      const rows = await store.query("memories", (m) => m.namespace === namespace);
      return rows
        .map((m) => {
          const words = tokens(m.content);
          let hits = 0;
          for (const w of words) if (overlaps(w)) hits++;
          const score = words.length ? hits / Math.sqrt(words.length) : 0;
          return { id: m.id, content: m.content, metadata: m.metadata, ts: m.ts, score: Number(score.toFixed(3)) };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  };
}
