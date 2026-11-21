import { describe, expect, it } from "vitest";
import type { WineType } from "../cellar";
import type { WineStructure } from "../pairing-engine/wine";
import { bottlesFor, enoughFor } from "./quantity";
import { servingAdvice } from "./serving";

const wine = (type: WineType, s: Partial<WineStructure>, year: number | null = 2022) => ({
  type,
  year,
  tier: "appellation" as const,
  structure: {
    body: 3,
    tannin: 0,
    acidity: 3.5,
    sweetness: 0.5,
    intensity: 3,
    oak: 0,
    alcohol: 2,
    fizz: type === "sparkling",
    ...s,
  },
});
const advise = (...args: Parameters<typeof wine>) => servingAdvice(wine(...args), 2026);

describe("serving temperature", () => {
  it("light whites cold, full whites cool, not ice-cold", () => {
    expect(advise("white", { body: 1 }).tempC).toEqual({ min: 7, max: 9 });
    expect(advise("white", { body: 2, acidity: 5 }).tempC).toEqual({ min: 9, max: 11 });
    expect(advise("white", { body: 4, oak: 2 }).tempC).toEqual({ min: 11, max: 13 });
  });
  it("light reds cellar-cool, full reds below room temperature", () => {
    expect(advise("red", { body: 2, tannin: 1.5 }).tempC).toEqual({ min: 13, max: 15 });
    expect(advise("red", { body: 3, tannin: 3.5 }).tempC).toEqual({ min: 15, max: 17 });
    expect(advise("red", { body: 5, tannin: 4.5 }).tempC).toEqual({ min: 17, max: 18 });
    expect(advise("red", { body: 5, tannin: 4.5 }).tempC.max).toBeLessThanOrEqual(18);
  });
  it("champagne a little less cold than simple bubbles; sweet and fino cold; tawny cool", () => {
    expect(advise("sparkling", { body: 2.5 }).tempC).toEqual({ min: 8, max: 10 });
    expect(advise("sparkling", { body: 1, sweetness: 4 }).tempC).toEqual({ min: 6, max: 8 });
    expect(advise("dessert", { sweetness: 5 }).tempC).toEqual({ min: 8, max: 10 });
    expect(advise("fortified", { sweetness: 0 }).tempC).toEqual({ min: 7, max: 9 });
    expect(advise("fortified", { sweetness: 4, tannin: 1 }).tempC).toEqual({ min: 12, max: 14 });
    expect(advise("fortified", { sweetness: 4.5, tannin: 4 }).tempC).toEqual({ min: 16, max: 18 });
  });
  it("says how long in the fridge", () => {
    expect(advise("white", { body: 2 }).fridgeMinutes).toBe(80);
    expect(advise("red", { body: 5, tannin: 4.5 }).fridgeMinutes).toBe(0);
    expect(advise("red", { body: 2, tannin: 1.5 }).fridgeMinutes).toBeGreaterThan(0);
  });
});

describe("decanting", () => {
  it("airs a young, firm red", () => {
    expect(advise("red", { body: 4.5, tannin: 4.5 }, 2020).decant).toEqual({
      kind: "air",
      minutes: 90,
    });
    expect(advise("red", { body: 4.5, tannin: 4.5 }, 2012).decant).toEqual({
      kind: "air",
      minutes: 45,
    });
  });
  it("does not air an old bottle: it is poured off its sediment", () => {
    expect(advise("red", { body: 2.5, tannin: 2 }, 1999).decant).toEqual({
      kind: "sediment",
      minutes: 0,
    });
    expect(advise("red", { body: 5, tannin: 4.5 }, 2000).decant.kind).toBe("sediment");
  });
  it("leaves light reds, whites, bubbles and sweet wines alone", () => {
    expect(advise("red", { body: 2, tannin: 1.5 }).decant.kind).toBe("no");
    expect(advise("white", { body: 2 }).decant.kind).toBe("no");
    expect(advise("sparkling", {}).decant.kind).toBe("no");
    expect(advise("dessert", { sweetness: 5 }).decant.kind).toBe("no");
    expect(advise("fortified", { sweetness: 4, tannin: 1 }).decant.kind).toBe("no");
  });
  it("vintage port with age is decanted for its sediment", () => {
    expect(advise("fortified", { sweetness: 4.5, tannin: 4 }, 2003).decant.kind).toBe("sediment");
  });
});

describe("the wine's own profile", () => {
  it("wins over the rule, and the answer says so", () => {
    const a = servingAdvice(
      {
        ...wine("white", { body: 2 }),
        profile: { serving: { minC: 10, maxC: 12 }, decantMinutes: 0 },
      },
      2026,
    );
    expect(a.tempC).toEqual({ min: 10, max: 12 });
    expect(a.basis).toBe("profile");
    expect(advise("white", { body: 2 }).basis).toBe("style");
  });
  it("is ignored when it is not a sensible temperature", () => {
    const a = servingAdvice(
      {
        ...wine("white", { body: 2 }),
        profile: { serving: { minC: 40, maxC: 60 }, decantMinutes: null },
      },
      2026,
    );
    expect(a.tempC).toEqual({ min: 9, max: 11 });
    expect(a.basis).toBe("style");
  });
  it("never airs an old bottle because a profile said so", () => {
    const a = servingAdvice(
      {
        ...wine("red", { body: 2.5, tannin: 2 }, 1999),
        profile: { serving: null, decantMinutes: 60 },
      },
      2026,
    );
    expect(a.decant).toEqual({ kind: "sediment", minutes: 0 });
  });
});

describe("glasses", () => {
  it("picks by kind and weight", () => {
    expect(advise("sparkling", {}).glass).toBe("flute-or-tulip");
    expect(advise("red", { body: 5, tannin: 4.5 }).glass).toBe("large-red");
    expect(advise("red", { body: 2, tannin: 1.5 }).glass).toBe("red");
    expect(advise("white", { body: 4 }).glass).toBe("large-white");
    expect(advise("dessert", {}).glass).toBe("small");
  });
});

describe("bottles for guests", () => {
  it("half a bottle each at dinner", () => {
    expect(bottlesFor(8)).toEqual({ guests: 8, bottles: 4, perWine: [4] });
    expect(bottlesFor(2).bottles).toBe(1);
    expect(bottlesFor(5).bottles).toBe(3);
  });
  it("splits over the wines of a menu, each rounded up; a dessert wine needs less", () => {
    expect(bottlesFor(8, { wines: 2 }).perWine).toEqual([2, 2]);
    expect(bottlesFor(8, { wines: 3, smallPours: [2] }).perWine).toEqual([2, 2, 1]);
    expect(bottlesFor(6, { wines: 3 }).perWine).toEqual([1, 1, 1]);
  });
  it("a reception needs less, a long evening more", () => {
    expect(bottlesFor(20, { gathering: "reception" }).bottles).toBe(7);
    expect(bottlesFor(8, { gathering: "long-evening" }).bottles).toBe(6);
  });
  it("says whether what is there is enough", () => {
    expect(enoughFor(4, 4)).toEqual({ enough: true, short: 0 });
    expect(enoughFor(4, 1)).toEqual({ enough: false, short: 3 });
  });
});
