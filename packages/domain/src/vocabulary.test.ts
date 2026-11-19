import { describe, expect, it } from "vitest";
import { FOOD } from "./food/knowledge";
import { AFFINITY } from "./pairing-engine/assess";
import { ALL_WINE_KEYS } from "./pairing-engine/knowledge";

/**
 * The two knowledge sets were written apart and meet in one vocabulary: the names a dish uses for its classic
 * wines must be names a wine can answer to. A key nobody answers to is a classic that silently never counts.
 */
describe("dishes and wines speak the same language", () => {
  it("every classic of every dish is a key some wine answers to", () => {
    const unknown = new Set<string>();
    for (const dish of FOOD.dishes)
      for (const key of dish.classics ?? [])
        if (!ALL_WINE_KEYS.has(key)) unknown.add(`${dish.id}: ${key}`);
    expect([...unknown]).toEqual([]);
  });
  it("every affinity the pairing engine knows names a key some wine answers to", () => {
    const unknown = Object.values(AFFINITY)
      .flat()
      .filter((key) => !ALL_WINE_KEYS.has(key));
    expect([...new Set(unknown)]).toEqual([]);
  });
});
