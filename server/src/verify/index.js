// Verifier factory (the checker seam). Resolves the verifier named in config;
// falls back to heuristic if a real verifier is selected but unconfigured.
import { createRegistry } from "../core/registry.js";
import { createHeuristicVerifier } from "./heuristicVerifier.js";
import { createLlmVerifier } from "./llmVerifier.js";

const registry = createRegistry("verifier")
  .register("heuristic", (opts) => createHeuristicVerifier(opts))
  .register("llm", (opts) => createLlmVerifier(opts));

/**
 * @param {import("../config.js").config} config
 * @returns {{name:string, health:Function, assess:Function}}
 */
export function getVerifier(config) {
  const { provider, ...opts } = config.verifier;
  try {
    return registry.create(provider, opts);
  } catch (e) {
    if (provider !== "heuristic") {
      console.warn(`[verifier] ${e.message} — falling back to "heuristic".`);
      return registry.create("heuristic", {});
    }
    throw e;
  }
}

export { registry as verifierRegistry };
