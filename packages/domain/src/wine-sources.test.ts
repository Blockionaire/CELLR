import { describe, expect, it } from "vitest";
import type { SourceNotice } from "./provenance";
import { safeHttpUrl, wineSourcesView, type WineSourcesInput } from "./wine-sources";

const notice = (over: Partial<SourceNotice> = {}): SourceNotice => ({
  providerId: "fixture",
  providerName: "Fixture Wines",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Fixture Wines dataset",
  modified: true,
  modificationNotice: "Names were normalised by CELLR.",
  modifications: ["name_normalized"],
  legalNotice: null,
  externalId: "F-1",
  sourceUrl: "https://fixture.example/F-1",
  retrievedAt: "2026-11-01T00:00:00Z",
  datasetVersion: "v1",
  scope: "public",
  ...over,
});

const base = (over: Partial<WineSourcesInput> = {}): WineSourcesInput => ({
  wine: { type: "red", countryCode: "FR", region: "Bordeaux", appellation: null },
  data: {
    catalog: true,
    catalogSources: [
      { name: "Producer website", url: "https://estate.example/cuvee", retrievedAt: "2026-10-01" },
    ],
    external: [],
  },
  drink: { source: "estimate", from: 2024, until: 2030 },
  insight: null,
  valuation: null,
  ownValue: false,
  yours: { bottles: 0, opened: 0, tastings: 0, prices: 0, photos: 0 },
  ...over,
});

describe("wineSourcesView", () => {
  it("a catalogue wine: identified by the CELLR catalogue, with the pages its check rests on", () => {
    const view = wineSourcesView(base());
    expect(view.identity.origin).toBe("cellr_catalog");
    expect(view.identity.catalogSources).toHaveLength(1);
    expect(view.identity.external).toEqual([]);
    expect(view.characteristics.map((c) => c.field)).toEqual(["type", "countryCode", "region"]);
    expect(view.characteristics.every((c) => c.origin === "cellr_catalog")).toBe(true);
  });

  it("a household's own wine never gets a source it did not come from", () => {
    const view = wineSourcesView(
      base({
        wine: { type: "red", countryCode: null, region: null, appellation: null },
        // even if the server were to send these, they are not this wine's
        data: {
          catalog: false,
          catalogSources: [
            { name: "Somebody's page", url: "https://x.example", retrievedAt: null },
          ],
          external: [notice()],
        },
      }),
    );
    expect(view.identity).toEqual({ origin: "user_provided", catalogSources: [], external: [] });
    expect(view.characteristics).toEqual([{ field: "type", origin: "user_provided" }]);
  });

  it("an external source is listed once per record, and only when it is shown to people", () => {
    const pilot = { ...notice({ externalId: "F-2" }), scope: "pilot" } as unknown as SourceNotice;
    const view = wineSourcesView(
      base({
        data: {
          catalog: true,
          catalogSources: [],
          external: [notice(), notice(), pilot, notice({ providerId: "other", externalId: "F-1" })],
        },
      }),
    );
    expect(view.identity.external.map((n) => `${n.providerId}:${n.externalId}`)).toEqual([
      "fixture:F-1",
      "other:F-1",
    ]);
    // a listed source changes nothing about where the wine's facts come from
    expect(view.characteristics.every((c) => c.origin === "cellr_catalog")).toBe(true);
  });

  it("nothing estimated, nothing recorded: no AI and no 'yours' lines are made up", () => {
    const view = wineSourcesView(base({ drink: { source: "estimate", from: null, until: null } }));
    expect(view.ai).toEqual([]);
    expect(view.yours).toEqual([]);
  });

  it("the drinking window is always an estimate: from the profile, or from the rough style table", () => {
    const table = wineSourcesView(base());
    expect(table.ai).toEqual([{ kind: "window_table", at: null, pages: [] }]);

    const profiled = wineSourcesView(
      base({
        drink: { source: "ai", from: 2024, until: 2034 },
        insight: {
          generatedAt: "2026-11-02T10:00:00Z",
          researched: true,
          sources: [{ name: "Estate", url: "https://estate.example/2019" }],
        },
      }),
    );
    expect(profiled.ai.map((l) => l.kind)).toEqual(["profile", "window_profile"]);
    expect(profiled.ai[0]).toMatchObject({ at: "2026-11-02T10:00:00Z", researched: true });
    expect(profiled.ai[0]!.pages).toEqual([{ name: "Estate", url: "https://estate.example/2019" }]);
    expect(profiled.ai[1]!.at).toBe("2026-11-02T10:00:00Z");
  });

  it("the household's own window and value are theirs, not an estimate", () => {
    const view = wineSourcesView(
      base({
        drink: { source: "own", from: 2025, until: 2028 },
        ownValue: true,
        yours: { bottles: 3, opened: 1, tastings: 2, prices: 2, photos: 1 },
      }),
    );
    expect(view.ai).toEqual([]);
    expect(view.yours).toEqual([
      { kind: "bottles", count: 3 },
      { kind: "opened", count: 1 },
      { kind: "prices", count: 2 },
      { kind: "tastings", count: 2 },
      { kind: "photos", count: 1 },
      { kind: "own_window", count: 1 },
      { kind: "own_value", count: 1 },
    ]);
  });

  it("a looked-up value is an estimate with its date and its pages", () => {
    const view = wineSourcesView(
      base({
        valuation: {
          valuedAt: "2026-11-03T00:00:00Z",
          sources: [
            { name: "Shop", url: "https://shop.example/p" },
            { name: "Bad", url: "javascript:alert(1)" },
          ],
        },
      }),
    );
    const line = view.ai.find((l) => l.kind === "valuation")!;
    expect(line.at).toBe("2026-11-03T00:00:00Z");
    expect(line.pages).toEqual([{ name: "Shop", url: "https://shop.example/p" }]);
  });

  it("only http(s) addresses ever become links", () => {
    expect(safeHttpUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(safeHttpUrl("http://a.example")).toBe("http://a.example/");
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://a.example", "", null, "x"])
      expect(safeHttpUrl(bad)).toBeNull();
    const view = wineSourcesView(
      base({
        data: {
          catalog: true,
          catalogSources: [{ name: "Odd", url: "javascript:void(0)", retrievedAt: null }],
          external: [],
        },
      }),
    );
    expect(view.identity.catalogSources).toEqual([{ name: "Odd", url: null, retrievedAt: null }]);
  });
});
