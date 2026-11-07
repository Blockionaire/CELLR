import { describe, expect, it } from "vitest";
import type { CellarItem } from "./cellar";
import {
  catalogIdentityOf,
  checkPurchase,
  PurchaseCheckRequestSchema,
  purchaseWineFrom,
  PurchaseWineSchema,
  similarity,
  type PurchaseCheckInput,
  type PurchaseWine,
  type PurchaseWineTraits,
} from "./purchase-check";
import { NO_PREFERENCES, type TasteTasting } from "./taste";

let n = 0;
const item = (over: Partial<CellarItem> = {}): CellarItem => {
  n += 1;
  return {
    vintageId: `v${n}`,
    wineId: `w${n}`,
    producer: `Producer ${n}`,
    wineName: `Wine ${n}`,
    type: "red",
    year: 2015,
    region: null,
    countryCode: "FR",
    count: 2,
    places: ["Fridge"],
    unplaced: 0,
    image: null,
    favorite: false,
    rating: null,
    drink: {
      source: "estimate",
      reliable: false,
      uncertain: false,
      phase: "peak",
      from: 2014,
      until: 2030,
      urgency: 5,
      yearsUntilOpen: null,
      yearsLeft: 4,
      position: 0.5,
    },
    ...over,
  };
};

const wine = (over: Partial<PurchaseWine> = {}): PurchaseWine =>
  PurchaseWineSchema.parse({
    producer: "Château Example",
    name: "Grand Vin",
    year: 2019,
    type: "red",
    countryCode: "FR",
    region: "Bordeaux",
    ...over,
  });

let t = 0;
const tasting = (over: Partial<TasteTasting> = {}): TasteTasting => {
  t += 1;
  return {
    wineId: `tw${t}`,
    vintageId: `tv${t}`,
    producer: `Taster ${t}`,
    wineName: `Tasted ${t}`,
    year: 2016,
    type: "red",
    region: null,
    appellation: null,
    score: 8,
    grapes: [],
    structure: null,
    ...over,
  };
};

const traitsOf = (entries: Array<[string, Partial<PurchaseWineTraits>]>) =>
  new Map(
    entries.map(([id, tr]) => [
      id,
      { appellation: null, grapes: [], aliases: [], catalogIds: [], ...tr },
    ]),
  );

const input = (over: Partial<PurchaseCheckInput> = {}): PurchaseCheckInput => ({
  wine: wine(),
  priceCents: null,
  catalogWineId: null,
  items: [],
  traits: new Map(),
  tastings: [],
  preferences: NO_PREFERENCES,
  ...over,
});

describe("the confirmed wine", () => {
  it("cleans typed text and treats empty fields as unknown", () => {
    const w = PurchaseWineSchema.parse({
      producer: "  Château\u0007  Example ",
      name: "",
      region: "   ",
      grapes: ["Merlot", "Merlot", " "],
    });
    expect(w).toMatchObject({ producer: "Château Example", name: null, region: null });
    expect(w.grapes).toEqual(["Merlot"]);
    expect(w.year).toBeNull();
  });

  it("needs a producer, a plausible year and a known country", () => {
    expect(PurchaseWineSchema.safeParse({ producer: " " }).success).toBe(false);
    expect(PurchaseWineSchema.safeParse({ producer: "X", year: 2190 }).success).toBe(false);
    expect(PurchaseWineSchema.safeParse({ producer: "X", countryCode: "ZZ" }).success).toBe(false);
    expect(
      PurchaseCheckRequestSchema.safeParse({ wine: { producer: "X" }, priceCents: -1 }).success,
    ).toBe(false);
  });

  it("starts from what the label says, without filling anything in", () => {
    const w = purchaseWineFrom({
      producer: null,
      name: "Tignanello",
      year: null,
      nonVintage: false,
      type: null,
      countryCode: "IT",
      region: null,
      appellation: null,
      grapes: [],
      abv: null,
      volumeMl: null,
      confidence: { producer: "low", name: "high", year: "low" },
    });
    expect(w).toMatchObject({ producer: "Tignanello", name: null, year: null, type: null });
  });
});

describe("1. already in your cellar?", () => {
  it("the exact wine and vintage: counts the real bottles", () => {
    const same = item({ producer: "Chateau EXAMPLE", wineName: "grand vin", year: 2019, count: 4 });
    const r = checkPurchase(input({ items: [same, item()] }));
    expect(r.ownership.kind).toBe("exact");
    expect(r.ownership.exactBottles).toBe(4);
    expect(r.ownership.exact.map((b) => b.vintageId)).toEqual([same.vintageId]);
  });

  it("the same wine, another vintage", () => {
    const other = item({
      producer: "Château Example",
      wineName: "Grand Vin",
      year: 2016,
      count: 1,
    });
    const r = checkPurchase(input({ items: [other] }));
    expect(r.ownership).toMatchObject({ kind: "other_vintages", exactBottles: 0, otherBottles: 1 });
    expect(r.reasons[0]).toEqual({ code: "owns_other_vintages", bottles: 1, vintages: 1 });
  });

  it("the vintage in the shop unknown: the wine is owned, the vintage is not claimed", () => {
    const other = item({ producer: "Château Example", wineName: "Grand Vin", year: 2016 });
    const r = checkPurchase(input({ wine: wine({ year: null }), items: [other] }));
    expect(r.ownership.kind).toBe("same_wine");
    expect(r.ownership.exactBottles).toBe(0);
  });

  it("a verified alias or a verified catalogue link is the same wine", () => {
    const aliased = item({ producer: "Château Example", wineName: "Le Grand Vin de Example" });
    const linked = item({ producer: "Ch. Example", wineName: "GV", year: 2019 });
    const r = checkPurchase(
      input({
        catalogWineId: "cat-1",
        items: [aliased, linked],
        traits: traitsOf([
          [aliased.wineId, { aliases: ["Grand Vin"] }],
          [linked.wineId, { catalogIds: ["cat-1"] }],
        ]),
      }),
    );
    expect(r.ownership.kind).toBe("exact");
    expect(r.ownership.exact.map((b) => b.vintageId)).toEqual([linked.vintageId]);
    expect(r.ownership.otherVintages.map((b) => b.vintageId)).toEqual([aliased.vintageId]);
  });

  it("a similar name is only 'possibly' the wine, and never counted as owned", () => {
    const close = item({ producer: "Chateau Exemple", wineName: "Grand Vin", year: 2019 });
    const r = checkPurchase(input({ items: [close] }));
    expect(r.ownership).toMatchObject({ kind: "possible", exactBottles: 0, otherBottles: 0 });
    expect(r.ownership.possible).toHaveLength(1);
    expect(r.reasons[0]).toEqual({ code: "maybe_owned" });
    expect(r.similar).toEqual([]); // not offered twice
  });

  it("a colour or country that contradicts it is not the same wine", () => {
    const white = item({ producer: "Château Example", wineName: "Grand Vin", type: "white" });
    const r = checkPurchase(input({ items: [white] }));
    expect(r.ownership.kind).toBe("none");
  });

  it("no name on the label: never confirmed, at most possibly the estate's wine", () => {
    const estate = item({ producer: "Château Example", wineName: "Grand Vin", year: 2019 });
    const r = checkPurchase(input({ wine: wine({ name: null }), items: [estate] }));
    expect(r.ownership.kind).toBe("possible");
  });

  it("an empty cellar: nothing owned, nothing similar, and said so", () => {
    const r = checkPurchase(input());
    expect(r.ownership.kind).toBe("none");
    expect(r.similar).toEqual([]);
    expect(r.cellarBottles).toBe(0);
    expect(r.reasons[0]).toEqual({ code: "cellar_empty" });
    expect(r.verdict).toBe("depends");
  });
});

describe("2. similar wines you already own", () => {
  it("red and French alone is not similar", () => {
    expect(similarity(wine({ region: null }), item({ region: null }), undefined)).toBeNull();
    expect(similarity(wine(), item({ region: "Rhône" }), undefined)).toBeNull();
  });

  it("another kind of wine, or an unknown kind, is never similar", () => {
    expect(similarity(wine(), item({ type: "white", region: "Bordeaux" }), undefined)).toBeNull();
    expect(similarity(wine({ type: null }), item({ region: "Bordeaux" }), undefined)).toBeNull();
  });

  it("the same region (and country) is comparable; appellation and grapes make it strong", () => {
    const plain = similarity(wine(), item({ region: "Bordeaux" }), undefined)!;
    expect(plain.reasons.map((r) => r.code)).toEqual(["same_region", "same_country"]);
    const strong = similarity(
      wine({ appellation: "Pauillac", grapes: ["Cabernet Sauvignon", "Merlot"] }),
      item({ region: "Bordeaux" }),
      { appellation: "PAUILLAC", grapes: ["Merlot", "Cabernet Sauvignon"] },
    )!;
    expect(strong.reasons.map((r) => r.code)).toEqual([
      "same_appellation",
      "same_grapes",
      "same_country",
    ]);
    expect(strong.score).toBeGreaterThanOrEqual(5);
  });

  it("only the household's own wines, at most three, the best first, the wine itself left out", () => {
    const itself = item({ producer: "Château Example", wineName: "Grand Vin", region: "Bordeaux" });
    const a = item({ region: "Bordeaux", count: 1 });
    const b = item({ region: "Bordeaux", count: 6 });
    const c = item({ region: "Bordeaux", count: 2 });
    const d = item({ region: "Bordeaux", count: 3 });
    const best = item({ region: "Bordeaux", count: 1 });
    const r = checkPurchase(
      input({
        wine: wine({ appellation: "Pauillac" }),
        items: [itself, a, b, c, d, best],
        traits: traitsOf([[best.wineId, { appellation: "Pauillac" }]]),
      }),
    );
    expect(r.similar.map((s) => s.bottle.vintageId)).toEqual([
      best.vintageId,
      b.vintageId,
      d.vintageId,
    ]);
    expect(r.similar[0]!.strength).toBe("moderate");
  });

  it("one card per wine, with all its bottles over its vintages", () => {
    const y1 = item({ wineId: "same", region: "Bordeaux", year: 2015, count: 1 });
    const y2 = item({ wineId: "same", region: "Bordeaux", year: 2018, count: 3 });
    const r = checkPurchase(input({ items: [y1, y2] }));
    expect(r.similar).toHaveLength(1);
    expect(r.similar[0]).toMatchObject({ bottles: 4, vintages: 2 });
    expect(r.similar[0]!.bottle.vintageId).toBe(y2.vintageId);
  });

  it("with few details about the wine, nothing is called similar or new", () => {
    const r = checkPurchase(
      input({ wine: wine({ region: null }), items: [item({ region: "Bordeaux" })] }),
    );
    expect(r.similar).toEqual([]);
    expect(r.reasons).toContainEqual({ code: "few_details" });
  });
});

describe("3. match with your taste", () => {
  it("no ratings: not enough information, whatever the kind of wine", () => {
    const r = checkPurchase(input({ preferences: { ...NO_PREFERENCES, wineFocus: "red" } }));
    expect(r.taste.fit).toBe("insufficient");
    expect(r.taste.signals).toEqual([
      expect.objectContaining({ code: "said_focus", direction: "for", strength: "weak" }),
    ]);
  });

  it("liking red wines in general is weak: no confident prediction", () => {
    const r = checkPurchase(
      input({ tastings: [1, 2, 3, 4].map(() => tasting({ score: 9, region: "Rioja" })) }),
    );
    expect(r.taste.fit).toBe("insufficient");
    expect(r.taste.signals).toContainEqual(
      expect.objectContaining({ code: "style", direction: "for", strength: "weak", wines: 4 }),
    );
  });

  it("three liked wines of the region are a supported positive match", () => {
    const r = checkPurchase(
      input({ tastings: [8, 9, 8].map((score) => tasting({ score, region: "bordeaux" })) }),
    );
    expect(r.taste.fit).toBe("positive");
    expect(r.taste.signals).toContainEqual(
      expect.objectContaining({ code: "region", direction: "for", wines: 3, average: 4.2 }),
    );
  });

  it("two are not enough for a region", () => {
    const r = checkPurchase(
      input({ tastings: [9, 9].map((score) => tasting({ score, region: "Bordeaux" })) }),
    );
    expect(r.taste.fit).toBe("insufficient");
  });

  it("a white wine of the region says nothing about a red one", () => {
    const r = checkPurchase(
      input({
        tastings: [9, 9, 9].map((score) => tasting({ score, region: "Bordeaux", type: "white" })),
      }),
    );
    expect(r.taste.fit).toBe("insufficient");
  });

  it("disliked grapes are a supported potential mismatch, and the advice is to skip", () => {
    const r = checkPurchase(
      input({
        wine: wine({ grapes: ["Merlot"] }),
        tastings: [4, 3, 5].map((score) => tasting({ score, grapes: ["merlot"] })),
      }),
    );
    expect(r.taste.fit).toBe("mismatch");
    expect(r.verdict).toBe("skip");
    expect(r.reasons).toContainEqual({ code: "taste_mismatch" });
  });

  it("another vintage of this very wine, rated: direct evidence", () => {
    const owned = item({ producer: "Château Example", wineName: "Grand Vin", year: 2016 });
    const r = checkPurchase(
      input({
        items: [owned],
        tastings: [tasting({ wineId: owned.wineId, producer: "x", wineName: "y", score: 9 })],
      }),
    );
    expect(r.taste.signals).toContainEqual(
      expect.objectContaining({ code: "this_wine", direction: "for", wines: 1, average: 4.5 }),
    );
    expect(r.taste.fit).toBe("positive");
  });

  it("liked and disliked evidence together is mixed, and the advice depends", () => {
    const r = checkPurchase(
      input({
        tastings: [
          ...[8, 9, 8].map((score) => tasting({ score, region: "Bordeaux" })),
          ...[4, 4].map((score) => tasting({ score, producer: "Château Example" })),
        ],
      }),
    );
    expect(r.taste.fit).toBe("mixed");
    expect(r.verdict).toBe("depends");
  });
});

describe("4. the advice", () => {
  const liked = [8, 9, 8].map((score) => tasting({ score, region: "Bordeaux" }));

  it("fits the taste and adds variety: worth considering", () => {
    const r = checkPurchase(
      input({ tastings: liked, items: [item({ type: "white", region: "Loire" })] }),
    );
    expect(r.verdict).toBe("consider");
    expect(r.reasons).toEqual([{ code: "adds_variety" }, { code: "taste_fits" }]);
  });

  it("fits the taste, two similar Bordeaux owned: worth considering, with the overlap named", () => {
    const r = checkPurchase(
      input({
        tastings: liked,
        items: [item({ region: "Bordeaux", count: 2 }), item({ region: "Bordeaux", count: 1 })],
      }),
    );
    expect(r.verdict).toBe("consider");
    expect(r.reasons[0]).toEqual({ code: "similar_owned", wines: 2, bottles: 3 });
  });

  it("three bottles of the exact wine already: probably skip, unless the taste supports it", () => {
    const same = item({ producer: "Château Example", wineName: "Grand Vin", year: 2019, count: 3 });
    expect(checkPurchase(input({ items: [same] })).verdict).toBe("skip");
    expect(checkPurchase(input({ items: [same], tastings: liked })).verdict).toBe("depends");
  });

  it("no taste evidence and no overlap: it depends, never a confident yes", () => {
    const r = checkPurchase(input({ items: [item({ type: "white", region: "Loire" })] }));
    expect(r.verdict).toBe("depends");
    expect(r.reasons).toContainEqual({ code: "taste_unknown" });
  });

  it("the price is shown back, never judged", () => {
    const r = checkPurchase(input({ priceCents: 1299 }));
    expect(r.priceCents).toBe(1299);
    expect(r.reasons.some((x) => x.code.includes("price"))).toBe(false);
  });

  it("the same input always gives the same answer", () => {
    const i = input({ tastings: liked, items: [item({ region: "Bordeaux" })] });
    expect(checkPurchase(i)).toEqual(checkPurchase(i));
  });
});

describe("the catalogue identity", () => {
  const cat = (over: Record<string, unknown>) => ({
    id: "c1",
    producer: "Château Example",
    name: "Grand Vin",
    type: "red" as const,
    countryCode: "FR",
    region: "Bordeaux",
    catalog: true,
    aliases: [] as string[],
    ...over,
  });

  it("exactly one catalogue wine, by name or verified alias", () => {
    expect(catalogIdentityOf(wine(), [cat({})])?.id).toBe("c1");
    expect(catalogIdentityOf(wine({ name: "GV" }), [cat({ aliases: ["GV"] })])?.id).toBe("c1");
  });

  it("not a household wine, not a similar name, not two of them", () => {
    expect(catalogIdentityOf(wine(), [cat({ catalog: false })])).toBeNull();
    expect(catalogIdentityOf(wine({ name: "Grand Vins" }), [cat({})])).toBeNull();
    expect(catalogIdentityOf(wine(), [cat({}), cat({ id: "c2" })])).toBeNull();
    expect(catalogIdentityOf(wine({ type: "white" }), [cat({})])).toBeNull();
  });
});
