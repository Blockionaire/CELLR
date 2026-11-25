import { describe, expect, it } from "vitest";
import { aggregateUnit, parseRatingRow, unitPayload, type UnitRating } from "./catalog-ratings";

const row = (s: string) => parseRatingRow(s.split(","));

describe("parseRatingRow", () => {
  it("reads a line of the real file", () => {
    expect(row("1,1604441,136103,1950,4.0,2019-10-14 11:20:52")).toEqual({
      ok: true,
      row: {
        ratingId: 1,
        raterId: "1604441",
        wineId: "136103",
        vintage: 1950,
        half: 8,
        ratedAt: "2019-10-14 11:20:52",
      },
    });
  });
  it("reads N.V. as non-vintage (null), never as a year", () => {
    const r = row("2,5,7,N.V.,3.5,2016-08-08 00:50:22");
    expect(r.ok && r.row.vintage).toBeNull();
    expect(r.ok && r.row.half).toBe(7);
  });
  it.each([
    ["an unknown vintage", "3,5,7,Unknown,3.5,2016-08-08 00:50:22", "vintage"],
    ["an empty vintage", "3,5,7,,3.5,2016-08-08 00:50:22", "vintage"],
    ["a two-digit vintage", "3,5,7,19,3.5,2016-08-08 00:50:22", "vintage"],
    ["a vintage out of range", "3,5,7,1700,3.5,2016-08-08 00:50:22", "vintage"],
    ["NV written otherwise", "3,5,7,NV,3.5,2016-08-08 00:50:22", "vintage"],
    ["a rating of 0", "3,5,7,2015,0,2016-08-08 00:50:22", "rating"],
    ["a rating above 5", "3,5,7,2015,5.5,2016-08-08 00:50:22", "rating"],
    ["a rating that is not a half step", "3,5,7,2015,4.2,2016-08-08 00:50:22", "rating"],
    ["a negative rating", "3,5,7,2015,-1,2016-08-08 00:50:22", "rating"],
    ["an impossible date", "3,5,7,2015,4.0,2016-02-30 00:50:22", "date"],
    ["a date without time", "3,5,7,2015,4.0,2016-02-03", "date"],
    ["a quoted field", '3,5,7,2015,"4.0",2016-02-03 00:00:00', "rating"],
    ["a rater id that is not a number", "3,abc,7,2015,4.0,2016-02-03 00:00:00", "rater_id"],
    ["a wine id that is not a number", "3,5,7x,2015,4.0,2016-02-03 00:00:00", "wine_id"],
    ["a missing column", "3,5,7,2015,4.0", "columns"],
    ["an extra column", "3,5,7,2015,4.0,2016-02-03 00:00:00,x", "columns"],
  ])("refuses %s", (_, line, problem) => {
    expect(row(line)).toEqual({ ok: false, problem });
  });
  it("accepts every half step from 0.5 to 5.0", () => {
    for (let h = 1; h <= 10; h++) {
      const r = row(`1,1,1,2015,${(h / 2).toFixed(1)},2016-01-01 00:00:00`);
      expect(r.ok && r.row.half).toBe(h);
    }
  });
});

const r = (rater: string, half: number, ratedAt: string, ratingId: number): UnitRating => ({
  rater,
  half,
  ratedAt,
  ratingId,
});

describe("aggregateUnit", () => {
  it("one rating", () => {
    expect(aggregateUnit([r("a", 8, "2020-01-02 10:00:00", 1)])).toEqual({
      count: 1,
      sumHalf: 8,
      distribution: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
      first: "2020-01-02",
      last: "2020-01-02",
      repeated: 0,
    });
  });
  it("keeps one rating per rater: the latest by date", () => {
    const a = aggregateUnit([
      r("a", 2, "2021-05-01 00:00:00", 9),
      r("a", 10, "2019-01-01 00:00:00", 3),
      r("b", 6, "2020-01-01 00:00:00", 4),
    ]);
    expect(a.count).toBe(2);
    expect(a.sumHalf).toBe(8);
    expect(a.repeated).toBe(1);
    expect(a.distribution[1]).toBe(1);
    expect(a.distribution[9]).toBe(0);
    expect(a.first).toBe("2020-01-01");
    expect(a.last).toBe("2021-05-01");
  });
  it("breaks a tie on the same second by the file's rating id", () => {
    const a = aggregateUnit([
      r("a", 4, "2021-05-01 00:00:00", 11),
      r("a", 6, "2021-05-01 00:00:00", 10),
    ]);
    expect(a.sumHalf).toBe(4);
  });
  it("the same rater rating the same unit many times counts once (manipulation)", () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      r("a", 10, `2020-01-01 00:00:${String(i % 60).padStart(2, "0")}`, i),
    );
    const a = aggregateUnit([...many, r("b", 2, "2020-02-01 00:00:00", 5000)]);
    expect(a.count).toBe(2);
    expect(a.repeated).toBe(999);
  });
  it("thousands of raters: exact sum and distribution", () => {
    const list = Array.from({ length: 5000 }, (_, i) =>
      r(`u${i}`, (i % 10) + 1, "2020-01-01 00:00:00", i),
    );
    const a = aggregateUnit(list);
    expect(a.count).toBe(5000);
    expect(a.distribution).toEqual(Array(10).fill(500));
    expect(a.sumHalf).toBe(500 * 55);
  });
  it("refuses an empty unit", () => {
    expect(() => aggregateUnit([])).toThrow();
  });
  it("the payload holds counts, sum, distribution and dates only (no rater)", () => {
    const p = unitPayload(
      "111",
      null,
      aggregateUnit([r("secret-rater", 7, "2020-01-01 00:00:00", 1)]),
    );
    expect(JSON.stringify(p)).not.toContain("secret-rater");
    expect(p).toEqual({
      external_id: "111",
      vintage: null,
      count: 1,
      sum_half: 7,
      distribution: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      first: "2020-01-01",
      last: "2020-01-01",
    });
    expect(unitPayload("1", 2019, aggregateUnit([r("a", 7, "2020-03-17 10:00:00", 1)])).first).toBe(
      "2020-03-01",
    );
  });
});
