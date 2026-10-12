import { describe, expect, it } from "vitest";
import { AddWishSchema, UpdateWishSchema } from "./wishlist";

const wineId = "11111111-1111-4111-8111-111111111111";

describe("adding a wish", () => {
  it("needs only a wine; the rest is optional and defaults to 'any vintage, no note, no price'", () => {
    expect(AddWishSchema.parse({ wineId })).toEqual({
      wineId,
      year: null,
      note: null,
      maxPriceCents: null,
    });
  });
  it("takes a vintage, a tidy note and a price", () => {
    expect(
      AddWishSchema.parse({ wineId, year: 2015, note: "  for the barbecue ", maxPriceCents: 4000 }),
    ).toEqual({
      wineId,
      year: 2015,
      note: "for the barbecue",
      maxPriceCents: 4000,
    });
    expect(AddWishSchema.parse({ wineId, note: "   " }).note).toBeNull();
  });
  it("refuses what makes no sense", () => {
    expect(AddWishSchema.safeParse({ wineId: "nope" }).success).toBe(false);
    expect(AddWishSchema.safeParse({ wineId, year: 1700 }).success).toBe(false);
    expect(AddWishSchema.safeParse({ wineId, year: 2015.5 }).success).toBe(false);
    expect(AddWishSchema.safeParse({ wineId, maxPriceCents: -1 }).success).toBe(false);
    expect(AddWishSchema.safeParse({ wineId, maxPriceCents: 10_000_001 }).success).toBe(false);
    expect(AddWishSchema.safeParse({ wineId, note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("changing a wish", () => {
  it("changes only what is sent, and may clear a field", () => {
    expect(UpdateWishSchema.parse({ note: "" })).toEqual({ note: null });
    expect(UpdateWishSchema.parse({ maxPriceCents: null, year: 2016 })).toEqual({
      maxPriceCents: null,
      year: 2016,
    });
  });
  it("must change something", () => {
    expect(UpdateWishSchema.safeParse({}).success).toBe(false);
  });
});
