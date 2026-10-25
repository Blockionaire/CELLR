import { describe, expect, it } from "vitest";
import {
  BottleExtrasSchema,
  checkInsight,
  checkValuation,
  InsightOutputSchema,
  mergeInsight,
  nextValuationAt,
  PROFILE_VERSION,
  profileUpgrade,
  samePageKey,
  valuationKind,
  checkOrigin,
  currentValueCents,
  daysUntil,
  reminderWhen,
  type RawInsight,
  type RawValuation,
} from "./insights";

const raw: RawInsight = {
  summary: "A  ripe\nBordeaux.",
  style: "Full-bodied red",
  grapes: ["Merlot", "merlot", " Cabernet Franc ", ""],
  tasting: "Plum and cedar.",
  serving_temp_min_c: 16,
  serving_temp_max_c: 18,
  decant_minutes: 60,
  abv_percent: 13.5,
  pairings: ["Lamb", "Hard cheese"],
  aging: "Another decade.",
  body: 4,
  tannin: 4.4,
  sweetness: 1,
  acidity: 9,
  flavors: [
    { group: "black_fruit", notes: ["Blackcurrant", "plum", ""] },
    { group: "black_fruit", notes: ["Cherry"] },
    { group: "oak", notes: ["Cedar"] },
  ],
  pairing_kinds: ["lamb", "beef", "lamb"],
  drink_from_year: 2020,
  drink_until_year: 2035,
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Pauillac",
  confidence: "medium",
  evidence: "producer",
  sources: [],
};

describe("the AI's drinking window", () => {
  it("is kept when it is sane for the vintage", () => {
    expect(checkInsight(raw, 2015)!.drinkWindow).toEqual({ from: 2020, until: 2035 });
  });
  it("is dropped without a vintage year, when reversed, before the vintage or absurdly long", () => {
    expect(checkInsight(raw, null)!.drinkWindow).toBeNull();
    expect(
      checkInsight({ ...raw, drink_from_year: 2035, drink_until_year: 2020 }, 2015)!.drinkWindow,
    ).toBeNull();
    expect(checkInsight(raw, 2025)!.drinkWindow).toBeNull();
    expect(checkInsight({ ...raw, drink_until_year: 2200 }, 2015)!.drinkWindow).toBeNull();
  });
});

describe("where the wine is from, per the AI", () => {
  it("gives well-formed country, region and appellation", () => {
    expect(checkOrigin(raw)).toEqual({
      countryCode: "FR",
      region: "Bordeaux",
      appellation: "Pauillac",
    });
  });
  it("gives nothing when the AI is unsure, and drops malformed values", () => {
    expect(checkOrigin({ ...raw, confidence: "low" })).toEqual({});
    expect(checkOrigin({ ...raw, country_code: "France", region: " ", appellation: null })).toEqual(
      {},
    );
  });
});

describe("bottle extras", () => {
  it("keeps who gave it only for a gift, and an occasion needs a name", () => {
    const parse = (v: unknown) => BottleExtrasSchema.safeParse(v);
    expect(
      parse({ acquiredHow: "gift", giftFrom: " Oma ", occasionTitle: null, occasionOn: null }),
    ).toMatchObject({ success: true, data: { giftFrom: "Oma" } });
    expect(
      parse({ acquiredHow: "bought", giftFrom: "Oma", occasionTitle: null, occasionOn: null }),
    ).toMatchObject({ success: true, data: { giftFrom: null } });
    expect(
      parse({ acquiredHow: null, giftFrom: null, occasionTitle: "", occasionOn: "2026-12-25" })
        .success,
    ).toBe(false);
    expect(
      parse({ acquiredHow: "stolen", giftFrom: null, occasionTitle: null, occasionOn: null })
        .success,
    ).toBe(false);
    expect(
      parse({ acquiredHow: null, giftFrom: null, occasionTitle: "x", occasionOn: "25-12-2026" })
        .success,
    ).toBe(false);
  });
});

describe("reminders", () => {
  it("counts calendar days, across months and leap days", () => {
    expect(daysUntil("2026-12-25", "2026-12-25")).toBe(0);
    expect(daysUntil("2026-12-25", "2026-12-20")).toBe(5);
    expect(daysUntil("2027-01-02", "2026-12-30")).toBe(3);
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
    expect(daysUntil("2026-12-20", "2026-12-25")).toBe(-5);
  });
  it("says when", () => {
    expect([-1, 0, 1, 9].map(reminderWhen)).toEqual(["overdue", "today", "tomorrow", "days"]);
  });
});

describe("checking an AI profile", () => {
  it("tidies the text, the scales, the aromas and the dishes", () => {
    const out = checkInsight(raw)!;
    expect(out.summary).toBe("A ripe Bordeaux.");
    expect(out.grapes).toEqual(["Merlot", "Cabernet Franc"]);
    expect(out.serving).toEqual({ minC: 16, maxC: 18 });
    expect(out.structure).toEqual({ body: 4, tannin: 4, sweetness: 1, acidity: null });
    expect(out.flavors).toEqual([
      { group: "black_fruit", notes: ["Blackcurrant", "plum"] },
      { group: "oak", notes: ["Cedar"] },
    ]);
    expect(out.pairingKinds).toEqual(["lamb", "beef"]);
    expect(out.version).toBe(PROFILE_VERSION);
    expect(out.value).toBeNull();
    expect(out.confidence).toBe("medium");
  });
  it("drops what cannot be true", () => {
    expect(checkInsight({ ...raw, serving_temp_min_c: 40 })!.serving).toBeNull();
    expect(
      checkInsight({ ...raw, serving_temp_min_c: 18, serving_temp_max_c: 16 })!.serving,
    ).toBeNull();
    expect(checkInsight({ ...raw, decant_minutes: 9000 })!.decantMinutes).toBeNull();
    expect(checkInsight(raw)!.abvPercent).toBe(13.5);
    expect(checkInsight({ ...raw, abv_percent: 0 })!.abvPercent).toBeNull();
    expect(checkInsight({ ...raw, abv_percent: 70 })!.abvPercent).toBeNull();
    expect(checkInsight({ ...raw, abv_percent: null })!.abvPercent).toBeNull();
    expect(
      checkInsight({ ...raw, body: null, tannin: 0, sweetness: null, acidity: null })!.structure,
    ).toBeNull();
  });
  it("has nothing to keep without a summary", () => {
    expect(checkInsight({ ...raw, summary: "  \n " })).toBeNull();
  });
});

describe("a profile stays as it was written", () => {
  const stored = InsightOutputSchema.parse({
    summary: "The first words.",
    style: "Full",
    grapes: ["Merlot"],
    tasting: "Plum.",
    serving: null,
    decantMinutes: 30,
    pairings: ["Lamb"],
    aging: "A decade.",
    value: { lowCents: 4000, highCents: 6000, currency: "EUR", basis: "x" },
    confidence: "medium",
  });
  it("an older profile reads with the new parts empty", () => {
    expect(stored).toMatchObject({ version: 1, structure: null, flavors: [], pairingKinds: [] });
  });
  it("a new run only fills in what was missing, and never rewrites what was there", () => {
    const fresh = checkInsight({ ...raw, summary: "Different words.", decant_minutes: 90 }, 2015)!;
    const merged = mergeInsight(stored, fresh);
    expect(merged.summary).toBe("The first words.");
    expect(merged.grapes).toEqual(["Merlot"]);
    expect(merged.decantMinutes).toBe(30);
    expect(merged.value).toEqual(stored.value);
    expect(merged.structure).toEqual(fresh.structure);
    expect(merged.flavors).toEqual(fresh.flavors);
    expect(merged.drinkWindow).toEqual({ from: 2020, until: 2035 });
    expect(merged.version).toBe(PROFILE_VERSION);
  });
});

describe("what a profile rests on (no invented facts)", () => {
  const page = "https://www.producer.example/wines/nemm-rosso?utm_source=openai";
  const exact: RawInsight = {
    ...raw,
    confidence: "high",
    evidence: "exact_wine",
    sources: [
      { name: "Producer", url: "https://producer.example/wines/nemm-rosso/" },
      { name: "Never opened", url: "https://made-up.example/nemm" },
    ],
  };
  it("exact-wine facts need a page the search really opened; only that page is kept", () => {
    const out = checkInsight(exact, 2023, [page])!;
    expect(out).toMatchObject({ evidence: "exact_wine", confidence: "high" });
    expect(out.sources).toEqual([
      { name: "Producer", url: "https://producer.example/wines/nemm-rosso/" },
    ]);
  });
  it("without such a page it is producer knowledge at best, never 'high'", () => {
    expect(checkInsight(exact, 2023, [])).toMatchObject({
      evidence: "producer",
      confidence: "medium",
      sources: [],
    });
    // Same site, other page: not the page it claims.
    expect(checkInsight(exact, 2023, ["https://producer.example/other"])!.evidence).toBe(
      "producer",
    );
  });
  it("a style estimate names no grapes and no precise alcohol, and stays low", () => {
    const out = checkInsight({ ...raw, confidence: "high", evidence: "style_estimate" }, 2023)!;
    expect(out).toMatchObject({ grapes: [], abvPercent: null, confidence: "low" });
    expect(out.summary).toBe("A ripe Bordeaux.");
    // An appellation's own rules may name the grapes.
    expect(checkInsight({ ...raw, evidence: "appellation_rules" })!.grapes).toEqual([
      "Merlot",
      "Cabernet Franc",
    ]);
  });
});

describe("asking again for an older profile", () => {
  const base = {
    summary: "Veneto red; the exact grapes are unknown.",
    style: "",
    grapes: [],
    tasting: "",
    serving: null,
    decantMinutes: null,
    pairings: [],
    aging: "",
  };
  it("an older profile that was not sure of itself is written again, once", () => {
    for (const confidence of ["low", "medium"] as const)
      expect(profileUpgrade(InsightOutputSchema.parse({ ...base, version: 5, confidence }))).toBe(
        "replace",
      );
    const rewritten = checkInsight(
      { ...raw, confidence: "low", evidence: "style_estimate" },
      2023,
    )!;
    expect(profileUpgrade(rewritten)).toBe("none");
  });
  it("a sure profile is kept as written; a very old one only gains its missing parts", () => {
    expect(
      profileUpgrade(InsightOutputSchema.parse({ ...base, version: 5, confidence: "high" })),
    ).toBe("none");
    expect(
      profileUpgrade(InsightOutputSchema.parse({ ...base, version: 3, confidence: "high" })),
    ).toBe("fill");
  });
});

describe("what a bottle is worth, with sources", () => {
  const consulted = [
    "https://www.shop.example/p/margaux-2015?utm_source=openai",
    "https://auction.example/lot/1",
    "https://cave.example/margaux-2015",
  ];
  const offer = (over: Partial<RawValuation["sources"][number]> = {}) => ({
    name: "Shop",
    url: "https://shop.example/p/margaux-2015?utm_source=openai#x",
    price: 169,
    vintage: 2015,
    bottle_ml: 750,
    same_wine: true,
    ...over,
  });
  const found: RawValuation = {
    low: 169,
    high: 269,
    basis: "  Shops \n in France. ",
    sources: [
      offer(),
      offer({ name: "Cave", url: "https://cave.example/margaux-2015/", price: 189 }),
      offer({ name: "Made up", url: "https://elsewhere.example/p", price: 99 }),
      offer({ name: "Plain http", url: "http://auction.example/lot/1", price: 50 }),
    ],
  };
  it("the range rests only on fitting pages the search really opened, from their own prices", () => {
    const v = checkValuation(found, "EUR", consulted, 2015)!;
    expect(v).toEqual({
      lowCents: 16900,
      highCents: 18900,
      currency: "EUR",
      basis: "Shops in France.",
      sources: [
        { name: "Shop", url: "https://shop.example/p/margaux-2015" },
        { name: "Cave", url: "https://cave.example/margaux-2015/" },
      ],
    });
    expect(valuationKind(v)).toBe("market");
  });
  it("same site is not the same page", () => {
    const other = offer({ url: "https://shop.example/p/margaux-2016" });
    expect(checkValuation({ ...found, sources: [other] }, "EUR", consulted, 2015)).toBeNull();
    expect(samePageKey("https://WWW.Shop.example/p/x/?b=2&a=1&gclid=z#top")).toBe(
      "shop.example/p/x?a=1&b=2",
    );
  });
  it("another vintage, another size, another cuvée or no price does not count", () => {
    for (const bad of [
      offer({ vintage: 2016 }),
      offer({ bottle_ml: 1500 }),
      offer({ bottle_ml: null }),
      offer({ same_wine: false }),
      offer({ price: null }),
    ])
      expect(checkValuation({ ...found, sources: [bad] }, "EUR", consulted, 2015)).toBeNull();
  });
  it("one shop is kept, honestly as one shop's asking price", () => {
    const v = checkValuation({ ...found, sources: [offer()] }, "EUR", consulted, 2015)!;
    expect(v).toMatchObject({ lowCents: 16900, highCents: 16900 });
    expect(valuationKind(v)).toBe("single_offer");
  });
  it("no real source or no price found, no value; nor an absurd spread", () => {
    expect(checkValuation(found, "EUR", [], 2015)).toBeNull();
    expect(checkValuation({ ...found, low: null, high: null }, "EUR", consulted, 2015)).toBeNull();
    const spread = [
      offer({ price: 10 }),
      offer({ url: "https://cave.example/margaux-2015", price: 500 }),
    ];
    expect(checkValuation({ ...found, sources: spread }, "EUR", consulted, 2015)).toBeNull();
  });
  it("can be looked up again a month after the last time", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    expect(nextValuationAt(null, now)).toBeNull();
    expect(nextValuationAt("2026-10-01T12:00:00Z", now)).toBe("2026-10-31T12:00:00.000Z");
    expect(nextValuationAt("2026-09-01T12:00:00Z", now)).toBeNull();
  });
});

describe("current value", () => {
  const legacy = InsightOutputSchema.parse({
    summary: "x",
    style: "",
    grapes: [],
    tasting: "",
    serving: null,
    decantMinutes: null,
    pairings: [],
    aging: "",
    value: { lowCents: 4000, highCents: 6000, currency: "EUR", basis: "" },
    confidence: "low",
  });
  const view = { insight: { output: legacy, model: "m", generatedAt: "x" } };
  const valuation = {
    lowCents: 8000,
    highCents: 10000,
    currency: "EUR",
    basis: "",
    sources: [],
    valuedAt: "2026-10-01",
  };
  it("prefers your own number, else the latest sourced value, else an old estimate, else nothing", () => {
    expect(currentValueCents({ ...view, myValueCents: 7000, valuation })).toBe(7000);
    expect(currentValueCents({ ...view, myValueCents: null, valuation })).toBe(9000);
    expect(currentValueCents({ ...view, myValueCents: null })).toBe(5000);
    expect(currentValueCents({ insight: null, myValueCents: null })).toBeNull();
    expect(currentValueCents({ insight: null, myValueCents: 0 })).toBe(0);
  });
});
