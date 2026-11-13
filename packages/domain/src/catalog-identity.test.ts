import { describe, expect, it } from "vitest";
import { groupSameIdentity, identityRelation, parseLwin } from "./catalog-identity";

// The hand-labelled pairs (eval/catalog/identity-pairs.json) are checked in scripts/catalog-tools/eval.test.ts:
// this package is pure and reads no files, not even in its tests.

describe("how two wine records relate", () => {
  it("says which words make it another bottling", () => {
    const c = identityRelation(
      { producer: "Château Margaux", name: "Château Margaux" },
      { producer: "Château Margaux", name: "Pavillon Rouge du Château Margaux" },
    );
    expect(c.relation).toBe("different_cuvee");
    expect(c.onlyInB).toEqual(["pavillon", "rouge"]);
    expect(c.discriminators).toEqual(["pavillon", "rouge"]);
  });

  it("an empty name or producer is never the same as anything, nor a spelling of it", () => {
    expect(identityRelation({ producer: "", name: "" }, { producer: "", name: "" }).relation).toBe(
      "different_producer",
    );
    expect(
      identityRelation(
        { producer: "Domaine Test", name: "" },
        { producer: "Domaine Test", name: "" },
      ).relation,
    ).toBe("uncertain");
    expect(
      identityRelation(
        { producer: "Domaine Test", name: "!!!" },
        { producer: "Domaine Test", name: "???" },
      ).relation,
    ).toBe("uncertain");
  });

  it("hostile input is answered quickly and never throws", () => {
    const long = "château ".repeat(40_000) + "x".repeat(200_000);
    const started = Date.now();
    for (const [x, y] of [
      [long, long + "y"],
      ["x".repeat(200_000), "y".repeat(200_000)],
      ["\u0000\uFFFF\uD800", "Cuvée"],
    ] as const) {
      const c = identityRelation({ producer: x, name: y }, { producer: y, name: x });
      expect(typeof c.relation).toBe("string");
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("grouping records that are the same identity", () => {
  it("only exact identities share a group; a reserve and a spelling variant stand alone", () => {
    const rows = [
      { id: 1, producer: "Bodegas Ejemplo", name: "Reserva", type: "red" as const },
      { id: 2, producer: "BODEGAS EJEMPLO", name: "reserva", type: "red" as const },
      { id: 3, producer: "Bodegas Ejemplo", name: "Gran Reserva", type: "red" as const },
      { id: 4, producer: "Ejemplo", name: "Reserva", type: "red" as const },
      { id: 5, producer: "Bodegas Ejemplo", name: "Reserva", type: "white" as const },
    ];
    expect(groupSameIdentity(rows).map((g) => g.map((r) => r.id))).toEqual([[1, 2], [3], [4], [5]]);
  });

  it("an unknown type or country never joins two known ones, in whatever order the records arrive", () => {
    const untyped = { id: "u", producer: "Bodegas Ejemplo", name: "Clásico" };
    const red = { ...untyped, id: "r", type: "red" as const };
    const white = { ...untyped, id: "w", type: "white" as const };
    const chile = { ...untyped, id: "cl", countryCode: "CL" };
    const usa = { ...untyped, id: "us", countryCode: "US" };
    const ids = (rows: Array<{ id: string }>[]) =>
      rows.map((g) => g.map((r) => r.id).sort()).sort();
    const orders = [
      [untyped, red, white, chile, usa],
      [white, red, untyped, usa, chile],
      [red, untyped, chile, white, usa],
    ];
    for (const order of orders)
      expect(ids(groupSameIdentity(order))).toEqual([["cl"], ["r"], ["u"], ["us"], ["w"]]);
  });

  it("names that differ only in a sign normalising drops are not grouped", () => {
    const rows = [
      { producer: "Weingut Beispiel", name: "Riesling Auslese *" },
      { producer: "Weingut Beispiel", name: "Riesling Auslese **" },
      { producer: "Weingut Beispiel", name: "Riesling Auslese *" },
    ];
    expect(groupSameIdentity(rows).map((g) => g.length)).toEqual([2, 1]);
  });
});

describe("LWIN codes", () => {
  it("LWIN-7 is the wine and nothing more", () => {
    expect(parseLwin("1014033")).toEqual({
      level: 7,
      lwin7: "1014033",
      vintage: null,
      vintagePlaceholder: false,
      packSize: null,
      bottleMl: null,
    });
  });
  it("LWIN-11 adds the vintage", () => {
    expect(parseLwin("10140332015")).toMatchObject({ level: 11, lwin7: "1014033", vintage: 2015 });
  });
  it("1000 in the vintage position is reported as a placeholder, never as a year and never as 'non-vintage'", () => {
    const c = parseLwin("10140331000");
    expect(c).toMatchObject({ level: 11, vintage: null, vintagePlaceholder: true });
    expect(c).not.toHaveProperty("nonVintage");
  });
  it("Liv-ex's own published examples parse as they describe them", () => {
    // liv-ex.com/contact-faqs: 2012; 2012, 750 ml; 2012, 12 bottles of 750 ml
    expect(parseLwin("12345672012")).toMatchObject({ lwin7: "1234567", vintage: 2012 });
    expect(parseLwin("1234567201200750")).toMatchObject({ vintage: 2012, bottleMl: 750 });
    expect(parseLwin("123456720121200750")).toMatchObject({
      vintage: 2012,
      packSize: 12,
      bottleMl: 750,
    });
  });
  it("LWIN-16 adds the bottle size; LWIN-18 the pack size too", () => {
    expect(parseLwin("1014033201500750")).toMatchObject({
      level: 16,
      vintage: 2015,
      bottleMl: 750,
      packSize: null,
    });
    expect(parseLwin("101403320150600750")).toMatchObject({
      level: 18,
      vintage: 2015,
      packSize: 6,
      bottleMl: 750,
    });
  });
  it("the levels are different abstraction levels of ONE wine, never different wines", () => {
    const codes = ["1014033", "10140332015", "1014033201500750", "101403320150600750"];
    expect(new Set(codes.map((c) => parseLwin(c)?.lwin7))).toEqual(new Set(["1014033"]));
  });
  it("anything else is not an LWIN: other lengths, letters, impossible years or sizes", () => {
    for (const bad of [
      "",
      "101403",
      "10140333",
      "1014033A",
      "0000000",
      "10140331799",
      "10140332101",
      "1014033201500000",
      "101403320150000750",
      "1014033 2015",
      "1014033-2015",
    ])
      expect(parseLwin(bad)).toBeNull();
  });
});
