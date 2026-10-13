import { describe, expect, it } from "vitest";
import { buildStats, decadeOf, type StatsBottle, type StatsInput } from "./stats";

const now = new Date("2026-10-12T12:00:00Z");
const bottle = (over: Partial<StatsBottle> = {}): StatsBottle => ({
  vintageId: "v1",
  wineId: "w1",
  producer: "Margaux",
  wineName: "Pavillon",
  type: "red",
  year: 2015,
  region: "Bordeaux",
  appellation: null,
  countryCode: "FR",
  priceCents: 3000,
  ...over,
});
const input = (over: Partial<StatsInput> = {}): StatsInput => ({
  bottles: [],
  opened: [],
  scores: [],
  values: [],
  currency: "EUR",
  now,
  ...over,
});

describe("an empty cellar", () => {
  it("is all zeros and nothing invented", () => {
    const s = buildStats(input());
    expect(s).toMatchObject({ bottleCount: 0, wineCount: 0, openedCount: 0 });
    expect(s.money).toEqual({
      spentCents: null,
      pricedCount: 0,
      averagePriceCents: null,
      worthCents: null,
      valuedCount: 0,
      gainCents: null,
      comparedCount: 0,
    });
    expect(s.byType).toEqual([]);
    expect(s.openedByMonth).toHaveLength(12);
    expect(s.readyByYear).toHaveLength(15);
    expect(s.topRated).toEqual([]);
  });
});

describe("what is in the cellar", () => {
  const bottles = [
    bottle({ vintageId: "v1", wineId: "w1" }),
    bottle({ vintageId: "v1", wineId: "w1" }),
    bottle({
      vintageId: "v2",
      wineId: "w2",
      producer: "Bollinger",
      wineName: "Special",
      type: "sparkling",
      year: null,
      region: "Champagne",
      priceCents: null,
    }),
    bottle({
      vintageId: "v3",
      wineId: "w3",
      producer: "Antinori",
      wineName: "Tignanello",
      year: 2018,
      region: "Tuscany",
      countryCode: "IT",
      priceCents: 9000,
    }),
  ];
  const s = buildStats(input({ bottles }));

  it("counts bottles and wines", () => {
    expect(s.bottleCount).toBe(4);
    expect(s.wineCount).toBe(3);
  });
  it("splits by type, country, decade and producer, biggest first", () => {
    expect(s.byType).toEqual([
      { key: "red", count: 3 },
      { key: "sparkling", count: 1 },
    ]);
    expect(s.byCountry).toEqual([
      { key: "FR", count: 3 },
      { key: "IT", count: 1 },
    ]);
    expect(s.byDecade).toEqual([
      { key: "2010s", count: 3 },
      { key: "nv", count: 1 },
    ]);
    expect(s.byProducer[0]).toEqual({ key: "Margaux", count: 2 });
  });
  it("adds up what was paid from the prices that are known", () => {
    expect(s.money).toMatchObject({
      spentCents: 15000,
      pricedCount: 3,
      averagePriceCents: 5000,
    });
  });
  it("puts every bottle in a stage of its window, and non-vintage in 'unknown'", () => {
    expect(s.byPhase.reduce((n, p) => n + p.count, 0)).toBe(4);
    expect(s.byPhase.find((p) => p.key === "unknown")).toEqual({ key: "unknown", count: 1 });
  });
  it("says in which years bottles are drinkable and at their best", () => {
    expect(s.readyByYear[0]!.year).toBe(2026);
    const total = s.readyByYear.reduce((n, y) => n + y.ready, 0);
    expect(total).toBeGreaterThan(0);
    for (const y of s.readyByYear) expect(y.peak).toBeLessThanOrEqual(y.ready);
  });
  it("limits the long lists", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      bottle({
        vintageId: `v${i}`,
        wineId: `w${i}`,
        producer: `P${String(i).padStart(2, "0")}`,
        countryCode: String.fromCharCode(65 + i) + "X",
      }),
    );
    const big = buildStats(input({ bottles: many }));
    expect(big.byCountry).toHaveLength(8);
    expect(big.byProducer).toHaveLength(5);
  });
});

describe("worth", () => {
  const bottles = [
    bottle({ vintageId: "v1", priceCents: 3000 }),
    bottle({ vintageId: "v1", priceCents: 3000 }),
    bottle({ vintageId: "v2", wineId: "w2", priceCents: null }),
    bottle({ vintageId: "v3", wineId: "w3", priceCents: 1000 }),
  ];
  it("counts each bottle at its vintage's value, and compares only where there is a price too", () => {
    const s = buildStats(
      input({
        bottles,
        values: [
          { vintageId: "v1", valueCents: 5000 },
          { vintageId: "v2", valueCents: 2000 },
        ],
      }),
    );
    expect(s.money.worthCents).toBe(5000 + 5000 + 2000);
    expect(s.money.valuedCount).toBe(3);
    // v1 twice: paid 6000, worth 10000. v2 has no price, so it is left out of the comparison.
    expect(s.money.gainCents).toBe(4000);
    expect(s.money.comparedCount).toBe(2);
  });
  it("is null when nothing has a value", () => {
    expect(buildStats(input({ bottles })).money).toMatchObject({
      worthCents: null,
      gainCents: null,
    });
  });
});

describe("what was drunk", () => {
  const opened = (openedAt: string) => ({
    vintageId: "v1",
    producer: "M",
    wineName: "P",
    type: "red" as const,
    year: 2015,
    openedAt,
  });
  it("counts the last twelve months, oldest first, and ignores older ones", () => {
    const s = buildStats(
      input({
        opened: [
          opened("2026-10-01T10:00:00Z"),
          opened("2026-10-11T10:00:00Z"),
          opened("2026-09-30T23:59:00Z"),
          opened("2025-11-02T10:00:00Z"),
          opened("2025-10-31T10:00:00Z"),
        ],
      }),
    );
    expect(s.openedByMonth[0]).toEqual({ month: "2025-11", count: 1 });
    expect(s.openedByMonth.at(-1)).toEqual({ month: "2026-10", count: 2 });
    expect(s.openedByMonth.find((m) => m.month === "2026-09")!.count).toBe(1);
    expect(s.openedCount).toBe(5); // all of them, not just this year
  });
});

describe("what people thought", () => {
  const bottles = [
    bottle({ vintageId: "v1" }),
    bottle({ vintageId: "v2", wineId: "w2", wineName: "White", type: "white" }),
  ];
  it("averages half-star scores per wine, best first, and per type", () => {
    const s = buildStats(
      input({
        bottles,
        scores: [
          { vintageId: "v1", score: 9 },
          { vintageId: "v1", score: 10 },
          { vintageId: "v2", score: 6 },
        ],
      }),
    );
    expect(s.topRated[0]).toMatchObject({ vintageId: "v1", stars: 4.8, ratings: 2 });
    expect(s.topRated[1]).toMatchObject({ vintageId: "v2", stars: 3, ratings: 1 });
    expect(s.ratingByType).toEqual([
      { type: "red", stars: 4.8, ratings: 1 },
      { type: "white", stars: 3, ratings: 1 },
    ]);
  });
  it("can name a wine that is already drunk, and leaves out one it knows nothing about", () => {
    const s = buildStats(
      input({
        opened: [
          {
            vintageId: "gone",
            producer: "Old",
            wineName: "Finished",
            type: "red",
            year: 2010,
            openedAt: "2026-01-01T00:00:00Z",
          },
        ],
        scores: [
          { vintageId: "gone", score: 8 },
          { vintageId: "nobody-knows", score: 10 },
        ],
      }),
    );
    expect(s.topRated.map((t) => t.vintageId)).toEqual(["gone"]);
  });
});

describe("decades", () => {
  it("names them", () => {
    expect([2024, 2019, 1998, 1955, null].map(decadeOf)).toEqual([
      "2020s",
      "2010s",
      "1990s",
      "older",
      "nv",
    ]);
  });
});
