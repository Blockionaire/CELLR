import { describe, expect, it } from "vitest";
import {
  BottleExtrasSchema,
  checkInsight,
  currentValueCents,
  daysUntil,
  reminderWhen,
  type RawInsight,
} from "./insights";

const raw: RawInsight = {
  summary: "A  ripe\nBordeaux.",
  style: "Full-bodied red",
  grapes: ["Merlot", "merlot", " Cabernet Franc ", ""],
  tasting: "Plum and cedar.",
  serving_temp_min_c: 16,
  serving_temp_max_c: 18,
  decant_minutes: 60,
  pairings: ["Lamb", "Hard cheese"],
  aging: "Another decade.",
  value_low: 40,
  value_high: 60,
  value_basis: "Recent auction prices for the estate.",
  confidence: "high",
};

describe("bottle extras", () => {
  it("keeps who gave it only for a gift, and an occasion needs a name", () => {
    const parse = (v: unknown) => BottleExtrasSchema.safeParse(v);
    expect(
      parse({ acquiredHow: "gift", giftFrom: " Oma ", occasionTitle: null, occasionOn: null }),
    ).toMatchObject({ success: true, data: { giftFrom: "Oma" } });
    expect(
      parse({ acquiredHow: "bought", giftFrom: "Oma", occasionTitle: null, occasionOn: null }),
    ).toMatchObject({ success: true, data: { giftFrom: null } });
    expect(
      parse({ acquiredHow: null, giftFrom: null, occasionTitle: "", occasionOn: "2026-12-25" })
        .success,
    ).toBe(false);
    expect(
      parse({ acquiredHow: "stolen", giftFrom: null, occasionTitle: null, occasionOn: null })
        .success,
    ).toBe(false);
    expect(
      parse({ acquiredHow: null, giftFrom: null, occasionTitle: "x", occasionOn: "25-12-2026" })
        .success,
    ).toBe(false);
  });
});

describe("reminders", () => {
  it("counts calendar days, across months and leap days", () => {
    expect(daysUntil("2026-12-25", "2026-12-25")).toBe(0);
    expect(daysUntil("2026-12-25", "2026-12-20")).toBe(5);
    expect(daysUntil("2027-01-02", "2026-12-30")).toBe(3);
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
    expect(daysUntil("2026-12-20", "2026-12-25")).toBe(-5);
  });
  it("says when", () => {
    expect([-1, 0, 1, 9].map(reminderWhen)).toEqual(["overdue", "today", "tomorrow", "days"]);
  });
});

describe("checking an AI profile", () => {
  it("tidies the text and turns the value into cents", () => {
    const out = checkInsight(raw, "EUR")!;
    expect(out.summary).toBe("A ripe Bordeaux.");
    expect(out.grapes).toEqual(["Merlot", "Cabernet Franc"]);
    expect(out.value).toEqual({
      lowCents: 4000,
      highCents: 6000,
      currency: "EUR",
      basis: "Recent auction prices for the estate.",
    });
    expect(out.serving).toEqual({ minC: 16, maxC: 18 });
    expect(out.confidence).toBe("high");
  });
  it("drops what cannot be true", () => {
    expect(checkInsight({ ...raw, serving_temp_min_c: 40 }, "EUR")!.serving).toBeNull();
    expect(
      checkInsight({ ...raw, serving_temp_min_c: 18, serving_temp_max_c: 16 }, "EUR")!.serving,
    ).toBeNull();
    expect(checkInsight({ ...raw, decant_minutes: 9000 }, "EUR")!.decantMinutes).toBeNull();
  });
  it("throws away an absurd value and is less sure of the rest", () => {
    for (const [low, high] of [
      [60, 40],
      [1, 500],
      [0, 10],
      [-5, 5],
      [10, 1e9],
    ] as const) {
      const out = checkInsight({ ...raw, value_low: low, value_high: high }, "EUR")!;
      expect(out.value).toBeNull();
      expect(out.confidence).toBe("medium");
    }
    expect(checkInsight({ ...raw, value_low: null, value_high: null }, "EUR")!.value).toBeNull();
  });
  it("has nothing to keep without a summary", () => {
    expect(checkInsight({ ...raw, summary: "  \n " }, "EUR")).toBeNull();
  });
});

describe("current value", () => {
  const insight = checkInsight(raw, "EUR")!;
  const view = { insight: { output: insight, model: "m", generatedAt: "x" } };
  it("prefers your own number, else the middle of the estimate, else nothing", () => {
    expect(currentValueCents({ ...view, myValueCents: 7000 })).toBe(7000);
    expect(currentValueCents({ ...view, myValueCents: null })).toBe(5000);
    expect(currentValueCents({ insight: null, myValueCents: null })).toBeNull();
    expect(currentValueCents({ insight: null, myValueCents: 0 })).toBe(0);
  });
});
