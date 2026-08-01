// ── Loop API client (optional) ───────────────────────────────────────
// Thin bridge from the static front-end to the loop service (server/).
// It probes /api/health on load; if the service isn't running the app keeps
// working entirely offline (localStorage), and the loop actions fall back to
// their local stubs. When the service IS up, "Propose improvement" runs the
// real optimizer against real traces, and approve / reject / eval flow through.
window.DirectoryAPI = (function () {
  // Empty / whitespace DIRECTORY_API_BASE must fall through ("" is falsy, but trim
  // also catches "  " so an unfilled index.html config never wins over localStorage).
  const configured =
    typeof window.DIRECTORY_API_BASE === "string"
      ? window.DIRECTORY_API_BASE.trim()
      : "";
  const base =
    configured ||
    localStorage.getItem("directory_api_base") ||
    "http://localhost:8790";

  const tokenConfigured =
    typeof window.DIRECTORY_API_TOKEN === "string"
      ? window.DIRECTORY_API_TOKEN.trim()
      : "";
  const token =
    tokenConfigured || localStorage.getItem("directory_api_token") || "";

  async function j(method, path, body) {
    const headers = {};
    if (body) headers["content-type"] = "application/json";
    if (token) headers["authorization"] = "Bearer " + token;
    const res = await fetch(base + path, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error(
        (payload && payload.error) || `${method} ${path} -> ${res.status}`,
      );
      error.status = res.status;
      error.runStatus = payload && payload.status;
      error.traceId = payload && payload.traceId;
      error.tracePersisted = payload && payload.tracePersisted;
      throw error;
    }
    return payload;
  }

  const api = {
    base,
    enabled: false,
    info: null,
    ready: null,

    async probe() {
      try {
        api.info = await j("GET", "/api/health");
        api.enabled = !!api.info.ok;
      } catch {
        api.enabled = false;
      }
      return api.enabled;
    },

    runImprovement: (id) => j("POST", `/api/agents/${id}/improvements`),
    approve: (id) => j("POST", `/api/agents/${id}/improvements/current/approve`),
    reject: (id) => j("POST", `/api/agents/${id}/improvements/current/reject`),
    logEval: (id, record) => j("POST", `/api/agents/${id}/evals`, record),
    recordTrace: (id, trace) => j("POST", `/api/agents/${id}/traces`, trace),
    fleetHealth: () => j("GET", "/api/fleet/health"),
    // Context pillar (memory)
    addContext: (id, item) => j("POST", `/api/agents/${id}/context`, item),
    recallContext: (id, q) => j("GET", `/api/agents/${id}/context/search?q=${encodeURIComponent(q)}`),
    // Run an agent where it lives (records a trace)
    runAgent: (id, inputs) => j("POST", `/api/agents/${id}/run`, { inputs }),
    invocationCapability: (id) =>
      j("GET", `/api/agents/${id}/invocation-capability`),
    submitFeedback: (id, traceId, feedback) =>
      j("POST", `/api/agents/${id}/traces/${encodeURIComponent(traceId)}/feedback`, feedback),
    // Loop / automations (the heartbeat)
    runLoop: () => j("POST", "/api/loop/run"),
    loopInbox: () => j("GET", "/api/loop/inbox"),
    loopRuns: (n = 5) => j("GET", `/api/loop/runs?limit=${n}`),
    loopLearnings: (n = 5) => j("GET", `/api/loop/learnings?limit=${n}`),
    loopQueue: (status) => j("GET", `/api/loop/queue${status ? "?status=" + status : ""}`),
    runGoal: (id, opts) => j("POST", `/api/agents/${id}/goal`, opts || {}),
  };

  api.ready = api.probe();
  return api;
})();
