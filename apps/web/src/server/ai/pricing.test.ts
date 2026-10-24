import { describe, expect, it } from "vitest";
import { costOf, estimateCost, PRICING_VERSION, priceOf } from "./pricing";
import type { AiUsage } from "./types";

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  model: "gpt-4.1-mini",
  tokensIn: 1000,
  tokensOut: 100,
  latencyMs: 900,
  reported: true,
  ...over,
});

describe("AI cost estimates (micro-USD)", () => {
  it("prices input and output tokens per model", () => {
    // gpt-4.1-mini: 1000 × $0.40/1M + 100 × $1.60/1M = $0.00056 = 560 micro-USD
    expect(costOf(usage())).toEqual({ usdMicro: 560, pricingVersion: PRICING_VERSION });
    // gpt-4.1: 1000 × $2 + 100 × $8 per 1M = $0.0028
    expect(costOf(usage({ model: "gpt-4.1" })).usdMicro).toBe(2800);
  });

  it("uses the model that actually answered, dated snapshots included", () => {
    expect(priceOf("gpt-4.1-mini-2025-04-14")).toEqual(priceOf("gpt-4.1-mini"));
    expect(
      costOf(usage({ model: "gpt-4.1-mini", servedModel: "gpt-4.1-2025-04-14" })).usdMicro,
    ).toBe(2800);
  });

  it("prices cached input at the cached rate", () => {
    // 600 uncached × 0.4 + 400 cached × 0.1 + 100 × 1.6 = 240 + 40 + 160
    expect(costOf(usage({ tokensCachedIn: 400 })).usdMicro).toBe(440);
  });

  it("adds web search calls and the mini models' fixed search content tokens", () => {
    // tokens 560 + 2 × ($0.01 + 8000 × $0.40/1M) = 560 + 2 × (10000 + 3200)
    expect(costOf(usage({ webSearchCalls: 2 })).usdMicro).toBe(560 + 26_400);
    // gpt-4.1 has no fixed content block: tokens 2800 + 1 × 10000
    expect(costOf(usage({ model: "gpt-4.1", webSearchCalls: 1 })).usdMicro).toBe(12_800);
  });

  it("keeps unknown unknown: no usage reported, or a model without a price, is null (never 0)", () => {
    expect(costOf(usage({ reported: false }))).toEqual({ usdMicro: null, pricingVersion: null });
    const silent = usage();
    delete silent.reported;
    expect(costOf(silent).usdMicro).toBeNull();
    expect(costOf(usage({ model: "some-new-model" })).usdMicro).toBeNull();
  });

  it("a call that was never sent costs a confirmed 0", () => {
    expect(costOf(usage({ notSent: true, tokensIn: 0, tokensOut: 0 })).usdMicro).toBe(0);
  });

  it("rounds a fraction of a micro-dollar up, so many small calls never add up to less", () => {
    expect(costOf(usage({ tokensIn: 1, tokensOut: 0 })).usdMicro).toBe(1);
  });

  it("the budget's estimate before a call is never below the real cost of a typical call", () => {
    const chat = estimateCost({
      model: "gpt-4.1-mini",
      promptChars: 9000,
      images: 0,
      maxOutputTokens: 900,
      webSearch: false,
    });
    expect(chat).toBeGreaterThanOrEqual(
      costOf(usage({ tokensIn: 3000, tokensOut: 900 })).usdMicro!,
    );
    const valuation = estimateCost({
      model: "gpt-4.1-mini",
      promptChars: 2000,
      images: 0,
      maxOutputTokens: 600,
      webSearch: true,
    });
    expect(valuation).toBeGreaterThanOrEqual(
      costOf(usage({ tokensIn: 8000, tokensOut: 600, webSearchCalls: 3 })).usdMicro!,
    );
    // An unpriced model is budgeted at the dearest known price, never as free.
    expect(
      estimateCost({
        model: "x",
        promptChars: 300,
        images: 1,
        maxOutputTokens: 800,
        webSearch: false,
      }),
    ).toBeGreaterThan(0);
  });

  it("gpt-6-luna: uncached input at the cache-write rate, cached input, output (reasoning included)", () => {
    // 600 × 0.125 + 400 × 0.01 + 700 × 0.5 = 75 + 4 + 350
    const u = usage({ model: "gpt-6-luna", tokensIn: 1000, tokensCachedIn: 400, tokensOut: 700 });
    expect(costOf(u).usdMicro).toBe(429);
    expect(priceOf("gpt-6-luna-2026-09-22")).toEqual(priceOf("gpt-6-luna"));
    // Above 272K input tokens the whole request costs 2x input and 1.5x output.
    expect(costOf(usage({ model: "gpt-6-luna", tokensIn: 300_000, tokensOut: 100 })).usdMicro).toBe(
      Math.ceil(300_000 * 0.125 * 2 + 100 * 0.5 * 1.5),
    );
    // The estimate before a call never falls below what it then costs.
    expect(
      estimateCost({
        model: "gpt-6-luna",
        promptChars: 3000,
        images: 0,
        maxOutputTokens: 2900,
        webSearch: false,
      }),
    ).toBeGreaterThanOrEqual(
      costOf(usage({ model: "gpt-6-luna", tokensIn: 1000, tokensOut: 2900 })).usdMicro!,
    );
  });
});
