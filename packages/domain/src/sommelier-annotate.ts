import { z } from "zod";
import { normalizeText, type CellarItem, type DrinkSummary } from "./cellar";
import { DRINK_PHASES, type DrinkPhase } from "./drink-window";
import { DECANT_KINDS, GLASSES, type DecantKind, type Glass } from "./experiences/serving";
import { EVIDENCE_TIERS, type EvidenceTier } from "./pairing-engine/wine";
import { askedFor } from "./sommelier-route";

/**
 * FACTS ON THE SOMMELIER'S CARDS (Sommelier V1+ part `annotate`, P4). The model chooses the wines; for each card
 * the app adds what it knows itself: whether to drink it now or keep it (the window the app already shows for the
 * wine, never a new estimate), how to serve it (the reviewed serving rules, or the wine's own researched profile),
 * how many bottles are kept for an occasion and how many are free to open, and where the bottles lie.
 *
 * Types, the stored shape and the pure parts live here (the package's main entry, no wine knowledge). The serving
 * part needs the wine knowledge to read a wine's structure: `annotateBottles` is in experiences/annotate.ts, behind
 * the server-only entry.
 */

export interface BottleAnnotation {
  vintageId: string;
  /** From the window the app already shows for this wine (item.drink); never a new estimate. */
  drink: {
    advice: "drink-now" | "drink-soon" | "keep" | "past-window" | "unknown";
    phase: DrinkPhase;
    from: number | null;
    until: number | null;
    /** own: the household set it. profile: from what is known about this wine. style: the table for its style (a guess). */
    basis: "own" | "profile" | "style";
  };
  /** Null when the wine is too little known to say (never a made-up default). */
  serving: {
    tempC: { min: number; max: number };
    fridgeMinutes: number;
    /**
     * Null when only the colour of the wine is known: then there is no decanting claim at all (whether a red needs
     * air depends on what it is). A deviation from the first draft of the contract, which had no way to say it.
     */
    decant: { kind: DecantKind; minutes: number } | null;
    glass: Glass;
    basis: "profile" | "style";
    tier: EvidenceTier;
  } | null;
  /** Bottles kept for an occasion, and how many are free to open. Null when none is reserved. */
  reserved: { count: number; free: number; title: string; on: string | null } | null;
  /** Where it lies: the places' labels as the cellar has them, and how many bottles have no place. */
  where: { places: string[]; unplaced: number };
}

/** At most this many places are kept for one wine (the rest are not shown). */
export const ANNOTATION_PLACES_MAX = 12;
/** At most this many annotations for one answer (one per card; a menu has at most eight). */
export const ANNOTATIONS_MAX = 8;

const year = z.number().int().min(1800).max(2200);
const count = z.number().int().min(0).max(100_000);

export const BottleAnnotationSchema: z.ZodType<BottleAnnotation> = z.object({
  vintageId: z.string().min(1).max(64),
  drink: z.object({
    advice: z.enum(["drink-now", "drink-soon", "keep", "past-window", "unknown"]),
    phase: z.enum(DRINK_PHASES),
    from: year.nullable(),
    until: year.nullable(),
    basis: z.enum(["own", "profile", "style"]),
  }),
  serving: z
    .object({
      tempC: z
        .object({ min: z.number().min(0).max(25), max: z.number().min(0).max(25) })
        .refine((t) => t.min <= t.max, "min above max"),
      fridgeMinutes: z.number().int().min(0).max(240),
      decant: z
        .object({ kind: z.enum(DECANT_KINDS), minutes: z.number().int().min(0).max(240) })
        .nullable(),
      glass: z.enum(GLASSES),
      basis: z.enum(["profile", "style"]),
      tier: z.enum(EVIDENCE_TIERS),
    })
    .nullable(),
  reserved: z
    .object({
      count: z.number().int().min(1).max(100_000),
      free: count,
      title: z.string().max(120),
      on: z.string().max(40).nullable(),
    })
    .nullable(),
  where: z.object({
    places: z.array(z.string().max(120)).max(ANNOTATION_PLACES_MAX),
    unplaced: count,
  }),
});

/** Annotations kept with an answer: the list when every one of them is sound, else none (never half a list). */
export function readAnnotations(value: unknown): BottleAnnotation[] | null {
  const parsed = z.array(BottleAnnotationSchema).max(ANNOTATIONS_MAX).safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ---- The parts that need no knowledge ------------------------------------------------------------------------

/**
 * Drink now or keep, from the window the app already shows (`item.drink`, already judged by `assessDrink`). Only
 * a window about this very wine (the household's own, or the profile's) may say "drink soon" or "past its window":
 * the style table's guess late in a window is "unknown", as everywhere else in the app.
 */
export function drinkAnnotation(drink: DrinkSummary): BottleAnnotation["drink"] {
  const basis = drink.source === "own" ? "own" : drink.source === "ai" ? "profile" : "style";
  const late = drink.phase === "ready" || drink.phase === "past";
  // Defensive: a summary that was not judged by assessDrink still never claims what it cannot know.
  const phase: DrinkPhase = drink.uncertain || (late && !drink.reliable) ? "unknown" : drink.phase;
  const window = phase === "unknown" ? { from: null, until: null } : window_(drink);
  const advice: BottleAnnotation["drink"]["advice"] =
    phase === "young" || phase === "developing"
      ? "keep"
      : phase === "peak"
        ? "drink-now"
        : phase === "ready"
          ? "drink-soon"
          : phase === "past"
            ? "past-window"
            : "unknown";
  return { advice, phase, ...window, basis };
}

/** A window's years only when they are years (a corrupt row says nothing rather than something odd). */
function window_(drink: DrinkSummary): { from: number | null; until: number | null } {
  const sound = (y: number | null) =>
    y !== null && Number.isInteger(y) && y >= 1800 && y <= 2200 ? y : null;
  const from = sound(drink.from);
  const until = sound(drink.until);
  return from !== null && until !== null && from > until
    ? { from: null, until: null }
    : { from, until };
}

/** Reserved bottles, never more than there are; null when none is. */
export function reservedAnnotation(item: CellarItem): BottleAnnotation["reserved"] {
  const total = Math.max(0, Math.floor(item.count));
  const kept = Math.min(total, Math.max(0, Math.floor(item.reserved?.count ?? 0)));
  if (!item.reserved || kept === 0) return null;
  return {
    count: kept,
    free: total - kept,
    title: tidy(item.reserved.title, 120),
    on: item.reserved.on ? item.reserved.on.slice(0, 40) : null,
  };
}

/** Where the bottles lie: the places as the cellar names them (each once), and how many have none. */
export function whereAnnotation(item: CellarItem): BottleAnnotation["where"] {
  const places = [...new Set(item.places.map((p) => tidy(p, 120)).filter((p) => p !== ""))];
  const total = Math.max(0, Math.floor(item.count));
  return {
    places: places.slice(0, ANNOTATION_PLACES_MAX),
    unplaced: Math.min(total, Math.max(0, Math.floor(item.unplaced))),
  };
}

const tidy = (value: string, max: number) =>
  value
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();

/**
 * What a question asks about the wines, so a card shows that first: a serving question shows the serving line
 * first and in full, a keeping question the drinking window. Anything else shows the card's short facts.
 */
export function annotationEmphasis(question: string): "serving" | "keeping" | null {
  const kind = askedFor(question);
  return kind === "serving" || kind === "keeping" ? kind : null;
}

// ---- Which wine a text names ---------------------------------------------------------------------------------

/** Words on many labels that do not pick out one wine. */
const GENERIC: ReadonlySet<string> = new Set(
  normalizeText(
    "chateau domaine domaines bodega bodegas cantina cantine tenuta weingut quinta clos mas cave caves maison " +
      "cuvee cuvees reserve reserva riserva gran grand grande grands premier cru crus classe classico superiore " +
      "blanc blanche rouge rose rosso bianco tinto blanco brut extra vieilles vignes vigne estate winery wines " +
      "wine cellars vineyards vineyard family selection selected special collection les des del della di de du la le " +
      "the and van von und old vintage red white sparkling dessert fortified orange sweet dry " +
      // The words of the questions themselves: "how long" is not the producer Long Shadows.
      "long keep kept store serve served serving should would could what which when where ready still cold " +
      "warm cool chill chilled decant decanted decanting carafe glass glasses breathe temperature bottle bottles " +
      "drink open opened lang bewaren bewaar serveer serveren schenk schenken koud koel koelen warm decanteren " +
      "decanteer karaf glas glazen temperatuur ademen dronk drinken wanneer welke welk fles flessen nog moet " +
      "kunnen this that with your have mijn onze deze from them they these those",
  ).split(" "),
);

/** A word that does not pick out one wine: on many labels, or a word of the questions themselves. */
export const isLabelGenericWord = (word: string): boolean => GENERIC.has(word);

/** The words of a label that can name it: long enough, and not on every other label. */
export const labelNameWords = (text: string): string[] =>
  normalizeText(text)
    .split(" ")
    .filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w));
