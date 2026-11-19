import { describe, expect, it } from "vitest";
import { misread, readingOf } from "./recognition";

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
});
