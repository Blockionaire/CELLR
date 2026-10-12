import { describe, expect, it } from "vitest";
import {
  DISH_GROUPS,
  DISH_IDS,
  DISHES,
  dishById,
  matchesDish,
  scorePairing,
  wineProfile,
} from "./pairing";
import type { WineType } from "./cellar";

const wine = (type: WineType, region: string | null, countryCode: string | null = "FR") => ({
  type,
  region,
  countryCode,
});

describe("the dishes", () => {
  it("are well formed: unique, grouped, with colours that suit them and targets on the 0–5 scale", () => {
    expect(new Set(DISHES.map((d) => d.id)).size).toBe(DISHES.length);
    for (const d of DISHES) {
      expect(DISH_GROUPS).toContain(d.group);
      expect(Math.max(...Object.values(d.weights))).toBeGreaterThanOrEqual(0.8);
      for (const [ideal, tolerance] of [d.body, d.tannin, d.acidity, d.sweetness]) {
        expect(ideal).toBeGreaterThanOrEqual(0);
        expect(ideal).toBeLessThanOrEqual(5);
        expect(tolerance).toBeGreaterThan(0);
      }
    }
  });
  it("are listed once in the list of ids, and nowhere else", () => {
    expect(DISHES.map((d) => d.id)).toEqual([...DISH_IDS]);
  });
  it("can be found by id and by typing", () => {
    expect(dishById("steak")?.group).toBe("red-meat");
    expect(dishById("nonsense")).toBeUndefined();
    expect(matchesDish(dishById("pasta-tomato")!, "pasta", "Pasta with tomato sauce")).toBe(true);
    expect(matchesDish(dishById("steak")!, "FISH", "Steak")).toBe(false);
    expect(matchesDish(dishById("steak")!, "", "Steak")).toBe(true);
  });
});

describe("a wine's profile", () => {
  it("starts from its colour and is moved by where it is from", () => {
    const claret = wineProfile(wine("red", "Bordeaux"));
    const beaujolais = wineProfile(wine("red", "Beaujolais"));
    expect(claret.body).toBeGreaterThan(beaujolais.body);
    expect(claret.tannin).toBeGreaterThan(beaujolais.tannin);
    const riesling = wineProfile(wine("white", "Mosel", "DE"));
    const plain = wineProfile(wine("white", null, null));
    expect(riesling.acidity).toBeGreaterThan(plain.acidity);
    expect(riesling.sweetness).toBeGreaterThan(plain.sweetness);
  });
  it("stays on the 0–5 scale", () => {
    for (const type of [
      "red",
      "white",
      "rose",
      "sparkling",
      "dessert",
      "fortified",
      "orange",
    ] as const)
      for (const region of ["Beaujolais", "Priorat", "Mosel", "Piedmont", null]) {
        const p = wineProfile(wine(type, region));
        for (const v of Object.values(p)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(5);
        }
      }
  });
});

describe("how well a wine suits a dish", () => {
  const score = (dish: string, w: ReturnType<typeof wine>) => scorePairing(w, dishById(dish)!);

  it("steak wants a big red, not a light white", () => {
    expect(score("steak", wine("red", "Bordeaux")).score).toBeGreaterThan(
      score("steak", wine("white", "Chablis")).score + 25,
    );
  });
  it("shellfish wants crisp white or bubbles, not red", () => {
    const red = score("shellfish", wine("red", "Bordeaux")).score;
    expect(score("shellfish", wine("white", "Loire")).score).toBeGreaterThan(red + 25);
    expect(score("shellfish", wine("sparkling", "Champagne")).score).toBeGreaterThan(red + 25);
  });
  it("blue cheese wants something sweet; fries want bubbles", () => {
    expect(score("blue-cheese", wine("dessert", "Sauternes")).score).toBeGreaterThan(
      score("blue-cheese", wine("red", "Beaujolais")).score,
    );
    expect(score("fries", wine("sparkling", "Champagne")).score).toBeGreaterThan(
      score("fries", wine("red", "Bordeaux")).score,
    );
  });
  it("a classic region earns its bonus and says so", () => {
    const classic = score("lamb", wine("red", "Bordeaux"));
    const other = score("lamb", wine("red", "Stellenbosch", "ZA"));
    expect(classic.reasons).toContain("classic-region");
    expect(other.reasons).not.toContain("classic-region");
    expect(classic.score).toBeGreaterThan(other.score);
  });
  it("gives at most three reasons, never 100, never below 0", () => {
    for (const d of DISHES)
      for (const type of [
        "red",
        "white",
        "rose",
        "sparkling",
        "dessert",
        "fortified",
        "orange",
      ] as const) {
        const s = scorePairing(wine(type, "Bordeaux"), d);
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(98);
        expect(s.reasons.length).toBeLessThanOrEqual(3);
      }
  });
});
