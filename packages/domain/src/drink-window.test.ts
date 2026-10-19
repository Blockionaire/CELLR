import { describe, expect, it } from "vitest";
import {
  assessDrink,
  drinkStatus,
  drinkStatusOf,
  drinkUrgency,
  estimateDrinkWindow,
  priceFactor,
  styleOf,
  type DrinkInput,
} from "./drink-window";

const wine = (over: Partial<DrinkInput> = {}): DrinkInput => ({
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
  year: 2015,
  ...over,
});

describe("which style of region a wine is from", () => {
  it("reads it from the words: region, appellation or name", () => {
    expect(styleOf({ countryCode: "FR", region: "Bordeaux", appellation: null })).toBe("bordeaux");
    expect(styleOf({ countryCode: "FR", region: null, appellation: "Pauillac" })).toBe("bordeaux");
    expect(styleOf({ countryCode: "FR", region: "Champagne" })).toBe("champagne");
    expect(styleOf({ countryCode: "FR", region: "Côte-Rôtie" })).toBe("rhone-north");
    expect(styleOf({ countryCode: "FR", region: "Burgundy" })).toBe("burgundy");
    expect(styleOf({ countryCode: "IT", region: "Barolo" })).toBe("piedmont");
    expect(styleOf({ countryCode: "IT", region: "Tuscany" })).toBe("tuscany");
    expect(styleOf({ countryCode: "ES", region: "Rioja" })).toBe("rioja");
    expect(styleOf({ countryCode: "PT", region: "Douro", name: "Vintage Port" })).toBe("port");
  });
  it("ignores accents and case, and does not match inside other words", () => {
    expect(styleOf({ countryCode: "FR", region: "CÔTES DU RHÔNE" })).toBe("rhone-south");
    // "Montepulciano d'Abruzzo" is Abruzzo's wine, not Tuscany's Vino Nobile
    expect(styleOf({ countryCode: "IT", region: "Abruzzo", name: "Montepulciano d'Abruzzo" })).toBe(
      "italy-south",
    );
    expect(styleOf({ countryCode: "XX", region: "Transport Valley" })).toBe("standard");
  });
  it("falls back on the country, then on 'standard'", () => {
    expect(styleOf({ countryCode: "DE", region: null })).toBe("riesling");
    expect(styleOf({ countryCode: "NZ", region: "Marlborough" })).toBe("new-zealand");
    expect(styleOf({ countryCode: "FR", region: "Somewhere unknown" })).toBe("standard");
    expect(styleOf({ countryCode: null, region: null })).toBe("standard");
  });
});

describe("the estimated window", () => {
  it("has none for a non-vintage wine (nothing to count from)", () => {
    expect(estimateDrinkWindow(wine({ year: null }))).toBeNull();
  });

  it("is counted in calendar years from the harvest, by style and colour", () => {
    // Bordeaux red: 3–10 years after the harvest, a mid-priced bottle (€30).
    expect(estimateDrinkWindow(wine({ pricePerBottleCents: 3000 }))).toEqual({
      from: 2018,
      until: 2026,
      source: "estimate",
    });
    // Beaujolais red is made to be drunk young: 1–5.
    expect(estimateDrinkWindow(wine({ region: "Beaujolais", year: 2022 }))).toMatchObject({
      from: 2023,
      until: 2027,
    });
    // A white from Chablis: 1–7.
    expect(
      estimateDrinkWindow(wine({ type: "white", region: "Chablis", year: 2020 })),
    ).toMatchObject({
      from: 2021,
      until: 2027,
    });
  });

  it("an expensive bottle keeps longer, and mostly gets old later rather than good much later", () => {
    const cheap = estimateDrinkWindow(wine({ pricePerBottleCents: 800 }))!;
    const fair = estimateDrinkWindow(wine({ pricePerBottleCents: 3000 }))!;
    const grand = estimateDrinkWindow(wine({ pricePerBottleCents: 15000 }))!;
    expect(cheap.until).toBeLessThan(fair.until);
    expect(fair.until).toBeLessThan(grand.until);
    expect(grand.from - fair.from).toBeLessThan(grand.until - fair.until);
  });

  it("the words on the label count: Grand Cru waits, Nouveau does not", () => {
    const plain = estimateDrinkWindow(wine({ region: "Burgundy", name: "Gevrey" }))!;
    const grand = estimateDrinkWindow(
      wine({ region: "Burgundy", name: "Clos de Bèze Grand Cru" }),
    )!;
    const nouveau = estimateDrinkWindow(
      wine({ region: "Beaujolais", name: "Beaujolais Nouveau" }),
    )!;
    expect(grand.until).toBeGreaterThan(plain.until);
    expect(nouveau.until - 2015).toBeLessThanOrEqual(2);
  });

  it("is bounded: price and quality add up but never run away", () => {
    const absurd = estimateDrinkWindow(
      wine({ name: "Premier Grand Cru Vintage", pricePerBottleCents: 500000 }),
    )!;
    expect(absurd.until - 2015).toBeLessThanOrEqual(Math.round(10 * 2.6));
  });

  it("always has a window of at least a year, ending after it starts", () => {
    for (const type of [
      "red",
      "white",
      "rose",
      "sparkling",
      "dessert",
      "fortified",
      "orange",
    ] as const)
      for (const price of [null, 300, 3000, 90000]) {
        const w = estimateDrinkWindow(
          wine({ type, pricePerBottleCents: price, region: null, countryCode: null }),
        )!;
        expect(w.until).toBeGreaterThan(w.from);
      }
  });

  it("scales the price in steps", () => {
    expect([null, 0, 500, 1000, 1500, 3000, 5000, 10000, 20000, 50000].map(priceFactor)).toEqual([
      1, 1, 0.55, 0.7, 0.85, 1.05, 1.3, 1.6, 2.0, 2.4,
    ]);
  });
});

describe("where a bottle stands today", () => {
  const window = { from: 2020, until: 2030, source: "estimate" as const };
  const at = (year: number, month = 0) => new Date(Date.UTC(year, month, 1));

  it("walks through young, developing, peak, ready, past", () => {
    expect(drinkStatus(window, at(2018)).phase).toBe("young");
    expect(drinkStatus(window, at(2021)).phase).toBe("developing"); // 10% in
    expect(drinkStatus(window, at(2024)).phase).toBe("peak"); // 40%
    expect(drinkStatus(window, at(2028)).phase).toBe("ready"); // 80%
    expect(drinkStatus(window, at(2030)).phase).toBe("ready"); // the last year is still in the window
    expect(drinkStatus(window, at(2031)).phase).toBe("past");
  });

  it("counts the years until it opens and until it closes, with a sign", () => {
    const s = drinkStatus(window, at(2018));
    expect(s.yearsUntilOpen).toBe(2);
    expect(s.yearsLeft).toBe(12);
    const late = drinkStatus(window, at(2032));
    expect(late.yearsUntilOpen).toBe(-12);
    expect(late.yearsLeft).toBe(-2);
  });

  it("says unknown, plainly, when there is no window", () => {
    expect(drinkStatus(null, at(2026))).toEqual({
      phase: "unknown",
      window: null,
      position: null,
      yearsUntilOpen: null,
      yearsLeft: null,
    });
    expect(drinkStatusOf(wine({ year: null }), at(2026)).phase).toBe("unknown");
  });

  it("orders what to open first: past, then ready, peak, developing, young, unknown", () => {
    const now = at(2026);
    const urgency = (w: DrinkInput) => drinkUrgency(drinkStatusOf(w, now));
    const past = wine({ region: "Beaujolais", year: 2010 });
    const ready = wine({ region: "Beaujolais", year: 2021 });
    const young = wine({ year: 2025 });
    const unknown = wine({ year: null });
    expect(drinkStatusOf(past, now).phase).toBe("past");
    expect(drinkStatusOf(young, now).phase).toBe("young");
    expect(urgency(past)).toBeLessThan(urgency(ready));
    expect(urgency(ready)).toBeLessThan(urgency(young));
    expect(urgency(young)).toBeLessThan(urgency(unknown));
  });
});

describe("an AI window", () => {
  it("replaces the style table and says so", () => {
    const w = estimateDrinkWindow(wine({ aiWindow: { from: 2022, until: 2040 } }));
    expect(w).toMatchObject({ from: 2022, until: 2040, source: "ai" });
  });
  it("is ignored when the wine has no year", () => {
    expect(
      estimateDrinkWindow(wine({ year: null, aiWindow: { from: 2022, until: 2040 } })),
    ).toBeNull();
  });
});

/**
 * Regression: the audit of 18 Oct 2026 found Château Musar 2016 on Home as "past its best". A wine people keep
 * for decades must never be told to be past it on the strength of a rough table.
 */
describe("trustworthy drinking advice", () => {
  const OCT_2026 = new Date("2026-10-18T12:00:00Z");
  const assess = (input: DrinkInput, now = OCT_2026) => assessDrink(drinkStatusOf(input, now));

  // Wines known to age far beyond the table's usual span (vintage, what one paid).
  const LONG_AGERS: Array<[string, DrinkInput]> = [
    [
      "Château Musar 2016",
      {
        type: "red",
        countryCode: "LB",
        region: "Bekaa",
        name: "Château Musar",
        year: 2016,
        pricePerBottleCents: 4800,
      },
    ],
    [
      "Barolo 2016",
      {
        type: "red",
        countryCode: "IT",
        region: "Piemonte",
        name: "Barolo",
        year: 2016,
        pricePerBottleCents: 4500,
      },
    ],
    [
      "Vintage Port 2011",
      {
        type: "fortified",
        countryCode: "PT",
        region: "Douro",
        name: "Vintage Port",
        year: 2011,
        pricePerBottleCents: 6500,
      },
    ],
    [
      "Sauternes 2009",
      {
        type: "dessert",
        countryCode: "FR",
        region: "Sauternes",
        name: "Château Suduiraut",
        year: 2009,
        pricePerBottleCents: 5500,
      },
    ],
    [
      "Rioja Gran Reserva 2010",
      {
        type: "red",
        countryCode: "ES",
        region: "Rioja",
        name: "Gran Reserva",
        year: 2010,
        pricePerBottleCents: 3500,
      },
    ],
    [
      "Hermitage 2010",
      {
        type: "red",
        countryCode: "FR",
        region: "Hermitage",
        name: "Hermitage",
        year: 2010,
        pricePerBottleCents: 9000,
      },
    ],
    [
      "Mosel Riesling Spätlese 2012",
      {
        type: "white",
        countryCode: "DE",
        region: "Mosel",
        name: "Riesling Spätlese",
        year: 2012,
        pricePerBottleCents: 2500,
      },
    ],
    [
      "Bordeaux Grand Cru Classé 2005",
      {
        type: "red",
        countryCode: "FR",
        region: "Pauillac",
        name: "Grand Cru Classé",
        year: 2005,
        pricePerBottleCents: 15000,
      },
    ],
  ];

  it.each(LONG_AGERS)(
    "%s is never called past it, or drink-soon, by the rough table",
    (_, input) => {
      const a = assess(input);
      expect(a.phase).not.toBe("past");
      expect(a.phase).not.toBe("ready");
      expect(a.reliable).toBe(false);
    },
  );

  it("Château Musar 2016 has a long window of its own region style", () => {
    const w = estimateDrinkWindow({
      type: "red",
      countryCode: "LB",
      region: "Bekaa",
      year: 2016,
      pricePerBottleCents: 4800,
    })!;
    expect(w.until).toBeGreaterThanOrEqual(2040);
    expect(
      assess({
        type: "red",
        countryCode: "LB",
        region: "Bekaa",
        year: 2016,
        pricePerBottleCents: 4800,
      }).phase,
    ).not.toBe("unknown");
  });

  // Everyday wines the table handles well: young or at their best is said plainly, the late claim is not.
  const EVERYDAY: Array<[string, DrinkInput, string]> = [
    [
      "NZ Sauvignon Blanc 2025",
      {
        type: "white",
        countryCode: "NZ",
        region: "Marlborough",
        year: 2025,
        pricePerBottleCents: 1400,
      },
      "developing|peak",
    ],
    [
      "Provence rosé 2026",
      {
        type: "rose",
        countryCode: "FR",
        region: "Provence",
        year: 2026,
        pricePerBottleCents: 1200,
      },
      "young|developing|peak",
    ],
    [
      "Beaujolais 2025",
      {
        type: "red",
        countryCode: "FR",
        region: "Beaujolais",
        year: 2025,
        pricePerBottleCents: 1100,
      },
      "developing|peak|young",
    ],
    [
      "Rioja Crianza 2022",
      {
        type: "red",
        countryCode: "ES",
        region: "Rioja",
        name: "Crianza",
        year: 2022,
        pricePerBottleCents: 1300,
      },
      "developing|peak",
    ],
  ];
  it.each(EVERYDAY)("%s gets a plain phase", (_, input, phases) => {
    expect(assess(input).phase).toMatch(new RegExp(`^(${phases})$`));
  });

  it("an old cheap rosé is 'not enough information', not 'past its best', without wine-specific evidence", () => {
    const a = assess({
      type: "rose",
      countryCode: "FR",
      region: "Provence",
      year: 2019,
      pricePerBottleCents: 900,
    });
    expect(a).toMatchObject({ phase: "unknown", uncertain: true, reliable: false });
    // the rough window is kept (as a sketch), but nothing urgent is said
    expect(a.window).not.toBeNull();
    expect(drinkUrgency(a)).toBe(999);
  });

  it("a window about this very wine may say it is past its best, or to drink it soon", () => {
    const past = assess({
      type: "red",
      countryCode: "LB",
      region: "Bekaa",
      year: 2016,
      aiWindow: { from: 2018, until: 2024 },
    });
    expect(past).toMatchObject({ phase: "past", reliable: true, uncertain: false });
    const soon = assess({
      type: "red",
      countryCode: "FR",
      region: "Bordeaux",
      year: 2015,
      aiWindow: { from: 2020, until: 2027 },
    });
    expect(soon).toMatchObject({ phase: "ready", reliable: true });
  });

  it("a wine without a year has no window and no claims", () => {
    expect(
      assess({ type: "sparkling", countryCode: "FR", region: "Champagne", year: null }),
    ).toMatchObject({
      phase: "unknown",
      reliable: false,
      uncertain: false,
    });
  });
});
