import { z } from "zod";
import type { CellarItem, WineType } from "./cellar";
import type { Reservation } from "./insights";
import { DISH_IDS, dishById, scorePairing, type DishId, type MatchReason } from "./pairing";
import { tasteBonus, type TasteContext } from "./taste-context";

/**
 * WHAT SHALL WE DRINK TONIGHT? Everything here is arithmetic on your own cellar: how well the wine suits the
 * dish, whether it is ready, whether it fits the occasion. No guesswork is hidden: each pick comes with the
 * few reasons that put it there. (A smarter, conversational layer can sit on top later; this is its floor.)
 */

export const OCCASIONS = ["anything", "weeknight", "guests", "celebration", "use-it-up"] as const;
export type Occasion = (typeof OCCASIONS)[number];

export const TonightRequestSchema = z.object({
  /** What is being eaten (a dish id), or nothing in particular. */
  dish: z.enum(DISH_IDS).nullable().default(null),
  occasion: z.enum(OCCASIONS).default("anything"),
});
export type TonightRequest = z.infer<typeof TonightRequestSchema>;

/** The parts of a card the ranking needs, plus what was paid. */
export type TonightCandidate = Pick<
  CellarItem,
  | "vintageId"
  | "wineId"
  | "producer"
  | "wineName"
  | "type"
  | "year"
  | "region"
  | "countryCode"
  | "favorite"
  | "rating"
  | "drink"
> & { pricePerBottleCents: number | null };

export const TONIGHT_SLOTS = ["best", "alternative", "special"] as const;
export type TonightSlot = (typeof TONIGHT_SLOTS)[number];

/** Why a bottle is on the list: the food reasons from the pairing, then the rest. */
export type PickReason =
  | MatchReason
  | "at-its-best"
  | "use-soon"
  | "favorite"
  | "loved"
  | "easy"
  | "impressive"
  | "bubbles";

export type MatchLevel = "great" | "good" | "worth-a-try";

export interface TonightPick {
  slot: TonightSlot;
  candidate: TonightCandidate;
  /** The ranking score (not shown as a percentage: it is a ranking, not a measurement). */
  total: number;
  match: MatchLevel;
  reasons: PickReason[];
}

const euros = (cents: number | null): number | null => (cents === null ? null : cents / 100);

const DRINK_BONUS = {
  peak: 14,
  ready: 14,
  developing: 5,
  past: 8,
  young: -40,
  unknown: 0,
} as const;

interface Scored {
  candidate: TonightCandidate;
  total: number;
  pairing: number | null;
  reasons: PickReason[];
  /** The person's taste for this wine: only ever a tie-breaker between equal totals (see rankForTonight). */
  taste: number;
}

function occasionBonus(
  c: TonightCandidate,
  occasion: Occasion,
): { bonus: number; reason: PickReason | null } {
  const price = euros(c.pricePerBottleCents);
  switch (occasion) {
    case "weeknight":
      if (price === null) return { bonus: 0, reason: null };
      if (price <= 20) return { bonus: 8, reason: "easy" };
      return { bonus: price > 45 ? -12 : 0, reason: null };
    case "guests":
      if (price === null) return { bonus: 0, reason: null };
      if (price >= 15 && price <= 60) return { bonus: 8, reason: "impressive" };
      return { bonus: price < 10 ? -6 : price > 120 ? -10 : 0, reason: null };
    case "celebration": {
      // Bubbles and a bottle that cost something both say "occasion", and they add up.
      const bubbles = c.type === "sparkling";
      const dear = price !== null && price > 45;
      const cheap = price !== null && price <= 15;
      return {
        bonus: (bubbles ? 10 : 0) + (dear ? 10 : cheap ? -10 : 0),
        reason: bubbles ? "bubbles" : dear ? "impressive" : null,
      };
    }
    case "use-it-up":
      return {
        bonus: { past: 16, ready: 12, peak: 4, developing: 0, young: 0, unknown: 0 }[c.drink.phase],
        reason: c.drink.phase === "past" || c.drink.phase === "ready" ? "use-soon" : null,
      };
    default:
      return { bonus: 0, reason: null };
  }
}

/** Below this pairing score a wine is not a good match, and no taste may make it look like one. */
const TASTE_MIN_PAIRING = 55;

function score(
  c: TonightCandidate,
  request: TonightRequest,
  taste: TasteContext | null = null,
): Scored {
  const d = request.dish === null ? undefined : dishById(request.dish);
  const pairing = d ? scorePairing(c, d) : null;
  let total = pairing?.score ?? 60;
  const reasons: PickReason[] = [...(pairing?.reasons.slice(0, 2) ?? [])];

  // Taste only chooses between suitable wines: never for a poor pairing, never when the point is to use one up.
  // It is kept apart from the total, so it can never outweigh a better pairing or a readier wine.
  const personal =
    request.occasion !== "use-it-up" && (pairing === null || pairing.score >= TASTE_MIN_PAIRING)
      ? tasteBonus(c, taste)
      : 0;

  total += DRINK_BONUS[c.drink.phase];
  if (c.drink.phase === "peak") reasons.push("at-its-best");
  if ((c.drink.phase === "ready" || c.drink.phase === "past") && request.occasion !== "use-it-up")
    reasons.push("use-soon");

  if (c.favorite) {
    total += 4;
    reasons.push("favorite");
  }
  if (c.rating) {
    total += (c.rating.average - 3) * 5;
    if (c.rating.average >= 4) reasons.push("loved");
  }
  const o = occasionBonus(c, request.occasion);
  total += o.bonus;
  if (o.reason) reasons.push(o.reason);

  return {
    candidate: c,
    total,
    pairing: pairing?.score ?? null,
    reasons: [...new Set(reasons)].slice(0, 3),
    taste: personal,
  };
}

const level = (s: Scored): MatchLevel => {
  const basis = s.pairing ?? 60;
  return basis >= 75 ? "great" : basis >= 55 ? "good" : "worth-a-try";
};

/** How special a bottle is: what it cost and how old it is. Used for the "special choice" only. */
const specialness = (c: TonightCandidate, now: Date): number => {
  const age = c.year === null ? 0 : Math.min(25, Math.max(0, now.getUTCFullYear() - c.year));
  return (euros(c.pricePerBottleCents) ?? 0) + 3 * age;
};

/**
 * Up to three suggestions: the best match; an alternative of another colour (or, failing that, another wine);
 * and a special choice among the strong contenders. Wines that are not ready are left out unless nothing else is.
 */
export function rankForTonight(
  candidates: readonly TonightCandidate[],
  request: TonightRequest,
  now: Date,
  /**
   * The person's own taste, when they have one and want it used. It only breaks a tie between wines with the
   * same total (where the name decides otherwise): it never changes the order of wines that differ at all.
   */
  taste: TasteContext | null = null,
): TonightPick[] {
  if (candidates.length === 0) return [];
  const ready = candidates.filter((c) => c.drink.phase !== "young");
  const pool = (ready.length > 0 ? ready : candidates).map((c) => score(c, request, taste));
  pool.sort(
    (a, b) =>
      b.total - a.total ||
      b.taste - a.taste ||
      a.candidate.wineName.localeCompare(b.candidate.wineName),
  );

  const picks: Array<Scored & { slot: TonightSlot }> = [];
  const taken = new Set<string>();
  const take = (s: Scored | undefined, slot: TonightSlot) => {
    if (!s || taken.has(s.candidate.vintageId)) return;
    taken.add(s.candidate.vintageId);
    picks.push({ ...s, slot });
  };

  const best = pool[0]!;
  take(best, "best");
  take(
    pool.find(
      (s) => !taken.has(s.candidate.vintageId) && s.candidate.type !== best.candidate.type,
    ) ??
      pool.find(
        (s) => !taken.has(s.candidate.vintageId) && s.candidate.wineId !== best.candidate.wineId,
      ),
    "alternative",
  );
  const contenders = pool
    .filter((s) => !taken.has(s.candidate.vintageId) && s.total >= best.total - 25)
    .slice(0, 10);
  take(
    contenders.sort(
      (a, b) => specialness(b.candidate, now) - specialness(a.candidate, now) || b.total - a.total,
    )[0],
    "special",
  );

  return picks.map((p) => ({
    slot: p.slot,
    candidate: p.candidate,
    total: Math.round(p.total * 10) / 10,
    match: level(p),
    reasons: p.reasons,
  }));
}

/** A pick, with the one bottle to open and where it is. */
export interface TonightPickView {
  slot: TonightSlot;
  match: MatchLevel;
  reasons: PickReason[];
  vintageId: string;
  /** The bottle to open: the easiest one to reach. */
  bottleId: string;
  producer: string;
  wineName: string;
  type: WineType;
  year: number | null;
  region: string | null;
  countryCode: string | null;
  /** Bottles of this vintage in the cellar. */
  count: number;
  place: { label: string; row: number; col: number } | null;
  drinkPhase: CellarItem["drink"]["phase"];
  /** Some of these bottles are kept for an occasion (the one to open is never one of them, when there is a choice). */
  reserved?: Reservation | null;
}

export interface TonightView {
  dish: DishId | null;
  occasion: Occasion;
  picks: TonightPickView[];
  /** How many wines in the cellar took part. */
  considered: number;
  /** The person's taste changed which bottles were picked, or their order (see rankWithTaste). */
  personal?: boolean;
}

/**
 * The ranking with the person's taste, and whether that taste made a difference: the same ranking is done
 * without it (in memory, on the same candidates) and the picks are compared, bottle by bottle and in order.
 * Only then may the answer say it was chosen for them.
 */
export function rankWithTaste(
  candidates: readonly TonightCandidate[],
  request: TonightRequest,
  now: Date,
  taste: TasteContext | null,
): { picks: TonightPick[]; personal: boolean } {
  const picks = rankForTonight(candidates, request, now, taste);
  if (!taste) return { picks, personal: false };
  const general = rankForTonight(candidates, request, now);
  const order = (list: TonightPick[]) => list.map((p) => p.candidate.vintageId).join(",");
  return { picks, personal: order(picks) !== order(general) };
}
