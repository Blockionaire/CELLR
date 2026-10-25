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
  bottles: { front_image_id: "i1" },
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

  it("an old tasting whose bottle was deleted still reads (no bottle, no photo)", async () => {
    const { db } = recordingDb({
      tastings: [{ ...row, bottle_id: null, bottles: null, score: null }],
    });
    const [e] = (await createCellarRepository(db).listMyJournal("h1", "u1", 500))!;
    expect(e).toMatchObject({ bottleId: null, image: null, score: null, note: "Lovely." });
  });
});

describe("the journal service", () => {
  const entry = (i: number) => ({
    tastingId: `t${i}`,
    vintageId: "v1",
    wineId: "w1",
    bottleId: `b${i}`,
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
