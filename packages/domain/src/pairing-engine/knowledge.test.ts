import { describe, expect, it } from "vitest";
import { normalizeText, WINE_TYPES } from "../cellar";
import {
  ALL_WINE_KEYS,
  APPELLATION_RULES,
  GRAPE_RULES,
  REGION_RULES,
  STYLE_KEYS,
  WINE_KNOWLEDGE,
  WINE_KNOWLEDGE_VERSION,
  WINE_PROVENANCE,
} from "./knowledge";
import { readWine, type WineInput, type WineProfileFacts, type WineStyleRule } from "./wine";

const RULES = WINE_KNOWLEDGE.rules;

const read = (wine: Partial<WineInput> & Pick<WineInput, "type">) =>
  readWine(
    { name: null, region: null, appellation: null, countryCode: null, ...wine },
    WINE_KNOWLEDGE,
  );

const LIMITS = {
  body: [1, 5],
  tannin: [0, 5],
  acidity: [1, 5],
  sweetness: [0, 5],
  intensity: [1, 5],
  oak: [0, 3],
  alcohol: [1, 4],
} as const;

describe("wine knowledge: integrity", () => {
  it("has the expected shape and size", () => {
    expect(WINE_KNOWLEDGE_VERSION).toBe("2026.11.1");
    expect(WINE_PROVENANCE).toEqual({ source: "cellr", reviewed: false });
    expect(REGION_RULES.every((r) => r.kind === "region")).toBe(true);
    expect(GRAPE_RULES.every((r) => r.kind === "grape")).toBe(true);
    expect(APPELLATION_RULES.every((r) => r.kind === "appellation")).toBe(true);
    expect(REGION_RULES.length).toBeGreaterThanOrEqual(60);
    expect(GRAPE_RULES.length).toBeGreaterThanOrEqual(60);
    expect(APPELLATION_RULES.length).toBeGreaterThanOrEqual(220);
    expect(RULES.length).toBe(REGION_RULES.length + GRAPE_RULES.length + APPELLATION_RULES.length);
  });

  it("has one rule per (id, colour, kind)", () => {
    const seen = new Set<string>();
    for (const r of RULES) {
      const key = `${r.kind}|${r.type}|${r.id}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("writes every id and name in normalised form", () => {
    for (const r of RULES) {
      expect(r.id, r.id).toBe(normalizeText(r.id));
      expect(r.names.length, r.id).toBeGreaterThan(0);
      for (const n of r.names) {
        expect(n.length, r.id).toBeGreaterThan(0);
        expect(n, r.id).toBe(normalizeText(n));
      }
    }
  });

  it("keeps every stated axis within its limits", () => {
    for (const r of RULES) {
      for (const [axis, [lo, hi]] of Object.entries(LIMITS)) {
        const v = r.s[axis as keyof typeof LIMITS];
        if (v === undefined) continue;
        expect(v, `${r.id} ${axis}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${r.id} ${axis}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("gives every rule a type, normalised keys and a well-formed country", () => {
    for (const r of RULES) {
      expect(WINE_TYPES, r.id).toContain(r.type);
      expect(r.keys.length, r.id).toBeGreaterThan(0);
      for (const k of r.keys) {
        // Keys are lower-case normalised text; the closed style list keeps its one hyphen ("off-dry white").
        expect(normalizeText(k), `${r.id}: ${k}`).toBe(k.replace(/-/g, " "));
        expect(k, `${r.id}: ${k}`).toBe(k.toLowerCase());
      }
      if (r.country !== undefined) expect(r.country, r.id).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("keeps the keys a closed vocabulary: rule ids, colours and style keys", () => {
    const vocabulary = new Set<string>([...RULES.map((r) => r.id), ...STYLE_KEYS, ...WINE_TYPES]);
    for (const r of RULES)
      for (const k of r.keys) expect(vocabulary.has(k), `${r.id}: ${k}`).toBe(true);
    for (const k of ALL_WINE_KEYS) expect(vocabulary.has(k), k).toBe(true);
    for (const k of vocabulary) expect(ALL_WINE_KEYS.has(k), k).toBe(true);
  });

  it("uses every style key in at least one rule", () => {
    const used = new Set(RULES.flatMap((r) => r.keys));
    for (const k of STYLE_KEYS) expect(used.has(k), k).toBe(true);
  });

  it("names no rule with a bare common word", () => {
    const banned = [
      "pouilly",
      "saint",
      "st",
      "villages",
      "reserva",
      "cru",
      "rouge",
      "blanc",
      "bianco",
      "rosso",
    ];
    for (const r of RULES)
      for (const n of r.names) expect(banned, `${r.id}: ${n}`).not.toContain(n);
  });

  it("lets every name, alone, select its own rule (no name is shadowed or claimed twice)", () => {
    for (const kind of ["region", "grape", "appellation"] as const) {
      const knowledge = { rules: RULES.filter((r) => r.kind === kind) };
      for (const r of knowledge.rules) {
        for (const n of r.names) {
          const reading = readWine(
            {
              type: r.type,
              name: n,
              region: null,
              appellation: null,
              countryCode: r.country ?? null,
            },
            knowledge,
          );
          expect(reading.rules, `${kind} ${r.type} "${n}"`).toEqual([r.id]);
        }
      }
    }
  });
});

type Range = readonly [number, number];
const within = (value: number, [lo, hi]: Range, label: string) => {
  expect(value, label).toBeGreaterThanOrEqual(lo);
  expect(value, label).toBeLessThanOrEqual(hi);
};
const atLeast = (n: number): Range => [n, 99];
const atMost = (n: number): Range => [-99, n];

interface Case {
  label: string;
  wine: Partial<WineInput> & Pick<WineInput, "type">;
  expect: Partial<Record<keyof typeof LIMITS, Range>> & { fizz?: boolean; rule?: string };
}

const CASES: Case[] = [
  {
    label: "Barolo",
    wine: { type: "red", appellation: "Barolo", countryCode: "IT" },
    expect: { tannin: atLeast(4.5), acidity: atLeast(4), body: atLeast(4) },
  },
  {
    label: "Muscadet Sèvre et Maine",
    wine: { type: "white", appellation: "Muscadet Sèvre et Maine sur lie", countryCode: "FR" },
    expect: { body: atMost(1.5), acidity: atLeast(4.5), oak: [0, 0] },
  },
  {
    label: "Mosel Riesling Kabinett",
    wine: {
      type: "white",
      region: "Mosel",
      appellation: "Mosel",
      name: "Wehlener Sonnenuhr Riesling Kabinett",
      countryCode: "DE",
    },
    expect: { sweetness: [2, 3], alcohol: [1, 1], acidity: atLeast(4.5), rule: "kabinett" },
  },
  {
    label: "Mosel Riesling Spätlese trocken is dry",
    wine: {
      type: "white",
      appellation: "Mosel",
      name: "Riesling Spätlese trocken",
      countryCode: "DE",
    },
    expect: { sweetness: atMost(0.5), alcohol: atLeast(2), rule: "trocken" },
  },
  {
    label: "Rheingau Riesling Spätlese is sweet",
    wine: { type: "white", appellation: "Rheingau", name: "Riesling Spätlese", countryCode: "DE" },
    expect: { sweetness: [2.5, 3.5], alcohol: atMost(1.5) },
  },
  {
    label: "Großes Gewächs is dry and fuller",
    wine: { type: "white", region: "Pfalz", name: "Riesling Großes Gewächs", countryCode: "DE" },
    expect: { sweetness: atMost(0.5), body: atLeast(3), rule: "grosses gewachs" },
  },
  {
    label: "Sauternes",
    wine: { type: "dessert", appellation: "Sauternes", countryCode: "FR" },
    expect: { sweetness: atLeast(4.5), body: atLeast(4) },
  },
  {
    label: "Fino",
    wine: {
      type: "fortified",
      appellation: "Jerez-Xérès-Sherry",
      name: "Tio Pepe Fino",
      countryCode: "ES",
    },
    expect: { sweetness: [0, 0], alcohol: [4, 4], body: atMost(2.5), rule: "fino" },
  },
  {
    label: "Manzanilla",
    wine: { type: "fortified", appellation: "Manzanilla-Sanlúcar de Barrameda", countryCode: "ES" },
    expect: { sweetness: [0, 0], body: atMost(2.5) },
  },
  {
    label: "Oloroso is dry but full",
    wine: { type: "fortified", appellation: "Jerez", name: "Oloroso", countryCode: "ES" },
    expect: { sweetness: atMost(0.5), body: atLeast(3.5), intensity: atLeast(4.5) },
  },
  {
    label: "Pedro Ximénez",
    wine: { type: "fortified", name: "Pedro Ximénez 1927", countryCode: "ES" },
    expect: { sweetness: [5, 5], body: atLeast(4.5) },
  },
  {
    label: "Cream sherry",
    wine: { type: "fortified", name: "Harveys Bristol Cream", countryCode: "ES" },
    expect: { sweetness: atLeast(3.5) },
  },
  {
    label: "Vintage port",
    wine: {
      type: "fortified",
      appellation: "Porto",
      name: "Taylor's Vintage Port 2011",
      countryCode: "PT",
    },
    expect: { sweetness: atLeast(4), tannin: atLeast(3), alcohol: [4, 4], rule: "vintage port" },
  },
  {
    label: "20 year old tawny",
    wine: {
      type: "fortified",
      appellation: "Porto",
      name: "Graham's 20 Year Old Tawny",
      countryCode: "PT",
    },
    expect: {
      tannin: atMost(1.5),
      oak: atLeast(1.2),
      sweetness: atLeast(3.5),
      rule: "aged tawny 20",
    },
  },
  {
    label: "Madeira Malmsey",
    wine: {
      type: "fortified",
      appellation: "Madeira",
      name: "Blandy's 10 Year Old Malmsey",
      countryCode: "PT",
    },
    expect: { acidity: atLeast(4.5), sweetness: atLeast(4), rule: "malmsey" },
  },
  {
    label: "Beaujolais",
    wine: { type: "red", appellation: "Beaujolais", countryCode: "FR" },
    expect: { tannin: atMost(2), body: atMost(2.5) },
  },
  {
    label: "Napa Cabernet",
    wine: {
      type: "red",
      appellation: "Napa Valley",
      name: "Cabernet Sauvignon",
      countryCode: "US",
    },
    expect: { body: atLeast(4.5), tannin: atLeast(4), alcohol: [3, 3] },
  },
  {
    label: "Condrieu",
    wine: { type: "white", appellation: "Condrieu", countryCode: "FR" },
    expect: { acidity: atMost(2.5), body: atLeast(3.5), intensity: atLeast(4) },
  },
  {
    label: "Alsace Gewurztraminer",
    wine: { type: "white", appellation: "Alsace", name: "Gewurztraminer", countryCode: "FR" },
    expect: { intensity: [5, 5], acidity: atMost(2.5), sweetness: [1, 2.5] },
  },
  {
    label: "Alsace Riesling stays fresh",
    wine: { type: "white", appellation: "Alsace", name: "Riesling", countryCode: "FR" },
    expect: { acidity: atLeast(4.5), intensity: atLeast(3.5) },
  },
  {
    label: "Champagne",
    wine: { type: "sparkling", appellation: "Champagne", countryCode: "FR" },
    expect: { fizz: true, acidity: atLeast(4.5) },
  },
  {
    label: "Champagne Blanc de Blancs",
    wine: {
      type: "sparkling",
      appellation: "Champagne",
      name: "Blanc de Blancs Brut",
      countryCode: "FR",
    },
    expect: { fizz: true, acidity: atLeast(4.7), rule: "blanc de blancs" },
  },
  {
    label: "Brut nature",
    wine: { type: "sparkling", appellation: "Champagne", name: "Brut Nature", countryCode: "FR" },
    expect: { sweetness: atMost(0.3) },
  },
  {
    label: "Prosecco",
    wine: { type: "sparkling", appellation: "Prosecco", countryCode: "IT" },
    expect: { sweetness: atLeast(1), fizz: true },
  },
  {
    label: "Cava",
    wine: { type: "sparkling", appellation: "Cava", countryCode: "ES" },
    expect: { sweetness: atMost(1), fizz: true, acidity: atLeast(4) },
  },
  {
    label: "Moscato d'Asti",
    wine: { type: "sparkling", appellation: "Moscato d'Asti", countryCode: "IT" },
    expect: { alcohol: [1, 1], sweetness: atLeast(3), fizz: true },
  },
  {
    label: "Lambrusco filed as red still sparkles",
    wine: { type: "red", appellation: "Lambrusco Grasparossa di Castelvetro", countryCode: "IT" },
    expect: { fizz: true, tannin: atMost(2.5) },
  },
  {
    label: "Amarone",
    wine: { type: "red", appellation: "Amarone della Valpolicella Classico", countryCode: "IT" },
    expect: { body: [5, 5], alcohol: [3, 3], sweetness: [1, 1.5] },
  },
  {
    label: "Chianti",
    wine: { type: "red", appellation: "Chianti", countryCode: "IT" },
    expect: { acidity: atLeast(4), tannin: [3, 4] },
  },
  {
    label: "Provence rosé",
    wine: { type: "rose", region: "Provence", appellation: "Côtes de Provence", countryCode: "FR" },
    expect: { body: atMost(2), tannin: atMost(0.5) },
  },
  {
    label: "Tavel is a fuller rosé",
    wine: { type: "rose", appellation: "Tavel", countryCode: "FR" },
    expect: { body: atLeast(2.5) },
  },
  {
    label: "Meursault",
    wine: { type: "white", appellation: "Meursault", countryCode: "FR" },
    expect: { oak: atLeast(1.5), body: atLeast(3.5) },
  },
  {
    label: "Chablis",
    wine: { type: "white", appellation: "Chablis", countryCode: "FR" },
    expect: { oak: atMost(0.5), body: atMost(2.5), acidity: atLeast(4.3) },
  },
  {
    label: "Rioja Reserva",
    wine: {
      type: "red",
      appellation: "Rioja",
      name: "Marqués de Murrieta Rioja Reserva",
      countryCode: "ES",
    },
    expect: { oak: atLeast(2), rule: "rioja reserva" },
  },
  {
    label: "Ribera del Duero Gran Reserva",
    wine: { type: "red", appellation: "Ribera del Duero", name: "Gran Reserva", countryCode: "ES" },
    expect: { oak: atLeast(2.5), body: atLeast(4), rule: "gran reserva" },
  },
  {
    label: "Châteauneuf-du-Pape",
    wine: { type: "red", appellation: "Châteauneuf-du-Pape", countryCode: "FR" },
    expect: { alcohol: [3, 3], body: atLeast(4.5) },
  },
  {
    label: "Châteauneuf-du-Pape blanc is soft",
    wine: { type: "white", appellation: "Châteauneuf-du-Pape", countryCode: "FR" },
    expect: { acidity: atMost(3), body: atLeast(3.5) },
  },
  {
    label: "Mendoza Malbec",
    wine: { type: "red", region: "Mendoza", name: "Malbec", countryCode: "AR" },
    expect: { body: atLeast(4), tannin: [3.5, 4.5] },
  },
  {
    label: "Red Sancerre is light",
    wine: { type: "red", appellation: "Sancerre", countryCode: "FR" },
    expect: { body: atMost(2.5), tannin: atMost(2) },
  },
  {
    label: "Albariño Rías Baixas",
    wine: { type: "white", appellation: "Rías Baixas", name: "Albariño", countryCode: "ES" },
    expect: { acidity: atLeast(4), oak: atMost(0.3) },
  },
  {
    label: "Grüner Veltliner Wachau Smaragd",
    wine: {
      type: "white",
      appellation: "Wachau",
      name: "Grüner Veltliner Smaragd",
      countryCode: "AT",
    },
    expect: { body: atLeast(3.5), alcohol: atLeast(2.5), sweetness: atMost(0.5), rule: "smaragd" },
  },
  {
    label: "Grüner Veltliner Wachau Federspiel",
    wine: {
      type: "white",
      appellation: "Wachau",
      name: "Grüner Veltliner Federspiel",
      countryCode: "AT",
    },
    expect: { body: [2, 3], acidity: atLeast(4) },
  },
  {
    label: "Vouvray without a sweetness word sits in the middle",
    wine: { type: "white", appellation: "Vouvray", countryCode: "FR" },
    expect: { sweetness: [1, 2] },
  },
  {
    label: "Vouvray demi-sec",
    wine: { type: "white", appellation: "Vouvray", name: "Vouvray Demi-Sec", countryCode: "FR" },
    expect: { sweetness: atLeast(2) },
  },
  {
    label: "Savennières",
    wine: { type: "white", appellation: "Savennières", countryCode: "FR" },
    expect: { sweetness: atMost(0.5), acidity: atLeast(4.5) },
  },
  {
    label: "Jurançon is sweet unless sec",
    wine: { type: "white", appellation: "Jurançon", countryCode: "FR" },
    expect: { sweetness: atLeast(3.5) },
  },
  {
    label: "Jurançon sec",
    wine: { type: "white", appellation: "Jurançon Sec", countryCode: "FR" },
    expect: { sweetness: atMost(0.5) },
  },
  {
    label: "Tokaji Aszú",
    wine: { type: "dessert", appellation: "Tokaji", name: "Aszú 6 Puttonyos", countryCode: "HU" },
    expect: { sweetness: atLeast(4.5), acidity: atLeast(4.5) },
  },
  {
    label: "Dry Tokaji Furmint",
    wine: { type: "white", appellation: "Tokaji", name: "Furmint", countryCode: "HU" },
    expect: { sweetness: atMost(0.7), acidity: atLeast(4.5) },
  },
  {
    label: "Banyuls",
    wine: { type: "fortified", appellation: "Banyuls", countryCode: "FR" },
    expect: { sweetness: atLeast(3.5), tannin: atLeast(2), alcohol: [4, 4] },
  },
  {
    label: "Eiswein",
    wine: { type: "dessert", region: "Rheinhessen", name: "Riesling Eiswein", countryCode: "DE" },
    expect: { sweetness: atLeast(4.5), acidity: atLeast(4.5) },
  },
  {
    label: "Hunter Valley Semillon",
    wine: { type: "white", appellation: "Hunter Valley", name: "Semillon", countryCode: "AU" },
    expect: { alcohol: atMost(1.5), body: atMost(2), oak: atMost(0.3) },
  },
  {
    label: "Marlborough Sauvignon Blanc",
    wine: { type: "white", region: "Marlborough", name: "Sauvignon Blanc", countryCode: "NZ" },
    expect: { intensity: atLeast(4), acidity: atLeast(4) },
  },
  {
    label: "Barossa Shiraz",
    wine: { type: "red", appellation: "Barossa Valley", name: "Shiraz", countryCode: "AU" },
    expect: { body: atLeast(4.5), alcohol: [3, 3] },
  },
  {
    label: "Madiran",
    wine: { type: "red", appellation: "Madiran", countryCode: "FR" },
    expect: { tannin: atLeast(4.5) },
  },
  {
    label: "Pinot Grigio delle Venezie",
    wine: { type: "white", appellation: "Pinot Grigio delle Venezie", countryCode: "IT" },
    expect: { body: atMost(2), intensity: atMost(2) },
  },
  {
    label: "Santorini",
    wine: { type: "white", appellation: "Santorini", countryCode: "GR" },
    expect: { acidity: atLeast(4.5) },
  },
  {
    label: "Naoussa",
    wine: { type: "red", appellation: "Naoussa", countryCode: "GR" },
    expect: { tannin: atLeast(4), acidity: atLeast(4) },
  },
  {
    label: "Pinot noir by grape alone",
    wine: { type: "red", name: "Spätburgunder" },
    expect: { tannin: atMost(2.5), acidity: atLeast(3.5), rule: "pinot noir" },
  },
  {
    label: "Nebbiolo by grape alone",
    wine: { type: "red", name: "Nebbiolo" },
    expect: { tannin: atLeast(4.5) },
  },
];

describe("readWine with the knowledge: coarse outcomes", () => {
  it("has at least 45 cases", () => expect(CASES.length).toBeGreaterThanOrEqual(45));
  for (const c of CASES) {
    it(c.label, () => {
      const r = read(c.wine);
      const { fizz, rule, ...ranges } = c.expect;
      for (const [axis, range] of Object.entries(ranges))
        within(r.structure[axis as keyof typeof LIMITS], range as Range, `${c.label} ${axis}`);
      if (fizz !== undefined) expect(r.structure.fizz, c.label).toBe(fizz);
      if (rule !== undefined) expect(r.rules, c.label).toContain(rule);
    });
  }

  const s = (wine: Case["wine"]) => read(wine).structure;
  it("orders the lighter and fuller wines of one place", () => {
    const fr = (type: WineInput["type"], appellation: string) =>
      s({ type, appellation, countryCode: "FR" });
    const itx = (appellation: string) => s({ type: "red", appellation, countryCode: "IT" });
    expect(fr("white", "Petit Chablis").body).toBeLessThan(fr("white", "Chablis").body);
    expect(fr("white", "Chablis").body).toBeLessThan(fr("white", "Chablis Grand Cru").body);
    expect(fr("white", "Muscadet").body).toBeLessThan(fr("white", "Meursault").body);
    expect(fr("red", "Fleurie").body).toBeLessThan(fr("red", "Morgon").body);
    expect(fr("red", "Margaux").tannin).toBeLessThan(fr("red", "Pauillac").tannin);
    expect(fr("red", "Pomerol").tannin).toBeLessThan(fr("red", "Pauillac").tannin);
    expect(fr("red", "Crozes-Hermitage").tannin).toBeLessThan(fr("red", "Hermitage").tannin);
    expect(fr("red", "Volnay").body).toBeLessThan(fr("red", "Pommard").body);
    expect(itx("Valpolicella").body).toBeLessThan(itx("Valpolicella Ripasso").body);
    expect(itx("Valpolicella Ripasso").body).toBeLessThan(itx("Amarone della Valpolicella").body);
    expect(itx("Rosso di Montalcino").tannin).toBeLessThan(itx("Brunello di Montalcino").tannin);
    expect(itx("Langhe Nebbiolo").tannin).toBeLessThan(itx("Barolo").tannin);
    const wachau = (name: string) =>
      s({ type: "white", appellation: "Wachau", name, countryCode: "AT" });
    expect(wachau("Steinfeder").body).toBeLessThan(wachau("Federspiel").body);
    expect(wachau("Federspiel").body).toBeLessThan(wachau("Smaragd").body);
    const de = (name: string) =>
      s({ type: "white", appellation: "Mosel", name, countryCode: "DE" });
    expect(de("Riesling trocken").sweetness).toBeLessThan(de("Riesling Kabinett").sweetness);
    expect(de("Riesling Kabinett").sweetness).toBeLessThan(de("Riesling Spätlese").sweetness);
    expect(de("Riesling Spätlese").sweetness).toBeLessThan(de("Riesling Auslese").sweetness);
  });

  it("leaves an orange wine alone when only white rules would match", () => {
    const plain = read({ type: "orange" });
    const r = read({
      type: "orange",
      appellation: "Chablis",
      name: "Chardonnay",
      countryCode: "FR",
    });
    expect(r.rules).toEqual([]);
    expect(r.colourOnly).toBe(true);
    expect(r.structure).toEqual(plain.structure);
    expect(r.structure.tannin).toBeGreaterThan(1);
    const ribolla = read({
      type: "orange",
      region: "Friuli",
      name: "Ribolla Gialla",
      countryCode: "IT",
    });
    expect(ribolla.rules).toContain("ribolla gialla");
    expect(ribolla.structure.tannin).toBeGreaterThanOrEqual(2);
    expect(ribolla.keys).toContain("orange");
  });

  it("gives the classics vocabulary: colour, grape, region and style", () => {
    const r = read({ type: "white", appellation: "Sancerre", countryCode: "FR" });
    expect(r.keys).toEqual(
      expect.arrayContaining(["white", "sancerre", "sauvignon blanc", "loire", "crisp white"]),
    );
    const b = read({ type: "red", appellation: "Barolo", countryCode: "IT" });
    expect(b.keys).toEqual(
      expect.arrayContaining(["red", "barolo", "nebbiolo", "piedmont", "tannic red"]),
    );
  });
});

describe("readWine with the knowledge: evidence tiers", () => {
  const exactProfile: WineProfileFacts = {
    structure: { body: 5, tannin: 1, sweetness: 1, acidity: 2 },
    grapes: [],
    exact: true,
    evidence: "exact_wine",
  };

  it("a recorded appellation is appellation-tier", () => {
    const r = read({ type: "red", appellation: "Barolo", countryCode: "IT" });
    expect(r.tier).toBe("appellation");
    expect(r.fromName).toBe(false);
    expect(r.colourOnly).toBe(false);
  });

  it("only a region recorded is an estimate", () => {
    const r = read({ type: "white", region: "Loire", countryCode: "FR" });
    expect(r.tier).toBe("estimate");
    expect(r.rules).toEqual(["loire"]);
  });

  it("only a country recorded is an estimate", () => {
    const r = read({ type: "red", countryCode: "FR" });
    expect(r.tier).toBe("estimate");
    expect(r.colourOnly).toBe(true);
  });

  it("a name alone shapes the guess without raising the tier", () => {
    const r = read({ type: "white", name: "Domaine Vacheron Sancerre 2022" });
    expect(r.tier).toBe("unknown");
    expect(r.fromName).toBe(true);
    expect(r.rules).toContain("sancerre");
    expect(r.structure.acidity).toBeGreaterThanOrEqual(4.3);
    expect(r.structure.body).toBeLessThanOrEqual(2.5);
  });

  it("nothing at all is colour only", () => {
    const r = read({ type: "red" });
    expect(r.tier).toBe("unknown");
    expect(r.colourOnly).toBe(true);
    expect(r.rules).toEqual([]);
  });

  it("an exact profile wins with its own numbers", () => {
    const r = read({
      type: "red",
      appellation: "Barolo",
      countryCode: "IT",
      profile: exactProfile,
    });
    expect(r.tier).toBe("exact");
    expect(r.structure.body).toBe(5);
    expect(r.structure.acidity).toBe(2);
    expect(r.structure.tannin).toBeLessThan(1);
    expect(r.structure.sweetness).toBeLessThan(1);
  });

  it("what a profile says about its own evidence never raises the tier, and never overrules a rule", () => {
    const r = read({
      type: "white",
      region: "Loire",
      countryCode: "FR",
      profile: {
        structure: { body: 5, tannin: null, sweetness: null, acidity: null },
        grapes: ["Chenin Blanc"],
        exact: false,
        evidence: "producer",
      },
    });
    // Only a region is recorded: an estimate, whatever the profile claims to rest on.
    expect(r.tier).toBe("estimate");
    expect(r.structure.body).toBeLessThan(4);
    expect(r.rules).toEqual(["loire", "chenin blanc"]);
  });

  it("a weak profile cannot turn a Sauternes dry", () => {
    const r = read({
      type: "dessert",
      appellation: "Sauternes",
      region: "Bordeaux",
      countryCode: "FR",
      profile: {
        structure: { body: null, tannin: null, sweetness: 1, acidity: null },
        grapes: [],
        exact: false,
        evidence: "style_estimate",
      },
    });
    expect(r.tier).toBe("appellation");
    expect(r.structure.sweetness).toBeGreaterThanOrEqual(4.5);
  });

  it("an exact profile that states one number is not knowledge of the whole wine", () => {
    const profile = (structure: {
      body: number;
      tannin: number | null;
      sweetness: number | null;
      acidity: number | null;
    }) =>
      read({
        type: "red",
        appellation: "Barolo",
        countryCode: "IT",
        profile: { structure, grapes: [], exact: true, evidence: "exact_wine" },
      });
    const one = profile({ body: 4, tannin: null, sweetness: null, acidity: null });
    expect(one.tier).toBe("appellation");
    expect(one.structure.body).toBe(4);
    expect(profile({ body: 4, tannin: 5, sweetness: 1, acidity: 4 }).tier).toBe("exact");
  });

  it("reads a country code however it is spelled", () => {
    const r = read({ type: "white", appellation: "Sancerre", countryCode: "fr" });
    expect(r.colourOnly).toBe(false);
    expect(r.tier).toBe("appellation");
  });
});

describe("readWine with the knowledge: names that collide", () => {
  const rulesOf = (wine: Case["wine"]) => read(wine).rules;
  /** The rules of one kind that apply, read with only that kind's rules. */
  const ruleOfKind = (wine: Case["wine"], kind: WineStyleRule["kind"]) =>
    readWine(
      { name: null, region: null, appellation: null, countryCode: null, ...wine },
      { rules: RULES.filter((r) => r.kind === kind) },
    ).rules;
  const appellationOf = (wine: Case["wine"]) => ruleOfKind(wine, "appellation");

  it("Barbera d'Asti is not Moscato or Asti", () => {
    const r = read({ type: "red", appellation: "Barbera d'Asti Superiore", countryCode: "IT" });
    expect(r.rules).toContain("barbera d asti");
    expect(r.rules).not.toContain("asti");
    expect(r.rules).not.toContain("moscato d asti");
    expect(r.structure.sweetness).toBeLessThanOrEqual(0.5);
    expect(r.structure.fizz).toBe(false);
    // Even a bottle filed as sparkling under that name does not become a sweet Asti.
    expect(
      rulesOf({ type: "sparkling", appellation: "Barbera d'Asti", countryCode: "IT" }),
    ).not.toContain("asti");
  });

  it("Petit Chablis is not Chablis", () => {
    expect(
      ruleOfKind({ type: "white", appellation: "Petit Chablis", countryCode: "FR" }, "appellation"),
    ).toEqual(["petit chablis"]);
    expect(
      ruleOfKind(
        { type: "white", appellation: "Chablis 1er Cru", countryCode: "FR" },
        "appellation",
      ),
    ).toEqual(["chablis premier cru"]);
  });

  it("Pouilly-Fumé is not Pouilly-Fuissé", () => {
    const fume = read({ type: "white", appellation: "Pouilly-Fumé", countryCode: "FR" });
    const fuisse = read({ type: "white", appellation: "Pouilly-Fuissé", countryCode: "FR" });
    expect(fume.rules).toEqual(["pouilly fume"]);
    expect(fuisse.rules).toEqual(["pouilly fuisse"]);
    expect(fume.keys).toContain("sauvignon blanc");
    expect(fuisse.keys).toContain("chardonnay");
    expect(fume.structure.acidity).toBeGreaterThan(fuisse.structure.acidity);
    expect(fume.structure.oak).toBeLessThan(fuisse.structure.oak);
  });

  it("Rosso di Montalcino is not Brunello", () => {
    expect(rulesOf({ type: "red", appellation: "Rosso di Montalcino", countryCode: "IT" })).toEqual(
      ["rosso di montalcino"],
    );
    expect(
      rulesOf({ type: "red", appellation: "Brunello di Montalcino", countryCode: "IT" }),
    ).toEqual(["brunello di montalcino"]);
  });

  it("Vino Nobile di Montepulciano is sangiovese, Montepulciano d'Abruzzo is montepulciano", () => {
    const nobile = read({ type: "red", name: "Vino Nobile di Montepulciano", countryCode: "IT" });
    expect(nobile.rules).toEqual(["sangiovese", "vino nobile di montepulciano"]);
    const abruzzo = read({ type: "red", name: "Montepulciano d'Abruzzo", countryCode: "IT" });
    expect(abruzzo.rules).toEqual(["abruzzo", "montepulciano", "montepulciano d abruzzo"]);
  });

  it("Côtes du Rhône Villages is not plain Côtes du Rhône", () => {
    expect(
      appellationOf({ type: "red", appellation: "Côtes du Rhône Villages", countryCode: "FR" }),
    ).toEqual(["cotes du rhone villages"]);
    expect(
      appellationOf({ type: "red", appellation: "Côtes du Rhône", countryCode: "FR" }),
    ).toEqual(["cotes du rhone"]);
  });

  it("a white Rioja gets the white rule and a red Sancerre the red one", () => {
    const rioja = read({ type: "white", appellation: "Rioja", countryCode: "ES" });
    expect(rioja.rules).toEqual(["rioja", "rioja"]);
    expect(rioja.structure.tannin).toBe(0);
    expect(rioja.keys).toContain("viura");
    const sancerre = read({ type: "red", appellation: "Sancerre", countryCode: "FR" });
    expect(sancerre.keys).toContain("pinot noir");
    expect(sancerre.structure.tannin).toBeGreaterThan(1);
  });

  it("a French name on a wine from elsewhere does not get the French rule", () => {
    expect(rulesOf({ type: "red", name: "Hermitage", countryCode: "ES" })).not.toContain(
      "hermitage",
    );
    expect(rulesOf({ type: "red", name: "Hermitage", countryCode: "AU" })).not.toContain(
      "hermitage",
    );
    expect(rulesOf({ type: "red", name: "Hermitage", countryCode: "FR" })).toContain("hermitage");
    expect(
      rulesOf({ type: "sparkling", name: "California Champagne", countryCode: "US" }),
    ).not.toContain("champagne");
  });

  it("a name word from another country does not refine a recorded appellation", () => {
    // "Concha y Toro" is a Chilean producer, not the Spanish appellation Toro.
    const r = read({
      type: "red",
      region: "Maipo",
      name: "Concha y Toro Marqués de Casa Concha Cabernet Sauvignon",
    });
    expect(r.rules).toContain("maipo");
    expect(r.rules).not.toContain("toro");
  });

  it("the longer appellation wins inside a name", () => {
    const one = (appellation: string, type: WineInput["type"] = "red") =>
      ruleOfKind({ type, appellation, countryCode: "FR" }, "appellation");
    expect(one("Crozes-Hermitage")).toEqual(["crozes hermitage"]);
    expect(one("Montagne-Saint-Émilion")).toEqual(["saint emilion satellites"]);
    expect(one("St-Émilion Grand Cru")).toEqual(["saint emilion"]);
    expect(one("Chambolle-Musigny")).toEqual(["chambolle musigny"]);
    expect(one("Musigny")).toEqual(["cote de nuits grand cru"]);
    expect(one("Puligny-Montrachet", "white")).toEqual(["puligny montrachet"]);
    expect(one("Bâtard-Montrachet", "white")).toEqual(["montrachet grand cru"]);
    expect(one("Côte de Brouilly")).toEqual(["cote de brouilly"]);
    expect(one("Beaujolais-Villages")).toEqual(["beaujolais villages"]);
    expect(one("Bordeaux Supérieur")).toEqual(["bordeaux superieur"]);
    expect(one("Haut-Médoc")).toEqual(["haut medoc"]);
    expect(one("Lalande-de-Pomerol")).toEqual(["lalande de pomerol"]);
    expect(one("Muscat de Beaumes-de-Venise", "fortified")).toEqual(["vin doux naturel muscat"]);
    expect(one("Beaumes-de-Venise")).toEqual(["southern rhone crus"]);
  });

  it("the longer grape name wins", () => {
    const grape = (name: string, type: WineInput["type"] = "red") =>
      ruleOfKind({ type, name }, "grape");
    expect(grape("Cabernet Franc")).toEqual(["cabernet franc"]);
    expect(grape("Cabernet")).toEqual(["cabernet sauvignon"]);
    expect(grape("Grenache Blanc", "white")).toEqual(["grenache blanc"]);
    expect(grape("Petite Sirah")).toEqual(["petite sirah"]);
  });

  it("a less specific name does not undo a recorded appellation", () => {
    const r = read({
      type: "red",
      appellation: "Valpolicella Ripasso",
      name: "Valpolicella Classico Superiore",
      countryCode: "IT",
    });
    expect(
      ruleOfKind(
        {
          type: "red",
          appellation: "Valpolicella Ripasso",
          name: "Valpolicella",
          countryCode: "IT",
        },
        "appellation",
      ),
    ).toEqual(["valpolicella ripasso"]);
    expect(r.structure.body).toBeGreaterThanOrEqual(3.5);
  });

  it("Spätlese trocken is dry, Spätlese alone is not", () => {
    const de = (name: string) => read({ type: "white", name, countryCode: "DE" });
    expect(de("Riesling Spätlese trocken").rules).toContain("trocken");
    expect(de("Riesling Spätlese").rules).toContain("spatlese");
    expect(de("Riesling Kabinett feinherb").rules).toContain("feinherb");
    expect(de("Riesling Trockenbeerenauslese").rules).not.toContain("trocken");
  });
});
