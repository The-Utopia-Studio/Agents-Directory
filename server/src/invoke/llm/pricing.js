/**
 * Attributable spend from recorded token counts.
 * Unknown models omit costUsd rather than inventing a price.
 */
export const MODEL_PRICING_USD_PER_MILLION = Object.freeze({
  "gpt-5.6-terra": Object.freeze({ input: 2, output: 12 }),
});

export function costUsdFromUsage(modelId, usage = {}) {
  const pricing = MODEL_PRICING_USD_PER_MILLION[String(modelId || "")];
  if (!pricing) return undefined;
  const inputTokens =
    typeof usage.inputTokens === "number" ? usage.inputTokens : null;
  const outputTokens =
    typeof usage.outputTokens === "number" ? usage.outputTokens : null;
  if (inputTokens === null && outputTokens === null) return undefined;
  const input = inputTokens || 0;
  const output = outputTokens || 0;
  const amount =
    (input / 1_000_000) * pricing.input + (output / 1_000_000) * pricing.output;
  // Fixed precision so traces stay comparable; still derived from real counts.
  return Math.round(amount * 1e8) / 1e8;
}
