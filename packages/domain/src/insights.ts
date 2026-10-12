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

/** What the model says. Everything is checked afterwards; nothing here is trusted as it comes. */
export const RawInsightSchema = z.object({
  summary: z.string(),
  style: z.string(),
  grapes: z.array(z.string()),
  tasting: z.string(),
  serving_temp_min_c: z.number().nullable(),
  serving_temp_max_c: z.number().nullable(),
  decant_minutes: z.number().nullable(),
  pairings: z.array(z.string()),
  aging: z.string(),
  value_low: z.number().nullable(),
  value_high: z.number().nullable(),
  value_basis: z.string(),
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
  pairings: z.array(z.string().max(80)).max(6),
  aging: z.string().max(400),
  value: z
    .object({
      lowCents: z.number().int().min(1),
      highCents: z.number().int().min(1),
      currency: z.string().regex(/^[A-Z]{3}$/),
      basis: z.string().max(240),
    })
    .nullable(),
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
 * Plausibility, in code and not in the prompt. A temperature that cannot be right, or a value range that is
 * absurd (reversed, or the high more than ten times the low), is dropped rather than shown; what is left has
 * its confidence lowered when the value had to go. Returns null when there is no profile worth keeping.
 */
export function checkInsight(raw: RawInsight, currency: string): InsightOutput | null {
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

  const low = raw.value_low !== null ? Math.round(raw.value_low * 100) : null;
  const high = raw.value_high !== null ? Math.round(raw.value_high * 100) : null;
  const valueOk =
    low !== null &&
    high !== null &&
    low >= 1 &&
    low <= high &&
    high <= MAX_PRICE_CENTS &&
    high <= low * 10;
  const basis = clean(raw.value_basis, 240);

  return {
    summary,
    style: clean(raw.style, 200),
    grapes: list(raw.grapes, 8, 60),
    tasting: clean(raw.tasting, 500),
    serving,
    decantMinutes: decant,
    pairings: list(raw.pairings, 6, 80),
    aging: clean(raw.aging, 400),
    value: valueOk ? { lowCents: low, highCents: high, currency, basis } : null,
    // an answer whose value had to be thrown away is not one to be confident about
    confidence:
      raw.value_low !== null && !valueOk && raw.confidence === "high" ? "medium" : raw.confidence,
  };
}

export interface VintageInsightView {
  /** False until the database step for this has been taken. */
  ready: boolean;
  insight: { output: InsightOutput; model: string; generatedAt: string } | null;
  /** The household's own value per bottle, which counts for more than any estimate. */
  myValueCents: number | null;
  currency: string;
}

export const SaveMyValueSchema = z.object({
  myValueCents: z.number().int().min(0).max(MAX_PRICE_CENTS).nullable(),
});
export type SaveMyValue = z.infer<typeof SaveMyValueSchema>;

/** The value to show and count: your own if you gave one, else the middle of the AI's range. */
export function currentValueCents(
  view: Pick<VintageInsightView, "insight" | "myValueCents">,
): number | null {
  if (view.myValueCents !== null) return view.myValueCents;
  const v = view.insight?.output.value;
  return v ? Math.round((v.lowCents + v.highCents) / 2) : null;
}
