import { describe, expect, it, vi } from "vitest";
import { createWineSourcesService, type WineSourcesRepository } from "./sources";

const notice = (over: Record<string, unknown> = {}) => ({
  providerId: "fixture",
  providerName: "Fixture Wines",
  homepage: "https://fixture.example",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Fixture Wines dataset",
  legalNotice: null,
  modified: true,
  modificationNotice: "Names were normalised by CELLR.",
  modifications: ["name_normalized"],
  externalId: "F-1",
  sourceUrl: "https://fixture.example/F-1",
  retrievedAt: "2026-11-01T00:00:00+00:00",
  datasetVersion: "v1",
  scope: "public",
  ...over,
});

function service(over: Partial<WineSourcesRepository> = {}) {
  const repo: WineSourcesRepository = {
    wineKind: vi.fn(async () => "catalog" as const),
    catalogSources: vi.fn(async () => [
      { name: "Producer website", url: "https://estate.example/cuvee", retrievedAt: "2026-10-01" },
    ]),
    notices: vi.fn(async () => [notice()]),
    ...over,
  };
  return { repo, sources: createWineSourcesService({ repo, householdId: async () => "h1" }) };
}

describe("what a wine page may credit", () => {
  it("a catalogue wine: its check pages and the cleared sources linked to it, asked for this household", async () => {
    const { repo, sources } = service();
    const data = await sources.get("w1");
    expect(data.catalog).toBe(true);
    expect(data.catalogSources).toHaveLength(1);
    expect(data.external).toHaveLength(1);
    expect(data.external[0]).toMatchObject({ providerName: "Fixture Wines", scope: "public" });
    expect(repo.notices).toHaveBeenCalledWith("h1", "w1");
  });

  it("a household's own wine: nothing is looked up and nothing is credited", async () => {
    const { repo, sources } = service({ wineKind: vi.fn(async () => "household" as const) });
    expect(await sources.get("w1")).toEqual({ catalog: false, catalogSources: [], external: [] });
    expect(repo.catalogSources).not.toHaveBeenCalled();
    expect(repo.notices).not.toHaveBeenCalled();
  });

  it("a wine the person cannot see does not exist", async () => {
    const { sources } = service({ wineKind: vi.fn(async () => null) });
    await expect(sources.get("w1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a notice that is not of a source shown to people, or is malformed, is dropped", async () => {
    const { sources } = service({
      notices: vi.fn(async () => [
        notice({ scope: "pilot", externalId: "P-1" }),
        notice({ scope: "off", externalId: "O-1" }),
        { providerId: "x" },
        "nonsense",
        null,
        notice({ externalId: "F-2" }),
      ]),
    });
    const data = await sources.get("w1");
    expect(data.external.map((n) => n.externalId)).toEqual(["F-2"]);
  });

  it("only the fields of a credit travel: nothing else the database might add", async () => {
    const { sources } = service({
      notices: vi.fn(async () => [notice({ rightsEvidence: "internal note", producer: "X" })]),
    });
    const [first] = (await sources.get("w1")).external;
    expect(first).not.toHaveProperty("rightsEvidence");
    expect(first).not.toHaveProperty("producer");
    expect(first).not.toHaveProperty("homepage");
  });

  it("before the database step, or when the lookup fails: the catalogue's own pages, no external credit", async () => {
    const missing = service({ notices: vi.fn(async () => null) });
    expect((await missing.sources.get("w1")).external).toEqual([]);
    const failing = service({
      notices: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });
    const data = await failing.sources.get("w1");
    expect(data.external).toEqual([]);
    expect(data.catalogSources).toHaveLength(1);
  });
});
