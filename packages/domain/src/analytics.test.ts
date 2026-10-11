import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENTS, AnalyticsPropsSchema, TrackEventSchema } from "./analytics";

describe("TrackEventSchema", () => {
  it("accepts every listed event, with props defaulting to empty", () => {
    for (const name of ANALYTICS_EVENTS)
      expect(TrackEventSchema.parse({ name })).toEqual({ name, props: {} });
  });
  it("rejects events that are not on the list", () => {
    expect(TrackEventSchema.safeParse({ name: "user_looked_at_something" }).success).toBe(false);
    expect(TrackEventSchema.safeParse({ name: "" }).success).toBe(false);
  });
  it("includes the events the product brief asks for", () => {
    for (const must of [
      "account_created",
      "wine_scan_failed",
      "tonight_recommendation_generated",
      "3d_cellar_opened",
      "drink_soon_viewed",
    ]) {
      expect(ANALYTICS_EVENTS).toContain(must);
    }
  });
  it("only takes a real household id", () => {
    expect(
      TrackEventSchema.safeParse({ name: "bottle_added", householdId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(
      TrackEventSchema.safeParse({
        name: "bottle_added",
        householdId: "3b797912-bf91-424b-8746-480f3b604ecc",
      }).success,
    ).toBe(true);
  });
});

describe("AnalyticsPropsSchema", () => {
  it("allows small flat scalars", () => {
    expect(
      AnalyticsPropsSchema.safeParse({ source: "scan", count: 3, first_time: true }).success,
    ).toBe(true);
  });
  it("blocks anything that looks like an email address", () => {
    expect(AnalyticsPropsSchema.safeParse({ who: "joost@example.com" }).success).toBe(false);
  });
  it("blocks nested objects, arrays and non-snake_case keys", () => {
    expect(AnalyticsPropsSchema.safeParse({ a: { b: 1 } }).success).toBe(false);
    expect(AnalyticsPropsSchema.safeParse({ a: [1] }).success).toBe(false);
    expect(AnalyticsPropsSchema.safeParse({ "Bad Key": 1 }).success).toBe(false);
    expect(AnalyticsPropsSchema.safeParse({ email: null }).success).toBe(false);
  });
  it("bounds size: long strings, too many keys, non-finite numbers", () => {
    expect(AnalyticsPropsSchema.safeParse({ s: "x".repeat(101) }).success).toBe(false);
    expect(
      AnalyticsPropsSchema.safeParse(
        Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i])),
      ).success,
    ).toBe(false);
    expect(AnalyticsPropsSchema.safeParse({ n: Infinity }).success).toBe(false);
    expect(AnalyticsPropsSchema.safeParse({ n: NaN }).success).toBe(false);
  });
});
