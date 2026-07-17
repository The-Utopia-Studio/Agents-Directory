// Minimal dependency-free router: method + path patterns with :params,
// JSON body parsing, CORS, and uniform error handling. Enough for a clean
// REST surface without pulling in a framework.
export function createRouter({ corsOrigin = "*" } = {}) {
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
          "access-control-allow-headers": "content-type",
        };
        if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

        const url = new URL(req.url, "http://localhost");
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
            send(res, status, out?.__body ?? out, cors);
          } catch (e) {
            send(res, e.status || 500, { error: e.message || "Internal error" }, cors);
          }
          return;
        }
        send(res, 404, { error: `No route for ${req.method} ${url.pathname}` }, cors);
      };
    },
  };
  return api;
}

function readJson(req) {
  if (req.method === "GET" || req.method === "DELETE") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve(null);
      try { resolve(JSON.parse(data)); } catch { reject(Object.assign(new Error("Invalid JSON body"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function send(res, status, body, cors) {
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(body));
}

/** Helper for handlers that need a non-200 status. */
export const reply = (status, body) => ({ __status: status, __body: body });
