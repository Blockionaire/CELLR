import { describe, expect, it } from "vitest";
import {
  AddBottlesSchema,
  averagePrice,
  BottleActionSchema,
  CreateStorageSchema,
  CreateWineSchema,
  formatVintage,
  historyEvents,
  matchesSearch,
  MAX_BOTTLES_PER_ADD,
  normalizeText,
  orderBottles,
  parseMoneyToCents,
  summarizePlaces,
  UpdatePurchaseSchema,
  UpdateStorageSchema,
  UpdateWineSchema,
} from "./cellar";
import { describeSlot, nextFreeSlots } from "./placement";

describe("normalizeText (must agree with the database's private.normalize_text)", () => {
  // The same table is asserted in supabase/tests/20_catalog.test.sql.
  const cases: Array<[string, string]> = [
    ["Marqués de Riscal – Reserva", "marques de riscal reserva"],
    ["Château Léoville-Las Cases", "chateau leoville las cases"],
    ["Müller-Thurgau", "muller thurgau"],
    ["  Gewürztraminer  ", "gewurztraminer"],
    ["Weißburgunder", "weissburgunder"],
    ["Cuvée Ærø", "cuvee aero"],
    ["Pétrus 2015!", "petrus 2015"],
    ["", ""],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(normalizeText(input)).toBe(expected);
    });
  }
});

describe("parseMoneyToCents", () => {
  it("reads the ways people actually type prices", () => {
    expect(parseMoneyToCents("24.50")).toBe(2450);
    expect(parseMoneyToCents("24,5")).toBe(2450);
    expect(parseMoneyToCents("€ 24")).toBe(2400);
    expect(parseMoneyToCents("1.234,50")).toBe(123450);
    expect(parseMoneyToCents("1,234.50")).toBe(123450);
    expect(parseMoneyToCents("1.234")).toBe(123400);
    expect(parseMoneyToCents("0,99")).toBe(99);
    expect(parseMoneyToCents(".5")).toBe(50);
  });
  it("tells blank from mistyped", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("   ")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeUndefined();
    expect(parseMoneyToCents("12.345,6789")).toBeUndefined();
    expect(parseMoneyToCents("1.2.3")).toBeUndefined();
    expect(parseMoneyToCents("999999999")).toBeUndefined();
  });
});

describe("contracts", () => {
  it("a new wine needs a producer, a name and a type; the rest is optional", () => {
    expect(
      CreateWineSchema.safeParse({ producer: "Opus One", name: "Opus One", type: "red" }).success,
    ).toBe(true);
    expect(CreateWineSchema.safeParse({ producer: "", name: "x", type: "red" }).success).toBe(
      false,
    );
    expect(CreateWineSchema.safeParse({ producer: "x", name: "x", type: "purple" }).success).toBe(
      false,
    );
    const withBlank = CreateWineSchema.parse({
      producer: "x",
      name: "y",
      type: "white",
      region: "  ",
    });
    expect(withBlank.region).toBeUndefined();
  });

  const wineId = "6f1c1d1e-7a7c-4a5e-9d4e-3b6f3a1c2d4e";
  it("adding bottles: a year or NV, 1..max bottles, everything else optional", () => {
    const ok = AddBottlesSchema.parse({ wineId, year: 2019, quantity: 3 });
    expect(ok).toMatchObject({
      locationId: null,
      priceCents: null,
      purchasedAt: null,
      formatMl: 750,
    });
    expect(AddBottlesSchema.safeParse({ wineId, year: null, quantity: 1 }).success).toBe(true);
    expect(AddBottlesSchema.safeParse({ wineId, year: 2019, quantity: 0 }).success).toBe(false);
    expect(
      AddBottlesSchema.safeParse({ wineId, year: 2019, quantity: MAX_BOTTLES_PER_ADD + 1 }).success,
    ).toBe(false);
    expect(AddBottlesSchema.safeParse({ wineId, year: 1700, quantity: 1 }).success).toBe(false);
    expect(
      AddBottlesSchema.safeParse({ wineId, year: 2019, quantity: 1, priceCents: -5 }).success,
    ).toBe(false);
    expect(AddBottlesSchema.safeParse({ wineId: "nope", year: 2019, quantity: 1 }).success).toBe(
      false,
    );
    expect(
      AddBottlesSchema.safeParse({ wineId, year: 2019, quantity: 1, purchasedAt: "yesterday" })
        .success,
    ).toBe(false);
  });

  it("a storage unit has a name and a sensible grid", () => {
    expect(CreateStorageSchema.parse({ label: "Wine fridge", rows: 6, cols: 4 }).kind).toBe(
      "fridge",
    );
    expect(CreateStorageSchema.safeParse({ label: "", rows: 6, cols: 4 }).success).toBe(false);
    expect(CreateStorageSchema.safeParse({ label: "x", rows: 0, cols: 4 }).success).toBe(false);
    expect(CreateStorageSchema.safeParse({ label: "x", rows: 31, cols: 4 }).success).toBe(false);
  });
});

describe("search and display", () => {
  it("matches every typed word, ignoring case and accents, across fields", () => {
    const card = ["Château Margaux", "Pavillon Rouge", "2015", "Bordeaux"];
    expect(matchesSearch(card, "")).toBe(true);
    expect(matchesSearch(card, "chateau")).toBe(true);
    expect(matchesSearch(card, "MARGAUX 2015")).toBe(true);
    expect(matchesSearch(card, "pavillon bordeaux")).toBe(true);
    expect(matchesSearch(card, "margaux 2016")).toBe(false);
    expect(matchesSearch(card, "burgundy")).toBe(false);
  });
  it("shows NV for non-vintage", () => {
    expect(formatVintage(2019)).toBe("2019");
    expect(formatVintage(null)).toBe("NV");
  });
});

describe("nextFreeSlots", () => {
  const grid = { rows: 2, cols: 3 };
  it("fills shelf by shelf from the top-left", () => {
    expect(nextFreeSlots(grid, [], 4)).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
      { row: 1, col: 3 },
      { row: 2, col: 1 },
    ]);
  });
  it("skips taken spots, including gaps left by opened bottles", () => {
    expect(
      nextFreeSlots(
        grid,
        [
          { row: 1, col: 1 },
          { row: 1, col: 3 },
        ],
        3,
      ),
    ).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 1 },
      { row: 2, col: 2 },
    ]);
  });
  it("gives only what fits when the unit is nearly full", () => {
    const taken = [1, 2, 3]
      .flatMap((col) => [{ row: 1, col }])
      .concat([
        { row: 2, col: 1 },
        { row: 2, col: 2 },
      ]);
    expect(nextFreeSlots(grid, taken, 5)).toEqual([{ row: 2, col: 3 }]);
    expect(nextFreeSlots(grid, [], 0)).toEqual([]);
  });
  it("describes a spot in words", () => {
    expect(describeSlot({ row: 2, col: 4 })).toBe("Shelf 2 · Position 4");
  });
});

describe("bottle actions", () => {
  const unit = "6f1c1d1e-7a7c-4a5e-9d4e-3b6f3a1c2d4e";
  it("open and remove need nothing else; move needs a complete place or none", () => {
    expect(BottleActionSchema.safeParse({ action: "open" }).success).toBe(true);
    expect(BottleActionSchema.safeParse({ action: "remove" }).success).toBe(true);
    expect(
      BottleActionSchema.safeParse({ action: "move", to: { locationId: unit, row: 2, col: 3 } })
        .success,
    ).toBe(true);
    expect(BottleActionSchema.safeParse({ action: "move", to: { locationId: null } }).success).toBe(
      true,
    );
    expect(BottleActionSchema.safeParse({ action: "move", to: { locationId: unit } }).success).toBe(
      false,
    );
    expect(
      BottleActionSchema.safeParse({ action: "move", to: { locationId: unit, row: 0, col: 1 } })
        .success,
    ).toBe(false);
    expect(
      BottleActionSchema.safeParse({ action: "move", to: { locationId: null, row: 1, col: 1 } })
        .success,
    ).toBe(false);
    expect(BottleActionSchema.safeParse({ action: "shake" }).success).toBe(false);
  });
  it("restore defaults to 'not placed'", () => {
    expect(BottleActionSchema.parse({ action: "restore" })).toEqual({
      action: "restore",
      to: { locationId: null, row: null, col: null },
    });
  });
});

describe("editing", () => {
  it("wine edits: a name that is not blank, optional text becomes null when emptied, at least one field", () => {
    expect(UpdateWineSchema.parse({ region: "  " })).toEqual({ region: null });
    expect(UpdateWineSchema.parse({ name: " Grand Vin ", countryCode: "FR" })).toEqual({
      name: "Grand Vin",
      countryCode: "FR",
    });
    expect(UpdateWineSchema.safeParse({}).success).toBe(false);
    expect(UpdateWineSchema.safeParse({ name: " " }).success).toBe(false);
  });
  it("purchase edits: price, date and shop; null clears", () => {
    expect(UpdatePurchaseSchema.parse({ priceCents: null })).toEqual({ priceCents: null });
    expect(UpdatePurchaseSchema.parse({ purchasedAt: "2026-10-01", purchasedFrom: "" })).toEqual({
      purchasedAt: "2026-10-01",
      purchasedFrom: null,
    });
    expect(UpdatePurchaseSchema.safeParse({}).success).toBe(false);
    expect(UpdatePurchaseSchema.safeParse({ priceCents: -1 }).success).toBe(false);
  });
});

describe("bottle helpers", () => {
  const b = (
    label: string | null,
    row: number | null,
    col: number | null,
    addedAt = "2026-01-01",
  ) => ({
    locationLabel: label,
    row,
    col,
    addedAt,
    priceCents: null as number | null,
  });
  it("orders placed bottles by place, shelf and position, and unplaced last", () => {
    const sorted = orderBottles([
      b(null, null, null),
      b("Rack", 2, 1),
      b("Fridge", 3, 1),
      b("Rack", 1, 4),
      b("Fridge", 1, 2),
    ]);
    expect(sorted.map((x) => [x.locationLabel, x.row, x.col])).toEqual([
      ["Fridge", 1, 2],
      ["Fridge", 3, 1],
      ["Rack", 1, 4],
      ["Rack", 2, 1],
      [null, null, null],
    ]);
  });
  it("summarises places with the unplaced last", () => {
    expect(
      summarizePlaces([b("Rack", 1, 1), b(null, null, null), b("Fridge", 1, 1), b("Rack", 1, 2)]),
    ).toEqual([
      { label: "Fridge", count: 1 },
      { label: "Rack", count: 2 },
      { label: null, count: 1 },
    ]);
  });
  it("averages the known prices only", () => {
    expect(averagePrice([])).toBeNull();
    expect(averagePrice([{ priceCents: null }])).toBeNull();
    expect(averagePrice([{ priceCents: 2000 }, { priceCents: null }, { priceCents: 3001 }])).toBe(
      2501,
    );
  });
});

describe("history", () => {
  it("merges same-day additions and openings, newest first", () => {
    const b = (addedAt: string, openedAt: string | null = null) => ({ addedAt, openedAt });
    const events = historyEvents([
      b("2026-10-03T09:00:00Z", "2026-10-12T20:00:00Z"),
      b("2026-10-03T09:00:01Z"),
      b("2026-10-03T09:00:02Z", "2026-10-12T21:30:00Z"),
      b("2026-09-01T10:00:00Z"),
    ]);
    expect(events).toEqual([
      { kind: "opened", day: "2026-10-12", count: 2 },
      { kind: "added", day: "2026-10-03", count: 3 },
      { kind: "added", day: "2026-09-01", count: 1 },
    ]);
  });
  it("is empty without bottles and respects the limit", () => {
    expect(historyEvents([])).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => ({
      addedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      openedAt: null,
    }));
    expect(historyEvents(many, 5)).toHaveLength(5);
  });
});

describe("changing a place", () => {
  it("rename, re-kind or resize: any one of them, but something", () => {
    expect(UpdateStorageSchema.parse({ label: " Cellar rack " })).toEqual({ label: "Cellar rack" });
    expect(UpdateStorageSchema.parse({ rows: 6, cols: 8 })).toEqual({ rows: 6, cols: 8 });
    expect(UpdateStorageSchema.safeParse({}).success).toBe(false);
    expect(UpdateStorageSchema.safeParse({ rows: 0 }).success).toBe(false);
    expect(UpdateStorageSchema.safeParse({ kind: "wardrobe" }).success).toBe(false);
  });
});
