import { describe, expect, it, vi } from "vitest";
import { DomainError, type CatalogSearchRow } from "@cellr/domain";
import { createCatalogSearchService, SearchCancelled } from "./search";

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
  const repo = {
    search: vi.fn(async (_args: unknown, _signal?: AbortSignal) => rows),
  };
  const spend = vi.fn(async () => {});
  const householdId = vi.fn(async () => "h1");
  const service = createCatalogSearchService({ repo, householdId, spend });
  return { repo, spend, householdId, service };
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
    expect(repo.search).toHaveBeenCalledWith(
      {
        householdId: "h1",
        query: "muga reserva",
        type: "red",
        country: "ES",
        region: null,
        limit: 5,
      },
      undefined,
    );
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
  it("passes the request's signal on to the database call, and answers a caller that stays as before", async () => {
    const { repo, service } = setup();
    const signal = new AbortController().signal;
    const out = await service.search({ q: "muga", limit: 8 }, signal);
    expect(repo.search.mock.calls[0]![1]).toBe(signal);
    expect(out.results.map((r) => r.recordId)).toEqual(["r1"]);
  });
  it("a search the caller already cancelled spends no budget and asks the database nothing", async () => {
    const { repo, spend, householdId, service } = setup();
    const gone = new AbortController();
    gone.abort();
    await expect(service.search({ q: "muga", limit: 8 }, gone.signal)).rejects.toBeInstanceOf(
      SearchCancelled,
    );
    expect(spend).not.toHaveBeenCalled();
    expect(householdId).not.toHaveBeenCalled();
    expect(repo.search).not.toHaveBeenCalled();
  });
  it("cancelled while the budget was being spent: the household is not looked up and nothing is searched", async () => {
    const { repo, spend, householdId, service } = setup();
    const gone = new AbortController();
    spend.mockImplementationOnce(async () => gone.abort());
    await expect(service.search({ q: "muga", limit: 8 }, gone.signal)).rejects.toBeInstanceOf(
      SearchCancelled,
    );
    expect(householdId).not.toHaveBeenCalled();
    expect(repo.search).not.toHaveBeenCalled();
  });
  it("cancelled while the household was looked up: nothing is searched", async () => {
    const { repo, householdId, service } = setup();
    const gone = new AbortController();
    householdId.mockImplementationOnce(async () => {
      gone.abort();
      return "h1";
    });
    await expect(service.search({ q: "muga", limit: 8 }, gone.signal)).rejects.toBeInstanceOf(
      SearchCancelled,
    );
    expect(repo.search).not.toHaveBeenCalled();
  });
  it("cancelled during the search: a cancellation, not a database error; a real failure is still a failure", async () => {
    const { repo, service } = setup();
    const gone = new AbortController();
    repo.search.mockImplementationOnce(async () => {
      gone.abort();
      throw new DomainError("INTERNAL");
    });
    await expect(service.search({ q: "muga", limit: 8 }, gone.signal)).rejects.toBeInstanceOf(
      SearchCancelled,
    );
    repo.search.mockImplementationOnce(async () => {
      throw new DomainError("INTERNAL");
    });
    await expect(
      service.search({ q: "muga", limit: 8 }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INTERNAL" });
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
