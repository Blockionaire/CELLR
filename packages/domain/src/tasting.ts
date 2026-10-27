import { z } from "zod";

/**
 * Words people reach for when describing a wine. Keys are stored; the screen translates them.
 * A short, friendly list on purpose: a tasting note is a feeling, not an exam.
 */
export const DESCRIPTORS = [
  "fruity",
  "floral",
  "earthy",
  "spicy",
  "oaky",
  "mineral",
  "fresh",
  "rich",
  "smooth",
  "bold",
  "light",
  "dry",
  "sweet",
  "tannic",
  "complex",
  "elegant",
] as const;
export type Descriptor = (typeof DESCRIPTORS)[number];

export const MAX_NOTE_LENGTH = 2000;

/**
 * A score is in half stars (stars = score / 2, so 9 = 4.5 stars), to one tenth of a STAR: 4.2 stars = 8.4. Any
 * multiple of 0.2 from 1 to 10 is valid (whole numbers, the older half-star ratings, still are). Normalised so
 * floating-point noise from the input (8.400000001) never reaches the database.
 */
export const ScoreSchema = z
  .number()
  .min(1)
  .max(10)
  .refine((v) => Math.abs(v * 5 - Math.round(v * 5)) < 1e-6, "Ratings go in tenths of a star.")
  .transform((v) => Math.round(v * 5) / 5);

/** Stars (1.0..5.0, tenths) → score; the inverse of starsOf. */
export const scoreOfStars = (stars: number): number => Math.round(stars * 10) / 5;

/** What a person says about a bottle they opened: stars (to a tenth, stored as half-star score), words, a note. */
export const SaveTastingSchema = z
  .object({
    score: ScoreSchema.nullable().default(null),
    descriptors: z
      .array(z.enum(DESCRIPTORS))
      .max(12)
      .default([])
      .transform((list) => [...new Set(list)]),
    note: z
      .string()
      .trim()
      .max(MAX_NOTE_LENGTH)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .default(null),
  })
  .refine((v) => v.score !== null || v.note !== null || v.descriptors.length > 0, {
    message: "Say something about it: give it stars, a word or a note.",
  });
export type SaveTasting = z.infer<typeof SaveTastingSchema>;

/** One person's verdict on one bottle. Everyone in the household can read it. */
export interface TastingView {
  id: string;
  vintageId: string;
  bottleId: string | null;
  userId: string;
  /** The author's first name, or null when they have not set one. */
  userName: string | null;
  /** 1..10 (half stars), or null when only words or a note were left. */
  score: number | null;
  descriptors: Descriptor[];
  note: string | null;
  tastedAt: string;
  /** Written by the signed-in person (the only ones they may change). */
  mine: boolean;
}

/** The household's average for a wine: in stars (0.5 steps stored, shown with one decimal) and how many people rated. */
export interface RatingSummary {
  average: number;
  count: number;
}

/** 9 → 4.5 stars; 8.4 → 4.2 (rounded to a tenth, so no floating-point tails). */
export const starsOf = (score: number): number => Math.round(score * 5) / 10;

/** "4.5", "4.2", "4": no trailing zero. */
export const formatStars = (score: number): string => String(starsOf(score));

/** Mean of 1..10 scores in stars, one decimal; null when there is nothing to average. */
export function summarizeScores(scores: readonly number[]): RatingSummary | null {
  if (scores.length === 0) return null;
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  return { average: Math.round(mean * 5) / 10, count: scores.length };
}
