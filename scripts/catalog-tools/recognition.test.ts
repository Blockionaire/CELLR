import { describe, expect, it } from "vitest";
import { identityKey, misread, readingOf, wrongIdentity } from "./recognition";

describe("recognition readings", () => {
  const e = { producer: "Marqués de Riscal", wine: "Reserva", type: "red" as const, country: "ES" };
  it("a misreading loses accents and case and drops one letter of the longest word", () => {
    expect(misread("Marqués de Riscal")).toBe("MARUES DE RISCAL");
    expect(misread("Brut")).toBe("BRUT"); // short words are left alone
  });
  it("readings never invent a year and keep the colour and country as printed", () => {
    for (const kind of ["clean", "misread", "producer"] as const) {
      const f = readingOf(e, kind);
      expect(f).toMatchObject({ year: null, nonVintage: false, type: "red", countryCode: "ES" });
    }
    expect(readingOf(e, "producer").name).toBeNull();
    expect(readingOf(e, "clean")).toMatchObject({ producer: "Marqués de Riscal", name: "Reserva" });
  });
  it("an automatic identity is right only when it is the wine seeded for exactly this identity", () => {
    const seeds = new Map([
      [identityKey({ producer: "Château Margaux", wine: "Château Margaux", type: "red" }), "w1"],
    ]);
    const margaux = { producer: "CHATEAU MARGAUX", wine: "Chateau Margaux", type: "red" };
    expect(wrongIdentity(null, margaux, seeds)).toBe(false);
    expect(wrongIdentity("w1", margaux, seeds)).toBe(false); // another query for the same wine
    expect(wrongIdentity("w2", margaux, seeds)).toBe(true);
    expect(wrongIdentity("w1", { ...margaux, wine: "Pavillon Rouge" }, seeds)).toBe(true);
    expect(wrongIdentity("w1", { ...margaux, type: "white" }, seeds)).toBe(true);
  });
});
