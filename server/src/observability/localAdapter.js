// Local observability reads historical traces from the file store. New file
// writes are disabled pending a Convex service identity.
export const FILE_TRACE_WRITES_ENABLED = false;

export function createLocalObservability({ store, lowScoreThreshold = 70 }) {
  const byRecent = (a, b) => (a.ts < b.ts ? 1 : -1);

  return {
    name: "local",

    async health() {
      await store.ready();
      return {
        ok: true,
        detail: "runtime metadata traces only; general file writes disabled",
      };
    },

    async recordTrace(trace, { persistRuntime = false } = {}) {
      await store.ready();
      const isTrustedRuntimeTrace =
        persistRuntime &&
        trace.source === "real" &&
        trace.metadata?.via === "runtime";
      if (!FILE_TRACE_WRITES_ENABLED && !isTrustedRuntimeTrace) {
        console.warn(
          `[observability] file trace write disabled; trace for ${trace.agentId || "(unknown)"} was not persisted`,
        );
        return {
          id: null,
          status: trace.status || "ok",
          persisted: false,
        };
      }
      // Defense in depth: even a trusted runtime call cannot persist payloads
      // or free-text failure reasons while retention rules are unresolved.
      const {
        input: _input,
        output: _output,
        failureReason: _failureReason,
        ...metadataOnly
      } = trace;
      const doc = {
        status: "ok",
        ts: new Date().toISOString(),
        ...metadataOnly,
      };
      const saved = await store.append("traces", doc);
      return { ...saved, persisted: true };
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
