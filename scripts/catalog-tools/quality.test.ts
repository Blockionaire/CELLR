import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileQuality, scriptsOf } from "./quality";

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
