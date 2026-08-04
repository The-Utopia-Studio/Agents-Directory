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
  // A per-browser override outranks the deployed default. The alternative —
  // editing index.html for local work — is how the shipped base URL became
  // localhost, pointing every Vercel visitor at their own machine.
  const base =
    localStorage.getItem("directory_api_base") ||
    configured ||
    "http://localhost:8790";

  const tokenConfigured =
    typeof window.DIRECTORY_API_TOKEN === "string"
      ? window.DIRECTORY_API_TOKEN.trim()
      : "";
  const token =
    tokenConfigured || localStorage.getItem("directory_api_token") || "";
  // Signed Clerk identity is memory-only. It is separate from the shared
  // Railway API token and is verified by the approval endpoint.
  let identityToken = "";

  async function j(method, path, body, { signedIdentity = false } = {}) {
    const headers = {};
    if (body) headers["content-type"] = "application/json";
    if (token) headers["authorization"] = "Bearer " + token;
    if (signedIdentity && !identityToken) {
      const error = new Error(
        "Signed-in Clerk identity is required. Sign in and retry — anonymous callers cannot spend or mutate.",
      );
      error.status = 401;
      throw error;
    }
    if (signedIdentity && identityToken) {
      headers["x-directory-identity-token"] = identityToken;
    }
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

  async function download(path) {
    const headers = token ? { authorization: "Bearer " + token } : undefined;
    const res = await fetch(base + path, { headers });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error((payload && payload.error) || `GET ${path} -> ${res.status}`);
    }
    const disposition = res.headers.get("content-disposition") || "";
    const filename =
      disposition.match(/filename="([^"]+)"/)?.[1] || "agent-artifact.zip";
    return { blob: await res.blob(), filename };
  }

  const api = {
    base,
    enabled: false,
    info: null,
    ready: null,
    setIdentityToken(value) {
      identityToken = typeof value === "string" ? value : "";
    },

    async probe() {
      try {
        api.info = await j("GET", "/api/health");
        api.enabled = !!api.info.ok;
      } catch {
        api.enabled = false;
      }
      return api.enabled;
    },

    migrationExport: () => j("GET", "/api/migration/export"),
    // Read-only. Observes which agent ids the service currently knows about, so
    // the browser can avoid colliding with them. This is not a catalog sync and
    // not an id reservation: the directory record stays local.
    listAgents: () => j("GET", "/api/agents"),
    runImprovement: (id) => j("POST", `/api/agents/${id}/improvements`, null, { signedIdentity: true }),
    // A decision names its proposal. "current" is only valid when exactly one
    // is pending; with several, an unnamed decision would resolve an arbitrary
    // one of them.
    approve: (id, pid) => j(
      "POST",
      `/api/agents/${id}/improvements/${encodeURIComponent(pid || "current")}/approve`,
      null,
      { signedIdentity: true },
    ),
    reject: (id, pid) => j(
      "POST",
      `/api/agents/${id}/improvements/${encodeURIComponent(pid || "current")}/reject`,
      null,
      { signedIdentity: true },
    ),
    reopenRejected: (id, pid) =>
      j("POST", `/api/agents/${id}/improvements/${encodeURIComponent(pid)}/reopen`, null, {
        signedIdentity: true,
      }),
    logEval: (id, record) =>
      j("POST", `/api/agents/${id}/evals`, record, { signedIdentity: true }),
    recordTrace: (id, trace) =>
      j("POST", `/api/agents/${id}/traces`, trace, { signedIdentity: true }),
    fleetHealth: () => j("GET", "/api/fleet/health"),
    // Context pillar (memory)
    addContext: (id, item) =>
      j("POST", `/api/agents/${id}/context`, item, { signedIdentity: true }),
    recallContext: (id, q) => j("GET", `/api/agents/${id}/context/search?q=${encodeURIComponent(q)}`),
    // Run an agent where it lives (records a trace) — spends Anthropic; requires Clerk
    runAgent: (id, inputs) =>
      j("POST", `/api/agents/${id}/run`, { inputs }, { signedIdentity: true }),
    putAgent: (id, body) =>
      j("PUT", `/api/agents/${id}`, body, { signedIdentity: true }),
    invocationCapability: (id) =>
      j("GET", `/api/agents/${id}/invocation-capability`),
    installSkill: (id) =>
      j("GET", `/api/agents/${id}/install-artifact/skill`),
    downloadInstallArtifact: (id) =>
      download(`/api/agents/${id}/install-artifact/download`),
    handoffBriefing: (id) => j("GET", `/api/agents/${id}/handoff-briefing`),
    submitFeedback: (id, traceId, feedback) =>
      j(
        "POST",
        `/api/agents/${id}/traces/${encodeURIComponent(traceId)}/feedback`,
        feedback,
        { signedIdentity: true },
      ),
    // Loop / automations (the heartbeat)
    runLoop: () => j("POST", "/api/loop/run", null, { signedIdentity: true }),
    loopInbox: () => j("GET", "/api/loop/inbox"),
    loopRuns: (n = 5) => j("GET", `/api/loop/runs?limit=${n}`),
    loopLearnings: (n = 5) => j("GET", `/api/loop/learnings?limit=${n}`),
    loopQueue: (status) => j("GET", `/api/loop/queue${status ? "?status=" + status : ""}`),
    runGoal: (id, opts) =>
      j("POST", `/api/agents/${id}/goal`, opts || {}, { signedIdentity: true }),
    mechanicalInventory: (id) => j("GET", `/api/agents/${id}/mechanical-inventory`),
    mechanicalScore: (id, body) =>
      j("POST", `/api/agents/${id}/mechanical-score`, body, { signedIdentity: true }),
    mechanicalComparePreview: (id, leftVersion, rightVersion) =>
      j(
        "GET",
        `/api/agents/${id}/mechanical-compare/preview?leftVersion=${encodeURIComponent(leftVersion)}&rightVersion=${encodeURIComponent(rightVersion)}`,
      ),
    mechanicalCompare: (id, body) =>
      j("POST", `/api/agents/${id}/mechanical-compare`, body, { signedIdentity: true }),
    mechanicalResults: (id, n = 10) =>
      j("GET", `/api/agents/${id}/mechanical-results?limit=${n}`),
  };

  api.ready = api.probe();
  return api;
})();
