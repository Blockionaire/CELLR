import { describe, expect, it, vi } from "vitest";
import { InsightOutputSchema, NO_PREFERENCES, type InsightOutput } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { createTasteRepository } from "./repository";
import { createTasteService, toTasteTastings } from "./service";
import type { TasteRepository, TasteRow } from "./types";

vi.mock("server-only", () => ({}));

const row = (over: Partial<TasteRow> = {}): TasteRow => ({
  wineId: "w1",
  vintageId: "v1",
  producer: "P",
  wineName: "W",
  year: 2018,
  type: "red",
  region: "Barolo",
  appellation: null,
  score: 9,
  curatedGrapes: [],
  ...over,
});
const insight = (over: Partial<InsightOutput>) =>
  InsightOutputSchema.parse({
    summary: "s",
    style: "",
    grapes: ["Nebbiolo"],
    tasting: "",
    serving: null,
    decantMinutes: null,
    pairings: [],
    aging: "",
    confidence: "high",
    evidence: "exact_wine",
    structure: { body: 4, tannin: 5, sweetness: 1, acidity: 4 },
    ...over,
  });

describe("what an AI profile may contribute", () => {
  it("curated grapes win; otherwise only grapes resting on the wine or the appellation's rules", () => {
    const one = (o: InsightOutput, curated: string[] = []) =>
      toTasteTastings([row({ curatedGrapes: curated })], new Map([["v1", o]]))[0]!;
    expect(one(insight({}), ["Nebbiolo", "Barbera"]).grapes).toEqual(["Nebbiolo", "Barbera"]);
    expect(one(insight({ evidence: "exact_wine" })).grapes).toEqual(["Nebbiolo"]);
    expect(one(insight({ evidence: "appellation_rules" })).grapes).toEqual(["Nebbiolo"]);
    expect(one(insight({ evidence: "producer" })).grapes).toEqual([]);
    expect(one(insight({ evidence: null })).grapes).toEqual([]);
  });
  it("structure only from a profile that is not a style estimate and not low confidence", () => {
    const s = (o: InsightOutput) => toTasteTastings([row()], new Map([["v1", o]]))[0]!.structure;
    expect(s(insight({}))).toMatchObject({ body: 4 });
    expect(s(insight({ evidence: "style_estimate", confidence: "low" }))).toBeNull();
    expect(s(insight({ evidence: "producer", confidence: "low" }))).toBeNull();
    expect(toTasteTastings([row()], new Map())[0]!.structure).toBeNull();
  });
});

describe("the taste profile service", () => {
  const repo = (over: Partial<TasteRepository> = {}): TasteRepository => ({
    listMyTastings: vi.fn(async () => [row(), row({ wineId: "w2", vintageId: "v2" })]),
    listInsights: vi.fn(async () => new Map()),
    listAvailableVintages: vi.fn(async (_h: string, ids: string[]) => new Set(ids)),
    getPreferences: vi.fn(async () => ({ ...NO_PREFERENCES, body: 4 })),
    savePreferences: vi.fn(async () => true),
    ...over,
  });
  const service = (r: TasteRepository) =>
    createTasteService({
      repo: r,
      userId: "u1",
      household: async () => ({ id: "h-active", currency: "EUR" }),
    });

  it("reads only my tastings in my active household, and my own answers", async () => {
    const r = repo();
    const view = await service(r).profile();
    expect(r.listMyTastings).toHaveBeenCalledWith("h-active", "u1");
    expect(r.getPreferences).toHaveBeenCalledWith("u1");
    expect(r.listInsights).toHaveBeenCalledWith("h-active", ["v1", "v2"]);
    expect(view).toMatchObject({
      ready: { tastings: true, preferences: true },
      preferences: { body: 4 },
    });
    expect(view.overview).toMatchObject({ winesTasted: 2, winesRated: 2 });
  });

  it("an archived wine still counts, but its example is not linkable; available ones are", async () => {
    const rows = [10, 9, 8].map((score, i) =>
      row({ wineId: `w${i}`, vintageId: `v${i}`, region: "Rioja", score }),
    );
    const listAvailableVintages = vi.fn(async () => new Set(["v1", "v2"]));
    const view = await service(
      repo({ listMyTastings: vi.fn(async () => rows), listAvailableVintages }),
    ).profile();
    // One bounded lookup, in my household, for just the example wines.
    expect(listAvailableVintages).toHaveBeenCalledTimes(1);
    expect(listAvailableVintages).toHaveBeenCalledWith("h-active", ["v0", "v1", "v2"]);
    expect(view.overview).toMatchObject({ winesRated: 3, average: 4.5 });
    const [rioja] = view.overview.favouriteRegions;
    expect(rioja).toMatchObject({ key: "Rioja", wines: 3 });
    expect(rioja!.examples.map((e) => [e.vintageId, e.available])).toEqual([
      ["v0", false],
      ["v1", true],
      ["v2", true],
    ]);
  });

  it("no example wines: no availability lookup", async () => {
    const r = repo();
    await service(r).profile();
    expect(r.listAvailableVintages).not.toHaveBeenCalled();
  });

  it("no tastings: no insights asked, an empty profile", async () => {
    const r = repo({ listMyTastings: vi.fn(async () => []) });
    const view = await service(r).profile();
    expect(r.listInsights).not.toHaveBeenCalled();
    expect(view.distribution).toEqual([]);
  });

  it("before the database steps: not ready, never an error", async () => {
    const view = await service(
      repo({ listMyTastings: vi.fn(async () => null), getPreferences: vi.fn(async () => null) }),
    ).profile();
    expect(view.ready).toEqual({ tastings: false, preferences: false });
    expect(view.preferences).toEqual(NO_PREFERENCES);
  });

  it("saves my answers under my id, and says so plainly when the step is missing", async () => {
    const r = repo();
    const input = {
      wineFocus: "red" as const,
      body: 5,
      tannin: null,
      sweetness: null,
      acidity: 3,
      onboarded: true,
    };
    await service(r).savePreferences(input);
    expect(r.savePreferences).toHaveBeenCalledWith("u1", input);
    await expect(
      service(repo({ savePreferences: vi.fn(async () => false) })).savePreferences(input),
    ).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });
});

describe("the taste queries", () => {
  function recordingDb(answers: Record<string, unknown>) {
    const calls: Array<{
      table: string;
      filters: Array<[string, string, unknown]>;
      upsert?: unknown;
    }> = [];
    const db = {
      from(table: string) {
        const call: (typeof calls)[number] = { table, filters: [] };
        calls.push(call);
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => (call.filters.push(["eq", c, v]), q),
          in: (c: string, v: unknown) => (call.filters.push(["in", c, v]), q),
          not: () => q,
          order: () => q,
          range: () => q,
          upsert: (v: unknown) => ((call.upsert = v), Promise.resolve({ error: null })),
          maybeSingle: () => Promise.resolve({ data: answers[table] ?? null, error: null }),
          then: (resolve: (r: { data: unknown; error: null }) => void) =>
            resolve({ data: answers[table] ?? [], error: null }),
        };
        return q;
      },
    };
    return { db: db as unknown as Db, calls };
  }

  it("tastings: only mine in the household; curated grapes; insights: the household's own", async () => {
    const { db, calls } = recordingDb({
      tastings: [
        {
          id: "t1",
          score: 8,
          vintage_id: "v1",
          wine_vintages: {
            year: 2016,
            wines: {
              id: "w1",
              name: "Barolo",
              wine_type: "red",
              region: "Piedmont",
              appellation: "Barolo",
              producers: { name: "Vietti" },
              wine_grapes: [{ grapes: { name: "Nebbiolo" } }],
            },
          },
        },
      ],
    });
    const repo = createTasteRepository(db);
    const rows = await repo.listMyTastings("h1", "u1");
    expect(calls[0]!.filters).toEqual([
      ["eq", "household_id", "h1"],
      ["eq", "user_id", "u1"],
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ wineId: "w1", curatedGrapes: ["Nebbiolo"], region: "Piedmont" }),
    ]);
    await repo.listInsights("h1", ["v1", "v1"]);
    expect(calls[1]!.filters).toEqual([
      ["eq", "household_id", "h1"],
      ["in", "vintage_id", ["v1"]],
    ]);
  });

  it("availability: the household's bottles of just these vintages, in the cellar or opened", async () => {
    const { db, calls } = recordingDb({ bottles: [{ vintage_id: "v2" }, { vintage_id: "v2" }] });
    const found = await createTasteRepository(db).listAvailableVintages("h1", ["v1", "v2", "v1"]);
    expect(calls[0]!.filters).toEqual([
      ["eq", "household_id", "h1"],
      ["in", "vintage_id", ["v1", "v2"]],
      ["in", "status", ["in_cellar", "opened"]],
    ]);
    expect([...found]).toEqual(["v2"]);
  });

  it("preferences: keyed by my own id; unset stays unset", async () => {
    const { db, calls } = recordingDb({});
    const repo = createTasteRepository(db);
    expect(await repo.getPreferences("u1")).toEqual(NO_PREFERENCES);
    expect(calls[0]!.filters).toEqual([["eq", "user_id", "u1"]]);
    await repo.savePreferences("u1", {
      wineFocus: null,
      body: 3,
      tannin: null,
      sweetness: null,
      acidity: null,
    });
    expect(calls[1]!.upsert).toMatchObject({
      user_id: "u1",
      body: 3,
      tannin: null,
      wine_focus: null,
    });
    expect(calls[1]!.upsert).not.toHaveProperty("onboarded_at");
  });
});
