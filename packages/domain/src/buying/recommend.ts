import type { FoodProfile } from "../food/types";
import { assessPairing, type Assessment } from "../pairing-engine/assess";
import { readWine, type WineKnowledge, type WineReading } from "../pairing-engine/wine";
import type { StyleReason } from "./codes";
import type { ConversationState } from "./state";
import { BUY_STYLES, type BuyStyle } from "./styles";

/**
 * WHAT TO BUY, as a style. The same pairing engine that judges an owned bottle judges every style in the
 * catalogue against the dish; the budget and the wished colour filter; taste and a receiver's preference order
 * what is left. The result is a style recommendation and says so: it names no product, no shop and no price of
 * anything on a shelf.
 */

export interface StyleSuggestion {
  style: BuyStyle;
  level: "style";
  reason: StyleReason;
  /** With a dish: how the style suits it. */
  assessment: Assessment | null;
}

export interface RecommendInput {
  /** The dish, when there is one. */
  food: FoodProfile | null;
  state: Pick<
    ConversationState,
    "intent" | "budgetMaxEuros" | "budgetMinEuros" | "wineType" | "recipientLikes"
  >;
  /** Wine keys the person likes (from their taste), strongest first; empty when unknown. */
  likes?: readonly string[];
  /** Wines the person named in the question ("an Albariño for the salmon"): they come first, if they suit. */
  asked?: readonly string[];
  /** Wine types the cellar already holds, to suggest something it lacks when there is no dish. */
  ownedTypes?: readonly string[];
  limit?: number;
}

const READINGS = new WeakMap<WineKnowledge, Map<string, WineReading>>();
function reading(style: BuyStyle, k: WineKnowledge): WineReading {
  let cache = READINGS.get(k);
  if (!cache) READINGS.set(k, (cache = new Map()));
  let r = cache.get(style.id);
  if (!r) cache.set(style.id, (r = readWine(style.wine, k)));
  return r;
}

/** Styles to have in the house when no dish was named: one of each kind that goes with many things. */
const VERSATILE = [
  "cava",
  "muscadet",
  "provence-rose",
  "beaujolais",
  "cotes-du-rhone",
  "malbec",
  "gruner",
  "chianti",
  "fino",
  "moscato",
];

export function recommendStyles(input: RecommendInput, k: WineKnowledge): StyleSuggestion[] {
  const { food, state } = input;
  const limit = input.limit ?? 3;
  const max = state.budgetMaxEuros;
  const min = state.budgetMinEuros;
  const within = BUY_STYLES.filter(
    (s) =>
      (max === null || s.fromEuros <= max) &&
      (state.wineType === null || s.wine.type === state.wineType),
  );
  const answersTo = (s: BuyStyle, keys: readonly string[]) => {
    const own = reading(s, k).keys;
    return keys.some((key) => own.includes(key) || s.id === key);
  };
  // With a floor ("at least €30"), styles that start near it come first; without, nothing changes.
  const floorFit = (s: BuyStyle) => (min === null ? 0 : s.fromEuros >= min * 0.6 ? 1 : 0);
  const asked = input.asked ?? [];
  const liked = [...(state.intent === "gift" ? state.recipientLikes : []), ...(input.likes ?? [])];

  if (food && food.main !== null) {
    const judged = within
      .map((s) => ({ s, a: assessPairing(food, { ...reading(s, k), type: s.wine.type }) }))
      .filter((x) => x.a.level !== "poor");
    // The best level the budget reaches: good styles, else ones that will do, else the ones nothing speaks
    // against. Someone who asks what to buy gets an answer; a style that clashes is never one.
    const top =
      (["good", "acceptable", "neutral"] as const)
        .map((level) => judged.filter((x) => x.a.level === level))
        .find((group) => group.length > 0) ?? [];
    // A style they asked for by name is advised when it does not clash, also beside better-suited ones.
    const best = [...judged.filter((x) => answersTo(x.s, asked) && !top.includes(x)), ...top];
    return best
      .sort(
        (x, y) =>
          Number(answersTo(y.s, asked)) - Number(answersTo(x.s, asked)) ||
          floorFit(y.s) - floorFit(x.s) ||
          y.a.score +
            (answersTo(y.s, liked) ? 4 : 0) +
            (y.s.common ? 2 : 0) -
            (x.a.score + (answersTo(x.s, liked) ? 4 : 0) + (x.s.common ? 2 : 0)),
      )
      .slice(0, limit)
      .map((x) => ({
        style: x.s,
        level: "style" as const,
        reason: "suits-dish" as const,
        assessment: x.a,
      }));
  }

  if (state.intent === "gift") {
    // What the receiver likes first; then bottles that read as a present. The budget is there to be used.
    const pool = within.filter((s) => answersTo(s, state.recipientLikes) || s.gift);
    return pool
      .sort(
        (a, b) =>
          Number(answersTo(b, state.recipientLikes)) - Number(answersTo(a, state.recipientLikes)) ||
          Number(b.gift) - Number(a.gift) ||
          b.fromEuros - a.fromEuros,
      )
      .slice(0, limit)
      .map((s) => ({
        style: s,
        level: "style" as const,
        reason: answersTo(s, state.recipientLikes) ? ("liked" as const) : ("gift-worthy" as const),
        assessment: null,
      }));
  }

  // No dish: what they like, then what the cellar lacks, then things that go with much.
  const owned = new Set(input.ownedTypes ?? []);
  const picks: StyleSuggestion[] = [];
  const add = (s: BuyStyle, reason: StyleReason) => {
    if (
      picks.length < limit &&
      !picks.some((p) => p.style.id === s.id || p.style.wine.type === s.wine.type)
    )
      picks.push({ style: s, level: "style", reason, assessment: null });
  };
  for (const s of within
    .filter((x) => answersTo(x, liked))
    .sort((a, b) => floorFit(b) - floorFit(a)))
    add(s, "liked");
  const versatile = VERSATILE.map((id) => within.find((s) => s.id === id)).filter(
    (s): s is BuyStyle => !!s,
  );
  if (owned.size > 0)
    for (const s of versatile.filter((x) => !owned.has(x.wine.type))) add(s, "fills-gap");
  for (const s of versatile) add(s, "versatile");
  return picks;
}
