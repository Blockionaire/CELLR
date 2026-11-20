import { describe, expect, it } from "vitest";
import type { WineType } from "../cellar";
import type { FoodMain, FoodProfile, FoodStructure, FoodTag } from "../food/types";
import { assessPairing, type AssessedWine } from "./assess";
import { decidePairing, TASTE_WEIGHT, type PairingCandidate } from "./decide";
import type { EvidenceTier, WineStructure } from "./wine";

/** A dish, stated directly: these tests are about the rules, not about reading text. */
function dish(
  main: FoodMain,
  s: Partial<FoodStructure>,
  tags: FoodTag[] = [],
  classics: string[] = [],
): FoodProfile {
  return {
    source: "dish",
    dishId: null,
    label: { en: "test", nl: "test" },
    said: null,
    main,
    structure: {
      weight: 2,
      intensity: 2,
      fat: 0,
      acid: 0,
      sweet: 0,
      salt: 0,
      bitter: 0,
      umami: 0,
      heat: 0,
      spice: 0,
      smoke: 0,
      ...s,
    },
    tags,
    classics,
    parts: { ingredients: [], techniques: [], sauces: [] },
    unknown: [],
    confidence: "high",
  };
}

function wine(type: WineType, s: Partial<WineStructure>, keys: string[] = []): AssessedWine {
  return {
    type,
    structure: {
      body: 3,
      tannin: type === "red" ? 3 : 0,
      acidity: 3.5,
      sweetness: 0.5,
      intensity: 3,
      oak: 0,
      alcohol: 2,
      fizz: type === "sparkling",
      ...s,
    },
    keys: [type, ...keys],
    colourOnly: false,
  };
}

// Wines a drinker recognises, stated as structures.
const muscadet = wine("white", { body: 1, acidity: 5, intensity: 2 }, ["muscadet", "crisp white"]);
const chablis = wine("white", { body: 2, acidity: 4.8, intensity: 2.5 }, [
  "chablis",
  "chardonnay",
  "crisp white",
]);
const meursault = wine("white", { body: 4, acidity: 3.5, oak: 2, intensity: 3.5 }, [
  "chardonnay",
  "rich white",
  "oaked white",
]);
const kabinett = wine(
  "white",
  { body: 1.5, acidity: 5, sweetness: 2.5, alcohol: 1, intensity: 3.5 },
  ["riesling", "off-dry white"],
);
const champagne = wine("sparkling", { body: 2.5, acidity: 4.8, sweetness: 0.8 }, [
  "champagne",
  "traditional method sparkling",
]);
const beaujolais = wine("red", { body: 2, tannin: 1.5, acidity: 4, intensity: 2.5 }, [
  "gamay",
  "light red",
]);
const pinot = wine("red", { body: 2.5, tannin: 2, acidity: 4, intensity: 3 }, [
  "pinot noir",
  "burgundy",
  "light red",
]);
const chianti = wine("red", { body: 3.5, tannin: 3.5, acidity: 4.3 }, [
  "sangiovese",
  "tuscany",
  "medium red",
]);
const pauillac = wine("red", { body: 4.5, tannin: 4.5, acidity: 3.5, oak: 2, intensity: 4 }, [
  "cabernet sauvignon",
  "bordeaux",
  "tannic red",
  "full red",
]);
const amarone = wine(
  "red",
  { body: 5, tannin: 3.5, acidity: 3, sweetness: 1.2, alcohol: 3, intensity: 5 },
  ["full red"],
);
const sauternes = wine("dessert", { body: 4.5, acidity: 4, sweetness: 5, intensity: 4.5 }, [
  "sauternes",
  "sweet white",
]);
const moscato = wine(
  "sparkling",
  { body: 1, acidity: 3.5, sweetness: 4, alcohol: 1, intensity: 3.5 },
  ["moscato", "sweet white"],
);
const vintagePort = wine(
  "fortified",
  { body: 5, tannin: 4, acidity: 3, sweetness: 4.5, alcohol: 4, intensity: 5 },
  ["port", "sweet fortified"],
);
const fino = wine(
  "fortified",
  { body: 2, tannin: 0, acidity: 3.5, sweetness: 0, alcohol: 4, intensity: 3 },
  ["dry sherry"],
);

const oysters = dish(
  "shellfish",
  { weight: 1, intensity: 2, salt: 2 },
  ["raw-seafood", "iodine"],
  ["muscadet", "chablis", "champagne"],
);
const seaBass = dish("white-fish", { weight: 2.5, intensity: 2, fat: 2, acid: 2 }, [
  "butter",
  "citrus",
]);
const ribeye = dish("red-meat", { weight: 4.5, intensity: 4, fat: 3, umami: 2, smoke: 1 }, [
  "charred",
]);
const greenCurry = dish(
  "poultry",
  { weight: 3, intensity: 4, fat: 2, heat: 2.5, spice: 3, sweet: 1 },
  ["coconut", "green-herb"],
);
const fondant = dish("dessert", { weight: 4, intensity: 5, fat: 2, sweet: 3, bitter: 2 }, [
  "chocolate",
]);
const lemonTart = dish("dessert", { weight: 2, intensity: 3, fat: 1, sweet: 2.5, acid: 2 }, [
  "fruit-dessert",
  "citrus",
]);
const stilton = dish("cheese", { weight: 4, intensity: 5, fat: 3, salt: 3, umami: 2 }, [
  "blue-cheese",
]);
const margherita = dish("pasta-grain", { weight: 3, intensity: 3, fat: 2, acid: 2, umami: 2 }, [
  "tomato",
]);
const friedFish = dish("white-fish", { weight: 3, intensity: 2, fat: 2.5, salt: 2 }, ["fried"]);
const asparagus = dish("vegetable", { weight: 2, intensity: 2, bitter: 1 }, ["asparagus"]);
const coqAuVin = dish(
  "poultry",
  { weight: 4, intensity: 4, fat: 2, umami: 2 },
  ["braised", "red-wine-sauce", "earthy"],
  ["burgundy"],
);

const level = (food: FoodProfile, w: AssessedWine) => assessPairing(food, w).level;

describe("hard clashes", () => {
  it("keeps tannin away from raw and briny seafood", () => {
    const a = assessPairing(oysters, pauillac);
    expect(a.level).toBe("poor");
    expect(a.clash).toBe("tannin-with-fish");
    expect(level(oysters, chianti)).toBe("poor");
  });
  it("keeps a firm red away from fish: delicate fish sooner than oily fish", () => {
    expect(assessPairing(seaBass, pauillac).clash).toBe("tannin-with-fish");
    const mackerel = dish("oily-fish", { weight: 3, fat: 2 }, ["fish-oil"]);
    expect(assessPairing(mackerel, wine("red", { tannin: 3.6 })).clash).toBe("tannin-with-fish");
    // Delicate white fish gives way sooner than meaty, oily fish.
    const sole = dish("white-fish", { weight: 2, fat: 1 });
    expect(assessPairing(sole, wine("red", { tannin: 3.1 })).clash).toBe("tannin-with-fish");
    expect(assessPairing(mackerel, pinot).clash).toBeNull();
  });
  it("keeps tannin away from chili heat", () => {
    expect(assessPairing(greenCurry, pauillac).clash).toBe("tannin-with-heat");
  });
  it("never pours a dry wine with a sweet dessert", () => {
    expect(assessPairing(fondant, pauillac).clash).not.toBeNull();
    expect(assessPairing(lemonTart, chablis).clash).toBe("dry-with-dessert");
    expect(level(lemonTart, champagne)).toBe("poor");
  });
  it("never pours a sweet wine with an ordinary savoury dish", () => {
    expect(assessPairing(ribeye, vintagePort).clash).toBe("sweet-with-savoury");
    expect(assessPairing(seaBass, sauternes).clash).toBe("sweet-with-savoury");
  });
  it("a clash is poor whatever else is right", () => {
    // Classic key present, weight right: still poor.
    const a = assessPairing(dish("dessert", { weight: 4, sweet: 3 }, [], ["bordeaux"]), pauillac);
    expect(a.level).toBe("poor");
  });
});

describe("what lifts a wine", () => {
  it("oysters: the lean, briny whites and champagne", () => {
    expect(level(oysters, muscadet)).toBe("good");
    expect(level(oysters, chablis)).toBe("good");
    expect(level(oysters, champagne)).toBe("good");
    expect(level(oysters, meursault)).not.toBe("good");
  });
  it("sea bass with lemon butter: fresh whites with some substance; not the heavy or the sweet", () => {
    expect(level(seaBass, chablis)).toBe("good");
    expect(level(seaBass, kabinett)).not.toBe("good");
    expect(level(seaBass, amarone)).toBe("poor");
  });
  it("grilled ribeye: firm, full reds; whites are underpowered", () => {
    const a = assessPairing(ribeye, pauillac);
    expect(a.level).toBe("good");
    expect(a.pros).toContain("tannin-meets-meat");
    expect(level(ribeye, muscadet)).toBe("poor");
    expect(level(ribeye, beaujolais)).not.toBe("good");
  });
  it("green curry: off-dry and aromatic; alcohol and oak count against", () => {
    const a = assessPairing(greenCurry, kabinett);
    expect(a.level).toBe("good");
    expect(a.pros).toContain("sweetness-tames-heat");
    expect(assessPairing(greenCurry, amarone).cons).toContain("alcohol-fans-heat");
    expect(level(greenCurry, amarone)).toBe("poor");
  });
  it("chocolate fondant: sweet and strong enough; a light sweet wine is not", () => {
    expect(level(fondant, vintagePort)).toBe("good");
    expect(level(fondant, moscato)).not.toBe("good");
  });
  it("lemon tart: sweet with acidity; port is too much", () => {
    expect(level(lemonTart, sauternes)).toBe("good");
    expect(level(lemonTart, moscato)).toBe("good");
    expect(level(lemonTart, vintagePort)).not.toBe("good");
  });
  it("blue cheese: sweetness with salt; port's tannin is carried by its sugar", () => {
    const a = assessPairing(stilton, sauternes);
    expect(a.level).toBe("good");
    expect(a.pros).toContain("sweet-with-salt");
    expect(level(stilton, vintagePort)).toBe("good");
    expect(level(stilton, pauillac)).not.toBe("good");
  });
  it("tomato wants acidity, and Sangiovese is its old partner", () => {
    expect(level(margherita, chianti)).toBe("good");
    expect(assessPairing(margherita, amarone).cons).toContain("needs-more-acidity");
  });
  it("fried food: bubbles and acidity", () => {
    const a = assessPairing(friedFish, champagne);
    expect(a.level).toBe("good");
    expect(a.pros).toEqual(expect.arrayContaining(["bubbles-refresh", "acidity-cuts-richness"]));
  });
  it("asparagus: no oak, no tannin", () => {
    expect(assessPairing(asparagus, meursault).cons).toContain("oak-overwhelms");
    expect(level(asparagus, chianti)).toBe("poor");
    expect(level(asparagus, chablis)).not.toBe("poor");
  });
  it("a red-wine sauce brings poultry to red", () => {
    expect(level(coqAuVin, pinot)).toBe("good");
    expect(assessPairing(coqAuVin, chablis).cons).toContain("white-for-red-wine-sauce");
  });
  it("dry sherry with salty snacks", () => {
    const olives = dish(
      "snack",
      { weight: 2, intensity: 3, salt: 3, fat: 1 },
      ["cured"],
      ["dry sherry"],
    );
    expect(level(olives, fino)).toBe("good");
  });
});

describe("what it takes to be offered", () => {
  it("a wine with nothing for it and nothing against it is not a recommendation", () => {
    const plain = wine("white", { body: 2.5, acidity: 3.4, intensity: 2.5 });
    const a = assessPairing(dish("poultry", { weight: 3, intensity: 2.5 }), plain);
    expect(a.cons).toEqual([]);
    expect(a.clash).toBeNull();
    // Not poor, which would be a lie about the wine; neutral, which is never offered.
    expect(a.level).toBe("neutral");
  });
  it("a dish that only names a colour gives that colour a little, never what a named classic gives", () => {
    const burger = (classics: string[]) => dish("red-meat", { weight: 3.5, fat: 2 }, [], classics);
    const red = wine("red", { body: 3.5, tannin: 3 }, ["malbec"]);
    const byColour = assessPairing(burger(["red"]), red);
    const byName = assessPairing(burger(["malbec"]), red);
    expect(byColour.pros).not.toContain("classic");
    expect(byName.pros).toContain("classic");
    expect(byName.score).toBeGreaterThan(byColour.score);
  });
  it("a glazed main course is still a main course", () => {
    const teriyaki = dish("oily-fish", { weight: 3, fat: 2.5, sweet: 2, salt: 2, umami: 2 }, [
      "sweet-glaze",
      "soy",
    ]);
    expect(assessPairing(teriyaki, pinot).clash).toBeNull();
    expect(assessPairing(teriyaki, sauternes).level).toBe("poor");
  });
  it("a hard, salty cheese is not blue cheese: sweet white is too much, a mellow fortified wine will do", () => {
    const gouda = dish("cheese", { weight: 3.5, intensity: 4, fat: 2.5, salt: 2, umami: 2.5 });
    expect(assessPairing(gouda, sauternes).cons).toContain("too-sweet");
    const tawny = wine(
      "fortified",
      { body: 4, tannin: 1, sweetness: 4, alcohol: 4, intensity: 4.5 },
      ["tawny port"],
    );
    expect(assessPairing(gouda, tawny).cons).not.toContain("too-sweet");
  });
});

describe("what a wine known only by its colour may claim", () => {
  it("is never more than acceptable", () => {
    const anyRed: AssessedWine = { ...pauillac, keys: ["red"], colourOnly: true };
    const a = assessPairing(ribeye, anyRed);
    expect(a.level).toBe("acceptable");
    expect(a.cons).toContain("little-known");
  });
  it("is still poor when it clashes", () => {
    expect(level(oysters, { ...pauillac, keys: ["red"], colourOnly: true })).toBe("poor");
  });
});

describe("the decision", () => {
  const candidate = (
    name: string,
    w: AssessedWine,
    taste = 0,
    tier: EvidenceTier = "appellation",
  ): PairingCandidate<string> => ({ item: name, wine: w, tier, taste });

  it("says good when a good wine is there, and never offers a poor one", () => {
    const d = decidePairing(oysters, [
      candidate("pauillac", pauillac),
      candidate("chablis", chablis),
      candidate("meursault", meursault),
    ]);
    expect(d.outcome).toBe("good");
    expect(d.picks[0]!.item).toBe("chablis");
    expect(d.picks.map((p) => p.item)).not.toContain("pauillac");
  });
  it("says acceptable when the best is a compromise", () => {
    const d = decidePairing(ribeye, [
      candidate("chianti", chianti),
      candidate("muscadet", muscadet),
    ]);
    expect(d.outcome).toBe("acceptable");
    expect(d.picks.map((p) => p.item)).toEqual(["chianti"]);
  });
  it("names the closest wine when nothing suits, and none when everything clashes", () => {
    const plain = wine("white", { body: 1, acidity: 3, intensity: 2 });
    const nothing = decidePairing(oysters, [
      candidate("plain", plain),
      candidate("pauillac", pauillac),
    ]);
    expect(nothing.outcome).toBe("none");
    expect(nothing.picks).toEqual([]);
    expect(nothing.closest?.item).toBe("plain");
    const clashes = decidePairing(oysters, [
      candidate("pauillac", pauillac),
      candidate("port", vintagePort),
    ]);
    expect(clashes.closest).toBeNull();
    expect(decidePairing(oysters, [candidate("chablis", chablis)]).closest).toBeNull();
  });
  it("says none when nothing suits, and for an empty cellar", () => {
    expect(
      decidePairing(oysters, [candidate("pauillac", pauillac), candidate("port", vintagePort)])
        .outcome,
    ).toBe("none");
    const empty = decidePairing(oysters, []);
    expect(empty.outcome).toBe("none");
    expect(empty.picks).toEqual([]);
  });
  it("taste orders wines of one level and never crosses a level", () => {
    const loved = decidePairing(oysters, [
      candidate("pauillac", pauillac, 1),
      candidate("meursault", meursault, 1),
      candidate("chablis", chablis, -1),
    ]);
    // The disliked good wine still comes before the loved acceptable one; the loved poor one is not offered.
    expect(loved.outcome).toBe("good");
    expect(loved.picks[0]!.item).toBe("chablis");
    expect(loved.picks.map((p) => p.item)).not.toContain("pauillac");

    const two = decidePairing(oysters, [
      candidate("muscadet", muscadet, -1),
      candidate("chablis", chablis, 1),
    ]);
    const gap = Math.abs(two.all[0]!.assessment.score - two.all[1]!.assessment.score);
    if (gap < 2 * TASTE_WEIGHT) expect(two.picks[0]!.item).toBe("chablis");
  });
  it("taste never changes the outcome (every dish, every taste)", () => {
    const wines = [
      muscadet,
      chablis,
      meursault,
      kabinett,
      champagne,
      beaujolais,
      pinot,
      chianti,
      pauillac,
      amarone,
      sauternes,
      moscato,
      vintagePort,
      fino,
    ];
    const dishes = [
      oysters,
      seaBass,
      ribeye,
      greenCurry,
      fondant,
      lemonTart,
      stilton,
      margherita,
      friedFish,
      asparagus,
      coqAuVin,
    ];
    for (const food of dishes) {
      const plain = decidePairing(
        food,
        wines.map((w, n) => candidate(String(n), w)),
      );
      for (const sign of [-1, 1]) {
        const tasted = decidePairing(
          food,
          wines.map((w, n) => candidate(String(n), w, n % 2 ? sign : -sign)),
        );
        expect(tasted.outcome).toBe(plain.outcome);
        const levelOf = (d: typeof plain) =>
          new Map(d.all.map((p) => [p.item, p.assessment.level]));
        expect(levelOf(tasted)).toEqual(levelOf(plain));
        expect(tasted.picks.every((p) => p.assessment.level !== "poor")).toBe(true);
      }
    }
  });
  it("is only as sure as the dish and the evidence for the wine", () => {
    expect(decidePairing(oysters, [candidate("chablis", chablis, 0, "exact")]).confidence).toBe(
      "high",
    );
    expect(
      decidePairing(oysters, [candidate("chablis", chablis, 0, "appellation")]).confidence,
    ).toBe("medium");
    expect(decidePairing(oysters, [candidate("chablis", chablis, 0, "unknown")]).confidence).toBe(
      "low",
    );
    const vague = { ...oysters, confidence: "low" as const };
    expect(decidePairing(vague, [candidate("chablis", chablis, 0, "exact")]).confidence).toBe(
      "low",
    );
    // "Nothing suits" is as sure as the least-known wine turned down.
    expect(
      decidePairing(oysters, [
        candidate("a", pauillac, 0, "exact"),
        candidate("b", vintagePort, 0, "unknown"),
      ]).confidence,
    ).toBe("low");
  });
});

describe("a kind of wine among a dish's classics (S9 review)", () => {
  // Fish and chips is known for "a sparkling wine". That means a dry one.
  const fishAndChips = dish(
    "white-fish",
    { weight: 3, intensity: 2.5, fat: 3, salt: 2 },
    ["fried"],
    ["sparkling", "crisp white"],
  );
  const asti = wine("sparkling", { body: 2, acidity: 3.5, sweetness: 4.5 }, ["asti", "moscato"]);

  it("a sweet sparkling wine is still a sweet wine with a savoury dish", () => {
    const a = assessPairing(fishAndChips, asti);
    expect(a.clash).toBe("sweet-with-savoury");
    expect(a.level).toBe("poor");
  });
  it("the dry sparkling wine the dish is known for is not held back by it", () => {
    expect(assessPairing(fishAndChips, champagne).clash).toBeNull();
    expect(level(fishAndChips, champagne)).not.toBe("poor");
  });
  it("a dish that names the sweet wine itself keeps it (foie gras and Sauternes)", () => {
    const foieGras = dish("poultry", { weight: 4, intensity: 3.5, fat: 3 }, [], ["sauternes"]);
    expect(assessPairing(foieGras, sauternes).clash).toBeNull();
  });
});
