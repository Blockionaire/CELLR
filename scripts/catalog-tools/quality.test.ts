import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectProviderFile } from "@cellr/domain";
import { crossSourceMatches, fileQuality, scriptsOf } from "./quality";

const fixture = (f: string) =>
  readFileSync(new URL(`../../eval/catalog/${f}`, import.meta.url), "utf8");

describe("data-quality report", () => {
  it("names the writing systems beyond basic Latin", () => {
    expect(scriptsOf("Château")).toEqual(["latin-accented"]);
    expect(scriptsOf("Массандра")).toEqual(["cyrillic"]);
    expect(scriptsOf("Κτήμα")).toEqual(["greek"]);
    expect(scriptsOf("Plain")).toEqual([]);
  });
  it("profiles the X-Wines-layout fixture: rows, skips, types, vintages, non-vintage", () => {
    const q = fileQuality(fixture("fixture-xwines-layout.csv"), "fixture");
    expect(q.rows).toBe(q.records + Object.values(q.skipped).reduce((a, b) => a + b, 0));
    expect(q.duplicate_external_ids).toBe(0);
    expect(q.vintages.records_marked_nv).toBeGreaterThanOrEqual(1);
    expect(Object.keys(q.types).length).toBeGreaterThan(1);
  });
  it("finds a producer written two ways, identical identities and near-identical names", () => {
    const H =
      "WineID,WineName,Type,Elaborate,Grapes,Harmonize,ABV,Body,Acidity,Code,Country,RegionID,RegionName,WineryID,WineryName,Website,Vintages";
    const r = (id: number, winery: string, name: string, type = "Red") =>
      `${id},${name},${type},Varietal/100%,['Merlot'],[],13,Full,Medium,FR,France,1,Bordeaux,1,${winery},,"[2019]"`;
    const q = fileQuality(
      [
        H,
        r(1, "Château Fictif", "Grand Vin"),
        r(2, "Chateau Fictif", "Grand Vin"),
        r(3, "Château Fictif", "Grand Vin Rouge"),
        r(4, "Château Fictif", "Grand Vin", "White"),
      ].join("\n") + "\n",
      "fixture",
    );
    expect(q.producer_spelling_variants.groups).toBe(1);
    expect(q.identical_identities.groups).toBe(1);
    expect(q.same_name_other_colour).toBe(1);
  });
});

describe("how one source's records relate to another's (Sprint 004C: LWIN ↔ X-Wines)", () => {
  const lwin = inspectProviderFile(fixture("fixture-lwin-crossmatch.csv"), "lwin_fixture").records;
  const xw = inspectProviderFile(fixture("fixture-xwines-layout.csv"), "fixture").records;
  const out = crossSourceMatches(lwin, xw);

  it("by CELLR's identity rules: the same wine, a spelling, a slipped letter, and nothing to compare", () => {
    expect(out.counts).toEqual({ same: 3, variant: 1, uncertain: 1, different_cuvee: 0, none: 2 });
    expect(out.ambiguous).toBe(0);
    // accents and the estate statement "Grand Vin" are not a different wine; a letter off is for a person
    expect(out.examples.same.map((e) => e.left.split(":")[0])).toEqual([
      "9200001",
      "9200002",
      "9200003",
    ]);
    expect(out.examples.variant[0]!.right).toMatch(/^900004:/);
    expect(out.examples.uncertain[0]).toMatchObject({ left: expect.stringMatching(/Inventadas/) });
  });

  it("a white is never the red of the same name, and a producer of its own matches nothing", () => {
    const unmatched = lwin
      .filter(
        (r) =>
          !Object.values(out.examples)
            .flat()
            .some((e) => e.left.startsWith(r.external_id)),
      )
      .map((r) => r.external_id);
    expect(unmatched).toEqual(["9200006", "9200007"]);
  });

  it("two records of one wine in the other source are counted as ambiguous, never picked between", () => {
    const twice = crossSourceMatches(lwin.slice(0, 1), [xw[0]!, { ...xw[0]!, external_id: "dup" }]);
    expect(twice.ambiguous).toBe(1);
    expect(twice.counts.same).toBe(1);
  });
});
