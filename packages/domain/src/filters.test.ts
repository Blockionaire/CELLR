import { describe, expect, it } from "vitest";
import type { CellarItem } from "./cellar";
import {
  activeFilterCount,
  applyFilters,
  facetsOf,
  NO_FILTERS,
  sortItems,
  vintageBand,
  type CellarFilters,
} from "./filters";

let n = 0;
const item = (over: Partial<CellarItem>): CellarItem => ({
  vintageId: `v${++n}`,
  wineId: `w${n}`,
  producer: "Producer",
  wineName: "Wine",
  type: "red",
  year: 2019,
  region: null,
  countryCode: "FR",
  count: 1,
  places: [],
  unplaced: 0,
  favorite: false,
  ...over,
});

const cellar = [
  item({
    producer: "Château Margaux",
    wineName: "Pavillon Rouge",
    year: 2015,
    count: 2,
    places: ["Fridge"],
    favorite: true,
  }),
  item({
    producer: "Bollinger",
    wineName: "Special Cuvée",
    type: "sparkling",
    year: null,
    count: 6,
    places: ["Fridge", "Rack"],
  }),
  item({
    producer: "Domaine Test",
    wineName: "Chablis",
    type: "white",
    year: 2021,
    countryCode: "FR",
    places: ["Rack"],
  }),
  item({
    producer: "Marqués de Riscal",
    wineName: "Reserva",
    year: 2008,
    countryCode: "ES",
    count: 3,
  }),
  item({
    producer: "Antinori",
    wineName: "Tignanello",
    year: 2018,
    countryCode: "IT",
    places: ["Rack"],
    favorite: true,
  }),
];
const names = (items: CellarItem[]) => items.map((i) => i.wineName);

describe("vintage bands", () => {
  it("groups years the way people talk", () => {
    expect([2025, 2020, 2019, 2010, 2009, 2000, 1999, 1961, null].map(vintageBand)).toEqual([
      "2020s",
      "2020s",
      "2010s",
      "2010s",
      "2000s",
      "2000s",
      "older",
      "older",
      "nv",
    ]);
  });
});

describe("filters", () => {
  const only = (f: Partial<CellarFilters>) => applyFilters(cellar, { ...NO_FILTERS, ...f });

  it("no filters shows everything, in order", () => {
    expect(names(only({}))).toEqual(names(cellar));
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });
  it("any choice within a group matches", () => {
    expect(names(only({ types: ["white", "sparkling"] }))).toEqual(["Special Cuvée", "Chablis"]);
  });
  it("every group must match", () => {
    expect(names(only({ types: ["red"], countries: ["FR"] }))).toEqual(["Pavillon Rouge"]);
    expect(names(only({ types: ["red"], countries: ["FR"], favoritesOnly: true }))).toEqual([
      "Pavillon Rouge",
    ]);
    expect(only({ types: ["white"], favoritesOnly: true })).toEqual([]);
  });
  it("places match when any of the bottles sits there", () => {
    expect(names(only({ places: ["Rack"] }))).toEqual(["Special Cuvée", "Chablis", "Tignanello"]);
  });
  it("vintage bands include non-vintage as its own band", () => {
    expect(names(only({ bands: ["nv"] }))).toEqual(["Special Cuvée"]);
    expect(names(only({ bands: ["2020s", "older"] }))).toEqual(["Chablis"]);
    expect(names(only({ bands: ["2000s", "nv"] }))).toEqual(["Special Cuvée", "Reserva"]);
  });
  it("favourites only", () => {
    expect(names(only({ favoritesOnly: true }))).toEqual(["Pavillon Rouge", "Tignanello"]);
  });
  it("a wine without a country is never matched by a country filter", () => {
    const stray = item({ countryCode: null });
    expect(applyFilters([stray], { ...NO_FILTERS, countries: ["FR"] })).toEqual([]);
  });
  it("counts each narrowing choice once", () => {
    expect(
      activeFilterCount({
        types: ["red", "white"],
        countries: ["FR"],
        places: [],
        bands: ["nv"],
        favoritesOnly: true,
      }),
    ).toBe(5);
  });
});

describe("sorting", () => {
  it("recent keeps the incoming order", () => {
    expect(names(sortItems(cellar, "recent"))).toEqual(names(cellar));
  });
  it("by name, ignoring accents and case", () => {
    expect(names(sortItems(cellar, "name"))).toEqual([
      "Chablis",
      "Pavillon Rouge",
      "Reserva",
      "Special Cuvée",
      "Tignanello",
    ]);
  });
  it("by producer", () => {
    expect(sortItems(cellar, "producer").map((i) => i.producer)).toEqual([
      "Antinori",
      "Bollinger",
      "Château Margaux",
      "Domaine Test",
      "Marqués de Riscal",
    ]);
  });
  it("by vintage, newest or oldest first, non-vintage always last", () => {
    expect(names(sortItems(cellar, "vintageNew"))).toEqual([
      "Chablis",
      "Tignanello",
      "Pavillon Rouge",
      "Reserva",
      "Special Cuvée",
    ]);
    expect(names(sortItems(cellar, "vintageOld"))).toEqual([
      "Reserva",
      "Pavillon Rouge",
      "Tignanello",
      "Chablis",
      "Special Cuvée",
    ]);
  });
  it("by number of bottles, most first", () => {
    expect(names(sortItems(cellar, "count"))).toEqual([
      "Special Cuvée",
      "Reserva",
      "Pavillon Rouge",
      "Chablis",
      "Tignanello",
    ]);
  });
  it("is stable and does not touch the input", () => {
    const twin = [item({ wineName: "Same" }), item({ wineName: "Same" })];
    const ids = twin.map((i) => i.vintageId);
    expect(sortItems(twin, "name").map((i) => i.vintageId)).toEqual(ids);
    const before = [...cellar];
    sortItems(cellar, "count");
    expect(cellar).toEqual(before);
  });
});

describe("facets", () => {
  it("lists what is there, most common first, with counts", () => {
    const f = facetsOf(cellar);
    expect(f.types[0]).toEqual({ value: "red", count: 3 });
    expect(f.countries.find((c) => c.value === "FR")?.count).toBe(3);
    expect(f.places).toEqual([
      { value: "Rack", count: 3 },
      { value: "Fridge", count: 2 },
    ]);
  });
  it("keeps vintage bands in natural order", () => {
    expect(facetsOf(cellar).bands.map((b) => b.value)).toEqual(["2020s", "2010s", "2000s", "nv"]);
  });
});
