// ── Loop API client (optional) ───────────────────────────────────────
// Thin bridge from the static front-end to the loop service (server/).
// It probes /api/health on load; if the service isn't running the app keeps
// working entirely offline (localStorage), and the loop actions fall back to
// their local stubs. When the service IS up, "Propose improvement" runs the
// real optimizer against real traces, and approve / reject / eval flow through.
window.DirectoryAPI = (function () {
  const base =
    window.DIRECTORY_API_BASE ||
    localStorage.getItem("directory_api_base") ||
    "http://localhost:8790";

  async function j(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    return res.json();
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
  };

  api.ready = api.probe();
  return api;
})();
