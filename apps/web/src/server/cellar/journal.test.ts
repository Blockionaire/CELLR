import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db/clients";
import { createCellarRepository } from "./repository";
import { createCellarService } from "./service";
import type { CellarRepository } from "./types";

vi.mock("server-only", () => ({}));

/** A Supabase stand-in that records every filter and answers with fixed rows. */
function recordingDb(answers: Record<string, unknown[]>) {
  const calls: Array<{ table: string; filters: Array<[string, string, unknown]>; limit?: number }> =
    [];
  const db = {
    from(table: string) {
      const call: (typeof calls)[number] = { table, filters: [] };
      calls.push(call);
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (call.filters.push(["eq", c, v]), q),
        in: (c: string, v: unknown) => (call.filters.push(["in", c, v]), q),
        order: () => q,
        range: () => q,
        limit: (n: number) => ((call.limit = n), q),
        then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
          resolve({ data: answers[table] ?? [], error: null }),
      };
      return q;
    },
  };
  return { db: db as unknown as Db, calls };
}

const row = {
  id: "t1",
  vintage_id: "v1",
  bottle_id: "b1",
  score: 9,
  descriptors: ["fruity"],
  note: "Lovely.",
  tasted_at: "2026-10-01T18:00:00Z",
  bottles: { front_image_id: "i1", status: "opened" },
  wine_vintages: {
    id: "v1",
    year: 2018,
    wines: { id: "w1", name: "Rouge", wine_type: "red", producers: { name: "Musar" } },
  },
};

describe("the journal query", () => {
  it("asks only for the person's own tastings in the given household, bounded", async () => {
    const { db, calls } = recordingDb({
      tastings: [row],
      bottle_images: [
        { id: "i1", blur_color: "#7d2234", width: 600, height: 900, texture_path: null },
      ],
    });
    const entries = await createCellarRepository(db).listMyJournal("h1", "u1", 500);
    const tastings = calls.find((c) => c.table === "tastings")!;
    expect(tastings.filters).toEqual([
      ["eq", "household_id", "h1"],
      ["eq", "user_id", "u1"],
    ]);
    expect(tastings.limit).toBe(501);
    // Label photos only from this household's images.
    expect(calls.find((c) => c.table === "bottle_images")!.filters).toContainEqual([
      "eq",
      "household_id",
      "h1",
    ]);
    expect(entries).toEqual([
      expect.objectContaining({
        tastingId: "t1",
        vintageId: "v1",
        wineId: "w1",
        bottleId: "b1",
        producer: "Musar",
        year: 2018,
        score: 9,
        image: expect.objectContaining({ id: "i1" }),
      }),
    ]);
  });

  it("an opened bottle's tasting is editable and its wine opens, without asking anything more", async () => {
    const { db, calls } = recordingDb({ tastings: [row] });
    const [e] = (await createCellarRepository(db).listMyJournal("h1", "u1", 500))!;
    expect(e).toMatchObject({ editable: true, wineAvailable: true });
    expect(calls.filter((c) => c.table === "bottles")).toHaveLength(0);
  });

  it("an archived tasting (bottle deleted, no bottle of the wine left) reads, but is neither editable nor linked", async () => {
    const { db, calls } = recordingDb({
      tastings: [{ ...row, bottle_id: null, bottles: null, score: null }],
      bottles: [],
    });
    const [e] = (await createCellarRepository(db).listMyJournal("h1", "u1", 500))!;
    expect(e).toMatchObject({
      bottleId: null,
      image: null,
      score: null,
      note: "Lovely.",
      editable: false,
      wineAvailable: false,
    });
    // Asked of the household's own bottles of just that vintage, in the cellar or opened.
    expect(calls.find((c) => c.table === "bottles")!.filters).toEqual([
      ["eq", "household_id", "h1"],
      ["in", "vintage_id", ["v1"]],
      ["in", "status", ["in_cellar", "opened"]],
    ]);
  });

  it("a bottle no longer opened (taken back, removed) is not editable; its wine opens while one is left", async () => {
    const { db } = recordingDb({
      tastings: [{ ...row, bottles: { front_image_id: null, status: "removed" } }],
      bottles: [{ vintage_id: "v1" }],
    });
    const [e] = (await createCellarRepository(db).listMyJournal("h1", "u1", 500))!;
    expect(e).toMatchObject({ editable: false, wineAvailable: true });
  });
});

describe("the journal service", () => {
  const entry = (i: number) => ({
    tastingId: `t${i}`,
    vintageId: "v1",
    wineId: "w1",
    bottleId: `b${i}`,
    editable: true,
    wineAvailable: true,
    producer: "P",
    wineName: "W",
    year: 2018,
    type: "red" as const,
    image: null,
    score: null,
    descriptors: [],
    note: "x",
    tastedAt: "2026-10-01T00:00:00Z",
  });
  const service = (repo: Partial<CellarRepository>) =>
    createCellarService(
      {
        getActiveHousehold: async () => ({ id: "h-active", currency: "EUR" }),
        ...repo,
      } as CellarRepository,
      { userId: "u1" },
    );

  it("reads the active household and the signed-in person, and summarises every tasting", async () => {
    const listMyJournal = vi.fn(async () => [entry(1)]);
    const listMyJournalScores = vi.fn(async () => [
      { wineId: "w1", score: 8 },
      { wineId: "w1", score: null },
      { wineId: "w2", score: 6 },
    ]);
    const view = await service({ listMyJournal, listMyJournalScores }).journal();
    expect(listMyJournal).toHaveBeenCalledWith("h-active", "u1", 500);
    expect(listMyJournalScores).toHaveBeenCalledWith("h-active", "u1");
    expect(view).toMatchObject({
      ready: true,
      truncated: false,
      summary: { entries: 3, scored: 2, wines: 2, average: 3.5 },
    });
  });

  it("says when there are more entries than are shown", async () => {
    const many = Array.from({ length: 501 }, (_, i) => entry(i));
    const view = await service({
      listMyJournal: async () => many,
      listMyJournalScores: async () => [],
    }).journal();
    expect(view.entries).toHaveLength(500);
    expect(view.truncated).toBe(true);
  });

  it("before the tastings step: an empty, not-ready journal", async () => {
    const view = await service({
      listMyJournal: async () => null,
      listMyJournalScores: async () => [],
    }).journal();
    expect(view).toMatchObject({ ready: false, entries: [], summary: { entries: 0 } });
  });
});

describe("the rating link from the journal, on the wine's page", () => {
  // 14 opened bottles, newest first: b0 (Oct 14) … b13 (Oct 1). The page lists the latest 12.
  const opened = Array.from({ length: 14 }, (_, i) => ({
    id: `b${i}`,
    status: "opened" as const,
    locationId: null,
    locationLabel: null,
    row: null,
    col: null,
    priceCents: null,
    currency: null,
    purchasedAt: null,
    addedAt: "2026-01-01T00:00:00Z",
    openedAt: `2026-10-${String(14 - i).padStart(2, "0")}T00:00:00Z`,
  }));
  const tasting = (bottleId: string, userId = "u1") => ({
    id: `t-${bottleId}-${userId}`,
    vintageId: "v1",
    bottleId,
    userId,
    userName: null,
    score: 7,
    descriptors: [],
    note: "Old favourite.",
    tastedAt: "2026-10-01T20:00:00Z",
  });
  const page = (over: Partial<CellarRepository> = {}) =>
    createCellarService(
      {
        getActiveHousehold: async () => ({ id: "h1", currency: "EUR" }),
        getVintage: async () => ({
          vintageId: "v1",
          year: 2018,
          wine: {
            id: "w1",
            producer: "P",
            name: "W",
            type: "red",
            countryCode: "FR",
            region: null,
            appellation: null,
          },
          bottles: opened,
          image: null,
        }),
        listFavoriteWineIds: async () => [],
        listTastings: async () => [],
        latestImageRef: async () => null,
        getMyTasting: async (_u: string, bottleId: string) => tasting(bottleId),
        ...over,
      } as unknown as CellarRepository,
      { userId: "u1" },
    );

  it("an ordinary page lists the latest 12 opened bottles", async () => {
    const detail = await page().vintage("v1");
    expect(detail.opened.map((b) => b.id)).toEqual(opened.slice(0, 12).map((b) => b.id));
  });

  it("an opened bottle older than those 12 is included when asked for, with my existing tasting of it", async () => {
    const getMyTasting = vi.fn(async (_u: string, bottleId: string) => tasting(bottleId));
    const detail = await page({ getMyTasting }).vintage("v1", { rate: "b13" });
    expect(detail.opened).toHaveLength(13);
    expect(detail.opened.at(-1)!.id).toBe("b13");
    expect(getMyTasting).toHaveBeenCalledWith("u1", "b13");
    // The sheet edits this one (mine), so saving updates it rather than adding a second tasting.
    expect(detail.tastings).toContainEqual(
      expect.objectContaining({ bottleId: "b13", mine: true, score: 7, note: "Old favourite." }),
    );
  });

  it("a bottle already listed, or with my tasting already loaded, is not fetched or added twice", async () => {
    const getMyTasting = vi.fn(async () => null);
    const detail = await page({
      getMyTasting,
      listTastings: async () => [tasting("b2")],
    }).vintage("v1", { rate: "b2" });
    expect(detail.opened).toHaveLength(12);
    expect(detail.tastings).toHaveLength(1);
    expect(getMyTasting).not.toHaveBeenCalled();
  });

  it("a bottle that is not one of this vintage's opened bottles is ignored", async () => {
    const getMyTasting = vi.fn(async () => null);
    for (const rate of ["not-here", "b-other-household"]) {
      const detail = await page({ getMyTasting }).vintage("v1", { rate });
      expect(detail.opened).toHaveLength(12);
    }
    const inCellar = { ...opened[13]!, status: "in_cellar" as const, openedAt: null };
    const detail = await page({
      getMyTasting,
      getVintage: async () => ({
        vintageId: "v1",
        year: 2018,
        wine: {
          id: "w1",
          producer: "P",
          name: "W",
          type: "red",
          countryCode: "FR",
          region: null,
          appellation: null,
        },
        bottles: [...opened.slice(0, 13), inCellar],
        image: null,
      }),
    }).vintage("v1", { rate: "b13" });
    expect(detail.opened.some((b) => b.id === "b13")).toBe(false);
    expect(getMyTasting).not.toHaveBeenCalled();
  });
});
