import { describe, expect, it } from "vitest";
import {
  detectScoreScale,
  ImportRequestSchema,
  parseWijnkelderBackup,
  planWijnkelderImport,
  slimWijnkelderBackup,
  toHalfStars,
  type WijnkelderBackup,
} from "./wijnkelder-import";

const fles = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  naam: "Pavillon Rouge",
  producent: "Château Margaux",
  land: "Frankrijk",
  regio: "Bordeaux",
  appellatie: "Margaux",
  kleur: "rood",
  jaargang: 2015,
  aantal: 3,
  formaat: "fles",
  aankoopPrijs: 24.5,
  aankoopDatum: "2020-05-17",
  leverancier: "Wijnhandel Smit",
  locatie: { kelder: "Kelder", rek: "1", rij: 2, vak: 3 },
  favoriet: true,
  notitie: "Cadeau",
  ...over,
});

const backup = (over: Partial<WijnkelderBackup> = {}): WijnkelderBackup => ({
  app: "wijnkelder",
  versie: 1,
  flessen: [fles()],
  notities: [],
  historie: [],
  ...over,
});

describe("reading the file", () => {
  it("accepts a Wijnkelder backup and refuses anything else, plainly", () => {
    expect(parseWijnkelderBackup(JSON.stringify(backup())).ok).toBe(true);
    expect(parseWijnkelderBackup("not json at all")).toEqual({ ok: false, error: "not-json" });
    expect(parseWijnkelderBackup(JSON.stringify({ app: "goals", flessen: [] }))).toEqual({
      ok: false,
      error: "not-wijnkelder",
    });
    // An empty cellar is a valid backup too.
    expect(parseWijnkelderBackup(JSON.stringify({ app: "wijnkelder" })).ok).toBe(true);
  });
});

describe("scores", () => {
  it("are read on the scale the old app was used with", () => {
    expect(detectScoreScale([4, 4.5, 3])).toBe(5);
    expect(detectScoreScale([8, 9, 7.5])).toBe(10);
    expect(detectScoreScale([88, 91, 85])).toBe(100);
    expect(detectScoreScale([0, null as never])).toBeNull();
  });
  it("become half stars (1..10)", () => {
    expect(toHalfStars(4.5, 5)).toBe(9);
    expect(toHalfStars(7, 10)).toBe(7);
    expect(toHalfStars(88, 100)).toBe(9);
    expect(toHalfStars(0, 10)).toBeNull();
    expect(toHalfStars(null, 10)).toBeNull();
    expect(toHalfStars(5, null)).toBeNull();
    expect(toHalfStars(500, 100)).toBe(10); // never above five stars
  });
});

describe("planning the move", () => {
  it("turns a count into that many bottles, in the spots they were in", () => {
    const plan = planWijnkelderImport(backup());
    expect(plan.wines).toHaveLength(1);
    expect(plan.wines[0]).toMatchObject({
      producer: "Château Margaux",
      name: "Pavillon Rouge",
      type: "red",
      countryCode: "FR",
      region: "Bordeaux",
      appellation: "Margaux",
      favorite: true,
    });
    const cellar = plan.bottles.filter((b) => b.status === "in_cellar");
    expect(cellar).toHaveLength(3);
    expect(cellar[0]).toMatchObject({
      year: 2015,
      formatMl: 750,
      priceCents: 2450,
      purchasedAt: "2020-05-17",
      purchasedFrom: "Wijnhandel Smit",
      notes: "Cadeau",
      row: 2,
      col: 3,
    });
    // The other two take the next free spots in the same rack: nothing is lost.
    expect(cellar.every((b) => b.unitKey !== null)).toBe(true);
    expect(new Set(cellar.map((b) => `${b.row}:${b.col}`)).size).toBe(3);
    expect(plan.units).toEqual(
      [{ key: "|1", label: "Kelder", kind: "rack", rows: 2, cols: 3 }].map((u) => ({
        ...u,
        key: "Kelder|1",
        label: "Rack 1",
      })),
    );
  });

  it("keeps wines apart by vintage but together by wine", () => {
    const plan = planWijnkelderImport(
      backup({
        flessen: [
          fles({ id: "a", jaargang: 2015, aantal: 1 }),
          fles({ id: "b", jaargang: 2016, aantal: 1, locatie: {} }),
        ],
      }),
    );
    expect(plan.wines).toHaveLength(1);
    expect(plan.bottles.map((b) => b.year).sort()).toEqual([2015, 2016]);
  });

  it("understands the old words: colours, countries, sizes, prices with commas", () => {
    const plan = planWijnkelderImport(
      backup({
        flessen: [
          fles({
            kleur: "mousserend",
            land: "Verenigd Koninkrijk",
            formaat: "magnum",
            aankoopPrijs: "42,50",
            aantal: 1,
          }),
          fles({
            id: "x",
            naam: "Other",
            kleur: "zoet",
            land: "Hongarije",
            aantal: 1,
            locatie: {},
          }),
        ],
      }),
    );
    const [a, b] = plan.wines;
    expect(a).toMatchObject({ type: "sparkling", countryCode: "GB" });
    expect(b).toMatchObject({ type: "dessert", countryCode: "HU" });
    expect(plan.bottles[0]).toMatchObject({ formatMl: 1500, priceCents: 4250 });
  });

  it("says what it could not understand, instead of guessing in silence", () => {
    const plan = planWijnkelderImport(
      backup({
        flessen: [
          fles({
            land: "Atlantis",
            jaargang: 1066,
            kleur: "paars",
            aankoopDatum: "gisteren",
            aantal: 1,
          }),
          fles({ id: "n", naam: "", aantal: 1 }),
        ],
      }),
    );
    const codes = plan.report.warnings.map((w) => w.code);
    expect(codes).toEqual(
      expect.arrayContaining(["country-unknown", "year-invalid", "type-unknown", "date-invalid"]),
    );
    expect(plan.report.skipped).toEqual([
      { what: "bottle", reason: "no-name", example: "(no name)" },
    ]);
    // The bottle itself is still imported, as non-vintage.
    expect(plan.bottles[0]).toMatchObject({ year: null });
  });

  it("caps an absurd count, and says so", () => {
    const plan = planWijnkelderImport(backup({ flessen: [fles({ aantal: 5000, locatie: {} })] }));
    expect(plan.bottles).toHaveLength(200);
    expect(plan.report.warnings.find((w) => w.code === "quantity-capped")).toBeTruthy();
  });

  it("when a spot is already taken, the bottle takes the next free one and it is reported", () => {
    const plan = planWijnkelderImport(
      backup({
        flessen: [fles({ id: "a", aantal: 1 }), fles({ id: "b", naam: "Twin", aantal: 1 })],
      }),
    );
    expect(plan.report.warnings.find((w) => w.code === "spot-taken")).toBeTruthy();
    expect(plan.report.counts.unplaced).toBe(0);
  });

  it("opened bottles come from the history, and their tasting notes attach to them", () => {
    const plan = planWijnkelderImport(
      backup({
        flessen: [fles({ aantal: 1 })],
        historie: [
          { type: "toegevoegd", flesId: "f1", aantal: 3 },
          { type: "gedronken", flesId: "f1", aantal: 2, datum: "2026-03-01" },
          {
            type: "gedronken",
            flesId: "gone",
            aantal: 1,
            datum: "2025-12-24",
            momentopname: {
              naam: "Old Friend",
              producent: "Domaine X",
              kleur: "wit",
              land: "Frankrijk",
              jaargang: 2010,
            },
          },
        ],
        notities: [
          {
            flesId: "f1",
            datum: "2026-03-01",
            score: 4.5,
            tekst: "Prachtig",
            geur: "cassis",
            smaak: "zijdezacht",
          },
          { flesId: "gone", datum: "2025-12-24", score: 4, tekst: "" },
          { flesId: "nobody", datum: "2025-01-01", score: 3, tekst: "?" },
        ],
      }),
    );
    expect(plan.report.counts).toMatchObject({ bottlesInCellar: 1, bottlesOpened: 3, wines: 2 });
    const opened = plan.bottles.filter((b) => b.status === "opened");
    expect(opened.map((b) => b.openedAt)).toEqual([
      "2026-03-01T12:00:00.000Z",
      "2026-03-01T12:00:00.000Z",
      "2025-12-24T12:00:00.000Z",
    ]);
    // Scores were on a 5-star scale: 4.5 → 9, 4 → 8.
    expect(plan.tastings).toHaveLength(2);
    const [first, second] = plan.tastings;
    expect(first).toMatchObject({
      score: 9,
      bottleKey: opened[0]!.key,
      note: "Prachtig\nNose: cassis\nPalate: zijdezacht",
    });
    expect(second).toMatchObject({ score: 8, bottleKey: opened[2]!.key, note: null });
    // A note about a bottle nobody knows is reported, not invented.
    expect(
      plan.report.skipped.some((s) => s.what === "note" && s.reason === "unknown-bottle"),
    ).toBe(true);
  });

  it("a score put straight on a bottle becomes a rating too", () => {
    const plan = planWijnkelderImport(
      backup({ flessen: [fles({ score: 88, aantal: 1, aangemaakt: Date.UTC(2024, 0, 5) })] }),
    );
    expect(plan.report.scoreScale).toBe(100);
    expect(plan.tastings).toEqual([
      expect.objectContaining({
        score: 9,
        bottleKey: null,
        note: null,
        tastedAt: "2024-01-05T12:00:00.000Z",
      }),
    ]);
  });

  it("builds a rack per rack, labelled so they can be told apart", () => {
    const plan = planWijnkelderImport(
      backup({
        flessen: [
          fles({ id: "a", aantal: 1, locatie: { kelder: "Kelder", rek: "1", rij: 4, vak: 8 } }),
          fles({
            id: "b",
            naam: "B",
            aantal: 1,
            locatie: { kelder: "Kelder", rek: "2", rij: 1, vak: 1 },
          }),
          fles({
            id: "c",
            naam: "C",
            aantal: 1,
            locatie: { kelder: "Garage", rek: "", rij: 2, vak: 2 },
          }),
        ],
      }),
    );
    expect(plan.units.map((u) => [u.label, u.rows, u.cols])).toEqual([
      ["Garage", 2, 2],
      ["Kelder · Rack 1", 4, 8],
      ["Kelder · Rack 2", 1, 1],
    ]);
  });

  it("knows an empty backup", () => {
    const plan = planWijnkelderImport({
      app: "wijnkelder",
      flessen: [],
      notities: [],
      historie: [],
    });
    expect(plan.report.counts).toEqual({
      wines: 0,
      bottlesInCellar: 0,
      bottlesOpened: 0,
      units: 0,
      tastings: 0,
      favorites: 0,
      unplaced: 0,
    });
  });
});

describe("sending it over", () => {
  it("drops the heavy extras (label photos) but changes nothing about the plan", () => {
    const full = backup({
      flessen: [
        fles({ foto: "data:image/jpeg;base64," + "A".repeat(50_000), score: 4 }),
        fles({ id: "g", naam: "Second", locatie: { kelder: "Garage", rek: "", rij: 1, vak: 2 } }),
      ],
      notities: [
        {
          flesId: "f1",
          datum: "2026-01-02",
          score: 4,
          tekst: "Fine",
          foto: "data:image/jpeg;base64," + "B".repeat(50_000),
          momentopname: {
            naam: "Pavillon Rouge",
            producent: "Château Margaux",
            foto: "C".repeat(9),
          },
        },
      ],
      historie: [{ type: "gedronken", flesId: "f1", aantal: 1, datum: "2026-01-02", extra: "x" }],
    });
    const slim = slimWijnkelderBackup(full);
    expect(JSON.stringify(slim).length).toBeLessThan(5_000);
    expect(JSON.stringify(slim)).not.toContain("base64");
    expect(planWijnkelderImport(slim)).toEqual(planWijnkelderImport(full));
  });

  it("a request defaults to a dry run, so nothing is written by accident", () => {
    const parsed = ImportRequestSchema.parse({ backup: backup() });
    expect(parsed.dryRun).toBe(true);
    expect(ImportRequestSchema.safeParse({ backup: { app: "other" } }).success).toBe(false);
    expect(ImportRequestSchema.safeParse({ backup: backup(), scoreScale: 7 }).success).toBe(false);
  });
});

describe("racks big enough for what is in them", () => {
  it("grow to hold a count of bottles that all sit at one position", () => {
    const plan = planWijnkelderImport(
      backup({
        flessen: [fles({ aantal: 7, locatie: { kelder: "K", rek: "1", rij: 1, vak: 1 } })],
      }),
    );
    const [unit] = plan.units;
    expect(unit!.rows * unit!.cols).toBeGreaterThanOrEqual(7);
    expect(plan.report.counts.unplaced).toBe(0);
    expect(new Set(plan.bottles.map((b) => `${b.row}:${b.col}`)).size).toBe(7);
  });

  it("stop at the biggest rack the app draws, and what does not fit stays unplaced", () => {
    const plan = planWijnkelderImport(
      backup({
        flessen: Array.from({ length: 5 }, (_, i) =>
          fles({
            id: `f${i}`,
            naam: `W${i}`,
            aantal: 200,
            locatie: { kelder: "K", rek: "1", rij: 1, vak: 1 },
          }),
        ),
      }),
    );
    expect(plan.units[0]).toMatchObject({ rows: 30, cols: 30 });
    expect(plan.report.counts.unplaced).toBe(100);
  });
});
