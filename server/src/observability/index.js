// Observability factory. Registers the built-in adapters and resolves the
// one named in config. Add a provider by registering it here.
import { createRegistry } from "../core/registry.js";
import { createLocalObservability } from "./localAdapter.js";
import { createLangfuseObservability } from "./langfuseAdapter.js";

const registry = createRegistry("observability")
  .register("local", (opts) => createLocalObservability(opts))
  .register("langfuse", (opts) => createLangfuseObservability(opts));

/**
 * @param {import("../config.js").config} config
 * @param {{store:any}} deps
 * @returns {import("../core/types.js").ObservabilityProvider}
 */
export function getObservability(config, { store }) {
  const { provider, lowScoreThreshold, langfuse } = config.observability;
  return registry.create(provider, { store, lowScoreThreshold, ...langfuse });
}

export { registry as observabilityRegistry };
