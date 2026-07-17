// Entrypoint. Wires config -> store -> providers -> service -> HTTP, seeds on
// first boot, and starts listening. This is the only file that knows about
// every layer; everything else depends on interfaces.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { createStore } from "../core/store.js";
import { createLoopService } from "../core/loopService.js";
import { getObservability } from "../observability/index.js";
import { getOptimizer } from "../improve/index.js";
import { getMemory } from "../memory/index.js";
import { createRouter } from "./router.js";
import { registerRoutes } from "./routes.js";
import { seed } from "../scripts/seed.js";

export async function buildApp(overrides = {}) {
  const store = overrides.store || createStore(config.dataDir);
  await seed(store); // idempotent
  const obs = overrides.obs || getObservability(config, { store });
  const optimizer = overrides.optimizer || getOptimizer(config);
  const memory = overrides.memory || getMemory(config, { store });
  const svc = createLoopService({ store, obs, optimizer, memory });

  // Seed each agent's context[] into memory once (marker in the store), so the
  // static Context list becomes live recall the first time the service runs.
  if (!(await store.get("meta", "contextSeeded"))) {
    try {
      const n = await svc.seedContext();
      await store.put("meta", { id: "contextSeeded", n, at: new Date().toISOString() });
    } catch (e) {
      console.warn(`[memory] context seed skipped: ${e.message}`);
    }
  }

  const router = createRouter({ corsOrigin: config.corsOrigin });
  registerRoutes(router, svc);
  return { svc, handler: router.handler() };
}

export async function start() {
  const { svc, handler } = await buildApp();
  const server = createServer(handler);
  await new Promise((r) => server.listen(config.port, r));
  const h = await svc.health();
  console.log(
    `[loop] listening on :${config.port}  ` +
    `obs=${h.observability.provider}(${h.observability.ok ? "ok" : "down"}) ` +
    `optimizer=${h.optimizer.provider}`
  );
  return server;
}

// Robust "is this the entrypoint?" check — path comparison, not URL string
// equality, so a space in the path (percent-encoded in import.meta.url) works.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start().catch((e) => { console.error(e); process.exit(1); });
}
