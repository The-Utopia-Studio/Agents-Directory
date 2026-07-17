// Local observability — traces live in the file store. Zero external setup,
// so the loop is demonstrable end-to-end offline. Implements the
// ObservabilityProvider interface (see core/types.js).
export function createLocalObservability({ store, lowScoreThreshold = 70 }) {
  const byRecent = (a, b) => (a.ts < b.ts ? 1 : -1);

  return {
    name: "local",

    async health() {
      await store.ready();
      return { ok: true, detail: "file-backed traces" };
    },

    async recordTrace(trace) {
      await store.ready();
      const doc = {
        status: "ok",
        ts: new Date().toISOString(),
        ...trace,
      };
      return store.append("traces", doc);
    },

    async listTraces(agentId, { limit = 50 } = {}) {
      const rows = await store.query("traces", (t) => t.agentId === agentId);
      return rows.sort(byRecent).slice(0, limit);
    },

    async getFailingTraces(agentId, { limit = 50 } = {}) {
      const rows = await store.query(
        "traces",
        (t) =>
          t.agentId === agentId &&
          (t.status === "fail" ||
            t.status === "error" ||
            (typeof t.score === "number" && t.score < lowScoreThreshold))
      );
      return rows.sort(byRecent).slice(0, limit);
    },
  };
}
