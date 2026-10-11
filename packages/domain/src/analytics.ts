import { z } from "zod";

/**
 * The complete list of product events. Adding one is a deliberate act: we mainly want to learn what
 * friends and family actually use, not to watch them. First-party only, no IP or user-agent stored.
 */
export const ANALYTICS_EVENTS = [
  "account_created",
  "household_created",
  "household_joined",
  "invite_created",
  "wine_scan_started",
  "wine_scan_completed",
  "wine_scan_failed",
  "bottle_added",
  "bottle_opened",
  "rating_created",
  "sommelier_question_asked",
  "tonight_recommendation_generated",
  "3d_cellar_opened",
  "3d_bottle_selected",
  "drink_soon_viewed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/**
 * Event properties are small, flat and anonymous by construction: short keys, scalar values,
 * and no value that looks like an email address (the commonest accidental leak).
 */
export const AnalyticsPropsSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,31}$/, "Property names are snake_case."),
    z.union([
      z
        .string()
        .max(100)
        .refine((s) => !s.includes("@"), "Properties must not contain personal data."),
      z.number().finite(),
      z.boolean(),
    ]),
  )
  .refine((props) => Object.keys(props).length <= 10, "At most 10 properties.");

export const TrackEventSchema = z.object({
  name: z.enum(ANALYTICS_EVENTS),
  props: AnalyticsPropsSchema.default({}),
  householdId: z.uuid().optional(),
});

export type TrackEvent = z.infer<typeof TrackEventSchema>;
