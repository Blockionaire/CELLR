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
  summarizeSharedProfiles,
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
