import { describe, expect, it } from "vitest";
import { DomainError, type AddWish } from "@cellr/domain";
import { toWish } from "./repository";
import { createWishlistService } from "./service";
import type { WishlistRepository, WishRow } from "./types";

const row = (over: Partial<WishRow> = {}): WishRow => ({
  id: "x1",
  wineId: "w1",
  producer: "Château Margaux",
  wineName: "Pavillon Rouge",
  type: "red",
  region: "Bordeaux",
  countryCode: "FR",
  year: null,
  note: null,
  maxPriceCents: null,
  addedAt: "2026-10-01T10:00:00Z",
  ...over,
});

function setup(
  options: {
    rows?: WishRow[] | null;
    known?: string[];
    bottles?: Record<string, number>;
    conflict?: boolean;
  } = {},
) {
  const state = {
    rows: options.rows === undefined ? [row()] : options.rows,
    removed: [] as string[],
  };
  const repo: WishlistRepository = {
    async list() {
      return state.rows;
    },
    async insert(_h, input: AddWish) {
      if (options.conflict)
        throw new DomainError("CONFLICT", "That wine is already on your wishlist.");
      return row({
        id: "new",
        wineId: input.wineId,
        year: input.year,
        note: input.note,
        maxPriceCents: input.maxPriceCents,
      });
    },
    async update(id, patch) {
      const found = state.rows?.find((r) => r.id === id);
      return found ? { ...found, ...(patch.note !== undefined ? { note: patch.note } : {}) } : null;
    },
    async remove(id) {
      state.removed.push(id);
      return state.rows?.some((r) => r.id === id) ?? false;
    },
  };
  const service = createWishlistService({
    repo,
    household: async () => ({ id: "h1", currency: "EUR" }),
    wineExists: async (id) => (options.known ?? ["w1"]).includes(id),
    bottlesByWine: async () => new Map(Object.entries(options.bottles ?? {})),
  });
  return { service, state };
}

describe("the wishlist", () => {
  it("lists the wishes, each with how many bottles of that wine are already in the cellar", async () => {
    const { service } = setup({
      rows: [row(), row({ id: "x2", wineId: "w2", wineName: "Other" })],
      bottles: { w1: 3 },
    });
    const view = await service.list();
    expect(view).toMatchObject({ currency: "EUR", ready: true });
    expect(view.items.map((i) => [i.wineName, i.inCellar])).toEqual([
      ["Pavillon Rouge", 3],
      ["Other", 0],
    ]);
  });

  it("says kindly that it is not switched on yet, instead of failing", async () => {
    const { service } = setup({ rows: null });
    expect(await service.list()).toEqual({ items: [], currency: "EUR", ready: false });
  });

  it("puts a wine you can see on the list, with what you said about it", async () => {
    const { service } = setup({ bottles: { w1: 1 } });
    const item = await service.add({
      wineId: "w1",
      year: 2015,
      note: "barbecue",
      maxPriceCents: 4000,
    });
    expect(item).toMatchObject({
      wineId: "w1",
      year: 2015,
      note: "barbecue",
      maxPriceCents: 4000,
      inCellar: 1,
    });
  });

  it("does not know a wine that is not yours to see, and refuses a doubled entry", async () => {
    await expect(
      setup().service.add({ wineId: "elsewhere", year: null, note: null, maxPriceCents: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      setup({ conflict: true }).service.add({
        wineId: "w1",
        year: null,
        note: null,
        maxPriceCents: null,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("changes and removes a wish; one that is not there is 'not found'", async () => {
    const { service, state } = setup();
    expect((await service.update("x1", { note: "changed" })).note).toBe("changed");
    await expect(service.update("nope", { note: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await service.remove("x1");
    expect(state.removed).toEqual(["x1"]);
    await expect(service.remove("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("reading a wish from the database", () => {
  it("joins the wine and its producer", () => {
    expect(
      toWish({
        id: "x",
        wine_id: "w",
        year: 2015,
        note: "n",
        max_price_cents: 4000,
        created_at: "2026-10-01T00:00:00Z",
        wines: {
          name: "Pavillon Rouge",
          wine_type: "red",
          region: "Bordeaux",
          country_code: "FR",
          producers: { name: "Château Margaux" },
        },
      }),
    ).toEqual({
      id: "x",
      wineId: "w",
      producer: "Château Margaux",
      wineName: "Pavillon Rouge",
      type: "red",
      region: "Bordeaux",
      countryCode: "FR",
      year: 2015,
      note: "n",
      maxPriceCents: 4000,
      addedAt: "2026-10-01T00:00:00Z",
    });
  });
});
