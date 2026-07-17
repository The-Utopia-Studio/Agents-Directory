// Memory factory — the Context pillar. Resolves the provider named in config;
// if a real provider is selected but misconfigured, falls back to local memory
// with a warning so the loop never hard-fails (same policy as the optimizer).
import { createRegistry } from "../core/registry.js";
import { createLocalMemory } from "./localMemory.js";
import { createSupermemory } from "./supermemoryAdapter.js";
import { createActiveloop } from "./activeloopAdapter.js";

const registry = createRegistry("memory")
  .register("local", (opts) => createLocalMemory(opts))
  .register("supermemory", (opts) => createSupermemory(opts))
  .register("activeloop", (opts) => createActiveloop(opts));

/**
 * @param {import("../config.js").config} config
 * @param {{store:any}} deps
 * @returns {import("../core/types.js").MemoryProvider}
 */
export function getMemory(config, { store }) {
  const { provider, topK } = config.memory;
  const sub = config.memory[provider] || {}; // provider-specific config only
  try {
    return registry.create(provider, { store, topK, ...sub });
  } catch (e) {
    if (provider !== "local") {
      console.warn(`[memory] ${e.message} — falling back to "local".`);
      return registry.create("local", { store });
    }
    throw e;
  }
}

export { registry as memoryRegistry };
