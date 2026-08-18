// Entrypoint. Wires config -> store -> providers -> service -> HTTP, seeds on
// first boot, and starts listening. This is the only file that knows about
// every layer; everything else depends on interfaces.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { assertDataDirReady } from "../core/dataDir.js";
import { createStore } from "../core/store.js";
import { createLoopService } from "../core/loopService.js";
import { getObservability } from "../observability/index.js";
import { getOptimizer } from "../improve/index.js";
import { getMemory } from "../memory/index.js";
import { getVerifier } from "../verify/index.js";
import { createLoopEngine } from "../loop/engine.js";
import { createRouter } from "./router.js";
import { registerRoutes } from "./routes.js";
import { seed } from "../scripts/seed.js";

export async function buildApp(overrides = {}) {
  const appConfig = overrides.config || config;
  // Tests and callers that inject a store own their own temp directory; skip
  // the volume check for those. Production always goes through createStore.
  if (!overrides.store) {
    await assertDataDirReady(appConfig.dataDir, {
      requireExisting: Boolean(appConfig.requirePersistentDataDir),
    });
  }
  const store =
    overrides.store ||
    createStore(appConfig.dataDir, {
      createIfMissing: !appConfig.requirePersistentDataDir,
    });
  // seedIfEmpty is a first-boot path only. On a volume that already has
  // agents.json it is a no-op; new server-owned agents (A7, A8, …) still need
  // the explicit upsert inside seed(), not a seed entry alone.
  const seedResult = await seed(store);
  // This is intentionally aggregate-only: Railway logs can prove whether the
  // mounted volume was seeded/upserted without exposing agent records or any
  // fellow data. A seed failure is still fatal because it is awaited above.
  const seededAgentCount = (await store.all("agents")).length;
  console.log(
    `[seed] agents=${seededAgentCount} ` +
      `seededEmpty=${seedResult.agents} ` +
      `serverOwnedAdded=${seedResult.serverOwnedAgentsAdded.join(",") || "none"} ` +
      `usabilityBackfilled=${seedResult.usabilityModesBackfilled}`,
  );
  const obs = overrides.obs || getObservability(appConfig, { store });
  const optimizer = overrides.optimizer || getOptimizer(appConfig);
  const memory = overrides.memory || getMemory(appConfig, { store });
  const verifier = overrides.verifier || getVerifier(appConfig);
  const svc = createLoopService({
    store,
    obs,
    optimizer,
    memory,
    verifier,
    config: appConfig,
    getGovernedRuntimePin: overrides.getGovernedRuntimePin,
  });
  const engine = overrides.engine || createLoopEngine({ svc, obs, verifier, config: appConfig });

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

  const router = createRouter({ corsOrigin: appConfig.corsOrigin, apiToken: appConfig.apiToken });
  registerRoutes(router, svc, engine, appConfig);
  return { svc, engine, handler: router.handler() };
}

export async function start() {
  const { svc, engine, handler } = await buildApp();
  const server = createServer(handler);
  await new Promise((r) => server.listen(config.port, r));
  const h = await svc.health();
  console.log(
    `[loop] listening on :${config.port}  ` +
    `dataDir=${config.dataDir}` +
    `${config.requirePersistentDataDir ? " (Railway volume required)" : ""}  ` +
    `obs=${h.observability.provider}(${h.observability.ok ? "ok" : "down"}) ` +
    `optimizer=${h.optimizer.provider} memory=${h.memory.provider}`
  );

  // The heartbeat — an in-process scheduler (opt-in). In production you'd push
  // this to cron / GitHub Actions so it survives the process, but this makes the
  // loop demonstrable as an actual automation, not just a manual trigger.
  if (config.loop.enabled && config.loop.intervalMs > 0) {
    const tick = () => engine.runCycle()
      .then((r) => {
        const o = r.outcomes || {};
        console.log(
          `[loop] cycle: scanned ${r.scanned}, attempted ${o.attempted ?? r.selected}, proposed ${o.proposed ?? 0}, refused ${o.refused ?? 0}, jobs ${r.budget?.jobs ?? 0} of ${r.budget?.maxJobs ?? "?"}`,
        );
      })
      .catch((e) => console.warn(`[loop] cycle error: ${e.message}`));
    setInterval(tick, config.loop.intervalMs).unref();
    console.log(`[loop] heartbeat every ${config.loop.intervalMs}ms (autoApply=${config.loop.autoApply})`);
  }
  return server;
}

// Robust "is this the entrypoint?" check — path comparison, not URL string
// equality, so a space in the path (percent-encoded in import.meta.url) works.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start().catch((e) => { console.error(e); process.exit(1); });
}
