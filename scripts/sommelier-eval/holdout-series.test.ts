import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seriesFromForm } from "./holdout-csv";
import { HUMAN_HOLDOUT_MIN_DISHES, sealOf, type HumanDish } from "./human-holdout";
import {
  checkSeries,
  humanSeries1,
  HUMAN_SERIES1_ENV,
  mergeSeries,
  PROVISIONAL_NOTE,
  SERIES,
  SERIES1_SET,
} from "./human-holdout-series";
import { HOLDOUT_HEADER } from "./review-forms";
import { csv } from "./review-sheet";
import { holdsBlind } from "./sets";

/**
 * THE HUMAN HOLDOUT IN TWO SERIES (P8). Series 1 (40) and series 2 (60) make the 100 the full set needs; the full
 * set's own escrow and its minimum of 100 are unchanged (benchmark.test.ts). Series 1 alone is its own blind set,
 * always reported as provisional. No real dish is used here: the dishes are made up for the tests.
 */
const dish = (id: string): HumanDish => ({
  id,
  en: `Test dish ${id}`,
  nl: `Testgerecht ${id}`,
  question_en: `Which wine with test dish ${id}?`,
  question_nl: `Welke wijn bij testgerecht ${id}?`,
  truth: { main: "poultry", weight: 3, fat: 1, acid: 1, sweet: 0, heat: 0, umami: 1 },
  good: ["chablis"],
  ok: [],
  why: "test",
  by: "test",
});
const series = (n: 1 | 2, count: number = SERIES[n].dishes) =>
  Array.from({ length: count }, (_, i) =>
    dish(`${SERIES[n].prefix}${String(i + 1).padStart(2, "0")}`),
  );

describe("the human holdout's two series", () => {
  it("are 40 and 60 dishes with their own ids, and together the minimum of 100", () => {
    expect(SERIES[1].dishes + SERIES[2].dishes).toBe(HUMAN_HOLDOUT_MIN_DISHES);
    expect(checkSeries(series(1), 1)).toHaveLength(40);
    expect(() => checkSeries(series(1, 39), 1)).toThrow(/series 1 has 40 dishes, this file 39/);
    expect(() => checkSeries(series(2), 1)).toThrow(/ids not of series 1/);
    expect(mergeSeries(series(1), series(2))).toHaveLength(100);
    expect(() => mergeSeries(series(1), series(1))).toThrow(/ids not of series 2/);
  });

  it("a filled series form becomes that series' file, and only that series'", () => {
    const row = (d: HumanDish) => [
      d.id,
      d.en,
      d.nl,
      d.question_en,
      d.question_nl,
      d.truth.main,
      ...[
        d.truth.weight,
        d.truth.fat,
        d.truth.acid,
        d.truth.sweet,
        d.truth.heat,
        d.truth.umami,
      ].map(String),
      d.good!.join(" "),
      "",
      "",
      d.why!,
      d.by,
    ];
    const form = (dishes: HumanDish[]) => csv([HOLDOUT_HEADER, ...dishes.map(row)]);
    expect(seriesFromForm(form(series(1)), 1)).toHaveLength(40);
    expect(() => seriesFromForm(form(series(1, 12)), 1)).toThrow(/40 dishes, this file 12/);
    expect(() => seriesFromForm(form(series(1)), 2)).toThrow(/ids not of series 2/);
  });

  it("series 1 alone is its own blind set, read only from its escrow and checked against its own seal", () => {
    expect(SERIES1_SET).toBe("human-series1");
    expect(holdsBlind(SERIES1_SET)).toBe(true);
    expect(humanSeries1({}, null)).toEqual({ dishes: [], scenarios: [] });
    const dir = mkdtempSync(join(tmpdir(), "cellr-series1-"));
    const path = join(dir, "series1.json");
    const text = JSON.stringify(series(1), null, 2);
    writeFileSync(path, text);
    expect(() => humanSeries1({ [HUMAN_SERIES1_ENV]: path }, null)).toThrow(/SEAL-series1\.json/);
    const set = humanSeries1({ [HUMAN_SERIES1_ENV]: path }, sealOf(text));
    expect(set.dishes).toHaveLength(40);
    expect(set.scenarios).toHaveLength(80);
    writeFileSync(path, JSON.stringify(series(1, 41).slice(1)));
    expect(() => humanSeries1({ [HUMAN_SERIES1_ENV]: path }, sealOf(text))).toThrow(
      /does not match its seal/,
    );
  });

  it("every report of series 1 alone is marked provisional, with the power caveat", () => {
    expect(PROVISIONAL_NOTE).toMatch(/^PROVISIONAL/);
    expect(PROVISIONAL_NOTE).toMatch(/cannot show non-inferiority at -5 points/);
  });
});
