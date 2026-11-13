import { z } from "zod";
import {
  MAX_PRICE_CENTS,
  normalizeText,
  WINE_COUNTRIES,
  WINE_TYPES,
  type CellarItem,
  type WineSummary,
} from "./cellar";
import { MATCH, nameSimilarity, scoreWine, type Confidence, type LabelFacts } from "./scan";
import { toSommelierBottle, type SommelierBottle } from "./sommelier";
import type { PurchaseKnowledge } from "./wine-knowledge";
import {
  FAVOURITE_MIN_SCORE,
  MIN_FAVOURITE_WINES,
  winePoints,
  type TastePreferences,
  type TasteTasting,
} from "./taste";

/**
 * KOOPCHECK (PURCHASE CHECK): "should I buy this wine, given what I already own and what I like?"
 *
 * A bottle in a shop is compared with the household's real cellar and the person's own taste, by plain code. Three
 * kinds of knowledge are kept apart:
 *  1. facts about the wine in the shop (what the label says, or what the person typed);
 *  2. evidence about the person (their own answers and ratings, only where the taste profile's minimums are met);
 *  3. the comparison between the two, every finding with a reason code the screen turns into words.
 * No model decides anything here: not what is owned, not how many bottles, not what is similar.
 */

// ---- The wine in the shop -----------------------------------------------------------------------------------

/** Typed or read text: one line, no control characters, trimmed; empty means "not known". */
const line = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((s) =>
      s
        // eslint-disable-next-line no-control-regex -- stripping control characters is the point
        .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
        .trim(),
    );
const optionalLine = (max: number) =>
  line(max)
    .nullable()
    .default(null)
    .transform((s) => (s ? s : null));

export const PURCHASE_LIMITS = {
  producer: 120,
  name: 160,
  region: 120,
  appellation: 160,
  grape: 40,
};

/** The wine as the person confirmed it (corrected or typed). Only the producer is required. */
export const PurchaseWineSchema = z.object({
  producer: line(PURCHASE_LIMITS.producer).pipe(z.string().min(1)),
  name: optionalLine(PURCHASE_LIMITS.name),
  /** The vintage; null with `nonVintage` false means "not known". */
  year: z
    .number()
    .int()
    .min(1800)
    .refine((y) => y <= new Date().getUTCFullYear() + 1)
    .nullable()
    .default(null),
  nonVintage: z.boolean().default(false),
  type: z.enum(WINE_TYPES).nullable().default(null),
  countryCode: z.enum(WINE_COUNTRIES).nullable().default(null),
  region: optionalLine(PURCHASE_LIMITS.region),
  appellation: optionalLine(PURCHASE_LIMITS.appellation),
  grapes: z
    .array(line(PURCHASE_LIMITS.grape))
    .max(6)
    .default([])
    .transform((gs) => [...new Set(gs.filter(Boolean))]),
});
export type PurchaseWine = z.infer<typeof PurchaseWineSchema>;

export const PurchaseCheckRequestSchema = z.object({
  wine: PurchaseWineSchema,
  /** The asking price per bottle, in euro cents, when the person typed one. Only shown, never judged. */
  priceCents: z.number().int().min(0).max(MAX_PRICE_CENTS).nullable().default(null),
});
export type PurchaseCheckRequest = z.input<typeof PurchaseCheckRequestSchema>;

/** What the photo step answers: the wine to confirm (never saved anywhere), or why it could not be read. */
export interface PurchaseRecognition {
  /** The wine as read, to correct; null when nothing was read (then the person types it). */
  wine: PurchaseWine | null;
  /** How it was read: the label's printed text named a CELLR wine (no model), or the vision model read it. */
  source: "text" | "vision" | null;
  /** Why there is no reading. "limit" / "budget": no more photos for now; the manual path always works. */
  reason: "ai-off" | "ai-down" | "limit" | "budget" | "not-a-label" | null;
  /** How legible the model found each field (only for a vision reading). */
  confidence: { producer: Confidence; name: Confidence; year: Confidence } | null;
  /** The reading is exactly one CELLR catalogue wine (its missing kind, country or region filled from it). */
  catalog: boolean;
}

/** The wine as label facts, so the scan's own matching can be used on it. */
export const purchaseFacts = (wine: PurchaseWine): LabelFacts => ({
  producer: wine.producer,
  name: wine.name,
  year: wine.year,
  nonVintage: wine.nonVintage,
  type: wine.type,
  countryCode: wine.countryCode,
  region: wine.region,
  appellation: wine.appellation,
  grapes: wine.grapes,
  abv: null,
  volumeMl: null,
  confidence: { producer: "high", name: "high", year: "high" },
});

/** A label reading (after the scan's plausibility checks) as the wine to confirm. Nothing is filled in. */
export function purchaseWineFrom(facts: LabelFacts): PurchaseWine | null {
  const producer = facts.producer ?? facts.name;
  if (!producer) return null;
  return {
    producer,
    name: facts.producer ? facts.name : null,
    year: facts.year,
    nonVintage: facts.nonVintage,
    type: facts.type,
    countryCode: (WINE_COUNTRIES as readonly string[]).includes(facts.countryCode ?? "")
      ? (facts.countryCode as PurchaseWine["countryCode"])
      : null,
    region: facts.region,
    appellation: facts.appellation,
    grapes: facts.grapes.slice(0, 6),
  };
}

// ---- What CELLR knows about the household's own wines --------------------------------------------------------

/** What the cellar list does not carry, per wine. */
export interface PurchaseWineTraits {
  appellation: string | null;
  /** From the curated catalogue, or from a wine profile that rests on this exact wine (never a regional guess). */
  grapes: string[];
  /** Verified other names (catalogue wines only). */
  aliases: string[];
  /** The catalogue wines this wine verifiably is: itself when it is one, or the one it is linked to. */
  catalogIds: string[];
}

export interface PurchaseCheckInput {
  wine: PurchaseWine;
  priceCents: number | null;
  /** The one CELLR catalogue wine the confirmed facts exactly are (producer, name or verified alias), if any. */
  catalogWineId: string | null;
  /** The active household's cellar: one item per vintage with bottles in it. */
  items: readonly CellarItem[];
  traits: ReadonlyMap<string, PurchaseWineTraits>;
  /** The signed-in person's own tastings in this household, and their own answers. */
  tastings: readonly TasteTasting[];
  preferences: TastePreferences;
}

// ---- 1. Is it already in the cellar? ------------------------------------------------------------------------

export type OwnershipKind = "exact" | "other_vintages" | "same_wine" | "possible" | "none";

export interface PurchaseOwnership {
  /**
   * exact: this very wine and vintage. other_vintages: this wine, other vintages only. same_wine: this wine, but the
   * vintage in the shop is not known. possible: a wine of a very similar name, NOT confirmed to be this one (never
   * counted as owned). none: nothing.
   */
  kind: OwnershipKind;
  exact: SommelierBottle[];
  otherVintages: SommelierBottle[];
  possible: SommelierBottle[];
  exactBottles: number;
  otherBottles: number;
}

const norm = (s: string | null | undefined) => (s ? normalizeText(s) : "");
const conflict = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a !== b);

/**
 * Whether a cellar wine IS the wine in the shop: verifiably the same catalogue wine, or the same producer and the
 * same name (or one of its verified aliases) after normalising case and accents, with no colour or country that
 * contradicts it. Similar names are never enough.
 */
export function isSameWine(
  wine: PurchaseWine,
  catalogWineId: string | null,
  cellar: Pick<CellarItem, "producer" | "wineName" | "type" | "countryCode">,
  traits: Pick<PurchaseWineTraits, "aliases" | "catalogIds"> | undefined,
): boolean {
  if (conflict(wine.type, cellar.type) || conflict(wine.countryCode, cellar.countryCode))
    return false;
  if (catalogWineId && traits?.catalogIds.includes(catalogWineId)) return true;
  if (!wine.name || norm(wine.producer) !== norm(cellar.producer)) return false;
  const names = [cellar.wineName, ...(traits?.aliases ?? [])].map(norm);
  return names.includes(norm(wine.name));
}

/** A name close enough to ask "is it this one?", but not confirmed. */
function looksLikeSameWine(wine: PurchaseWine, item: CellarItem): boolean {
  if (conflict(wine.type, item.type) || conflict(wine.countryCode, item.countryCode)) return false;
  const summary: WineSummary = {
    id: item.wineId,
    producer: item.producer,
    name: item.wineName,
    type: item.type,
    countryCode: item.countryCode,
    region: item.region,
  };
  if (wine.name) return scoreWine(purchaseFacts(wine), summary) >= MATCH.strong;
  // No wine name on the label: the same estate, of the same colour, may or may not be this wine.
  return wine.type !== null && nameSimilarity(wine.producer, item.producer) >= 0.9;
}

const byBottles = (a: CellarItem, b: CellarItem) =>
  b.count - a.count || (b.year ?? 0) - (a.year ?? 0) || a.vintageId.localeCompare(b.vintageId);

export function ownershipOf(input: PurchaseCheckInput): {
  ownership: PurchaseOwnership;
  sameWineIds: Set<string>;
  possibleWineIds: Set<string>;
} {
  const { wine, catalogWineId, items, traits } = input;
  const same = items.filter((i) => isSameWine(wine, catalogWineId, i, traits.get(i.wineId)));
  const sameWineIds = new Set(same.map((i) => i.wineId));
  const vintageKnown = wine.year !== null || wine.nonVintage;
  const exact = vintageKnown ? same.filter((i) => i.year === wine.year) : [];
  const other = same.filter((i) => !exact.includes(i)).sort(byBottles);
  const possibleItems = items
    .filter((i) => !sameWineIds.has(i.wineId) && looksLikeSameWine(wine, i))
    .sort(byBottles);
  const possibleWineIds = new Set(possibleItems.map((i) => i.wineId));
  const sum = (xs: readonly CellarItem[]) => xs.reduce((s, i) => s + i.count, 0);
  const kind: OwnershipKind =
    exact.length > 0
      ? "exact"
      : other.length > 0
        ? vintageKnown
          ? "other_vintages"
          : "same_wine"
        : possibleItems.length > 0
          ? "possible"
          : "none";
  return {
    ownership: {
      kind,
      exact: exact.map(toSommelierBottle),
      otherVintages: other.slice(0, 6).map(toSommelierBottle),
      possible: possibleItems.slice(0, 3).map(toSommelierBottle),
      exactBottles: sum(exact),
      otherBottles: sum(other),
    },
    sameWineIds,
    possibleWineIds,
  };
}

// ---- 2. Similar wines already in the cellar ----------------------------------------------------------------

export const SIMILAR_REASONS = [
  "same_producer",
  "same_appellation",
  "same_region",
  "same_grapes",
  "shared_grapes",
  "same_country",
] as const;
export type SimilarReason = (typeof SIMILAR_REASONS)[number];

/** How much each finding weighs. Only these, and only from data CELLR holds. */
const WEIGHT: Record<SimilarReason, number> = {
  same_producer: 3,
  same_appellation: 3,
  same_region: 2,
  same_grapes: 3,
  shared_grapes: 2,
  same_country: 1,
};
/** Comparable from this score, with at least one ANCHOR finding (and always the same kind of wine). */
export const SIMILAR_MIN = 3;
/**
 * The findings that say two wines are alike in the glass: where they come from, or what they are made of. The same
 * producer (who can make very different wines) and the same country only ever add to one of these.
 */
export const SIMILAR_ANCHORS: ReadonlySet<SimilarReason> = new Set([
  "same_appellation",
  "same_region",
  "same_grapes",
  "shared_grapes",
]);
/** "Strong" from this score: e.g. the same appellation and the same grapes. */
export const SIMILAR_STRONG = 5;
export const SIMILAR_MAX = 3;

export interface SimilarWine {
  /** The vintage with the most bottles, as the card (its page is the link). */
  bottle: SommelierBottle;
  /** All bottles of this wine in the cellar, over its vintages. */
  bottles: number;
  vintages: number;
  reasons: Array<{ code: SimilarReason; value: string | null }>;
  strength: "strong" | "moderate";
  score: number;
}

const grapeSet = (gs: readonly string[]) => new Set(gs.map(norm).filter(Boolean));

/** The findings that make one cellar wine comparable to the wine in the shop (none when it is not). */
export function similarity(
  wine: PurchaseWine,
  item: Pick<CellarItem, "producer" | "type" | "region" | "countryCode">,
  traits: Pick<PurchaseWineTraits, "appellation" | "grapes"> | undefined,
): { score: number; reasons: SimilarWine["reasons"] } | null {
  // A different kind of wine (or one not known) is never "similar": the colour has to be established first.
  if (!wine.type || wine.type !== item.type) return null;
  const reasons: SimilarWine["reasons"] = [];
  if (nameSimilarity(wine.producer, item.producer) >= 0.9)
    reasons.push({ code: "same_producer", value: item.producer });
  const appellation = traits?.appellation ?? null;
  if (wine.appellation && appellation && norm(wine.appellation) === norm(appellation))
    reasons.push({ code: "same_appellation", value: appellation });
  else if (wine.region && item.region && norm(wine.region) === norm(item.region))
    reasons.push({ code: "same_region", value: item.region });
  const mine = grapeSet(wine.grapes);
  const theirs = traits?.grapes ?? [];
  const shared = theirs.filter((g) => mine.has(norm(g)));
  if (shared.length > 0) {
    const all = shared.length === mine.size && grapeSet(theirs).size === mine.size;
    reasons.push({ code: all ? "same_grapes" : "shared_grapes", value: shared.join(", ") });
  }
  if (wine.countryCode && wine.countryCode === item.countryCode)
    reasons.push({ code: "same_country", value: item.countryCode });
  const score = reasons.reduce((s, r) => s + WEIGHT[r.code], 0);
  if (score < SIMILAR_MIN || !reasons.some((r) => SIMILAR_ANCHORS.has(r.code))) return null;
  return { score, reasons };
}

/** At most three genuinely comparable wines from the cellar, never the wine itself (or a "may be it"). */
export function similarWines(
  input: PurchaseCheckInput,
  exclude: ReadonlySet<string>,
): SimilarWine[] {
  const byWine = new Map<string, CellarItem[]>();
  for (const i of input.items) {
    if (exclude.has(i.wineId)) continue;
    byWine.set(i.wineId, [...(byWine.get(i.wineId) ?? []), i]);
  }
  const found: SimilarWine[] = [];
  for (const [wineId, vintages] of byWine) {
    const card = [...vintages].sort(byBottles)[0]!;
    const s = similarity(input.wine, card, input.traits.get(wineId));
    if (!s) continue;
    found.push({
      bottle: toSommelierBottle(card),
      bottles: vintages.reduce((n, v) => n + v.count, 0),
      vintages: vintages.length,
      reasons: s.reasons,
      strength: s.score >= SIMILAR_STRONG ? "strong" : "moderate",
      score: s.score,
    });
  }
  return found
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.bottles - a.bottles ||
        a.bottle.producer.localeCompare(b.bottle.producer) ||
        a.bottle.wineName.localeCompare(b.bottle.wineName),
    )
    .slice(0, SIMILAR_MAX);
}

// ---- 3. Does it match the person's taste? -------------------------------------------------------------------

/** 2.5 stars or less (stored 1..10): a wine the person did not like. */
export const LOW_SCORE = 5;
/** The same producer counts from two different rated wines of theirs. */
export const MIN_PRODUCER_WINES = 2;

export const TASTE_SIGNALS = [
  "this_wine",
  "producer",
  "appellation",
  "region",
  "grape",
  "style",
  "said_focus",
] as const;
export type TasteSignalCode = (typeof TASTE_SIGNALS)[number];

export interface TasteSignal {
  code: TasteSignalCode;
  direction: "for" | "against" | "neutral";
  /** Strong signals decide the fit; weak ones (a kind of wine, what was said about red or white) only add context. */
  strength: "strong" | "weak";
  key: string | null;
  /** Different rated wines behind it, and their mean in stars (one decimal); null for what was said. */
  wines: number | null;
  average: number | null;
}

/** positive / mismatch: supported by ratings. mixed: both. insufficient: no strong evidence either way. */
export type TasteFit = "positive" | "mismatch" | "mixed" | "insufficient";

export interface PurchaseTaste {
  fit: TasteFit;
  signals: TasteSignal[];
  /** Different wines the person rated in this household (all kinds). */
  ratedWines: number;
}

const stars = (score: number) => Math.round((score / 2) * 10) / 10;
const meanOf = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Taste is judged from the person's own ratings, and only where enough different wines support it (the taste
 * profile's own minimums): a region, an appellation or a grape needs three rated wines of the same kind, the
 * producer two of the same kind, this wine one (another vintage of it). What they said ("mostly red") and how they rate a whole kind
 * of wine are weak signals: shown, never enough on their own.
 */
export function tasteOf(
  input: PurchaseCheckInput,
  sameWineIds: ReadonlySet<string>,
): PurchaseTaste {
  const { wine, tastings, preferences } = input;
  const points = winePoints(tastings).filter((p) => p.score !== null);
  const appellationOf = new Map(tastings.map((t) => [t.wineId, t.appellation]));
  const isThis = (p: (typeof points)[number]) =>
    sameWineIds.has(p.wineId) ||
    (wine.name !== null &&
      norm(p.ref.producer) === norm(wine.producer) &&
      norm(p.ref.wineName) === norm(wine.name) &&
      !conflict(wine.type, p.type));
  const signals: TasteSignal[] = [];

  /** A group of rated wines: liked (mean ≥ 3.5★), disliked (≤ 2.5★) or neither; nothing below the minimum. */
  const judge = (
    code: TasteSignalCode,
    key: string | null,
    group: typeof points,
    min: number,
    strength: TasteSignal["strength"],
  ) => {
    if (group.length < min) return;
    const m = meanOf(group.map((p) => p.score!));
    const direction = m >= FAVOURITE_MIN_SCORE ? "for" : m <= LOW_SCORE ? "against" : "neutral";
    signals.push({ code, direction, strength, key, wines: group.length, average: stars(m) });
  };

  const same = points.filter(isThis);
  judge("this_wine", null, same, 1, "strong");
  const others = points.filter((p) => !isThis(p));
  // Only wines of the same kind say something about this one (a red Bordeaux says little about a white one).
  const sameKind = wine.type ? others.filter((p) => p.type === wine.type) : [];
  // The producer too: a producer's whites say nothing about its red (and an unknown kind cannot be checked).
  judge(
    "producer",
    wine.producer,
    sameKind.filter((p) => nameSimilarity(p.ref.producer, wine.producer) >= 0.9),
    MIN_PRODUCER_WINES,
    "strong",
  );
  if (wine.appellation)
    judge(
      "appellation",
      wine.appellation,
      sameKind.filter((p) => norm(appellationOf.get(p.wineId)) === norm(wine.appellation)),
      MIN_FAVOURITE_WINES,
      "strong",
    );
  if (wine.region)
    judge(
      "region",
      wine.region,
      sameKind.filter((p) => norm(p.region) === norm(wine.region)),
      MIN_FAVOURITE_WINES,
      "strong",
    );
  const grapes = grapeSet(wine.grapes);
  if (grapes.size > 0)
    judge(
      "grape",
      wine.grapes.join(", "),
      sameKind.filter((p) => p.grapes.some((g) => grapes.has(norm(g)))),
      MIN_FAVOURITE_WINES,
      "strong",
    );
  if (wine.type) judge("style", wine.type, sameKind, MIN_FAVOURITE_WINES, "weak");

  const focus = preferences.wineFocus;
  if (focus && focus !== "both" && wine.type && ["red", "white", "rose"].includes(wine.type)) {
    const fits = focus === "red" ? wine.type === "red" : wine.type !== "red";
    signals.push({
      code: "said_focus",
      direction: fits ? "for" : "against",
      strength: "weak",
      key: focus,
      wines: null,
      average: null,
    });
  }

  const strongFor = signals.some((s) => s.strength === "strong" && s.direction === "for");
  const strongAgainst = signals.some((s) => s.strength === "strong" && s.direction === "against");
  return {
    fit:
      strongFor && strongAgainst
        ? "mixed"
        : strongFor
          ? "positive"
          : strongAgainst
            ? "mismatch"
            : "insufficient",
    signals,
    ratedWines: points.length,
  };
}

// ---- 4. The advice ------------------------------------------------------------------------------------------

export const PURCHASE_VERDICTS = ["consider", "depends", "skip"] as const;
export type PurchaseVerdict = (typeof PURCHASE_VERDICTS)[number];

export type VerdictReason =
  | { code: "owns_exact"; bottles: number }
  | { code: "owns_other_vintages"; bottles: number; vintages: number }
  | { code: "owns_same_wine"; bottles: number }
  | { code: "maybe_owned" }
  | { code: "similar_owned"; wines: number; bottles: number }
  | { code: "adds_variety" }
  | { code: "no_similar_found" }
  | { code: "few_details" }
  | { code: "cellar_empty" }
  | { code: "taste_fits" }
  | { code: "taste_mismatch" }
  | { code: "taste_mixed" }
  | { code: "taste_unknown" };

/** Enough of the same already: this many bottles of the wine itself, or of strongly similar wines. */
export const REDUNDANT = { exact: 3, sameWine: 6, strongSimilar: 6, similar: 12 } as const;

export interface PurchaseCheckResult {
  wine: PurchaseWine;
  priceCents: number | null;
  /** The confirmed facts are exactly one CELLR catalogue wine. */
  catalog: boolean;
  cellarBottles: number;
  ownership: PurchaseOwnership;
  similar: SimilarWine[];
  taste: PurchaseTaste;
  verdict: PurchaseVerdict;
  /** Short, concrete reasons, most important first (at most four). */
  reasons: VerdictReason[];
  /**
   * What CELLR knew about this wine beyond what the person confirmed, and where each part came from (the
   * `purchase_intel` feature): catalogue facts, a reused profile of this vintage, or the wine's stable facts.
   * `wine` above is the wine as it was COMPARED (the confirmed facts with only their open fields filled); this says
   * what was filled in. Absent or null: nothing was added, the comparison used the confirmed facts alone.
   */
  knowledge?: PurchaseKnowledge | null;
}

/** The advice follows from the findings, never the other way round. */
export function verdictOf(
  ownership: PurchaseOwnership,
  similar: readonly SimilarWine[],
  taste: PurchaseTaste,
  context: {
    cellarBottles: number;
    /** The wine in the shop is described well enough to compare (kind, and a place or grapes). */
    detailed: boolean;
    /** Every cellar wine of that kind has a place or grapes known: "nothing like it" can then be said. */
    described: boolean;
  },
): { verdict: PurchaseVerdict; reasons: VerdictReason[] } {
  const strongBottles = similar
    .filter((s) => s.strength === "strong")
    .reduce((n, s) => n + s.bottles, 0);
  const similarBottles = similar.reduce((n, s) => n + s.bottles, 0);
  const owned = ownership.exactBottles + ownership.otherBottles;
  const redundant =
    ownership.exactBottles >= REDUNDANT.exact ||
    owned >= REDUNDANT.sameWine ||
    strongBottles >= REDUNDANT.strongSimilar ||
    similarBottles >= REDUNDANT.similar;

  const reasons: VerdictReason[] = [];
  if (context.cellarBottles === 0) reasons.push({ code: "cellar_empty" });
  else if (ownership.kind === "exact")
    reasons.push({ code: "owns_exact", bottles: ownership.exactBottles });
  else if (ownership.kind === "other_vintages")
    reasons.push({
      code: "owns_other_vintages",
      bottles: ownership.otherBottles,
      vintages: ownership.otherVintages.length,
    });
  else if (ownership.kind === "same_wine")
    reasons.push({ code: "owns_same_wine", bottles: ownership.otherBottles });
  else if (ownership.kind === "possible") reasons.push({ code: "maybe_owned" });
  if (similar.length > 0)
    reasons.push({ code: "similar_owned", wines: similar.length, bottles: similarBottles });
  else if (context.cellarBottles > 0 && ownership.kind === "none")
    // "New for the cellar" only when both sides were described well enough to compare; otherwise say what is known.
    reasons.push({
      code: !context.detailed
        ? "few_details"
        : context.described
          ? "adds_variety"
          : "no_similar_found",
    });
  reasons.push({
    code:
      taste.fit === "positive"
        ? "taste_fits"
        : taste.fit === "mismatch"
          ? "taste_mismatch"
          : taste.fit === "mixed"
            ? "taste_mixed"
            : "taste_unknown",
  });

  const verdict: PurchaseVerdict =
    taste.fit === "mismatch"
      ? "skip"
      : redundant
        ? taste.fit === "positive"
          ? "depends"
          : "skip"
        : taste.fit === "positive"
          ? "consider"
          : "depends";
  return { verdict, reasons: reasons.slice(0, 4) };
}

/** The whole check: ownership, similar wines, taste, advice. Pure: the same input gives the same answer. */
export function checkPurchase(input: PurchaseCheckInput): PurchaseCheckResult {
  const { ownership, sameWineIds, possibleWineIds } = ownershipOf(input);
  const similar = similarWines(input, new Set([...sameWineIds, ...possibleWineIds]));
  const taste = tasteOf(input, sameWineIds);
  const cellarBottles = input.items.reduce((n, i) => n + i.count, 0);
  const w = input.wine;
  const detailed = w.type !== null && Boolean(w.region || w.appellation || w.grapes.length > 0);
  const described = input.items
    .filter((i) => i.type === w.type)
    .every((i) => {
      const t = input.traits.get(i.wineId);
      return Boolean(i.region || t?.appellation || (t?.grapes.length ?? 0) > 0);
    });
  const { verdict, reasons } = verdictOf(ownership, similar, taste, {
    cellarBottles,
    detailed,
    described,
  });
  return {
    wine: input.wine,
    priceCents: input.priceCents,
    catalog: input.catalogWineId !== null,
    cellarBottles,
    ownership,
    similar,
    taste,
    verdict,
    reasons,
  };
}

/** The one catalogue wine these facts exactly are (producer, name or verified alias, nothing contradicting). */
export function catalogIdentityOf(
  wine: PurchaseWine,
  candidates: readonly WineSummary[],
): WineSummary | null {
  const exact = candidates.filter(
    (c) =>
      c.catalog &&
      wine.name !== null &&
      norm(c.producer) === norm(wine.producer) &&
      [c.name, ...(c.aliases ?? [])].map(norm).includes(norm(wine.name)) &&
      !conflict(wine.type, c.type) &&
      !conflict(wine.countryCode, c.countryCode),
  );
  return exact.length === 1 ? exact[0]! : null;
}
