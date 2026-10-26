import { z } from "zod";
import {
  normalizeText,
  WINE_COUNTRIES,
  WINE_TYPES,
  type WineSummary,
  type WineType,
} from "./cellar";
import type { ImageRef } from "./image";
import type { Quad } from "./label-crop";

/**
 * SCANNING A LABEL. A vision model reads what is printed; everything after that is ordinary, testable code:
 * the answer is checked for plausibility (a vintage of 2087 is dropped, not believed), matched against the
 * wines the household already has by plain string similarity, and sorted into one of four outcomes. The model
 * never decides what a wine is, and never touches the database: it only reads.
 */

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** What the model is asked to return. Every key is required (null when not printed on the label). */
export const RawExtractionSchema = z.object({
  is_wine_label: z.boolean(),
  producer: z.string().nullable(),
  wine_name: z.string().nullable(),
  vintage: z.number().nullable(),
  non_vintage: z.boolean(),
  wine_type: z.string().nullable(),
  country_code: z.string().nullable(),
  region: z.string().nullable(),
  appellation: z.string().nullable(),
  grapes: z.array(z.string()),
  abv_percent: z.number().nullable(),
  volume_ml: z.number().nullable(),
  text_seen: z.string(),
  /** The four corners of the label in the photo (x1, y1 … x4, y4 as fractions), when it can be located. */
  label_corners: z.array(z.number()).nullable().default(null),
  confidence: z.object({
    producer: z.enum(CONFIDENCE_LEVELS),
    wine_name: z.enum(CONFIDENCE_LEVELS),
    vintage: z.enum(CONFIDENCE_LEVELS),
  }),
});
export type RawExtraction = z.infer<typeof RawExtractionSchema>;

/** What was read off the label, after the plausibility checks. Null = not read, never "guessed". */
export interface LabelFacts {
  producer: string | null;
  name: string | null;
  /** The vintage printed on the label. */
  year: number | null;
  /** The label says it is non-vintage (or shows no year and says so). */
  nonVintage: boolean;
  type: WineType | null;
  countryCode: string | null;
  region: string | null;
  appellation: string | null;
  grapes: string[];
  abv: number | null;
  volumeMl: number | null;
  confidence: { producer: Confidence; name: Confidence; year: Confidence };
}

/** The countries the app lets you choose, so a code read off a label can always be shown and edited. */
const COUNTRY_CODES: ReadonlySet<string> = new Set(WINE_COUNTRIES);

const MAX = { producer: 120, name: 160, region: 120, appellation: 160, grape: 40 } as const;

/** Text from a model: trimmed, one line, no control characters, never longer than a field allows. */
function clean(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = value
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? null : text.slice(0, max).trim();
}

const lower = (c: Confidence): Confidence => (c === "high" ? "medium" : "low");

/**
 * Plausibility guards, in code and not in the prompt: a field that cannot be true is dropped and the
 * confidence of what is left is lowered. Returns null when there is nothing usable to start a wine from.
 */
export function normalizeExtraction(raw: RawExtraction, now: Date = new Date()): LabelFacts | null {
  if (!raw.is_wine_label) return null;
  const producer = clean(raw.producer, MAX.producer);
  const name = clean(raw.wine_name, MAX.name);
  if (producer === null && name === null) return null;

  const wanted = (raw.wine_type ?? "").trim().toLowerCase();
  const type = (WINE_TYPES as readonly string[]).includes(wanted) ? (wanted as WineType) : null;

  const country = (raw.country_code ?? "").trim().toUpperCase();
  const countryCode = COUNTRY_CODES.has(country) ? country : null;

  const ceiling = now.getUTCFullYear() + 1;
  let year: number | null = null;
  let yearConfidence = raw.confidence.vintage;
  if (raw.vintage !== null) {
    if (Number.isInteger(raw.vintage) && raw.vintage >= 1800 && raw.vintage <= ceiling)
      year = raw.vintage;
    else yearConfidence = "low"; // printed something, but not a year this wine could have
  }
  // "NV" and a year cannot both be true; the year, printed, wins.
  const nonVintage = raw.non_vintage && year === null;

  const abv =
    raw.abv_percent !== null && raw.abv_percent >= 5 && raw.abv_percent <= 20
      ? raw.abv_percent
      : null;
  const volumeMl =
    raw.volume_ml !== null &&
    Number.isInteger(raw.volume_ml) &&
    raw.volume_ml >= 100 &&
    raw.volume_ml <= 30000
      ? raw.volume_ml
      : null;

  // The words must exist before a place can be trusted.
  const droppedPlace = raw.country_code !== null && countryCode === null;
  return {
    producer,
    name,
    year,
    nonVintage,
    type,
    countryCode,
    region: clean(raw.region, MAX.region),
    appellation: clean(raw.appellation, MAX.appellation),
    grapes: raw.grapes
      .map((g) => clean(g, MAX.grape))
      .filter((g): g is string => g !== null)
      .slice(0, 6),
    abv,
    volumeMl,
    confidence: {
      producer: droppedPlace ? lower(raw.confidence.producer) : raw.confidence.producer,
      name: raw.confidence.wine_name,
      year: yearConfidence,
    },
  };
}

/** What to start the "new wine" form with: the best name the label gives, never an empty one. */
export function suggestWine(facts: LabelFacts): {
  producer: string;
  name: string;
  type: WineType | null;
  countryCode: string | null;
  region: string | null;
} {
  const producer = facts.producer ?? facts.name ?? "";
  const name = facts.name ?? facts.appellation ?? facts.region ?? producer;
  return {
    producer,
    name,
    type: facts.type,
    countryCode: facts.countryCode,
    region: facts.region ?? facts.appellation,
  };
}

// ---- Matching against the wines you already have -----------------------------------------------------------

/** Words that say what kind of estate it is, not which one: "Château Margaux" and "Margaux" are one name. */
const ESTATE_WORDS = new Set([
  "chateau",
  "domaine",
  "maison",
  "cave",
  "caves",
  "clos",
  "cantina",
  "cantine",
  "azienda",
  "agricola",
  "tenuta",
  "castello",
  "fattoria",
  "bodega",
  "bodegas",
  "quinta",
  "weingut",
  "winery",
  "wines",
  "wine",
  "vineyards",
  "vineyard",
  "estate",
  "estates",
  "cellars",
  "the",
  "le",
  "la",
  "les",
  "de",
  "du",
  "des",
  "di",
  "del",
  "della",
  "el",
  "los",
  "und",
  "et",
  "and",
  "et",
]);

const tokens = (text: string): string[] => normalizeText(text).split(" ").filter(Boolean);

/** The distinguishing words of a name; if there are none (a name made only of estate words), all of them. */
const core = (text: string): string[] => {
  const all = tokens(text);
  const kept = all.filter((t) => !ESTATE_WORDS.has(t));
  return kept.length > 0 ? kept : all;
};

const bigrams = (text: string): Map<string, number> => {
  const padded = ` ${text} `;
  const map = new Map<string, number>();
  for (let i = 0; i < padded.length - 1; i++) {
    const gram = padded.slice(i, i + 2);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
};

/** Sørensen–Dice on letter pairs: 1 for the same text, ~0 for unrelated text, forgiving of a slipped letter. */
function dice(a: string, b: string): number {
  if (a === b) return a === "" ? 0 : 1;
  const x = bigrams(a);
  const y = bigrams(b);
  let overlap = 0;
  for (const [gram, count] of x) overlap += Math.min(count, y.get(gram) ?? 0);
  const total =
    [...x.values()].reduce((s, n) => s + n, 0) + [...y.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** How alike two names are, 0..1, comparing their distinguishing words (so "Château Margaux" ≈ "Margaux"). */
export function nameSimilarity(a: string, b: string): number {
  const left = core(a);
  const right = core(b);
  if (left.length === 0 || right.length === 0) return 0;
  const whole = dice(left.join(" "), right.join(" "));
  // Word by word, so a reordered or partly shown name still counts: each word finds its best partner.
  const best = (from: string[], to: string[]) =>
    from.reduce((sum, w) => sum + Math.max(...to.map((v) => dice(w, v))), 0) / from.length;
  const words = Math.min(best(left, right), best(right, left));
  return Math.max(whole, words);
}

export interface LabelMatch {
  wine: WineSummary;
  /** 0..1: how sure we are that the label is this wine. Computed here, never by the model. */
  score: number;
}

/** Who made it counts most, then what it is called, then where it is from. */
export function scoreWine(facts: LabelFacts, wine: WineSummary): number {
  const producerText = facts.producer ?? facts.name ?? "";
  // A label that shows only one big name: it may be the estate, or the cuvée. Take the better reading.
  const producer = Math.max(
    nameSimilarity(producerText, wine.producer),
    facts.name ? nameSimilarity(facts.name, wine.producer) * 0.9 : 0,
  );
  const nameText = facts.name ?? facts.appellation ?? facts.region ?? null;
  const name = nameText
    ? Math.max(
        nameSimilarity(nameText, wine.name),
        facts.producer ? nameSimilarity(facts.producer, wine.name) * 0.6 : 0,
      )
    : 0;
  // Without a name on the label, the estate has to carry the match on its own.
  let score = nameText ? producer * 0.55 + name * 0.4 : producer * 0.8;
  if (facts.countryCode && wine.countryCode)
    score += facts.countryCode === wine.countryCode ? 0.05 : -0.3;
  if (facts.type && facts.type !== wine.type) score -= 0.12; // red and white of one estate are different wines
  return Math.max(0, Math.min(1, score));
}

export const MATCH = {
  /** A single answer: this strong, and this far ahead of the runner-up. */
  strong: 0.85,
  lead: 0.15,
  /** Worth offering as "is it one of these?". */
  maybe: 0.5,
  most: 3,
} as const;

export const SCAN_OUTCOMES = ["found", "choose", "new", "unread"] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

/** Ranks the household's wines against what was read, and decides how sure to be. */
export function matchLabel(
  facts: LabelFacts,
  wines: readonly WineSummary[],
): { outcome: Exclude<ScanOutcome, "unread">; matches: LabelMatch[] } {
  const ranked = wines
    .map((wine) => ({ wine, score: scoreWine(facts, wine) }))
    .filter((m) => m.score >= MATCH.maybe)
    .sort((a, b) => b.score - a.score || a.wine.name.localeCompare(b.wine.name))
    .slice(0, MATCH.most);
  const [first, second] = ranked;
  if (!first) return { outcome: "new", matches: [] };
  if (first.score >= MATCH.strong && (!second || first.score - second.score >= MATCH.lead))
    return { outcome: "found", matches: [first] };
  return { outcome: "choose", matches: ranked };
}

// ---- What the scan endpoint answers --------------------------------------------------------------------------

export interface ScanResult {
  /** The photo is always kept, so nothing the person did is lost if the reading failed. */
  image: ImageRef;
  outcome: ScanOutcome;
  facts: LabelFacts | null;
  /** Wines you already have that this may be, best first (empty unless `found` or `choose`). */
  matches: LabelMatch[];
  /**
   * Why there is no reading, when `outcome` is `unread`. "limit": this household's scan limit; "budget": the
   * platform's AI budget is spent. Both mean: send no more photos for now (the photo itself is kept).
   */
  reason: "ai-off" | "ai-down" | "limit" | "budget" | "not-a-label" | null;
  /** Where the model found the label in the photo, if it is believable: the start of the person's own framing. */
  labelCorners: Quad | null;
  /**
   * True when this exact photo (byte for byte, after processing) was scanned and confirmed in this household
   * before, so the answer comes from that confirmation and no model was asked. It is still only a suggestion:
   * the person confirms it like any other reading.
   */
  remembered?: boolean;
}

/**
 * What a confirmed scan says about the photo: the wine and year the household chose for it. Printed details the
 * model would read (grapes, alcohol, appellation) are not repeated; the person can still edit everything.
 */
export function confirmedFacts(wine: WineSummary, year: number | null): LabelFacts {
  return {
    producer: wine.producer,
    name: wine.name,
    year,
    nonVintage: year === null,
    type: wine.type,
    countryCode: wine.countryCode,
    region: wine.region,
    appellation: null,
    grapes: [],
    abv: null,
    volumeMl: null,
    confidence: { producer: "high", name: "high", year: "high" },
  };
}

/**
 * A remembered scan only counts when every confirmation of the photo agrees on one wine and year, and that wine
 * is still one of the household's. Anything else (none, disagreeing, a wine that is gone) is not trusted.
 */
export function recallScan(
  confirmations: ReadonlyArray<{ wineId: string; year: number | null }>,
  wines: readonly WineSummary[],
): { wine: WineSummary; year: number | null } | null {
  if (confirmations.length !== 1) return null;
  const [only] = confirmations;
  const wine = wines.find((w) => w.id === only!.wineId);
  return wine ? { wine, year: only!.year } : null;
}
