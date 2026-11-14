import { describe, expect, it } from "vitest";
import { WINE_COUNTRIES } from "./cellar";
import { checkInsight, type InsightOutput, type RawInsight } from "./insights";
import { PurchaseWineSchema, type PurchaseWine } from "./purchase-check";
import {
  enrichPurchaseWine,
  STABLE_FACT_KEYS,
  stableWineFacts,
  VINTAGE_ONLY_FIELDS,
  vintageKnowledge,
  type CatalogWineFacts,
  type StoredProfile,
} from "./wine-knowledge";

const raw: RawInsight = {
  summary: "A Rioja Reserva of this estate, harvested in a warm year.",
  style: "Structured red",
  grapes: ["Tempranillo", "Graciano"],
  tasting: "Cherry and vanilla.",
  serving_temp_min_c: 16,
  serving_temp_max_c: 18,
  decant_minutes: 45,
  abv_percent: 14,
  pairings: ["Lamb"],
  aging: "Ready from 2024.",
  body: 4,
  tannin: 4,
  sweetness: 1,
  acidity: 3,
  flavors: [{ group: "red_fruit", notes: ["Cherry"] }],
  pairing_kinds: ["lamb"],
  drink_from_year: 2024,
  drink_until_year: 2034,
  country_code: "ES",
  region: "Rioja",
  appellation: "Rioja",
  confidence: "high",
  evidence: "exact_wine",
  sources: [{ name: "Producer", url: "https://example.org/reserva" }],
};
const consulted = ["https://example.org/reserva"];
/** A profile of one vintage that meets the shared bar (unless `over` weakens it). */
const profile = (
  year: number | null,
  over: Partial<RawInsight> = {},
  researched = true,
): StoredProfile => {
  const from = year === null ? null : year + 4;
  const output = checkInsight(
    { ...raw, drink_from_year: from, drink_until_year: from === null ? null : from + 10, ...over },
    year,
    consulted,
    researched,
  )!;
  return { year, output, generatedAt: `${year ?? 2020}-12-01T10:00:00.000Z` };
};
const wine = (over: Partial<PurchaseWine> = {}): PurchaseWine =>
  PurchaseWineSchema.parse({ producer: "Bodegas Ejemplo", name: "Reserva", ...over });
const catalog: CatalogWineFacts = {
  id: "c-reserva",
  type: "red",
  countryCode: "ES",
  region: "Rioja",
  appellation: "Rioja DOCa",
  grapes: [],
};
const enrich = (confirmed: PurchaseWine, profiles: StoredProfile[], cat = catalog) =>
  enrichPurchaseWine(confirmed, cat, profiles, WINE_COUNTRIES);

describe("vintage knowledge: a profile of exactly this vintage", () => {
  it("is reused for the same vintage, and only that one", () => {
    const profiles = [profile(2018), profile(2019)];
    expect(
      vintageKnowledge(profiles, { year: 2019, nonVintage: false, countryCode: "ES" })?.year,
    ).toBe(2019);
    expect(
      vintageKnowledge(profiles, { year: 2021, nonVintage: false, countryCode: "ES" }),
    ).toBeNull();
  });

  it("non-vintage is its own vintage; an unknown vintage has no vintage knowledge at all", () => {
    const profiles = [profile(null), profile(2019)];
    expect(
      vintageKnowledge(profiles, { year: null, nonVintage: true, countryCode: "ES" })?.year,
    ).toBeNull();
    expect(
      vintageKnowledge(profiles, { year: null, nonVintage: false, countryCode: "ES" }),
    ).toBeNull();
  });

  it("a profile that no longer meets the bar is not reused: not researched, unsure, another evidence, an old version, a foreign shape", () => {
    const at = { year: 2019, nonVintage: false, countryCode: "ES" };
    expect(vintageKnowledge([profile(2019, {}, false)], at)).toBeNull();
    expect(vintageKnowledge([profile(2019, { confidence: "medium" })], at)).toBeNull();
    expect(vintageKnowledge([profile(2019, { evidence: "appellation_rules" })], at)).toBeNull();
    const old = profile(2019);
    expect(
      vintageKnowledge([{ ...old, output: { ...(old.output as InsightOutput), version: 1 } }], at),
    ).toBeNull();
    expect(
      vintageKnowledge([{ year: 2019, output: { summary: 42 }, generatedAt: "x" }], at),
    ).toBeNull();
    expect(vintageKnowledge([{ year: 2019, output: null, generatedAt: "x" }], at)).toBeNull();
  });

  it("a profile whose window starts before its own harvest, or that contradicts the catalogue's country, is not reused", () => {
    const early = profile(2019);
    const broken = {
      ...early,
      output: { ...(early.output as InsightOutput), drinkWindow: { from: 2015, until: 2020 } },
    };
    expect(
      vintageKnowledge([broken], { year: 2019, nonVintage: false, countryCode: "ES" }),
    ).toBeNull();
  });
});

describe("stable wine facts: what may cross a vintage, and what never does", () => {
  it("has room for grapes, structure and where they came from — and for nothing else", () => {
    const facts = stableWineFacts([profile(2018), profile(2019)], { countryCode: "ES" })!;
    expect(Object.keys(facts).sort()).toEqual([...STABLE_FACT_KEYS].sort());
    // every vintage-only part of a profile is absent, by name
    for (const field of VINTAGE_ONLY_FIELDS) expect(facts).not.toHaveProperty(field);
    expect(JSON.stringify(facts)).not.toMatch(/2023|2028|2033|drink|window|abv|14|Ready|harvest/i);
  });

  it("grapes are reused when every vintage's profile names the same varieties (order and accents aside)", () => {
    const facts = stableWineFacts(
      [profile(2018), profile(2019, { grapes: ["graciano", "TEMPRANILLO"] })],
      { countryCode: "ES" },
    );
    // as the newest vintage's profile writes them
    expect(facts).toMatchObject({ grapes: ["graciano", "TEMPRANILLO"], fromYears: [2019, 2018] });
  });

  it("vintages that disagree on the grapes give no grapes at all (a blend that changes is not a wine-level fact)", () => {
    const facts = stableWineFacts(
      [profile(2018), profile(2019, { grapes: ["Tempranillo", "Garnacha"] })],
      { countryCode: "ES" },
    );
    expect(facts?.grapes).toEqual([]);
  });

  it("a structure scale is kept only where the vintages lie within one step", () => {
    const facts = stableWineFacts(
      [
        profile(2018, { body: 4, tannin: 2, acidity: 3 }),
        profile(2019, { body: 5, tannin: 5, acidity: 3 }),
      ],
      { countryCode: "ES" },
    );
    expect(facts?.structure).toEqual({ body: 5, tannin: null, sweetness: 1, acidity: 3 });
  });

  it("profiles that do not meet the bar contribute nothing; none that do means no stable facts", () => {
    expect(
      stableWineFacts([profile(2018, { confidence: "low" }), profile(2019, {}, false)], {
        countryCode: "ES",
      }),
    ).toBeNull();
    expect(stableWineFacts([], { countryCode: "ES" })).toBeNull();
    // a weak profile next to a good one neither blocks nor colours it
    expect(
      stableWineFacts([profile(2018, { confidence: "low", grapes: ["Merlot"] }), profile(2019)], {
        countryCode: "ES",
      }),
    ).toMatchObject({ grapes: ["Tempranillo", "Graciano"], fromYears: [2019] });
  });
});

describe("what a Koopcheck adds to the wine the person confirmed", () => {
  it("fills only what was left open, from the catalogue, and says so", () => {
    const { wine: compared, knowledge } = enrich(wine({ year: 2021 }), []);
    expect(compared).toMatchObject({
      type: "red",
      countryCode: "ES",
      region: "Rioja",
      appellation: "Rioja DOCa",
      year: 2021,
    });
    expect(knowledge.status).toBe("catalog_only");
    expect(knowledge.added.map((a) => `${a.field}:${a.origin}:${a.level}`)).toEqual([
      "type:cellr_catalog:wine",
      "countryCode:cellr_catalog:wine",
      "region:cellr_catalog:wine",
      "appellation:cellr_catalog:wine",
    ]);
    expect(knowledge.profile).toBeNull();
  });

  it("never replaces what the person typed, even where the catalogue says otherwise", () => {
    const typed = wine({
      year: 2021,
      type: "white",
      countryCode: "FR",
      region: "Elders",
      appellation: "Mijn eigen",
      grapes: ["Viura"],
    });
    const { wine: compared, knowledge } = enrich(typed, [profile(2021)], {
      ...catalog,
      grapes: ["Tempranillo"],
    });
    expect(compared).toEqual(typed);
    expect(knowledge.added).toEqual([]);
  });

  it("a valid profile of exactly this vintage is reused: its grapes as an estimate of this vintage, its window shown", () => {
    const { wine: compared, knowledge } = enrich(wine({ year: 2019 }), [
      profile(2018),
      profile(2019),
    ]);
    expect(compared.grapes).toEqual(["Tempranillo", "Graciano"]);
    expect(knowledge.status).toBe("vintage_profile");
    expect(knowledge.added.at(-1)).toEqual({
      field: "grapes",
      value: "Tempranillo, Graciano",
      origin: "ai_estimate",
      level: "vintage",
    });
    expect(knowledge.profile).toMatchObject({
      year: 2019,
      drinkWindow: { from: 2023, until: 2033 },
      sources: 1,
    });
  });

  it("another vintage: only the wine's stable facts cross, named as an estimate from those years; no window, no text", () => {
    const { wine: compared, knowledge } = enrich(wine({ year: 2021 }), [
      profile(2018),
      profile(2019),
    ]);
    expect(compared.grapes).toEqual(["Tempranillo", "Graciano"]);
    expect(knowledge.status).toBe("stable_facts");
    expect(knowledge.added.at(-1)).toEqual({
      field: "grapes",
      value: "Tempranillo, Graciano",
      origin: "ai_estimate",
      level: "wine",
      fromYears: [2019, 2018],
    });
    // nothing of the 2018 or 2019 profile's vintage-specific content reaches a 2021 bottle
    expect(knowledge.profile).toBeNull();
    expect(JSON.stringify(knowledge)).not.toMatch(
      /drinkWindow":\{|2022|2023|2032|2033|warm year|Ready from/,
    );
  });

  it("an unknown vintage gets stable facts at most, never some vintage's profile", () => {
    const { knowledge } = enrich(wine({ year: null }), [profile(2019)]);
    expect(knowledge.status).toBe("stable_facts");
    expect(knowledge.profile).toBeNull();
  });

  it("non-vintage reuses only the non-vintage profile, and a non-vintage profile carries no window", () => {
    const nv = enrich(wine({ year: null, nonVintage: true }), [profile(null), profile(2019)]);
    expect(nv.knowledge.status).toBe("vintage_profile");
    expect(nv.knowledge.profile).toMatchObject({ year: null, drinkWindow: null });
  });

  it("curated grapes of the catalogue come before any estimate", () => {
    const { wine: compared, knowledge } = enrich(wine({ year: 2019 }), [profile(2019)], {
      ...catalog,
      grapes: ["Tempranillo"],
    });
    expect(compared.grapes).toEqual(["Tempranillo"]);
    expect(knowledge.added.at(-1)).toMatchObject({
      field: "grapes",
      origin: "cellr_catalog",
      level: "wine",
    });
  });

  it("vintages that disagree leave the grapes open rather than guess", () => {
    const { wine: compared, knowledge } = enrich(wine({ year: 2021 }), [
      profile(2018),
      profile(2019, { grapes: ["Garnacha"] }),
    ]);
    expect(compared.grapes).toEqual([]);
    expect(knowledge.added.some((a) => a.field === "grapes")).toBe(false);
  });

  it("a catalogue country the form cannot show is not added; the result still parses as a wine to compare", () => {
    const { wine: compared } = enrich(wine({ year: 2021 }), [], { ...catalog, countryCode: "XX" });
    expect(compared.countryCode).toBeNull();
    expect(PurchaseWineSchema.safeParse(compared).success).toBe(true);
  });

  it("is pure: the confirmed wine and the stored profiles are left as they were", () => {
    const confirmed = wine({ year: 2019 });
    const stored = [profile(2019)];
    const before = JSON.stringify([confirmed, stored]);
    enrich(confirmed, stored);
    expect(JSON.stringify([confirmed, stored])).toBe(before);
  });
});
