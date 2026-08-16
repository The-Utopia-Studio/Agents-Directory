// Minimal dependency-free router: method + path patterns with :params,
// JSON body parsing, CORS, optional bearer auth, and uniform error handling.
// Enough for a clean REST surface without pulling in a framework.
/**
 * Routes that carry their own, stronger authentication and therefore cannot
 * use the shared API_TOKEN gate. Only the GitHub webhook qualifies: GitHub
 * cannot send our bearer token, and the route verifies an HMAC over the raw
 * body instead. Nothing is added here without an equivalent gate of its own.
 */
const SELF_AUTHENTICATED_PATHS = new Set(["/api/github/webhook"]);

export function createRouter({ corsOrigin = "*", apiToken = "" } = {}) {
  const routes = [];

  function add(method, pattern, handler) {
    const keys = [];
    const rx = new RegExp(
      "^" + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; }) + "/?$"
    );
    routes.push({ method, rx, keys, handler });
  }

  const api = {
    get: (p, h) => (add("GET", p, h), api),
    post: (p, h) => (add("POST", p, h), api),
    put: (p, h) => (add("PUT", p, h), api),
    del: (p, h) => (add("DELETE", p, h), api),
    handler() {
      return async (req, res) => {
        const cors = {
          "access-control-allow-origin": corsOrigin,
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          // authorization must be listed so browser preflight allows Bearer tokens
          "access-control-allow-headers": "content-type, authorization, x-directory-identity-token",
          "access-control-expose-headers": "content-disposition, x-artifact-digest, x-artifact-digest-algorithm",
        };
        if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

        const url = new URL(req.url, "http://localhost");
        const path = url.pathname.replace(/\/+$/, "") || "/";

        // Optional shared-secret gate. Unset API_TOKEN => open (backwards-compatible).
        // Health stays public so Railway / Docker probes work without a token.
        if (apiToken) {
          const isPublicHealth = req.method === "GET" && path === "/api/health";
          if (!isPublicHealth && !SELF_AUTHENTICATED_PATHS.has(path)) {
            const auth = req.headers.authorization || "";
            if (auth !== `Bearer ${apiToken}`) {
              send(res, 401, { error: "Unauthorized" }, cors);
              return;
            }
          }
        }

        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = url.pathname.match(r.rx);
          if (!m) continue;
          const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          const query = Object.fromEntries(url.searchParams);
          try {
            const body = await readJson(req);
            const out = await r.handler({ params, query, body, req });
            const status = out?.__status || 200;
            if (out?.__binary) {
              sendBinary(res, status, out.__body, out.__headers, cors);
            } else {
              send(res, status, out?.__body ?? out, cors);
            }
          } catch (e) {
            const body = { error: e.message || "Internal error" };
            if (e.runStatus) body.status = e.runStatus;
            if (e.traceId) body.traceId = e.traceId;
            if (typeof e.tracePersisted === "boolean") {
              body.tracePersisted = e.tracePersisted;
            }
            if (e.promotionGate) body.promotionGate = e.promotionGate;
            if (e.proposal) body.proposal = e.proposal;
            if (e.code) body.code = e.code;
            if (e.expectedDigest !== undefined) body.expectedDigest = e.expectedDigest;
            if (e.actualDigest !== undefined) body.actualDigest = e.actualDigest;
            send(res, e.status || 500, body, cors);
          }
          return;
        }
        send(res, 404, { error: `No route for ${req.method} ${url.pathname}` }, cors);
      };
    },
  };
  return api;
}

/**
 * Parse the JSON body and keep the exact bytes on req.rawBody.
 *
 * The raw buffer is what HMAC-signed webhooks must be verified against —
 * re-serialising the parsed object reorders keys and drops whitespace, so a
 * valid signature would fail. Handlers that do not verify signatures ignore it.
 */
function readJson(req) {
  if (req.method === "GET" || req.method === "DELETE") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      req.rawBody = raw;
      if (!raw.length) return resolve(null);
      try { resolve(JSON.parse(raw.toString("utf8"))); } catch { reject(Object.assign(new Error("Invalid JSON body"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, cors) {
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}

function sendBinary(res, status, body, headers = {}, cors) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "content-type": "application/octet-stream",
    "content-length": data.length,
    ...headers,
    ...cors,
  });
  res.end(data);
}

/** Helper for handlers that need a non-200 status. */
export const reply = (status, body) => ({ __status: status, __body: body });

/** Fixed server-owned download. Callers never supply filesystem paths. */
export const binaryReply = (body, headers = {}, status = 200) => ({
  __status: status,
  __body: body,
  __headers: headers,
  __binary: true,
});
