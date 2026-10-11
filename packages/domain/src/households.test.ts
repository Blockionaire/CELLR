import { describe, expect, it } from "vitest";
import {
  CreateHouseholdSchema,
  CreateInviteSchema,
  formatInviteCode,
  InviteCodeSchema,
  JoinHouseholdSchema,
  nextOnboardingStep,
  normalizeInviteCode,
  UpdateHouseholdSchema,
  UpdateProfileSchema,
} from "./households";

describe("invite codes", () => {
  it("normalise however they are typed", () => {
    expect(normalizeInviteCode("ABCD-EF01-2345")).toBe("abcdef012345");
    expect(normalizeInviteCode(" abcd ef01 2345 ")).toBe("abcdef012345");
  });
  it("round-trip through format/normalize", () => {
    expect(formatInviteCode("abcdef012345")).toBe("abcd-ef01-2345");
    expect(normalizeInviteCode(formatInviteCode("abcdef012345"))).toBe("abcdef012345");
  });
  it("must have exactly 12 hex characters once normalised", () => {
    expect(JoinHouseholdSchema.safeParse({ code: "ABCD-EF01-2345" }).success).toBe(true);
    for (const bad of ["", "abcd", "abcdef0123456", "zzzz-zzzz-zzzz"]) {
      expect(InviteCodeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("household input", () => {
  it("defaults the currency and trims the name", () => {
    expect(CreateHouseholdSchema.parse({ name: "  Joost & Merel " })).toEqual({
      name: "Joost & Merel",
      currency: "EUR",
    });
  });
  it("rejects blank names and bad currencies", () => {
    expect(CreateHouseholdSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(CreateHouseholdSchema.safeParse({ name: "x", currency: "euro" }).success).toBe(false);
    expect(CreateHouseholdSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  it("update needs at least one field", () => {
    expect(UpdateHouseholdSchema.safeParse({}).success).toBe(false);
    expect(UpdateHouseholdSchema.safeParse({ name: "New" }).success).toBe(true);
  });
  it("invite bounds match the database", () => {
    expect(CreateInviteSchema.parse({})).toEqual({ ttlHours: 168, maxUses: 5 });
    expect(CreateInviteSchema.safeParse({ ttlHours: 0 }).success).toBe(false);
    expect(CreateInviteSchema.safeParse({ ttlHours: 721 }).success).toBe(false);
    expect(CreateInviteSchema.safeParse({ maxUses: 51 }).success).toBe(false);
  });
  it("profile update needs a field", () => {
    expect(UpdateProfileSchema.safeParse({}).success).toBe(false);
    expect(UpdateProfileSchema.safeParse({ displayName: "Joost" }).success).toBe(true);
    expect(UpdateProfileSchema.safeParse({ locale: "nl" }).success).toBe(true);
    expect(UpdateProfileSchema.safeParse({ locale: "Dutch" }).success).toBe(false);
  });
});

describe("onboarding", () => {
  const hh = { id: "1", name: "x", currency: "EUR", role: "owner" as const, memberCount: 1 };
  it("sends people with no household to create/join one", () => {
    expect(nextOnboardingStep({ displayName: null, households: [] })).toBe("household");
  });
  it("then asks for a name, then is done", () => {
    expect(nextOnboardingStep({ displayName: null, households: [hh] })).toBe("name");
    expect(nextOnboardingStep({ displayName: "Joost", households: [hh] })).toBe("done");
  });
});
