// Local observability reads historical traces from the file store. New file
// writes are disabled pending a Convex service identity.
import {
  sanitizeCheckResults,
  sanitizeFailureReason,
} from "../core/traceSafety.js";

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
      // while retention rules are unresolved. The checker's verdict is allowed
      // through because it is filtered to closed-vocabulary ids and numeric or
      // boolean facts — shape, never content. Stripping it outright is what
      // left every failing trace with an empty failureReason and starved the
      // maker of the one signal we generate mechanically.
      const {
        input: _input,
        output: _output,
        failureReason,
        checkResults,
        ...metadataOnly
      } = trace;
      const safeReason = sanitizeFailureReason(failureReason);
      const safeChecks = sanitizeCheckResults(checkResults);
      const doc = {
        status: "ok",
        ts: new Date().toISOString(),
        ...metadataOnly,
        ...(safeReason ? { failureReason: safeReason } : {}),
        ...(safeChecks.length ? { checkResults: safeChecks } : {}),
      };
      const saved = await store.append("traces", doc);
      return { ...saved, persisted: true };
    },

    async listTraces(agentId, { limit = 50 } = {}) {
      const rows = await store.query("traces", (t) => t.agentId === agentId);
      // Defense in depth on the open read: never return payloads even if an
      // older row was written before write-time stripping.
      return rows
        .sort(byRecent)
        .slice(0, limit)
        .map((trace) => {
          const {
            input: _input,
            output: _output,
            notes: _notes,
            failureReason,
            checkResults,
            ...metadataOnly
          } = trace;
          const safeReason = sanitizeFailureReason(failureReason);
          const safeChecks = sanitizeCheckResults(checkResults);
          return {
            ...metadataOnly,
            ...(safeReason ? { failureReason: safeReason } : {}),
            ...(safeChecks.length ? { checkResults: safeChecks } : {}),
          };
        });
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
