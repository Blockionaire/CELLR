import { describe, expect, it } from "vitest";
import {
  budgetUse,
  isAdminUser,
  parseAdminAllowlist,
  parseAdminPage,
  parseAdminRange,
  summarizeAiCosts,
  sumActivity,
  type AdminAiCosts,
  summarizeRecognitionCache,
  summarizeRecognitionPaths,
  AdminRecognitionPathsSchema,
  summarizeSharedProfiles,
  catalogShare,
} from "./admin";

const A = "0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b";
const B = "1c7a3d2f-7b2e-4a8f-8b4c-3d5e6f7a8b9c";

describe("who is an admin", () => {
  it("a listed, verified user id is", () => {
    const list = parseAdminAllowlist(` ${A} , ${B.toUpperCase()} `);
    expect(isAdminUser(A, list)).toBe(true);
    expect(isAdminUser(B, list)).toBe(true);
  });
  it("fails closed: unset, empty, or any malformed entry admits nobody", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "  ",
      `${A},not-a-uuid`,
      `${A},`,
      "admin@cellr.app",
      "*",
      `${A};${B}`,
    ])
      expect(parseAdminAllowlist(raw).size).toBe(0);
    expect(isAdminUser(A, parseAdminAllowlist(`${A},x`))).toBe(false);
  });
  it("only the exact id counts: no email, prefix, empty or spoofed value", () => {
    const list = parseAdminAllowlist(A);
    for (const claim of [
      null,
      undefined,
      "",
      "admin",
      A.slice(0, 8),
      `${A} `,
      B,
      "admin@cellr.app",
    ])
      expect(isAdminUser(claim, list)).toBe(false);
  });
});

describe("what a page asks for", () => {
  it("ranges are 7, 30 or 90 days; anything else is the default", () => {
    expect(parseAdminRange("7")).toBe(7);
    expect(parseAdminRange(["90", "7"])).toBe(90);
    for (const v of [undefined, "14", "-7", "30;drop", "1e9"]) expect(parseAdminRange(v)).toBe(30);
  });
  it("pages are whole, from 1, bounded", () => {
    expect(parseAdminPage("3")).toBe(3);
    for (const v of [undefined, "0", "-2", "abc", "99999999"]) expect(parseAdminPage(v)).toBe(1);
    expect(parseAdminPage("2.7")).toBe(2);
  });
});

const costs = (over: Partial<AdminAiCosts["totals"]> = {}): AdminAiCosts => ({
  from: "a",
  to: "b",
  totals: {
    calls: 10,
    ok: 6,
    failed: 1,
    timeout: 1,
    rate_limited: 0,
    blocked: 2,
    known_cost: 13450,
    unknown_calls: 1,
    unknown_held: 9000,
    tokens_in: 13000,
    tokens_cached_in: 0,
    tokens_out: 1600,
    web_searches: 3,
    avg_latency_ms: 600,
    ...over,
  },
  by_day: [],
  by_task: [],
  by_model: [],
});

describe("AI costs", () => {
  it("rates are over calls that reached the provider; unknown cost is apart, never free", () => {
    const s = summarizeAiCosts(costs());
    expect(s).toMatchObject({
      sent: 8,
      successRate: 6 / 8,
      timeoutRate: 1 / 8,
      knownCostUsdMicro: 13450,
    });
    expect(s).toMatchObject({
      unknownCostCalls: 1,
      unknownHeldUsdMicro: 9000,
      searchFeesUsdMicro: 30000,
    });
  });
  it("no calls: rates are unavailable, not 0%", () => {
    const s = summarizeAiCosts(costs({ calls: 0, ok: 0, failed: 0, timeout: 0, blocked: 0 }));
    expect([s.successRate, s.failureRate, s.timeoutRate]).toEqual([null, null, null]);
  });
  it("the budget counts recorded usage and outstanding holds, each once", () => {
    const u = budgetUse(
      {
        recorded_day: 22450,
        recorded_month: 50000,
        holds_day: 5000,
        holds_month: 5000,
        holds_open: 1,
      },
      { daily: 100000, monthly: null },
    );
    expect(u.day).toMatchObject({ total: 27450, share: 0.2745 });
    expect(u.month).toMatchObject({ total: 55000, limit: null, share: null });
  });
});

describe("activity", () => {
  it("sums the days; extraction success is null without any extraction", () => {
    const day = (over = {}) => ({
      day: "2026-10-01",
      signups: 1,
      active: 2,
      scans: 0,
      extraction_ok: 0,
      extraction_failed: 0,
      sommelier: 1,
      insights: 0,
      valuations: 0,
      tonight: 1,
      cellar_3d: 0,
      bottles_added: 3,
      ...over,
    });
    expect(sumActivity([day(), day({ active: 5 })])).toMatchObject({
      signups: 2,
      sommelier: 2,
      tonight: 2,
      bottlesAdded: 6,
      peakActive: 5,
      extractionSuccess: null,
    });
    expect(sumActivity([day({ extraction_ok: 3, extraction_failed: 1 })]).extractionSuccess).toBe(
      0.75,
    );
  });
});

describe("the recognition cache figures", () => {
  it("hits are vision calls avoided; the rate is over scans that looked", () => {
    expect(summarizeRecognitionCache({ hits: 3, misses: 9 })).toEqual({
      hits: 3,
      misses: 9,
      visionCallsAvoided: 3,
      hitRate: 0.25,
    });
    expect(summarizeRecognitionCache({ hits: 0, misses: 0 }).hitRate).toBeNull();
  });
});

describe("the shared wine profile figures", () => {
  it("hits are research calls avoided; the rate is over shareable wines that looked", () => {
    expect(summarizeSharedProfiles({ hits: 3, misses: 1, profiles: 4, review_due: 0 }, 5)).toEqual({
      hits: 3,
      misses: 1,
      researchCallsAvoided: 3,
      hitRate: 0.75,
      sharedProfiles: 4,
      reviewDue: 0,
      researchCalls: 5,
    });
    expect(
      summarizeSharedProfiles({ hits: 0, misses: 0, profiles: 0, review_due: 0 }, null).hitRate,
    ).toBeNull();
  });
});

describe("the catalogue figures", () => {
  it("the share of new bottles that are catalogue wines", () => {
    const base = { producers: 1, wines: 2, vintages: 3, aliases: 0, private_wines_created: 0 };
    expect(catalogShare({ ...base, bottles_catalog: 1, bottles_private: 3 })).toBe(0.25);
    expect(catalogShare({ ...base, bottles_catalog: 0, bottles_private: 0 })).toBeNull();
  });
});

describe("database-first recognition paths", () => {
  const paths = AdminRecognitionPathsSchema.parse({
    scans: 20,
    cacheHits: 2,
    textAttempts: 12,
    textHits: 6,
    textMisses: 6,
    noText: 4,
    textHitsWithYear: 5,
    ocrMs: { hit: "1820", miss: 2400, cacheHit: 700, p50: 2000, p90: 2900 },
    lookupMs: { avg: 35, p90: 60 },
    vision: { calls: 9, avgMs: 6100, p90Ms: 9000, costedCalls: 9, avgCostUsdMicro: 1500 },
    outcomes: { accepted: 3, yearChanged: 1, yearFilled: 1, differentWine: 0, unsaved: 1 },
  });

  it("reports only measured figures: calls avoided, the read-by-model share, and the saving at the measured cost", () => {
    const s = summarizeRecognitionPaths(paths);
    expect(s.visionCallsAvoided).toBe(8);
    expect(s.readByModel).toBe(12);
    expect(s.fallbackRate).toBeCloseTo(0.6);
    expect(s.textHitRate).toBeCloseTo(0.5);
    expect(s.estimatedSavingsUsdMicro).toBe(12_000);
    expect(s.savedMatches).toBe(5);
    expect(s.rejectionRate).toBe(0);
    expect(s.yearCorrectionRate).toBeCloseTo(0.2);
    expect(s.ocrMs.hit).toBe(1820);
  });

  it("no measured cost, no saving; no scans, no rates", () => {
    const none = summarizeRecognitionPaths(
      AdminRecognitionPathsSchema.parse({
        ...paths,
        scans: 0,
        cacheHits: 0,
        textAttempts: 0,
        textHits: 0,
        vision: { ...paths.vision, avgCostUsdMicro: null, avgMs: null },
        ocrMs: { hit: null, miss: null, p50: null, p90: null },
        outcomes: { accepted: 0, yearChanged: 0, yearFilled: 0, differentWine: 0, unsaved: 0 },
      }),
    );
    expect(none.estimatedSavingsUsdMicro).toBeNull();
    expect(none.fallbackRate).toBeNull();
    expect(none.textHitRate).toBeNull();
    expect(none.rejectionRate).toBeNull();
    expect(none.ocrMs.hit).toBeNull();
  });
});
