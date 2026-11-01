import { describe, expect, it } from "vitest";
import {
  VintageInputSchema,
  WineDetailsSchema,
  auditChanges,
  parseAliases,
  parseGrapes,
  parseMasterFlags,
  parseMasterPage,
  parseMasterResult,
} from "./wine-master";

describe("master list parameters", () => {
  it("reads known flags only, and drops contradictory pairs", () => {
    expect(parseMasterFlags("art,pending,bogus")).toEqual(["art", "pending"]);
    expect(parseMasterFlags("art,no_art,linked")).toEqual(["linked"]);
    expect(parseMasterFlags(undefined)).toEqual([]);
  });
  it("keeps the old visuals filter links working", () => {
    expect(parseMasterFlags(undefined, "published")).toEqual(["art"]);
    expect(parseMasterFlags(undefined, "wanted")).toEqual(["no_art", "pending"]);
  });
  it("pages from 1", () => {
    expect(parseMasterPage("3")).toBe(3);
    expect(parseMasterPage("0")).toBe(1);
    expect(parseMasterPage("x")).toBe(1);
  });
  it("treats an unknown database answer as invalid", () => {
    expect(parseMasterResult("stale")).toBe("stale");
    expect(parseMasterResult(true)).toBe("invalid");
  });
});

describe("wine details", () => {
  const base = {
    name: " Grand Vin ",
    type: "red",
    country: "fr",
    region: "",
    appellation: "Pauillac",
    classification: "",
    bottleStyle: "",
    reason: "",
  };
  it("trims, upper-cases the country and turns empty fields into nothing", () => {
    const v = WineDetailsSchema.parse(base);
    expect(v).toMatchObject({
      name: "Grand Vin",
      country: "FR",
      region: null,
      appellation: "Pauillac",
      bottleStyle: null,
    });
  });
  it("refuses an empty name, an unknown type, a bad country or a bottle style that is not an object", () => {
    expect(WineDetailsSchema.safeParse({ ...base, name: " " }).success).toBe(false);
    expect(WineDetailsSchema.safeParse({ ...base, type: "blue" }).success).toBe(false);
    expect(WineDetailsSchema.safeParse({ ...base, country: "FRA" }).success).toBe(false);
    expect(WineDetailsSchema.safeParse({ ...base, bottleStyle: "[1]" }).success).toBe(false);
    expect(WineDetailsSchema.safeParse({ ...base, bottleStyle: "{nope" }).success).toBe(false);
    expect(
      WineDetailsSchema.parse({ ...base, bottleStyle: '{"shape":"burgundy"}' }).bottleStyle,
    ).toEqual({ shape: "burgundy" });
  });
});

describe("vintages", () => {
  it("reads a year or non-vintage, and an alcohol with a comma", () => {
    expect(VintageInputSchema.parse({ year: "NV", abv: "12,5", reason: "" })).toMatchObject({
      year: null,
      abv: 12.5,
    });
    expect(VintageInputSchema.parse({ year: "2016", abv: "", reason: "" })).toMatchObject({
      year: 2016,
      abv: null,
    });
  });
  it("refuses impossible years and alcohol", () => {
    expect(VintageInputSchema.safeParse({ year: "1700", abv: "", reason: "" }).success).toBe(false);
    expect(VintageInputSchema.safeParse({ year: "2016", abv: "40", reason: "" }).success).toBe(
      false,
    );
  });
});

describe("aliases and grapes", () => {
  it("aliases: one per line, without repeats", () => {
    expect(parseAliases("Le Grand\nle grand; GV \n\n")).toEqual(["Le Grand", "GV"]);
    expect(parseAliases("x".repeat(161))).toBeNull();
    expect(parseAliases(Array.from({ length: 21 }, (_, i) => `a${i}`).join("\n"))).toBeNull();
  });
  it("grapes: with or without shares, within 100%", () => {
    expect(parseGrapes("Cabernet Sauvignon 70%\nMerlot: 25; Petit Verdot")).toEqual([
      { grape: "Cabernet Sauvignon", pct: 70 },
      { grape: "Merlot", pct: 25 },
      { grape: "Petit Verdot", pct: null },
    ]);
    expect(parseGrapes("")).toEqual([]);
    expect(parseGrapes("Merlot 80\nCabernet Franc 40")).toBeNull();
    expect(parseGrapes("Merlot\nmerlot")).toBeNull();
  });
});

describe("audit lines", () => {
  it("lists only what changed", () => {
    expect(
      auditChanges({ region: "Bordeaux", name: "A" }, { region: "Pauillac", name: "A" }),
    ).toEqual(["region: Bordeaux → Pauillac"]);
    expect(auditChanges(null, { year: 2016 })).toEqual(["year: — → 2016"]);
    expect(auditChanges(["a"], ["a", "b"])).toEqual(['["a"] → ["a","b"]']);
  });
});
