/**
 * HOW MANY BOTTLES FOR HOW MANY GUESTS. A bottle pours six glasses at table; over a dinner people drink about
 * half a bottle each across all the wines, less at a reception with one wine, more over a long evening.
 */

export const GATHERINGS = ["dinner", "reception", "long-evening"] as const;
export type Gathering = (typeof GATHERINGS)[number];

/** Bottles per person, across everything poured. */
const PER_PERSON: Record<Gathering, number> = {
  dinner: 0.5,
  reception: 0.35,
  "long-evening": 0.75,
};

export interface QuantityPlan {
  guests: number;
  /** Bottles of table wine needed in all. */
  bottles: number;
  /** When the meal has several wines: how many of each, in pouring order. */
  perWine: number[];
}

/**
 * `wines` is how many different wines will be poured (one per course, say). Each is rounded up on its own, so
 * nobody's glass stays empty at the last course; an aperitif or a dessert wine is poured smaller and needs less.
 */
export function bottlesFor(
  guests: number,
  options: { gathering?: Gathering; wines?: number; smallPours?: readonly number[] } = {},
): QuantityPlan {
  const people = Math.max(1, Math.min(500, Math.round(guests)));
  const wines = Math.max(1, Math.min(8, options.wines ?? 1));
  const total = people * PER_PERSON[options.gathering ?? "dinner"];
  const small = new Set(options.smallPours ?? []);
  // A small pour (dessert wine, aperitif) is about half a share.
  const shares = Array.from({ length: wines }, (_, i) => (small.has(i) ? 0.5 : 1));
  const sum = shares.reduce((a, b) => a + b, 0);
  const perWine = shares.map((share) => Math.max(1, Math.ceil((total * share) / sum - 1e-9)));
  return { guests: people, bottles: perWine.reduce((a, b) => a + b, 0), perWine };
}

/** Whether what is there is enough, and how many are missing. */
export function enoughFor(needed: number, available: number): { enough: boolean; short: number } {
  return { enough: available >= needed, short: Math.max(0, needed - available) };
}
