import { z } from "zod";
import { MAX_PRICE_CENTS } from "./cellar";

/**
 * WHAT ONLY THE HOUSEHOLD KNOWS, AND WHAT AN AI CAN ADD. Per bottle: bought or a gift (and from whom), and
 * whether it is being kept for an occasion. Per vintage: an AI-written profile (always an estimate, never a
 * fact) with a rough current value, and the household's own idea of the value.
 */

// ---- Per bottle ------------------------------------------------------------------------------------------

export const ACQUIRED_HOW = ["bought", "gift"] as const;
export type AcquiredHow = (typeof ACQUIRED_HOW)[number];

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

/** Replaces what is known about one bottle. A gift giver means nothing for a bought bottle, so it is dropped. */
export const BottleExtrasSchema = z
  .object({
    acquiredHow: z.enum(ACQUIRED_HOW).nullable(),
    giftFrom: text(120),
    occasionTitle: text(120),
    /** The day it is meant for. */
    occasionOn: z.iso.date().nullable(),
  })
  .refine((v) => v.occasionOn === null || v.occasionTitle !== null, {
    message: "Say what the occasion is.",
    path: ["occasionTitle"],
  })
  .transform((v) => ({ ...v, giftFrom: v.acquiredHow === "gift" ? v.giftFrom : null }));
export type BottleExtras = z.infer<typeof BottleExtrasSchema>;
export type BottleExtrasInput = z.input<typeof BottleExtrasSchema>;

export interface BottleExtrasView extends BottleExtras {
  bottleId: string;
}

export const NO_EXTRAS: BottleExtras = {
  acquiredHow: null,
  giftFrom: null,
  occasionTitle: null,
  occasionOn: null,
};

/**
 * Bottles of one wine that are kept for an occasion (and not yet past it): so Tonight and the sommelier can say
 * "this one is reserved for Christmas dinner" instead of suggesting it blindly.
 */
export interface Reservation {
  /** How many bottles of the wine are reserved. */
  count: number;
  /** The soonest occasion. */
  title: string;
  /** Its day, or null when no day was given. */
  on: string | null;
}

/** A bottle being kept for something: shown on Home when it is near, and on the wine itself. */
export interface Reminder {
  bottleId: string;
  vintageId: string;
  producer: string;
  wineName: string;
  year: number | null;
  title: string;
  /** YYYY-MM-DD */
  on: string;
  /** Negative = the day has passed and the bottle is still here. */
  daysUntil: number;
}

export interface RemindersView {
  /** False until the database step for this has been taken. */
  ready: boolean;
  items: Reminder[];
}

/** Whole days from `today` to `on`, both as calendar dates (no clock, no time zones involved). */
export function daysUntil(on: string, today: string): number {
  const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((day(on) - day(today)) / 86_400_000);
}

/** How far ahead Home looks, and how long after the day a forgotten bottle is still mentioned. */
export const REMINDER_AHEAD_DAYS = 45;
export const REMINDER_BEHIND_DAYS = 14;

/** "Today", "Tomorrow", "In 5 days" as a key plus a number; the screen supplies the words. */
export function reminderWhen(days: number): "overdue" | "today" | "tomorrow" | "days" {
  return days < 0 ? "overdue" : days === 0 ? "today" : days === 1 ? "tomorrow" : "days";
}

// ---- Per vintage: the AI's profile ----------------------------------------------------------------------

export const INSIGHT_CONFIDENCE = ["low", "medium", "high"] as const;

/** Families of aromas, as wine apps group them; each has a colour and an icon on screen. */
export const FLAVOR_GROUPS = [
  "red_fruit",
  "black_fruit",
  "citrus",
  "tree_fruit",
  "tropical",
  "dried_fruit",
  "floral",
  "herbal",
  "spice",
  "oak",
  "earth",
  "mineral",
  "nutty",
  "sweet",
] as const;
export type FlavorGroup = (typeof FLAVOR_GROUPS)[number];

/** Kinds of food, each with an icon on screen. */
export const PAIRING_KINDS = [
  "beef",
  "lamb",
  "pork",
  "poultry",
  "game",
  "fish",
  "shellfish",
  "cheese",
  "pasta",
  "vegetarian",
  "spicy",
  "dessert",
  "aperitif",
] as const;
export type PairingKind = (typeof PAIRING_KINDS)[number];

/**
 * Which version of the profile a stored one is. A profile is written once and then stays as it is; a newer
 * version only fills in what an older one did not have yet (see `mergeInsight`).
 */
export const PROFILE_VERSION = 5;

/** What the model says. Everything is checked afterwards; nothing here is trusted as it comes. */
export const RawInsightSchema = z.object({
  summary: z.string(),
  style: z.string(),
  grapes: z.array(z.string()),
  tasting: z.string(),
  serving_temp_min_c: z.number().nullable(),
  serving_temp_max_c: z.number().nullable(),
  decant_minutes: z.number().nullable(),
  abv_percent: z.number().nullable(),
  drink_from_year: z.number().nullable(),
  drink_until_year: z.number().nullable(),
  country_code: z.string().nullable(),
  region: z.string().nullable(),
  appellation: z.string().nullable(),
  pairings: z.array(z.string()),
  aging: z.string(),
  // 1 (light, soft, dry, gentle) … 5 (full, firm, sweet, sharp); null when unsure or not applicable
  body: z.number().nullable(),
  tannin: z.number().nullable(),
  sweetness: z.number().nullable(),
  acidity: z.number().nullable(),
  flavors: z.array(z.object({ group: z.enum(FLAVOR_GROUPS), notes: z.array(z.string()) })),
  pairing_kinds: z.array(z.enum(PAIRING_KINDS)),
  confidence: z.enum(INSIGHT_CONFIDENCE),
});
export type RawInsight = z.infer<typeof RawInsightSchema>;

/** What is kept, shown and stored: checked, tidy, and always labelled as an estimate by the screen. */
export const InsightOutputSchema = z.object({
  summary: z.string().max(700),
  style: z.string().max(200),
  grapes: z.array(z.string().max(60)).max(8),
  tasting: z.string().max(500),
  serving: z.object({ minC: z.number(), maxC: z.number() }).nullable(),
  decantMinutes: z.number().int().min(0).max(240).nullable(),
  /** Alcohol by volume as typically bottled; profiles saved before this existed have none. */
  abvPercent: z.number().min(0.5).max(25).nullable().default(null),
  /** The calendar years in which this wine drinks well, as the model knows it; profiles from before have none. */
  drinkWindow: z
    .object({ from: z.number().int(), until: z.number().int() })
    .nullable()
    .default(null),
  pairings: z.array(z.string().max(80)).max(6),
  aging: z.string().max(400),
  /** How it feels, 1–5 on each scale (as wine apps show it); null for a scale the model was unsure of. */
  structure: z
    .object({
      body: z.number().int().min(1).max(5).nullable(),
      tannin: z.number().int().min(1).max(5).nullable(),
      sweetness: z.number().int().min(1).max(5).nullable(),
      acidity: z.number().int().min(1).max(5).nullable(),
    })
    .nullable()
    .default(null),
  /** The aromas, grouped by family, strongest family first. */
  flavors: z
    .array(z.object({ group: z.enum(FLAVOR_GROUPS), notes: z.array(z.string().max(40)).max(6) }))
    .max(5)
    .default([]),
  pairingKinds: z.array(z.enum(PAIRING_KINDS)).max(6).default([]),
  /** Profiles from before versions were kept count as version 1. */
  version: z.number().int().min(1).default(1),
  /** Only in profiles from before values had their own history (see valuations). */
  value: z
    .object({
      lowCents: z.number().int().min(1),
      highCents: z.number().int().min(1),
      currency: z.string().regex(/^[A-Z]{3}$/),
      basis: z.string().max(240),
    })
    .nullable()
    .default(null),
  confidence: z.enum(INSIGHT_CONFIDENCE),
});
export type InsightOutput = z.infer<typeof InsightOutputSchema>;

/** Text from a model: one tidy line, no control characters, never longer than a field allows. */
function clean(value: string, max: number): string {
  return (
    value
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
      .trim()
  );
}

const list = (values: readonly string[], max: number, length: number): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const c = clean(v, length);
    if (c !== "" && !seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      out.push(c);
    }
    if (out.length === max) break;
  }
  return out;
};

/**
 * Where the wine is from, as the AI knows it, to fill in what the person left empty. Only an answer the model is
 * not unsure about is used, and only well-formed values; the caller adds just the fields that are still empty.
 */
export function checkOrigin(raw: RawInsight): {
  countryCode?: string;
  region?: string;
  appellation?: string;
} {
  if (raw.confidence === "low") return {};
  const text = (v: string | null, max: number) => {
    const t = (v ?? "").replace(/\s+/g, " ").trim();
    return t.length >= 2 && t.length <= max ? t : null;
  };
  const country = (raw.country_code ?? "").trim().toUpperCase();
  const region = text(raw.region, 120);
  const appellation = text(raw.appellation, 160);
  return {
    ...(/^[A-Z]{2}$/.test(country) ? { countryCode: country } : {}),
    ...(region ? { region } : {}),
    ...(appellation ? { appellation } : {}),
  };
}

/**
 * Plausibility, in code and not in the prompt. A temperature that cannot be right, or a value range that is
 * absurd (reversed, or the high more than ten times the low), is dropped rather than shown; what is left has
 * its confidence lowered when the value had to go. Returns null when there is no profile worth keeping.
 */
export function checkInsight(
  raw: RawInsight,
  /** The harvest year, to judge the drinking window against (null = non-vintage: no window is kept). */
  year: number | null = null,
): InsightOutput | null {
  const summary = clean(raw.summary, 700);
  if (summary === "") return null;

  const min = raw.serving_temp_min_c;
  const max = raw.serving_temp_max_c;
  const serving =
    min !== null && max !== null && min >= 4 && max <= 20 && min <= max
      ? { minC: Math.round(min), maxC: Math.round(max) }
      : null;

  const decant =
    raw.decant_minutes !== null && raw.decant_minutes >= 0 && raw.decant_minutes <= 240
      ? Math.round(raw.decant_minutes)
      : null;

  const abv =
    raw.abv_percent !== null && raw.abv_percent >= 0.5 && raw.abv_percent <= 25
      ? Math.round(raw.abv_percent * 10) / 10
      : null;

  // The drinking window: whole years, never before the harvest, never longer than a lifetime, never reversed.
  const wFrom = raw.drink_from_year !== null ? Math.round(raw.drink_from_year) : null;
  const wUntil = raw.drink_until_year !== null ? Math.round(raw.drink_until_year) : null;
  const drinkWindow =
    year !== null &&
    wFrom !== null &&
    wUntil !== null &&
    wFrom >= year &&
    wUntil > wFrom &&
    wUntil - year <= 80
      ? { from: wFrom, until: wUntil }
      : null;

  const scale = (v: number | null) => (v !== null && v >= 1 && v <= 5 ? Math.round(v) : null);
  const structure = {
    body: scale(raw.body),
    tannin: scale(raw.tannin),
    sweetness: scale(raw.sweetness),
    acidity: scale(raw.acidity),
  };
  const seenGroups = new Set<string>();
  const flavors = raw.flavors
    .filter((f) => !seenGroups.has(f.group) && seenGroups.add(f.group))
    .map((f) => ({ group: f.group, notes: list(f.notes, 6, 40) }))
    .filter((f) => f.notes.length > 0)
    .slice(0, 5);

  return {
    summary,
    style: clean(raw.style, 200),
    grapes: list(raw.grapes, 8, 60),
    tasting: clean(raw.tasting, 500),
    serving,
    decantMinutes: decant,
    abvPercent: abv,
    drinkWindow,
    pairings: list(raw.pairings, 6, 80),
    aging: clean(raw.aging, 400),
    structure: Object.values(structure).some((v) => v !== null) ? structure : null,
    flavors,
    pairingKinds: [...new Set(raw.pairing_kinds)].slice(0, 6),
    version: PROFILE_VERSION,
    value: null,
    confidence: raw.confidence,
  };
}

/**
 * A profile is written once and then stays: the person reads the same description, tastes and aromas every time.
 * A newer kind of profile only fills in what the stored one lacks (an empty list, a missing number), never more.
 */
export function mergeInsight(stored: InsightOutput, fresh: InsightOutput): InsightOutput {
  const text = (a: string, b: string) => (a.trim() !== "" ? a : b);
  const items = <T>(a: T[], b: T[]) => (a.length > 0 ? a : b);
  return {
    ...stored,
    summary: text(stored.summary, fresh.summary),
    style: text(stored.style, fresh.style),
    tasting: text(stored.tasting, fresh.tasting),
    aging: text(stored.aging, fresh.aging),
    grapes: items(stored.grapes, fresh.grapes),
    pairings: items(stored.pairings, fresh.pairings),
    serving: stored.serving ?? fresh.serving,
    decantMinutes: stored.decantMinutes ?? fresh.decantMinutes,
    abvPercent: stored.abvPercent ?? fresh.abvPercent,
    drinkWindow: stored.drinkWindow ?? fresh.drinkWindow,
    structure: stored.structure ?? fresh.structure,
    flavors: items(stored.flavors, fresh.flavors),
    pairingKinds: items(stored.pairingKinds, fresh.pairingKinds),
    version: Math.max(stored.version, fresh.version),
  };
}

// ---- Per vintage: what a bottle is worth, with sources ---------------------------------------------------

/** A new value may be looked up at most this often per vintage: prices move slowly, and a lookup costs money. */
export const VALUATION_INTERVAL_DAYS = 30;

export const RawValuationSchema = z.object({
  low: z.number().nullable(),
  high: z.number().nullable(),
  basis: z.string(),
  sources: z.array(z.object({ name: z.string(), url: z.string() })),
});
export type RawValuation = z.infer<typeof RawValuationSchema>;

export interface ValuationSource {
  name: string;
  url: string;
}

export interface Valuation {
  lowCents: number;
  highCents: number;
  currency: string;
  basis: string;
  /** The web pages the prices were read from; empty for values from before sources were kept. */
  sources: ValuationSource[];
  valuedAt: string;
}

/** A page address without tracking bits, or null when it is not a plain https page. */
function cleanUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return null;
    for (const key of [...url.searchParams.keys()])
      if (key.startsWith("utm_")) url.searchParams.delete(key);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/**
 * What the AI found a bottle sells for, checked in code: a sane range, in the household's currency, and only
 * sources it really looked at (a page on a site the web search visited). No real source, no value.
 */
export function checkValuation(
  raw: RawValuation,
  currency: string,
  /** The pages the web search actually opened. */
  consulted: readonly string[],
): Omit<Valuation, "valuedAt"> | null {
  const low = raw.low !== null ? Math.round(raw.low * 100) : null;
  const high = raw.high !== null ? Math.round(raw.high * 100) : null;
  if (low === null || high === null || low < 1 || low > high) return null;
  if (high > MAX_PRICE_CENTS || high > low * 10) return null;
  const hosts = new Set(
    consulted.flatMap((u) => {
      const url = cleanUrl(u);
      return url ? [url.hostname.replace(/^www\./, "")] : [];
    }),
  );
  const seen = new Set<string>();
  const sources: ValuationSource[] = [];
  for (const s of raw.sources) {
    const url = cleanUrl(s.url);
    if (!url || !hosts.has(url.hostname.replace(/^www\./, ""))) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    sources.push({ name: clean(s.name, 80) || url.hostname, url: url.href.slice(0, 500) });
    if (sources.length === 5) break;
  }
  if (sources.length === 0) return null;
  return { lowCents: low, highCents: high, currency, basis: clean(raw.basis, 300), sources };
}

/** When a new value may be looked up again (ISO), or null when that may happen now. */
export function nextValuationAt(lastValuedAt: string | null, now: Date): string | null {
  if (lastValuedAt === null) return null;
  const next = Date.parse(lastValuedAt) + VALUATION_INTERVAL_DAYS * 86_400_000;
  return next > now.getTime() ? new Date(next).toISOString() : null;
}

export const midCents = (v: Pick<Valuation, "lowCents" | "highCents">) =>
  Math.round((v.lowCents + v.highCents) / 2);

export interface VintageInsightView {
  /** False until the database step for this has been taken. */
  ready: boolean;
  insight: { output: InsightOutput; model: string; generatedAt: string } | null;
  /** The household's own value per bottle, which counts for more than any estimate. */
  myValueCents: number | null;
  currency: string;
  /** False until the database step for value history has been taken. */
  valuationsReady: boolean;
  /** The latest value with its sources, if one was ever looked up. */
  valuation: Valuation | null;
  /** Every value looked up so far, oldest first (the middle of each range). */
  valueHistory: Array<{ cents: number; valuedAt: string }>;
  /** When a new value may be looked up (ISO); null when that may happen now. */
  nextValuationAt: string | null;
}

export const SaveMyValueSchema = z.object({
  myValueCents: z.number().int().min(0).max(MAX_PRICE_CENTS).nullable(),
});
export type SaveMyValue = z.infer<typeof SaveMyValueSchema>;

/** The value to show and count: your own if you gave one, else the middle of the AI's range. */
export function currentValueCents(
  view: Pick<VintageInsightView, "insight" | "myValueCents"> & {
    valuation?: Valuation | null | undefined;
  },
): number | null {
  if (view.myValueCents !== null) return view.myValueCents;
  if (view.valuation) return midCents(view.valuation);
  const v = view.insight?.output.value;
  return v ? midCents(v) : null;
}
