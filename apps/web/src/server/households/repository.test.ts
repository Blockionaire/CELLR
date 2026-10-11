import { describe, expect, it } from "vitest";
import { toHousehold, toMember, toProfile } from "./repository";

describe("row mappers", () => {
  it("map a household row", () => {
    expect(toHousehold({ id: "h", name: "N", currency: "EUR" })).toEqual({
      id: "h",
      name: "N",
      currency: "EUR",
    });
  });
  it("map a membership row to camelCase", () => {
    expect(
      toMember({
        household_id: "h",
        user_id: "u",
        role: "owner",
        joined_at: "2026-01-01T00:00:00Z",
      }),
    ).toEqual({
      householdId: "h",
      userId: "u",
      role: "owner",
      joinedAt: "2026-01-01T00:00:00Z",
    });
  });
  it("map a profile row, keeping nulls", () => {
    expect(
      toProfile({ id: "u", display_name: null, locale: "en", active_household_id: null }),
    ).toEqual({
      id: "u",
      displayName: null,
      locale: "en",
      activeHouseholdId: null,
    });
  });
});
