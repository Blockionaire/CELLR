import {
  FOOD,
  WINE_KNOWLEDGE,
  decidePairing,
  parseFood,
  readWine,
  type FoodProfile,
  type PairingCandidate,
} from "@cellr/domain/intelligence";
import { buildFixture, type FixtureWine } from "../fixtures";
import type { Capability, Engine, EvalAnswer, FoodTruth, Scenario } from "../types";

/**
 * SOMMELIER 3.0, THE ENGINES ALONE: the food engine reads the question, the wine engine reads every wine of the
 * cellar from what the app records about it (name, region, appellation, country, and a researched profile when the
 * scenario says there is one), and the pairing engine decides. No model, no database.
 *
 * This adapter measures the engines before they are wired into the app: it knows nothing of reserved bottles,
 * drinking windows, counted facts, conversations, buying or friends. Those arrive with the orchestrator (S3 and
 * later), which gets its own adapter; until then such scenarios count as not attempted.
 */
const CAPABILITIES: ReadonlySet<Capability> = new Set(["pairing", "evidence"]);

const round = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

export function truthOf(food: FoodProfile): Partial<FoodTruth> | null {
  if (food.main === null) return null;
  const s = food.structure;
  return {
    main: food.main,
    weight: round(s.weight, 1, 5) as FoodTruth["weight"],
    fat: round(s.fat, 0, 3) as FoodTruth["fat"],
    acid: round(s.acid, 0, 3) as FoodTruth["acid"],
    sweet: round(s.sweet, 0, 3) as FoodTruth["sweet"],
    heat: round(s.heat, 0, 3) as FoodTruth["heat"],
    umami: round(s.umami, 0, 3) as FoodTruth["umami"],
  };
}

/** A fixture wine as the app would know it: grapes and structure only through a researched profile. */
export function wineInput(f: FixtureWine) {
  return {
    type: f.wine.type,
    name: f.wine.name,
    region: f.stripped ? null : f.wine.region,
    appellation: f.stripped ? null : f.wine.appellation,
    countryCode: f.stripped ? null : f.wine.countryCode,
    profile: f.profiled
      ? {
          structure: f.wine.structure,
          grapes: f.wine.grapes,
          exact: true,
          evidence: "exact_wine" as const,
        }
      : null,
  };
}

export const v3: Engine = {
  name: "v3-engines",
  describes:
    "Sommelier 3.0 engines without the app around them: parseFood → readWine → decidePairing (no model)",
  capabilities: CAPABILITIES,
  async run(scenario: Scenario) {
    const missing = scenario.needs.filter((n) => !CAPABILITIES.has(n));
    const fixture = buildFixture(scenario);
    const question = scenario.turns.at(-1)!.user;

    const started = performance.now();
    const food = parseFood(question, FOOD);
    const candidates: PairingCandidate<string>[] = fixture.wines.map((f) => {
      const reading = readWine(wineInput(f), WINE_KNOWLEDGE);
      return { item: f.key, wine: { ...reading, type: f.wine.type }, tier: reading.tier };
    });
    const decision = food.main === null ? null : decidePairing(food, candidates);
    const ms = performance.now() - started;

    const answer: EvalAnswer = {
      ...(missing.length > 0 ? { unsupported: missing } : {}),
      food: { truth: truthOf(food) },
      verdict: decision?.outcome ?? null,
      bottles: decision?.picks.map((p) => p.item) ?? [],
      invented: 0,
      flags: [],
      facts: null,
      confidence: decision?.confidence ?? null,
      tiers: Object.fromEntries(candidates.map((c) => [c.item, c.tier])),
    };
    return { answer, ms };
  },
};
