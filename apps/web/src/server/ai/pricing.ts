import "server-only";
import type { AiUsage } from "./types";

/**
 * What AI calls cost, as an ESTIMATE from the usage the provider reported. One currency: US dollars, stored as
 * micro-USD (1 USD = 1 000 000). This is not the provider's bill: their invoice is the truth, this is how we
 * keep an eye on it per call, user, household, task and model.
 *
 * Prices are a versioned list. A new price (or a new model) is a new PRICING_VERSION and a new entry; every
 * recorded call keeps the version it was priced with, so old rows never change meaning.
 *
 * Source: OpenAI API pricing, standard tier (developers.openai.com/api/docs/pricing and the gpt-4.1 /
 * gpt-4.1-mini model pages), checked 2026-10-24.
 * - Tokens: USD per 1M tokens (input, cached input, output).
 * - Web search (the non-preview `web_search` tool): USD 10 per 1 000 calls, plus its search content tokens
 *   billed at the model's input rate; for gpt-4.1-mini (and gpt-4o-mini) the content is billed as a fixed
 *   8 000 input tokens per call. Whether the provider's reported input_tokens already include that block is
 *   not documented, so it is added on top: the estimate errs high, never low.
 * - gpt-6-luna (developers.openai.com/api/docs/models/gpt-6-luna, checked 2026-10-24): input 0.10, cached
 *   input 0.01, cache writes 0.125 (1.25x input), output 0.50. Usage does not say which uncached input tokens
 *   were cache writes, so all uncached input is priced at the cache-write rate (errs high). Reasoning tokens
 *   are part of the reported output tokens and billed as output. Prompts above 272K input tokens cost 2x input
 *   and 1.5x output for the whole request (`longPrompt`).
 */
export const PRICING_VERSION = "openai-2026-10-24b";

interface ModelPrice {
  /** USD per 1M tokens, which is micro-USD per token. */
  input: number;
  cachedInput: number;
  output: number;
  /** Search content billed as this many input tokens per web search call (mini models). */
  searchContentTokens?: number;
  /** Above this many input tokens, the whole request is billed at higher rates. */
  longPrompt?: { aboveTokensIn: number; input: number; output: number };
}

const MODELS: Record<string, ModelPrice> = {
  "gpt-4.1": { input: 2.0, cachedInput: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6, searchContentTokens: 8000 },
  "gpt-6-luna": {
    input: 0.125,
    cachedInput: 0.01,
    output: 0.5,
    longPrompt: { aboveTokensIn: 272_000, input: 2, output: 1.5 },
  },
};

/** USD per web search call (USD 10 / 1 000), in micro-USD. */
const WEB_SEARCH_CALL_MICRO = 10_000;

/** The price of a model, by its name or its dated snapshot ("gpt-4.1-mini-2025-04-14"); null if not listed. */
export function priceOf(model: string): ModelPrice | null {
  return MODELS[model] ?? MODELS[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")] ?? null;
}

export interface CostEstimate {
  /** Micro-USD, or null when it cannot be known (no usage reported, or a model without a price). */
  usdMicro: number | null;
  pricingVersion: string | null;
}

/**
 * The cost of one recorded call (all its attempts, as the provider reported them). Unknown stays unknown:
 * a call whose usage was not reported (a timeout, a dropped connection, an error) or a model without a price
 * is null, never 0. A call that was never sent (the budget said no) costs a confirmed 0.
 */
export function costOf(usage: AiUsage): CostEstimate {
  if (usage.notSent) return { usdMicro: 0, pricingVersion: PRICING_VERSION };
  const price = priceOf(usage.servedModel ?? usage.model);
  if (!usage.reported || !price) return { usdMicro: null, pricingVersion: null };
  const cached = Math.min(usage.tokensCachedIn ?? 0, usage.tokensIn);
  const searches = usage.webSearchCalls ?? 0;
  const long =
    price.longPrompt && usage.tokensIn > price.longPrompt.aboveTokensIn ? price.longPrompt : null;
  const micro =
    ((usage.tokensIn - cached) * price.input + cached * price.cachedInput) * (long?.input ?? 1) +
    usage.tokensOut * price.output * (long?.output ?? 1) +
    searches * (WEB_SEARCH_CALL_MICRO + (price.searchContentTokens ?? 0) * price.input);
  return { usdMicro: Math.ceil(micro), pricingVersion: PRICING_VERSION };
}

/** The most a model is priced at, for budgeting a model we have no price for (never cheaper than a known one). */
const DEAREST: ModelPrice = Object.values(MODELS).reduce((a, b) => (b.input > a.input ? b : a));

/**
 * A deliberately high guess of what a call will cost, before it is made, for the platform budget: the prompt at
 * ~3 characters a token, ~1 700 tokens per high-detail image, the full output allowance, every attempt (a
 * repair doubles a chat call), and up to three web searches with ~8 000 tokens of results each.
 */
export function estimateCost(input: {
  model: string;
  promptChars: number;
  images: number;
  maxOutputTokens: number;
  webSearch: boolean;
}): number {
  const price = priceOf(input.model) ?? DEAREST;
  const attempts = input.webSearch ? 1 : 2;
  const searches = input.webSearch ? 3 : 0;
  // Search results come back into the prompt: count ~8 000 input tokens per search on top of the fixed block.
  const tokensIn = Math.ceil(input.promptChars / 3) + input.images * 1700 + searches * 8000;
  const perAttempt = tokensIn * price.input + input.maxOutputTokens * price.output;
  const micro =
    attempts * perAttempt +
    searches * (WEB_SEARCH_CALL_MICRO + (price.searchContentTokens ?? 8000) * price.input);
  return Math.max(1, Math.ceil(micro));
}
