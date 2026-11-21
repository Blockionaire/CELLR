import type { DishId } from "@cellr/domain";

/**
 * THE BENCHMARK'S CONTRACT. A scenario is a question (one or more turns) asked of a fixed cellar, with a reference
 * answer that was written down before any engine ran. An engine adapter answers it; score.ts compares the two.
 * Reference answers never come from an engine's own scoring: they are the labels in dishes.ts and the `expect`
 * block of the scenario. How the labels were made, and their limits, is in docs/sprints/sommelier-3-mega/BASELINE.md.
 */

/** The three honest outcomes of a pairing question. */
export type Verdict = "good" | "acceptable" | "none";

/** What an engine must be able to do to attempt a scenario. One that cannot is "unsupported", which counts as a miss. */
export const CAPABILITIES = [
  "pairing",
  "facts",
  "evidence",
  "conversation",
  "buying",
  "offers",
  "social",
  "experiences",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CATEGORIES = [
  "pairing-simple",
  "pairing-hard",
  "pairing-misleading",
  "no-suitable-wine",
  "empty-cellar",
  "missing-metadata",
  "inventory",
  "evidence",
  "budget",
  "follow-up",
  "multi-person",
  "revoked-sharing",
  "retail",
  "robustness",
  "experience",
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Coarse food truth for a reference dish, on 0–3 scales (0 none, 1 some, 2 clear, 3 dominant). */
export interface FoodTruth {
  /** What the dish is built on. */
  main:
    | "red-meat"
    | "game"
    | "pork"
    | "poultry"
    | "white-fish"
    | "oily-fish"
    | "shellfish"
    | "vegetable"
    | "mushroom"
    | "pasta-grain"
    | "egg"
    | "cheese"
    | "dessert"
    | "snack"
    | "pulse";
  /** How heavy the dish eats: 1 delicate … 5 very rich. */
  weight: 1 | 2 | 3 | 4 | 5;
  fat: 0 | 1 | 2 | 3;
  acid: 0 | 1 | 2 | 3;
  sweet: 0 | 1 | 2 | 3;
  heat: 0 | 1 | 2 | 3;
  umami: 0 | 1 | 2 | 3;
}

/** A reference dish: what it is, and which benchmark wines suit it. */
export interface DishCard {
  id: string;
  /** How a person would say it, in English and in Dutch. */
  en: string;
  nl: string;
  /** Readings by the V1 word list (the 46 legacy dishes) that count as sensible. Empty: V1 has no sensible category. */
  legacy: readonly DishId[];
  truth: FoodTruth;
  /** Wines (keys of wines.ts) a trained sommelier would recommend with confidence. */
  good: readonly string[];
  /** Wines that will do without a structural clash. Every wine in neither list is a poor choice for this dish. */
  ok: readonly string[];
  /** The reference reasoning, in one line. */
  why: string;
}

/** Changes to a named cellar, to build the situation a scenario is about. */
export interface CellarMods {
  /** Bottles kept for an occasion, per wine key (all of them when the number is at least the count). */
  reserved?: Readonly<Record<string, number>>;
  /** Another vintage year for a wine (to make it too young, or past its window). */
  years?: Readonly<Record<string, number>>;
  /** Wines whose region, appellation and country are unknown. "all" for every wine. */
  strip?: readonly string[] | "all";
  /** Wines with a researched profile of the exact wine (its structure is then known). "all" for every wine. */
  profiles?: readonly string[] | "all";
  /** How many bottles of a wine (default 2). */
  counts?: Readonly<Record<string, number>>;
  /** The household's rating of a wine, 1–10. */
  ratings?: Readonly<Record<string, number>>;
  favorites?: readonly string[];
}

export type OfferLevel = "style" | "product" | "online-offer" | "local-availability";

export interface Expectation {
  /** The outcome. "auto": from the dish card and the cellar (a good wine present, else an acceptable one, else none). */
  verdict?: Verdict | "auto";
  /** The first bottle must be labelled at least this well. Default with a dish: follows the verdict. */
  first?: "good" | "good-or-ok";
  /** Whether the dish must be understood (default true when the scenario has a dish). */
  food?: boolean;
  /** Wine keys that must not be offered to open (reserved to the last bottle, far too young, not in the cellar…). */
  never?: readonly string[];
  /** Exactly no bottle may be offered. */
  noBottles?: boolean;
  /** Things the answer must state as structured flags, not prose: a constraint that applies to a bottle it offers. */
  flags?: ReadonlyArray<"reserved" | "young" | "past" | "estimate" | "unknown-data">;
  /** A question about the cellar itself: the counted answer. */
  facts?: { bottles?: number; wines?: number; matchedBottles?: number };
  /** The most the engine may claim to know (a regional guess is never "high"). */
  maxConfidence?: "low" | "medium" | "high";
  /** The evidence tier the engine must report for a wine. */
  tiers?: Readonly<Record<string, "exact" | "appellation" | "estimate" | "unknown">>;
  buy?: {
    /** Buying advice must (true) or must not (false) be given. */
    given: boolean;
    /** Every priced suggestion stays within this many euros per bottle. */
    maxEuros?: number;
    minEuros?: number;
    /** The strongest claim allowed. With no approved retailer source this is "style". */
    maxLevel?: OfferLevel;
    /** At least one suggestion is one of these wine styles (keys of the engine's style catalogue). */
    styleAnyOf?: readonly string[];
  };
  /** The structured state after the last turn. Only the listed keys are compared. */
  state?: Readonly<Record<string, string | number | boolean | null>>;
  /** The one question the engine should ask next (a code), or null: it must not ask anything. */
  asks?: string | null;
  /** Questions it must not ask (already answered). */
  notAsk?: readonly string[];
  friends?: {
    /** Mentions that resolve to a friend, by handle. */
    resolved?: readonly string[];
    /** Friends whose taste may be used, and whose may not. */
    taste?: readonly string[];
    cellar?: readonly string[];
    /** Friends (or strangers) whose data must not appear anywhere in the answer. */
    denied?: readonly string[];
  };
  offers?: {
    /** Offer ids (of the scenario's provider fixture) that may be shown. Any other shown offer is a failure. */
    shown: readonly string[];
  };
  /** The answer must not follow an instruction hidden in the question or the data. */
  resistsInjection?: boolean;
}

export interface Turn {
  user: string;
  /** A budget chosen on screen for this turn, in whole euros. */
  budgetEuros?: number;
}

export interface Scenario {
  id: string;
  category: Category;
  lang: "en" | "nl";
  /** A named cellar of wines.ts. */
  cellar: string;
  mods?: CellarMods;
  turns: readonly Turn[];
  /** The reference dish the (last) question is about, when it is about food. */
  dish?: string;
  needs: readonly Capability[];
  expect: Expectation;
  /** Extra situation for social and retail scenarios; an engine without those capabilities never reads it. */
  world?: Readonly<Record<string, unknown>>;
  note?: string;
}

/** What an engine said, in the benchmark's own terms. */
export interface EvalAnswer {
  /** The engine could not attempt this (a capability it does not have). */
  unsupported?: Capability[];
  food?: { legacy?: DishId | null; truth?: Partial<FoodTruth> | null } | null;
  verdict: Verdict | null;
  /** Wine keys offered to open, best first. */
  bottles: string[];
  /** Offered wines that are not in the scenario's cellar (must be 0). */
  invented: number;
  flags?: string[];
  facts?: { bottles?: number; wines?: number; matchedBottles?: number } | null;
  confidence?: "low" | "medium" | "high" | null;
  tiers?: Record<string, string>;
  buy?: Array<{
    style: string | null;
    minEuros: number | null;
    maxEuros: number | null;
    level: OfferLevel;
  }>;
  state?: Record<string, string | number | boolean | null>;
  asks?: string | null;
  friends?: { resolved: string[]; taste: string[]; cellar: string[]; leaked: string[] };
  offers?: string[];
  followedInjection?: boolean;
  /** Model calls made and what they cost, when the engine uses one. */
  ai?: { calls: number; inputTokens: number; outputTokens: number; usdMicro: number };
  /**
   * Variant E in shadow mode (S11): what V1's guard would have held back of `bottles` (keys), for the last turn.
   * Absent for engines without the guard; null when it did not run for this answer.
   */
  guard?: { considered: boolean; flagged: string[] } | null;
}

export interface EngineRun {
  answer: EvalAnswer;
  /** Wall time of the engine's own work for the last turn, in milliseconds. */
  ms: number;
}

export interface Engine {
  name: string;
  /** One line for the report: what was actually run. */
  describes: string;
  capabilities: ReadonlySet<Capability>;
  run(scenario: Scenario): Promise<EngineRun>;
}
