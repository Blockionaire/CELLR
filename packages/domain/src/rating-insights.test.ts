import { describe, expect, it } from "vitest";
import { myRatingSummary, summarizeJournal } from "./journal";
import { ratingInsights } from "./rating-insights";
import { buildTasteProfile, NO_PREFERENCES, type TasteTasting } from "./taste";

let n = 0;
const tasting = (over: Partial<TasteTasting>): TasteTasting => {
  n += 1;
  return {
    wineId: `w${n}`,
    vintageId: `v${n}`,
    producer: `Producer ${n}`,
    wineName: `Wine ${n}`,
    year: 2019,
    type: "red",
    region: null,
    appellation: null,
    score: 8,
    grapes: [],
    structure: null,
    ...over,
  };
};
const entries = (list: Array<{ wineId: string; score: number | null; tastedAt: string }>) => list;

describe("ratings insights are honest", () => {
  it("one wine rated many times is one wine, not many", () => {
    const same = Array.from({ length: 5 }, () => ({ wineId: "w-same", score: 10 }));
    expect(myRatingSummary([...same, { wineId: "w2", score: 4 }])).toEqual({
      wines: 2,
      average: 3.5,
    });
    const profile = buildTasteProfile(
      Array.from({ length: 5 }, () =>
        tasting({ wineId: "w-same", region: "Bourgogne", score: 10 }),
      ),
      NO_PREFERENCES,
    );
    const r = ratingInsights(profile, []);
    expect(r.winesRated).toBe(1);
    expect(r.favouriteRegions).toEqual([]); // one great wine is not a favourite region
  });

  it("kinds of wine are only compared with enough rated wines in at least two kinds", () => {
    const reds = [8, 9, 10].map((score) => tasting({ type: "red", score }));
    const twoWhites = [6, 7].map((score) => tasting({ type: "white", score }));
    expect(
      ratingInsights(buildTasteProfile([...reds, ...twoWhites], NO_PREFERENCES), []).byType,
    ).toEqual([]);
    const third = tasting({ type: "white", score: 8 });
    const r = ratingInsights(buildTasteProfile([...reds, ...twoWhites, third], NO_PREFERENCES), []);
    expect(r.byType.map((t) => [t.type, t.wines, t.average])).toEqual([
      ["red", 3, 4.5],
      ["white", 3, 3.5],
    ]);
  });

  it("'drink most' and 'rate highest' are contrasted only when both are real and different", () => {
    const loire = [5, 6, 6, 5].map((score) => tasting({ region: "Loire", score }));
    const rhone = [9, 9, 10].map((score) => tasting({ region: "Rhône", score }));
    const r = ratingInsights(buildTasteProfile([...loire, ...rhone], NO_PREFERENCES), []);
    expect(r.oftenVsBest).toMatchObject({
      often: { key: "Loire", wines: 4 },
      best: { key: "Rhône", wines: 3 },
    });
    const onlyRhone = ratingInsights(buildTasteProfile(rhone, NO_PREFERENCES), []);
    expect(onlyRhone.oftenVsBest).toBeNull();
  });

  it("a discovery is a real favourite that is a small part of what I taste, and needs enough wines overall", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      tasting({ region: "Bordeaux", score: 6 + (i % 2) }),
    );
    const jura = [9, 10, 9].map((score) => tasting({ region: "Jura", score }));
    const r = ratingInsights(buildTasteProfile([...many, ...jura], NO_PREFERENCES), []);
    expect(r.discovery).toMatchObject({ kind: "region", favourite: { key: "Jura", wines: 3 } });
    expect(r.discovery!.share).toBeCloseTo(3 / 13);
    const few = ratingInsights(buildTasteProfile(jura, NO_PREFERENCES), []);
    expect(few.discovery).toBeNull();
  });

  it("over time: only years with enough different wines, and only when there are two of them", () => {
    const profile = buildTasteProfile([], NO_PREFERENCES);
    const y2025 = [8, 8, 9].map((score, i) => ({
      wineId: `a${i}`,
      score,
      tastedAt: `2025-03-0${i + 1}`,
    }));
    const y2026 = [6, 7, 8].map((score, i) => ({
      wineId: `b${i}`,
      score,
      tastedAt: `2026-03-0${i + 1}`,
    }));
    const repeats = [10, 10, 10].map(() => ({ wineId: "c", score: 10, tastedAt: "2024-01-01" }));
    const r = ratingInsights(profile, entries([...y2025, ...y2026, ...repeats]));
    expect(r.overTime).toEqual([
      { year: 2025, wines: 3, average: 4.2 },
      { year: 2026, wines: 3, average: 3.5 },
    ]);
    expect(ratingInsights(profile, entries(y2025)).overTime).toBeNull();
  });

  it("the distribution puts tenths of a star in their own band, never rounded up", () => {
    const d = summarizeJournal([
      { wineId: "a", score: 8.8 }, // 4.4 stars → 4.0–4.4
      { wineId: "b", score: 9 }, // 4.5 stars → 4.5–4.9
      { wineId: "c", score: 10 }, // 5 stars
      { wineId: "d", score: 8 },
    ]).distribution;
    expect(d[7]).toBe(2);
    expect(d[8]).toBe(1);
    expect(d[9]).toBe(1);
  });

  it("nothing rated: empty insights, no made-up numbers", () => {
    const r = ratingInsights(buildTasteProfile([], NO_PREFERENCES), []);
    expect(r).toMatchObject({
      winesRated: 0,
      average: null,
      byType: [],
      overTime: null,
      discovery: null,
    });
    expect(myRatingSummary([{ wineId: "a", score: null }])).toEqual({ wines: 0, average: null });
  });
});
