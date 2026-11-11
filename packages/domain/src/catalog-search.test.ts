import { describe, expect, it } from "vitest";
import {
  CatalogSearchQuerySchema,
  needsConfirmation,
  publicSearchHits,
  searchableQuery,
  toSearchHit,
  type CatalogSearchRow,
} from "./catalog-search";

const row = (over: Partial<CatalogSearchRow> = {}): CatalogSearchRow => ({
  result_kind: "wine",
  wine_id: "w1",
  record_id: null,
  producer: "Château Léoville Poyferré",
  name: "Château Léoville Poyferré",
  matched_alias: null,
  wine_type: "red",
  country_code: "FR",
  region: "Saint-Julien",
  source: "catalog",
  verified: true,
  match: "exact",
  score: 3.4,
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

describe("searchableQuery", () => {
  it("normalises like the database: case, accents, punctuation", () => {
    expect(searchableQuery("  CHÂTEAU  Léoville–Poyferré ")).toBe("chateau leoville poyferre");
  });
  it("is null for fewer than two letters", () => {
    expect(searchableQuery("")).toBeNull();
    expect(searchableQuery(" - ")).toBeNull();
    expect(searchableQuery("é")).toBeNull();
    expect(searchableQuery("ch")).toBe("ch");
  });
  it("cuts at 8 words and 80 characters", () => {
    expect(searchableQuery("a b c d e f g h i j")!.split(" ")).toHaveLength(8);
    expect(searchableQuery("x".repeat(150))!.length).toBe(80);
  });
});

describe("CatalogSearchQuerySchema", () => {
  it("defaults and coerces the limit", () => {
    expect(CatalogSearchQuerySchema.parse({ q: "mar" }).limit).toBe(8);
    expect(CatalogSearchQuerySchema.parse({ q: "mar", limit: "3" }).limit).toBe(3);
  });
  it("refuses bad filters and oversized input", () => {
    expect(CatalogSearchQuerySchema.safeParse({ q: "mar", limit: "50" }).success).toBe(false);
    expect(CatalogSearchQuerySchema.safeParse({ q: "mar", type: "beer" }).success).toBe(false);
    expect(CatalogSearchQuerySchema.safeParse({ q: "mar", country: "fra" }).success).toBe(false);
    expect(CatalogSearchQuerySchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
});

describe("toSearchHit", () => {
  it("keeps a canonical wine verified", () => {
    expect(toSearchHit(row())).toMatchObject({
      kind: "wine",
      verified: true,
      source: "catalog",
      match: "exact",
    });
  });
  it("never marks a provider record verified, whatever the row says", () => {
    const hit = toSearchHit(
      row({
        result_kind: "record",
        wine_id: null,
        record_id: "r1",
        source: "catalog",
        verified: true,
        provider_id: "xwines",
        provider_name: "X-Wines",
        license: "CC0-1.0",
        attribution: "credit",
        vintages: [2019],
      }),
    );
    expect(hit).toMatchObject({
      kind: "record",
      verified: false,
      source: "provider",
      wineId: null,
      recordId: "r1",
    });
    expect(hit.provider).toEqual({
      id: "xwines",
      name: "X-Wines",
      license: "CC0-1.0",
      licenseUrl: null,
      attribution: "credit",
      scope: "public",
      modified: true,
    });
    expect(hit.vintages).toEqual([2019]);
  });
  it("never marks a household's own wine verified", () => {
    expect(toSearchHit(row({ source: "household", verified: true })).verified).toBe(false);
  });
  it("treats an unknown match or type as the weakest", () => {
    const hit = toSearchHit(row({ match: "magic", wine_type: "beer" }));
    expect(hit.match).toBe("fuzzy");
    expect(hit.type).toBeNull();
  });
});

describe("publicSearchHits", () => {
  const record = (over: Partial<CatalogSearchRow>) =>
    row({
      result_kind: "record",
      wine_id: null,
      record_id: "r",
      source: "provider",
      verified: false,
      provider_id: "p",
      provider_scope: "public",
      ...over,
    });
  it("keeps CELLR wines and public provider records", () => {
    expect(publicSearchHits([row(), record({})]).map((h) => h.kind)).toEqual(["wine", "record"]);
  });
  it("drops pilot, unknown and missing scopes, and records without a provider", () => {
    expect(
      publicSearchHits([
        record({ provider_scope: "pilot" }),
        record({ provider_scope: null }),
        record({ provider_scope: "Public" }),
        record({ provider_id: null }),
      ]),
    ).toEqual([]);
  });
});

describe("needsConfirmation", () => {
  it("a verified exact or alias match may be used as the identity", () => {
    expect(needsConfirmation(toSearchHit(row()))).toBe(false);
    expect(needsConfirmation(toSearchHit(row({ match: "alias", matched_alias: "Pavillon" })))).toBe(
      false,
    );
  });
  it("a fuzzy, prefix or provider result always needs the person", () => {
    expect(needsConfirmation(toSearchHit(row({ match: "fuzzy" })))).toBe(true);
    expect(needsConfirmation(toSearchHit(row({ match: "prefix" })))).toBe(true);
    expect(
      needsConfirmation(
        toSearchHit(row({ result_kind: "record", record_id: "r", match: "exact" })),
      ),
    ).toBe(true);
  });
  it("the household's own wine typed exactly is theirs", () => {
    expect(needsConfirmation(toSearchHit(row({ source: "owned", verified: false })))).toBe(false);
  });
});
