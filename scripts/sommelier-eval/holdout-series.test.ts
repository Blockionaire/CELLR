import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { seriesFromForm } from "./holdout-csv";
import { HUMAN_HOLDOUT_MIN_DISHES, sealOf, type HumanDish } from "./human-holdout";
import {
  checkSeries,
  DEFINITIVE_NOTE,
  DEFINITIVE_SET,
  definitiveRefusal,
  EXPLORATORY_NOTE,
  EXPLORATORY_SET,
  HUMAN_DEFINITIVE_ENV,
  HUMAN_EXPLORATORY_ENV,
  humanPart,
  isDefinitive,
  mergeSeries,
  readScored,
  recordScoring,
  SERIES,
  type Series,
} from "./human-holdout-series";
import { HOLDOUT_HEADER } from "./review-forms";
import { csv } from "./review-sheet";
import { holdsBlind } from "./sets";

/**
 * THE HUMAN HOLDOUT IN TWO PARTS (owner decision 2026-11-25): 40 exploratory + 60 definitive. The definitive 60 are
 * blind, scored only with the build frozen and only once. The full set's escrow and its minimum of 100 are unchanged
 * (benchmark.test.ts). No real dish is used here: the dishes are made up for the tests.
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
const part = (s: Series, count: number = SERIES[s].dishes) =>
  Array.from({ length: count }, (_, i) =>
    dish(`${SERIES[s].prefix}${String(i + 1).padStart(2, "0")}`),
  );

describe("the human holdout's two parts", () => {
  it("are 40 exploratory and 60 definitive dishes with their own ids, together the minimum of 100", () => {
    expect(SERIES.exploratory.dishes + SERIES.definitive.dishes).toBe(HUMAN_HOLDOUT_MIN_DISHES);
    expect(checkSeries(part("exploratory"), "exploratory")).toHaveLength(40);
    expect(() => checkSeries(part("exploratory", 39), "exploratory")).toThrow(
      /exploratory part has 40 dishes, this file 39/,
    );
    expect(() => checkSeries(part("definitive"), "exploratory")).toThrow(
      /ids not of the exploratory/,
    );
    expect(mergeSeries(part("exploratory"), part("definitive"))).toHaveLength(100);
    expect(() => mergeSeries(part("exploratory"), part("exploratory"))).toThrow(
      /ids not of the definitive/,
    );
    expect(isDefinitive("hh-d-07-en")).toBe(true);
    expect(isDefinitive("hh-x-07-en")).toBe(false);
  });

  it("a filled form becomes that part's file, and only that part's", () => {
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
    expect(seriesFromForm(form(part("exploratory")), "exploratory")).toHaveLength(40);
    expect(seriesFromForm(form(part("definitive")), "definitive")).toHaveLength(60);
    expect(() => seriesFromForm(form(part("exploratory", 12)), "exploratory")).toThrow(
      /40 dishes, this file 12/,
    );
    expect(() => seriesFromForm(form(part("exploratory")), "definitive")).toThrow(
      /ids not of the definitive/,
    );
  });

  it("each part is its own blind set, read only from its escrow and checked against its own seal", () => {
    expect(holdsBlind(EXPLORATORY_SET)).toBe(true);
    expect(holdsBlind(DEFINITIVE_SET)).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "cellr-parts-"));
    for (const [s, env] of [
      ["exploratory", HUMAN_EXPLORATORY_ENV],
      ["definitive", HUMAN_DEFINITIVE_ENV],
    ] as const) {
      expect(humanPart(s, {}, null)).toEqual({ dishes: [], scenarios: [] });
      const path = join(dir, `${s}.json`);
      const text = JSON.stringify(part(s), null, 2);
      writeFileSync(path, text);
      expect(() => humanPart(s, { [env]: path }, null)).toThrow(new RegExp(`SEAL-${s}\\.json`));
      expect(humanPart(s, { [env]: path }, sealOf(text)).scenarios).toHaveLength(
        2 * SERIES[s].dishes,
      );
      writeFileSync(path, JSON.stringify(part(s, SERIES[s].dishes + 1).slice(1)));
      expect(() => humanPart(s, { [env]: path }, sealOf(text))).toThrow(/does not match its seal/);
    }
  });

  it("the definitive part is scored only with --definitive, the frozen build checked out, and only once", () => {
    const frozen = { commit: "abc1234def", frozenOn: "2026-12-01", by: "owner" };
    const ok = {
      definitive: true,
      frozenAt: "abc1234",
      head: "abc1234def5678",
      frozen,
      scored: [],
      sealSha256: "f".repeat(64),
      engine: "v1plus-ai:check",
    };
    expect(definitiveRefusal(ok)).toBeNull();
    expect(definitiveRefusal({ ...ok, definitive: false })).toMatch(/--definitive/);
    expect(definitiveRefusal({ ...ok, frozenAt: undefined })).toMatch(/--frozen-at/);
    expect(definitiveRefusal({ ...ok, frozen: null })).toMatch(/no recorded freeze/);
    expect(definitiveRefusal({ ...ok, frozenAt: "0000000" })).toMatch(/not the recorded freeze/);
    expect(definitiveRefusal({ ...ok, head: "9999999aaaa" })).toMatch(/not the frozen build/);
    // A commit after the freeze that only adds results (the freeze record, the runs' files) keeps the build frozen.
    expect(definitiveRefusal({ ...ok, head: "9999999aaaa", onlyResultsSince: true })).toBeNull();
    expect(definitiveRefusal({ ...ok, sealSha256: null })).toMatch(/not sealed/);
    const once = [
      { sealSha256: ok.sealSha256, engine: ok.engine, frozenAt: "abc1234", scoredOn: "x" },
    ];
    expect(definitiveRefusal({ ...ok, scored: once })).toMatch(/only once/);
    // Another engine (the other arm of the paired comparison) may score the same seal once too.
    expect(definitiveRefusal({ ...ok, scored: once, engine: "v1plus-ai:none" })).toBeNull();
  });

  it("records a scoring before the run, so a second one is refused even after a crash", () => {
    const path = pathToFileURL(join(mkdtempSync(join(tmpdir(), "cellr-scored-")), "scored.json"));
    expect(readScored(path)).toEqual([]);
    const entry = {
      sealSha256: "a".repeat(64),
      engine: "v1plus-ai:none",
      frozenAt: "abc1234",
      scoredOn: "2026-12-01",
    };
    recordScoring(entry, path);
    expect(readScored(path)).toEqual([entry]);
    expect(
      definitiveRefusal({
        definitive: true,
        frozenAt: "abc1234",
        head: "abc1234",
        frozen: { commit: "abc1234", frozenOn: "2026-12-01", by: "owner" },
        scored: readScored(path),
        sealSha256: entry.sealSha256,
        engine: entry.engine,
      }),
    ).toMatch(/only once/);
  });

  it("every report says which part it is: exploratory, or definitive and apart", () => {
    expect(EXPLORATORY_NOTE).toMatch(/^EXPLORATORY/);
    expect(EXPLORATORY_NOTE).toMatch(/only catch a large regression/);
    expect(EXPLORATORY_NOTE).not.toMatch(/equivalent|non-inferior/i);
    expect(DEFINITIVE_NOTE).toMatch(/^DEFINITIVE.*scored once.*apart/);
  });
});
