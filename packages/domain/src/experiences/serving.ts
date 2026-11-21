import type { WineType } from "../cellar";
import type { EvidenceTier, WineStructure } from "../pairing-engine/wine";

/**
 * HOW TO SERVE A BOTTLE: how cool, whether to decant and for how long, which glass. Rules of thumb every
 * sommelier uses, computed from the wine's structure and age. A researched profile of the exact wine that states
 * a serving temperature or a decanting time wins over these; the answer says which of the two it is.
 */

export interface ServingAdvice {
  /** Serving temperature in °C. */
  tempC: { min: number; max: number };
  /** Roughly how long in a fridge from room temperature (about 20 °C) to get there, in minutes; 0: none. */
  fridgeMinutes: number;
  decant: DecantAdvice;
  glass: Glass;
  /** Where the temperature and decanting came from: the wine's own profile, or the engine's rule for its style. */
  basis: "profile" | "style";
  /** How well the wine is known; an estimate is worded as one. */
  tier: EvidenceTier;
}

export const DECANT_KINDS = [
  /** No need. */
  "no",
  /** Young and firm: air softens it. */
  "air",
  /** Old: stand it upright, pour gently off the sediment just before serving; no long airing. */
  "sediment",
  /** A short splash in a carafe is optional. */
  "optional",
] as const;
export type DecantKind = (typeof DECANT_KINDS)[number];
export interface DecantAdvice {
  kind: DecantKind;
  /** Minutes of air before serving; 0 when it should be poured straight away. */
  minutes: number;
}

export const GLASSES = [
  "flute-or-tulip",
  "white",
  "large-white",
  "red",
  "large-red",
  "small",
] as const;
export type Glass = (typeof GLASSES)[number];

export interface ServingInput {
  type: WineType;
  structure: WineStructure;
  tier: EvidenceTier;
  /** The harvest year, when the wine has one. */
  year: number | null;
  /** From a researched profile of this wine, when it states them. */
  profile?: { serving: { minC: number; maxC: number } | null; decantMinutes: number | null } | null;
}

function temperature(type: WineType, s: WineStructure): { min: number; max: number } {
  if (type === "sparkling")
    return s.body >= 2.5 && s.sweetness < 2 ? { min: 8, max: 10 } : { min: 6, max: 8 };
  if (type === "dessert") return { min: 8, max: 10 };
  if (type === "fortified") {
    if (s.sweetness < 1) return { min: 7, max: 9 }; // fino, manzanilla
    return s.tannin >= 3 ? { min: 16, max: 18 } : { min: 12, max: 14 }; // vintage and ruby; tawny
  }
  if (type === "rose") return { min: 8, max: 10 };
  if (type === "orange") return { min: 12, max: 14 };
  if (type === "white") {
    if (s.sweetness >= 2) return { min: 7, max: 9 };
    if (s.body >= 3.5 || s.oak >= 2) return { min: 11, max: 13 };
    return s.body <= 1.5 ? { min: 7, max: 9 } : { min: 9, max: 11 };
  }
  // Red
  if (s.body <= 2.5 && s.tannin <= 2.5) return { min: 13, max: 15 };
  if (s.body >= 4.5 || s.tannin >= 4) return { min: 17, max: 18 };
  return { min: 15, max: 17 };
}

function decanting(input: ServingInput, thisYear: number): DecantAdvice {
  const { type, structure: s, year } = input;
  const age = year === null ? null : Math.max(0, thisYear - year);
  if (type === "sparkling" || type === "rose" || type === "dessert")
    return { kind: "no", minutes: 0 };
  if (type === "fortified") {
    // Vintage port throws a heavy sediment; the others are ready from the bottle.
    return s.tannin >= 3.5 && s.sweetness >= 3 && age !== null && age >= 8
      ? { kind: "sediment", minutes: 0 }
      : { kind: "no", minutes: 0 };
  }
  if (type === "white" || type === "orange")
    return s.body >= 4 && s.oak >= 2
      ? { kind: "optional", minutes: 20 }
      : { kind: "no", minutes: 0 };
  // Red: old bottles are fragile, young firm ones want air.
  const old = age !== null && age >= (s.tannin >= 4 ? 20 : 15);
  if (old) return { kind: "sediment", minutes: 0 };
  if (s.tannin >= 4 || (s.tannin >= 3.5 && s.body >= 4)) {
    // An age that is not known is not "young": air is offered, not prescribed.
    if (age === null) return { kind: "optional", minutes: 30 };
    return { kind: "air", minutes: age <= 8 ? 90 : 45 };
  }
  if (s.tannin >= 3 && s.body >= 3.5) return { kind: "optional", minutes: 30 };
  return { kind: "no", minutes: 0 };
}

function glass(type: WineType, s: WineStructure): Glass {
  if (type === "sparkling") return "flute-or-tulip";
  if (type === "dessert" || type === "fortified") return "small";
  if (type === "red") return s.body >= 4 || s.tannin >= 4 ? "large-red" : "red";
  if (type === "orange") return "large-white";
  return s.body >= 3.5 ? "large-white" : "white";
}

/** A fridge cools a bottle by very roughly one degree every eight minutes over this range. */
const fridge = (target: number) => (target >= 17 ? 0 : Math.round(((20 - target) * 8) / 5) * 5);

export function servingAdvice(input: ServingInput, thisYear: number): ServingAdvice {
  const stated = input.profile ?? null;
  const sound =
    stated?.serving &&
    stated.serving.minC >= 4 &&
    stated.serving.maxC <= 20 &&
    stated.serving.minC <= stated.serving.maxC
      ? { min: Math.round(stated.serving.minC), max: Math.round(stated.serving.maxC) }
      : null;
  const tempC = sound ?? temperature(input.type, input.structure);
  const ruled = decanting(input, thisYear);
  // The profile's decanting time is used where airing can make sense at all: never for bubbles, rosé or a sweet
  // wine, never for an old bottle of any colour (it is fragile), and never against sediment advice.
  const age = input.year === null ? null : Math.max(0, thisYear - input.year);
  const airable =
    input.type !== "sparkling" &&
    input.type !== "rose" &&
    input.type !== "dessert" &&
    ruled.kind !== "sediment" &&
    !(age !== null && age >= 15);
  const profileDecant = stated?.decantMinutes != null && airable;
  const decant: DecantAdvice = profileDecant
    ? stated.decantMinutes === 0
      ? { kind: "no", minutes: 0 }
      : { kind: "air", minutes: Math.min(stated.decantMinutes!, 240) }
    : ruled;
  return {
    tempC,
    fridgeMinutes: fridge((tempC.min + tempC.max) / 2),
    decant,
    glass: glass(input.type, input.structure),
    // "Known about this exact wine" only when everything said is: the temperature and the decanting. One of the
    // two from the rule makes the whole a rule of thumb (under-claiming is the safe side).
    basis: sound && profileDecant ? "profile" : "style",
    tier: input.tier,
  };
}
