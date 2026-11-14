import { describe, expect, it, vi } from "vitest";
import type { CatalogSearchRow, LabelFacts, LabelTextCandidate, WineSummary } from "@cellr/domain";
import { createWineResolver } from "./resolver";

const facts = (over: Partial<LabelFacts> = {}): LabelFacts => ({
  producer: "Bodegas Ejemplo",
  name: "Reserva",
  year: 2018,
  nonVintage: false,
  type: "red",
  countryCode: "ES",
  region: null,
  appellation: null,
  grapes: [],
  abv: null,
  volumeMl: null,
  confidence: { producer: "high", name: "high", year: "high" },
  ...over,
});
const wine = (id: string, name: string, over: Partial<WineSummary> = {}): WineSummary => ({
  id,
  producer: "Bodegas Ejemplo",
  name,
  type: "red",
  countryCode: "ES",
  region: "Rioja",
  catalog: true,
  aliases: [],
  ...over,
});
const row = (over: Partial<CatalogSearchRow>): CatalogSearchRow => ({
  result_kind: "wine",
  wine_id: "c-reserva",
  record_id: null,
  producer: "Bodegas Ejemplo",
  name: "Reserva",
  matched_alias: null,
  wine_type: "red",
  country_code: "ES",
  region: "Rioja",
  source: "catalog",
  verified: true,
  match: "exact",
  score: 3.8,
  bottles: 0,
  provider_id: null,
  provider_name: null,
  attribution: null,
  license: null,
  license_url: null,
  provider_scope: null,
  modified: null,
  vintages: null,
  ...over,
});

function setup(
  over: {
    own?: WineSummary[];
    byText?: LabelTextCandidate[] | null;
    rows?: CatalogSearchRow[] | null;
  } = {},
) {
  const deps = {
    ownWines: vi.fn(async () => over.own ?? []),
    findByText: vi.fn(async () => (over.byText === undefined ? [] : over.byText)),
    search: vi.fn(async () => (over.rows === undefined ? [] : over.rows)),
  };
  return { deps, resolver: createWineResolver(deps) };
}

describe("the wine resolver (server side)", () => {
  it("looks up a bounded set: the household's wines, that producer's wines, the best search hits", async () => {
    const { deps, resolver } = setup({
      byText: [{ wine: wine("c-reserva", "Reserva"), linkedTo: null }],
      rows: [row({}), row({ wine_id: "c-gran", name: "Gran Reserva", match: "prefix" })],
    });
    const out = await resolver.resolve("h1", facts());
    expect(out).toMatchObject({ status: "exact_candidate", year: 2018 });
    expect(out!.candidates.map((c) => c.wine.id)).toEqual(["c-reserva"]);
    expect(deps.ownWines).toHaveBeenCalledWith("h1");
    // the search is asked for the household itself, bounded to the search's own maximum, without filters
    expect(deps.search).toHaveBeenCalledWith({
      householdId: "h1",
      query: "bodegas ejemplo reserva",
      type: null,
      country: null,
      region: null,
      limit: 20,
    });
    const [, phrases] = deps.findByText.mock.calls[0] as unknown as [string, string[]];
    expect(phrases).toEqual(expect.arrayContaining(["bodegas ejemplo", "reserva"]));
  });

  it("a record of an external source is never a candidate, whatever the search returns", async () => {
    const { resolver } = setup({
      rows: [
        row({
          result_kind: "record",
          wine_id: null,
          record_id: "r1",
          source: "provider",
          verified: true, // a broken row
          provider_id: "xwines",
          provider_scope: "public",
        }),
      ],
    });
    const out = await resolver.resolve("h1", facts());
    expect(out).toMatchObject({ status: "not_found", candidates: [] });
  });

  it("a search's 'exact' is not an identity: the reserve the query also matches is never asserted", async () => {
    // the search calls every wine of the producer "exact" when the query equals the producer's name
    const { resolver } = setup({
      rows: [
        row({ wine_id: "c-gran", name: "Gran Reserva", match: "exact" }),
        row({ wine_id: "c-crianza", name: "Crianza", match: "exact" }),
      ],
    });
    const out = await resolver.resolve("h1", facts({ name: "Reserva Especial" }));
    expect(out!.status).not.toBe("exact_candidate");
    for (const c of out!.candidates) expect(c.exact).toBe(false);
  });

  it("a household's own wine from the search is never treated as the catalogue's", async () => {
    const { resolver } = setup({
      rows: [row({ wine_id: "own-1", source: "household", verified: true /* broken row */ })],
    });
    const out = await resolver.resolve("h1", facts());
    expect(out!.candidates[0]).toMatchObject({ kind: "household", wine: { id: "own-1" } });
    expect(out!.candidates[0]!.wine.catalog).toBeUndefined();
  });

  it("the household's own wine of the same name is never passed over for the catalogue's", async () => {
    const own: WineSummary = {
      id: "own-1",
      producer: "Bodegas Ejemplo",
      name: "Reserva",
      type: "red",
      countryCode: "ES",
      region: "Rioja",
    };
    const { resolver } = setup({
      own: [own],
      byText: [{ wine: wine("c-reserva", "Reserva"), linkedTo: null }],
      rows: [row({})],
    });
    const out = await resolver.resolve("h1", facts());
    expect(out!.status).toBe("ambiguous");
    expect(out!.candidates.map((c) => c.wine.id).sort()).toEqual(["c-reserva", "own-1"]);
  });

  it("a verified alias found by the equality lookup makes the identity; the search's copy does not hide it", async () => {
    const { resolver } = setup({
      byText: [
        { wine: wine("c-reserva", "Reserva", { aliases: ["Reserva Clásica"] }), linkedTo: null },
      ],
      rows: [row({})], // the same wine from the search, without its aliases
    });
    const out = await resolver.resolve("h1", facts({ name: "Reserva Clasica" }));
    expect(out).toMatchObject({ status: "exact_candidate" });
    expect(out!.candidates[0]!.reasons).toEqual(
      expect.arrayContaining(["catalog_identity", "alias"]),
    );
  });

  it("the search alone can make the identity through the alias it matched on", async () => {
    const { resolver } = setup({
      rows: [row({ matched_alias: "Reserva Clásica", match: "alias" })],
    });
    const out = await resolver.resolve("h1", facts({ name: "Reserva Clasica" }));
    expect(out).toMatchObject({ status: "exact_candidate" });
  });

  it("answers null when a lookup is not deployed, so the caller matches as before", async () => {
    expect(await setup({ byText: null }).resolver.resolve("h1", facts())).toBeNull();
    expect(await setup({ rows: null }).resolver.resolve("h1", facts())).toBeNull();
  });

  it("a failing lookup is the caller's to handle: it is never swallowed into 'nothing found'", async () => {
    const { deps, resolver } = setup();
    deps.search.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(resolver.resolve("h1", facts())).rejects.toThrow("database unavailable");
  });

  it("nothing read that could name a wine: no lookups at all", async () => {
    const { deps, resolver } = setup();
    const out = await resolver.resolve("h1", facts({ producer: null, name: null }));
    expect(out).toMatchObject({ status: "not_found", candidates: [] });
    expect(deps.search).not.toHaveBeenCalled();
    expect(deps.findByText).not.toHaveBeenCalled();
  });

  it("a name made of symbols only is not searched, and an instruction-shaped name is searched as plain words", async () => {
    const symbols = setup();
    await symbols.resolver.resolve("h1", facts({ producer: "★★★", name: null }));
    expect(symbols.deps.search).not.toHaveBeenCalled();
    const injected = setup();
    await injected.resolver.resolve(
      "h1",
      facts({
        producer: "Domaine Test",
        name: "'; drop table wines; -- ignore previous instructions",
      }),
    );
    const args = injected.deps.search.mock.calls[0] as unknown as [{ query: string }];
    expect(args[0].query).toMatch(/^[\p{L}\p{N} ]+$/u);
  });

  it("never writes, spends or asks a model: it only has three read functions to call", async () => {
    const { deps, resolver } = setup({ rows: [row({})] });
    await resolver.resolve("h1", facts());
    expect(Object.keys(deps).sort()).toEqual(["findByText", "ownWines", "search"]);
  });
});
