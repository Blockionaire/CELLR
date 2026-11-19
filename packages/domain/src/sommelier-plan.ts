import { z } from "zod";
import { ConversationStateSchema, ASK_CODES } from "./buying/state";
import { STYLE_REASONS } from "./buying/codes";
import { OFFER_DEFECTS } from "./buying/offers";
import { DECANT_KINDS, GLASSES } from "./experiences/serving";
import { PAIRING_CONS, PAIRING_PROS } from "./pairing-engine/assess";
import { CONFIDENCE_LEVELS, PAIRING_OUTCOMES } from "./pairing-engine/decide";
import { EVIDENCE_TIERS } from "./pairing-engine/wine";
import { MENTION_STATUSES } from "./social";
import { DRINK_PHASES } from "./drink-window";

/**
 * THE SOMMELIER'S PLAN: what the engines decided, before any sentence is written. It is the whole answer in a
 * form a screen can draw and a model can word, and nothing in it is a model's opinion: the outcome, the bottles,
 * the reasons, the evidence behind them, what was set aside and why, what to buy as a style, and the one question
 * to ask back. A model that words an answer gets this plan and may not add a wine, a price or a claim to it.
 *
 * The plan travels in an answer next to the V1 fields, which keep their meaning: a screen (or a stored
 * conversation) that does not know plans still shows the bottles and a plain sentence.
 */
export const SOMMELIER_PLAN_VERSION = 1;

// The codes a plan is made of, for the screens that word them (the engines themselves stay server-side).
export {
  PAIRING_CONS,
  PAIRING_PROS,
  type PairingCon,
  type PairingPro,
} from "./pairing-engine/assess";
export {
  CONFIDENCE_LEVELS as PAIRING_CONFIDENCE_LEVELS,
  PAIRING_OUTCOMES,
  type Confidence as PairingConfidence,
  type PairingOutcome,
} from "./pairing-engine/decide";
export { EVIDENCE_TIERS, type EvidenceTier } from "./pairing-engine/wine";
export { DECANT_KINDS, GLASSES, type DecantKind, type Glass } from "./experiences/serving";

export const PLAN_KINDS = [
  /** What to open with a dish. */
  "pairing",
  /** What to buy (with or without a dish). */
  "buying",
  /** A wine for every course. */
  "menu",
  /** What to cook with a bottle. */
  "wine-to-food",
  /** Which of two owned wines for a dish. */
  "compare",
  /** How to serve a bottle. */
  "serving",
  /** How long a bottle can be kept. */
  "keeping",
  /** How many bottles for the guests. */
  "quantity",
  /** The question could not be read, or is not about wine or food: one question back, no bottles. */
  "clarify",
] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/** Things said about a bottle that is offered. */
export const PICK_NOTES = [
  /** Some of its bottles are kept for an occasion; at least one is free. */
  "partly-reserved",
  /** It can be drunk now but is still young. */
  "young",
  /** It is past its window: drink soon, it may have faded. */
  "past",
  /** What is said about it rests on its region or grape, not on this exact wine. */
  "estimate",
  /** Its origin is not recorded; it was judged by its name. */
  "by-name",
  /** Nothing but its colour is known. */
  "little-known",
  /** By the estimate of its window it is past its best, but too little is known of it to say so for sure. */
  "may-be-past",
  /** The asker's taste put it before others that suit as well. */
  "your-taste",
  /** The taste of the table (the asker and the friends named) put it before others. */
  "table-taste",
] as const;
export type PickNote = (typeof PICK_NOTES)[number];

/** Why a wine that suits the dish is not offered. */
export const SET_ASIDE_REASONS = ["reserved", "too-young", "turned-down"] as const;
export type SetAsideReason = (typeof SET_ASIDE_REASONS)[number];

/** What became of looking for real bottles in shops. */
export const OFFER_CHECKS = [
  /** Nobody asked to buy. */
  "not-asked",
  /** No retailer source is connected: only a style can be advised. */
  "no-provider",
  /** The source did not answer. */
  "provider-down",
  /** It answered; nothing passed the checks. */
  "nothing-verified",
  "shown",
] as const;
export type OfferCheck = (typeof OFFER_CHECKS)[number];

const uuid = z.string().uuid();
const pros = z.array(z.enum(PAIRING_PROS)).max(6);
const cons = z.array(z.enum(PAIRING_CONS)).max(6);

export const PlanPickSchema = z.object({
  vintageId: uuid,
  /** "neutral" only ever for the closest wine when nothing suits; an offered wine is good or acceptable. */
  level: z.enum(["good", "acceptable", "neutral"]),
  tier: z.enum(EVIDENCE_TIERS),
  pros,
  cons,
  notes: z.array(z.enum(PICK_NOTES)).max(6),
});
export type PlanPick = z.infer<typeof PlanPickSchema>;

export const PlanStyleSchema = z.object({
  /** A style of the catalogue (buying/styles.ts). Never a product. */
  styleId: z.string().max(40),
  label: z.string().max(80),
  type: z.string().max(12),
  /** The engine's estimate of where sound bottles of this style start, whole euros. Shown as "usually from about". */
  fromEuros: z.number().int().min(1).max(10_000),
  reason: z.enum(STYLE_REASONS),
  pros,
});
export type PlanStyle = z.infer<typeof PlanStyleSchema>;

/** A real bottle in a real shop, as a retailer source reported it and the checks passed it. */
export const PlanOfferSchema = z.object({
  level: z.enum(["online-offer", "local-availability"]),
  producer: z.string().max(120),
  name: z.string().max(160),
  year: z.number().int().nullable(),
  sizeMl: z.number().int(),
  priceCents: z.number().int().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  merchant: z.string().max(120),
  store: z.string().max(120).nullable(),
  /** The bottle's own page at the merchant: https only, whatever a stored plan claims. */
  url: z
    .string()
    .url()
    .max(500)
    .refine((u) => u.startsWith("https://"), "https only"),
  observedAt: z.string().max(40),
});
export type PlanOffer = z.infer<typeof PlanOfferSchema>;

export const PlanServingSchema = z.object({
  vintageId: uuid,
  tempC: z.object({ min: z.number(), max: z.number() }),
  fridgeMinutes: z.number().int().min(0),
  decant: z.object({ kind: z.enum(DECANT_KINDS), minutes: z.number().int().min(0) }),
  glass: z.enum(GLASSES),
  basis: z.enum(["profile", "style"]),
  tier: z.enum(EVIDENCE_TIERS),
});
export type PlanServing = z.infer<typeof PlanServingSchema>;

export const PlanCourseSchema = z.object({
  dish: z.string().max(120),
  outcome: z.enum(PAIRING_OUTCOMES),
  pick: PlanPickSchema.nullable(),
  /** The same wine is poured with another course too. */
  shared: z.boolean(),
});

export const SommelierPlanSchema = z.object({
  v: z.literal(SOMMELIER_PLAN_VERSION),
  kind: z.enum(PLAN_KINDS),
  /** The dish as the food engine read it, in the asker's words; null when there is none. */
  dish: z.string().max(120).nullable(),
  /** How well the dish was understood. */
  dishConfidence: z.enum(CONFIDENCE_LEVELS).nullable(),
  /** For a pairing: a good match, an acceptable compromise, or nothing that suits. */
  outcome: z.enum(PAIRING_OUTCOMES).nullable(),
  /** How sure the engine is, in words; never a percentage. */
  confidence: z.enum(CONFIDENCE_LEVELS).nullable(),
  /** How many of the household's wines were considered (after a wish for a colour). 0: nothing to choose from. */
  considered: z.number().int().min(0),
  /** The owned wines offered, best first. The cards in the answer are these, in this order. */
  picks: z.array(PlanPickSchema).max(6),
  /**
   * When nothing suits: the owned wine that comes closest without clashing. Not a recommendation, and never
   * worded as one.
   */
  closest: PlanPickSchema.nullable(),
  /** Owned wines that would suit but are not offered. */
  setAside: z.array(z.object({ vintageId: uuid, reason: z.enum(SET_ASIDE_REASONS) })).max(6),
  /** What to buy, as styles. */
  styles: z.array(PlanStyleSchema).max(4),
  offers: z.array(PlanOfferSchema).max(3),
  offerCheck: z.enum(OFFER_CHECKS),
  /** Why offers were dropped, counted per reason (for the record; no offer data). */
  offersDropped: z.array(z.enum(OFFER_DEFECTS)).max(20),
  /** A menu: one entry per course. */
  courses: z.array(PlanCourseSchema).max(6),
  /** Wine-to-food: dishes that suit the bottle (ids of the food knowledge), and what to steer away from. */
  dishIdeas: z
    .array(z.object({ dishId: z.string().max(60), label: z.string().max(80), pros }))
    .max(8),
  avoid: cons,
  serving: z.array(PlanServingSchema).max(3),
  /** How long a bottle can be kept: the drinking window the app already shows for it, and how sure that is. */
  keeping: z
    .array(
      z.object({
        vintageId: uuid,
        from: z.number().int().nullable(),
        until: z.number().int().nullable(),
        phase: z.enum(DRINK_PHASES),
        /** False when the window is the style table's guess, not known for this wine. */
        reliable: z.boolean(),
      }),
    )
    .max(3),
  /** Guests and bottles: needed, and how many of the offered wines are there. */
  quantity: z
    .object({
      guests: z.number().int(),
      needed: z.number().int(),
      available: z.number().int(),
      short: z.number().int(),
    })
    .nullable(),
  /** The one question asked back, if any. */
  ask: z.enum(ASK_CODES).nullable(),
  /** What was established so far; the screen sends it back with the next question. */
  state: ConversationStateSchema,
  /** The friends named in the question and what became of each. No friend data: only the asker's own words. */
  friends: z
    .array(z.object({ handle: z.string().max(21), status: z.enum(MENTION_STATUSES) }))
    .max(5),
});
export type SommelierPlan = z.infer<typeof SommelierPlanSchema>;

/** A plan from an answer that was kept or sent by a screen: used when it is one, else there is none. */
export function readPlan(value: unknown): SommelierPlan | null {
  const parsed = SommelierPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
