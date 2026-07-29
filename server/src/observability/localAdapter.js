// Local observability reads historical traces from the file store. New file
// writes are disabled pending a Convex service identity.
export const FILE_TRACE_WRITES_ENABLED = false;

export function createLocalObservability({ store, lowScoreThreshold = 70 }) {
  const byRecent = (a, b) => (a.ts < b.ts ? 1 : -1);

  return {
    name: "local",

    async health() {
      await store.ready();
      return { ok: true, detail: "historical file traces; writes disabled" };
    },

    async recordTrace(trace) {
      await store.ready();
      if (!FILE_TRACE_WRITES_ENABLED) {
        console.warn(
          `[observability] file trace write disabled; trace for ${trace.agentId || "(unknown)"} was not persisted`,
        );
        return {
          id: null,
          status: trace.status || "ok",
          persisted: false,
        };
      }
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
