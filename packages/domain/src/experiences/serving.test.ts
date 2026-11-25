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

describe("what a serving advice may claim", () => {
  const firm = (year: number | null) => ({
    ...wine("red", { body: 4.5, tannin: 4.5 }, year),
    tier: "exact" as const,
  });
  it("calls it fact about the exact wine only when both the temperature and the decanting are", () => {
    const whole = servingAdvice(
      { ...firm(2018), profile: { serving: { minC: 16, maxC: 18 }, decantMinutes: 60 } },
      2026,
    );
    expect(whole.basis).toBe("profile");
    const onlyDecant = servingAdvice(
      { ...firm(2018), profile: { serving: null, decantMinutes: 30 } },
      2026,
    );
    expect(onlyDecant.decant).toEqual({ kind: "air", minutes: 30 });
    expect(onlyDecant.basis).toBe("style");
    const onlyTemp = servingAdvice(
      { ...firm(2018), profile: { serving: { minC: 16, maxC: 18 }, decantMinutes: null } },
      2026,
    );
    expect(onlyTemp.basis).toBe("style");
    const absurd = servingAdvice(
      { ...firm(2018), profile: { serving: { minC: 40, maxC: 60 }, decantMinutes: 0 } },
      2026,
    );
    expect(absurd.tempC.max).toBeLessThanOrEqual(18);
    expect(absurd.basis).toBe("style");
  });

  it("does not prescribe air for a firm red whose age is not known", () => {
    expect(servingAdvice({ ...firm(null), profile: null }, 2026).decant.kind).toBe("optional");
  });

  it("never airs bubbles or an old bottle because a profile said so", () => {
    const champagne = servingAdvice(
      {
        ...wine("sparkling", { body: 3, acidity: 4.5 }, 2015),
        tier: "exact" as const,
        profile: { serving: { minC: 8, maxC: 10 }, decantMinutes: 60 },
      },
      2026,
    );
    expect(champagne.decant).toEqual({ kind: "no", minutes: 0 });
    const oldWhite = servingAdvice(
      {
        ...wine("white", { body: 3.5, oak: 2 }, 1990),
        tier: "exact" as const,
        profile: { serving: { minC: 11, maxC: 13 }, decantMinutes: 120 },
      },
      2026,
    );
    expect(oldWhite.decant.kind).not.toBe("air");
  });
});

describe("red bands, as sommeliers serve them (second review)", () => {
  it("a full-bodied red is served full whatever its tannin: 17–18, not 15–17", () => {
    // Penfolds Grange as read from "South Australia": body 4.3, tannin 3.3.
    expect(advise("red", { body: 4.3, tannin: 3.3 }).tempC).toEqual({ min: 17, max: 18 });
    expect(advise("red", { body: 4, tannin: 2.5 }).tempC).toEqual({ min: 17, max: 18 });
  });
  it("a soft red a little more than light (a cru Beaujolais, a Bourgogne) is 14–16", () => {
    // Morgon as the knowledge reads it: body 3, tannin 2.2.
    expect(advise("red", { body: 3, tannin: 2.2 }).tempC).toEqual({ min: 14, max: 16 });
    expect(advise("red", { body: 2.6, tannin: 2.2 }).tempC).toEqual({ min: 14, max: 16 });
    expect(advise("red", { body: 3, tannin: 2.2 }).fridgeMinutes).toBe(40);
  });
  it("light stays 13–15 and medium 15–17", () => {
    expect(advise("red", { body: 2.4, tannin: 1.6 }).tempC).toEqual({ min: 13, max: 15 });
    expect(advise("red", { body: 3.5, tannin: 3.2 }).tempC).toEqual({ min: 15, max: 17 });
    expect(advise("red", { body: 3.3, tannin: 2.5 }).tempC).toEqual({ min: 15, max: 17 });
  });
  it("an old full red is still decanted off its sediment (the words leave air open)", () => {
    expect(advise("red", { body: 4.3, tannin: 3.3 }, 2008).decant.kind).toBe("sediment");
    expect(advise("red", { body: 4.2, tannin: 4.8 }, 2004).decant.kind).toBe("sediment");
  });
});
