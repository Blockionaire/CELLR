import { describe, expect, it } from "vitest";
import { FOOD } from "../food/knowledge";
import { parseFood } from "../food/parse";
import { GUARD_SETTINGS, GUARD_VERSION, guardPicks } from "./guard";
import { WINE_KNOWLEDGE } from "./knowledge";
import { readWine, type WineInput } from "./wine";

const wine = (input: Partial<WineInput> & Pick<WineInput, "type">) => ({
  ...readWine(
    {
      name: null,
      region: null,
      appellation: null,
      countryCode: null,
      profile: null,
      ...input,
    },
    WINE_KNOWLEDGE,
  ),
  type: input.type,
});
const BAROLO = wine({ type: "red", name: "Barolo", region: "Piemonte", appellation: "Barolo" });
const MUSCADET = wine({
  type: "white",
  name: "Muscadet Sèvre et Maine",
  region: "Loire",
  appellation: "Muscadet Sèvre et Maine",
});
const SAUTERNES = wine({ type: "dessert", name: "Sauternes", appellation: "Sauternes" });
const JUST_RED = wine({ type: "red" });

describe("the V1 guard (variant E)", () => {
  it("is frozen: version 1, judging dishes read with at least medium confidence", () => {
    expect(GUARD_VERSION).toBe(1);
    expect(GUARD_SETTINGS).toEqual({ minConfidence: "medium" });
  });

  it("flags a hard clash and nothing else, keeping the order it was given", () => {
    const oysters = parseFood("oysters", FOOD);
    const v = guardPicks(oysters, [
      { item: "muscadet", wine: MUSCADET },
      { item: "barolo", wine: BAROLO },
    ]);
    expect(v.considered).toBe(true);
    expect(v.flagged).toEqual([{ item: "barolo", index: 1, clash: "tannin-with-fish" }]);
  });

  it("says nothing without a dish, or about a wine known by its colour alone", () => {
    expect(guardPicks(null, [{ item: "b", wine: BAROLO }])).toEqual({
      considered: false,
      flagged: [],
    });
    expect(guardPicks(parseFood("what shall I open", FOOD), [{ item: "b", wine: BAROLO }])).toEqual(
      { considered: false, flagged: [] },
    );
    expect(guardPicks(parseFood("oysters", FOOD), [{ item: "r", wine: JUST_RED }]).flagged).toEqual(
      [],
    );
  });

  it("holds back a dessert wine with a savoury main course, and not with a dessert", () => {
    const steak = guardPicks(parseFood("grilled steak", FOOD), [{ item: "s", wine: SAUTERNES }]);
    expect(steak.flagged.map((f) => f.clash)).toEqual(["sweet-with-savoury"]);
    const tart = guardPicks(parseFood("apple tart", FOOD), [{ item: "s", wine: SAUTERNES }]);
    expect(tart.flagged).toEqual([]);
  });

  it("at a higher bar it judges fewer dishes, never more", () => {
    const food = parseFood("fish with some sauce", FOOD);
    const strict = guardPicks(food, [{ item: "b", wine: BAROLO }], { minConfidence: "high" });
    const loose = guardPicks(food, [{ item: "b", wine: BAROLO }], { minConfidence: "medium" });
    if (strict.considered) expect(loose.considered).toBe(true);
    expect(strict.flagged.length).toBeLessThanOrEqual(loose.flagged.length);
  });
});
