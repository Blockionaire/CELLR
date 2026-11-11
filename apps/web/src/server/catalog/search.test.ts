import { describe, expect, it, vi } from "vitest";
import { DomainError, type CatalogSearchRow } from "@cellr/domain";
import { createCatalogSearchService } from "./search";

const row: CatalogSearchRow = {
  result_kind: "record",
  wine_id: null,
  record_id: "r1",
  producer: "Bodegas Muga",
  name: "Reserva",
  matched_alias: null,
  wine_type: "red",
  country_code: "ES",
  region: "Rioja",
  source: "provider",
  verified: true, // a broken row: the service must still never call a record verified
  match: "prefix",
  score: 2.1,
  bottles: 0,
  provider_id: "xwines",
  provider_name: "X-Wines dataset",
  attribution: "credit",
  license: "CC0-1.0",
  license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
  provider_scope: "public",
  modified: true,
  vintages: [2018, 2019],
};

function setup(rows: CatalogSearchRow[] | null = [row]) {
  const repo = { search: vi.fn(async () => rows) };
  const spend = vi.fn(async () => {});
  const service = createCatalogSearchService({ repo, householdId: async () => "h1", spend });
  return { repo, spend, service };
}

describe("catalog search service", () => {
  it("searches the normalised query for the caller's household, with filters and limit", async () => {
    const { repo, service } = setup();
    const out = await service.search({
      q: "  MUGA Résérva ",
      type: "red",
      country: "ES",
      limit: 5,
    });
    expect(repo.search).toHaveBeenCalledWith({
      householdId: "h1",
      query: "muga reserva",
      type: "red",
      country: "ES",
      region: null,
      limit: 5,
    });
    expect(out.available).toBe(true);
    expect(out.results[0]).toMatchObject({ kind: "record", verified: false, source: "provider" });
  });
  it("a too-short query costs nothing and asks nothing", async () => {
    const { repo, spend, service } = setup();
    expect(await service.search({ q: " m ", limit: 8 })).toEqual({
      query: null,
      results: [],
      available: true,
    });
    expect(repo.search).not.toHaveBeenCalled();
    expect(spend).not.toHaveBeenCalled();
  });
  it("spends from the budget before searching, and stops when it is spent", async () => {
    const { repo, spend, service } = setup();
    spend.mockRejectedValueOnce(new DomainError("RATE_LIMITED"));
    await expect(service.search({ q: "muga", limit: 8 })).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(repo.search).not.toHaveBeenCalled();
  });
  it("says unavailable (never an error) before the database step exists", async () => {
    const { service } = setup(null);
    expect(await service.search({ q: "muga", limit: 8 })).toEqual({
      query: "muga",
      results: [],
      available: false,
    });
  });
  it("fails closed: a pilot or unscoped provider record never reaches the app", async () => {
    const { service } = setup([
      { ...row, record_id: "pilot", provider_scope: "pilot" },
      { ...row, record_id: "none", provider_scope: null },
      { ...row, record_id: "odd", provider_scope: "PUBLIC" },
      { ...row, record_id: "nobody", provider_id: null },
      row,
    ]);
    const out = await service.search({ q: "muga", limit: 8 });
    expect(out.results.map((r) => r.recordId)).toEqual(["r1"]);
  });
  it("an empty answer is just empty", async () => {
    const { service } = setup([]);
    expect(await service.search({ q: "zzzz", limit: 8 })).toEqual({
      query: "zzzz",
      results: [],
      available: true,
    });
  });
});
