import { z } from "zod";

/**
 * PRIVATE BETA FEEDBACK: what a signed-in person chooses to tell us, in their own words. It is not analytics and
 * nothing is collected behind their back: no form contents, photos, cellar details, notes, chats or logs; no
 * URL query, IP address or full user agent. The person's identity is taken from their session on the server.
 */

export const FEEDBACK_CATEGORIES = ["bug", "confusing", "idea", "other"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_MESSAGE_MIN = 10;
export const FEEDBACK_MESSAGE_MAX = 2000;
export const FEEDBACK_LOCATION_MAX = 120;
export const FEEDBACK_DEVICE_MAX = 160;

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const KEEP_LINES = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g;
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const ONE_LINE = /[\u0000-\u001f\u007f-\u009f]+/g;

/** Text from a person: no control characters (line breaks kept in the message), trimmed. */
const tidy = (keepLines: boolean) => (v: string) =>
  v.replace(keepLines ? KEEP_LINES : ONE_LINE, " ").trim();

const optionalLine = (max: number) =>
  z
    .string()
    .transform(tidy(false))
    .pipe(z.string().max(max))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

export const SubmitFeedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z
    .string()
    .transform(tidy(true))
    .pipe(z.string().min(FEEDBACK_MESSAGE_MIN).max(FEEDBACK_MESSAGE_MAX)),
  /** Where it happened, in the person's words or the screen they picked. */
  location: optionalLine(FEEDBACK_LOCATION_MAX),
  /** A coarse device line the person was shown and chose to include. */
  device: optionalLine(FEEDBACK_DEVICE_MAX),
});
export type SubmitFeedback = z.input<typeof SubmitFeedbackSchema>;

/** The screens a person can pick as "where it happened" (they may also type their own). */
export const FEEDBACK_PLACES = [
  "home",
  "cellar",
  "scan",
  "wine",
  "sommelier",
  "tonight",
  "ratings",
  "taste",
  "profile",
  "other",
] as const;
export type FeedbackPlace = (typeof FEEDBACK_PLACES)[number];

/**
 * A coarse description of the device, from the browser's own user-agent string: only the kind of device, the
 * browser family and whether CELLR runs as a home-screen app. Never versions, models or the raw string.
 */
export function coarseDevice(userAgent: string, standalone: boolean): string {
  const ua = userAgent.toLowerCase();
  const device = /iphone|ipod/.test(ua)
    ? "iPhone"
    : /ipad/.test(ua)
      ? "iPad"
      : /android/.test(ua)
        ? "Android"
        : /mac os x|macintosh/.test(ua)
          ? "Mac"
          : /windows/.test(ua)
            ? "Windows"
            : /linux/.test(ua)
              ? "Linux"
              : "Other device";
  const browser = /edg\//.test(ua)
    ? "Edge"
    : /firefox|fxios/.test(ua)
      ? "Firefox"
      : /crios|chrome|chromium/.test(ua)
        ? "Chrome"
        : /safari/.test(ua)
          ? "Safari"
          : "Other browser";
  return [device, browser, standalone ? "home-screen app" : "browser tab"].join(" · ");
}

// ---- The admin inbox -----------------------------------------------------------------------------------------

export const FEEDBACK_PAGE_SIZE = 25;

export const AdminFeedbackPageSchema = z.object({
  total: z.coerce.number().int(),
  counts: z.record(z.string(), z.coerce.number().int()),
  rows: z.array(
    z.object({
      id: z.string(),
      category: z.enum(FEEDBACK_CATEGORIES),
      message: z.string(),
      location: z.string().nullable(),
      device: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type AdminFeedbackPage = z.infer<typeof AdminFeedbackPageSchema>;

export const parseFeedbackCategory = (value: unknown): FeedbackCategory | null =>
  typeof value === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(value)
    ? (value as FeedbackCategory)
    : null;
