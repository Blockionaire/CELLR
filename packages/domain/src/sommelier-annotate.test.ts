import { describe, expect, it } from "vitest";
import type { DrinkSummary } from "./cellar";
import {
  annotationEmphasis,
  BottleAnnotationSchema,
  drinkAnnotation,
  readAnnotations,
  type BottleAnnotation,
} from "./sommelier-annotate";

const drink = (over: Partial<DrinkSummary>): DrinkSummary => ({
  source: "estimate",
  reliable: false,
  uncertain: false,
  phase: "peak",
  from: 2022,
  until: 2031,
  urgency: 1,
  yearsUntilOpen: -4,
  yearsLeft: 5,
  position: 0.5,
  ...over,
});

const good: BottleAnnotation = {
  vintageId: "5000aa-0000-4000-8000-000000000000",
  drink: { advice: "drink-now", phase: "peak", from: 2022, until: 2031, basis: "style" },
  serving: {
    tempC: { min: 16, max: 18 },
    fridgeMinutes: 0,
    decant: { kind: "air", minutes: 90 },
    glass: "large-red",
    basis: "style",
    tier: "appellation",
  },
  reserved: { count: 2, free: 4, title: "Anniversary", on: "2026-12-12" },
  where: { places: ["Wine fridge"], unplaced: 1 },
};

describe("drink now or keep, from the app's own window", () => {
  it.each([
    ["young", "keep"],
    ["developing", "keep"],
    ["peak", "drink-now"],
    ["unknown", "unknown"],
  ] as const)("%s → %s", (phase, advice) => {
    expect(drinkAnnotation(drink({ phase })).advice).toBe(advice);
  });
  it("drink soon and past its window only from a window about this very wine", () => {
    expect(drinkAnnotation(drink({ phase: "ready", reliable: true, source: "own" }))).toEqual({
      advice: "drink-soon",
      phase: "ready",
      from: 2022,
      until: 2031,
      basis: "own",
    });
    expect(drinkAnnotation(drink({ phase: "past", reliable: true, source: "ai" })).advice).toBe(
      "past-window",
    );
    expect(drinkAnnotation(drink({ phase: "ready" })).advice).toBe("unknown");
    expect(drinkAnnotation(drink({ phase: "past" })).advice).toBe("unknown");
  });
  it("an uncertain or broken window gives no years", () => {
    expect(drinkAnnotation(drink({ uncertain: true, phase: "unknown" }))).toMatchObject({
      from: null,
      until: null,
    });
    expect(drinkAnnotation(drink({ from: 2031, until: 2022 }))).toMatchObject({
      from: null,
      until: null,
    });
    expect(drinkAnnotation(drink({ from: 1.5, until: 99999 }))).toMatchObject({
      from: null,
      until: null,
    });
    expect(drinkAnnotation(drink({ from: null, until: 2030 }))).toMatchObject({
      from: null,
      until: 2030,
    });
  });
});

describe("what a kept annotation may be", () => {
  it("a sound one parses, also without serving or reservation", () => {
    expect(BottleAnnotationSchema.safeParse(good).success).toBe(true);
    expect(
      BottleAnnotationSchema.safeParse({ ...good, serving: null, reserved: null }).success,
    ).toBe(true);
    expect(
      BottleAnnotationSchema.safeParse({ ...good, serving: { ...good.serving!, decant: null } })
        .success,
    ).toBe(true);
  });
  it.each([
    [
      "a temperature above 25 °C",
      { ...good, serving: { ...good.serving!, tempC: { min: 20, max: 30 } } },
    ],
    [
      "a temperature below 0 °C",
      { ...good, serving: { ...good.serving!, tempC: { min: -2, max: 4 } } },
    ],
    ["min above max", { ...good, serving: { ...good.serving!, tempC: { min: 18, max: 16 } } }],
    [
      "decanting over four hours",
      { ...good, serving: { ...good.serving!, decant: { kind: "air", minutes: 300 } } },
    ],
    ["a fridge over four hours", { ...good, serving: { ...good.serving!, fridgeMinutes: 500 } }],
    [
      "an unknown decanting",
      { ...good, serving: { ...good.serving!, decant: { kind: "shake", minutes: 0 } } },
    ],
    ["an unknown glass", { ...good, serving: { ...good.serving!, glass: "mug" } }],
    ["an unknown advice", { ...good, drink: { ...good.drink, advice: "sell" } }],
    ["a year out of range", { ...good, drink: { ...good.drink, from: 12 } }],
    ["thirteen places", { ...good, where: { places: Array(13).fill("x"), unplaced: 0 } }],
    ["a long place", { ...good, where: { places: ["x".repeat(121)], unplaced: 0 } }],
    ["negative unplaced", { ...good, where: { places: [], unplaced: -1 } }],
    ["no reserved bottle", { ...good, reserved: { ...good.reserved!, count: 0 } }],
    ["a long title", { ...good, reserved: { ...good.reserved!, title: "x".repeat(121) } }],
    ["no id", { ...good, vintageId: "" }],
    ["no where", { ...good, where: undefined }],
  ])("rejects %s", (_, value) => {
    expect(BottleAnnotationSchema.safeParse(value).success).toBe(false);
  });
  it("a kept answer from before this part (no annotations) reads as none; at most eight", () => {
    expect(readAnnotations(undefined)).toBeNull();
    expect(readAnnotations([])).toEqual([]);
    expect(readAnnotations(Array(8).fill(good))).toHaveLength(8);
    expect(readAnnotations(Array(9).fill(good))).toBeNull();
  });
});

describe("which line a question puts first", () => {
  it.each([
    ["At what temperature should I serve my Chablis?", "serving"],
    ["Moet ik de Barolo decanteren?", "serving"],
    ["How long can I keep the Barolo?", "keeping"],
    ["Is hij al op dronk?", "keeping"],
    ["What goes with lamb?", null],
    ["How long does an opened bottle keep?", null],
    ["8 guests, do I have enough wine?", null],
  ] as const)("%s → %s", (question, emphasis) => {
    expect(annotationEmphasis(question)).toBe(emphasis);
  });
});
