// Optimizer factory. Resolves the optimizer named in config; if GEPA is
// selected but unconfigured, falls back to the heuristic optimizer so the
// loop never hard-fails — with a warning so the operator knows.
import { createRegistry } from "../core/registry.js";
import { createHeuristicOptimizer } from "./heuristicOptimizer.js";
import { createGepaOptimizer } from "./gepaAdapter.js";

const registry = createRegistry("optimizer")
  .register("heuristic", () => createHeuristicOptimizer())
  .register("gepa", (opts) => createGepaOptimizer(opts));

/**
 * @param {import("../config.js").config} config
 * @returns {import("../core/types.js").Optimizer}
 */
export function getOptimizer(config) {
  const { provider, gepa } = config.optimizer;
  try {
    return registry.create(provider, gepa);
  } catch (e) {
    if (provider !== "heuristic") {
      console.warn(`[optimizer] ${e.message} — falling back to "heuristic".`);
      return registry.create("heuristic");
    }
    throw e;
  }
}

export { registry as optimizerRegistry };
