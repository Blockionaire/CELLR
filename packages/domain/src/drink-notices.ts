import { z } from "zod";
import { fractionalYear, type DrinkWindow } from "./drink-window";

/** "peak": it has reached its best years. "ending": the last stretch of its window: drink it soon. */
export const DRINK_NOTICE_KINDS = ["peak", "ending"] as const;
export type DrinkNoticeKind = (typeof DRINK_NOTICE_KINDS)[number];

/** Where in its window a wine reaches its best (the same thresholds as `drinkStatus`). */
const START: Record<DrinkNoticeKind, number> = { peak: 0.25, ending: 0.7 };
/** A moment is news for this long after it happens (in years): the daily round may miss a few days, but a moment
 * from long ago (say, a whole cellar brought in at once) is old news and stays quiet. */
const RECENT = 0.25;

export interface NoticeWine {
  vintageId: string;
  title: string;
  window: Pick<DrinkWindow, "from" | "until"> | null;
  /** When the first bottle of it that is still in the cellar came in (ISO). */
  firstAddedAt: string;
}

export interface DrinkNotice {
  vintageId: string;
  kind: DrinkNoticeKind;
  title: string;
}

/**
 * Which reminders are due today. Each (vintage, kind) is told once. Only a moment that happened lately, and after
 * the bottle came in, is news: a wine bought when it was already at its best is marked as known, not announced.
 * And only the latest moment counts: a wine that is already in its last stretch is not also told it peaked.
 * With `baseline` (reminders just switched on) everything that is already true is marked as known.
 */
export function dueNotices(
  wines: readonly NoticeWine[],
  known: ReadonlySet<string>,
  now: Date,
  baseline = false,
): { announce: DrinkNotice[]; quiet: DrinkNotice[] } {
  const t = fractionalYear(now);
  const announce: DrinkNotice[] = [];
  const quiet: DrinkNotice[] = [];
  for (const w of wines) {
    if (!w.window) continue;
    const span = Math.max(1, w.window.until - w.window.from);
    const at = (kind: DrinkNoticeKind) => w.window!.from + START[kind] * span;
    const added = fractionalYear(new Date(w.firstAddedAt));
    const reached = (["ending", "peak"] as const).filter((k) => t >= at(k));
    reached.forEach((kind, i) => {
      if (known.has(noticeKey(w.vintageId, kind))) return;
      const notice = { vintageId: w.vintageId, kind, title: w.title };
      const news = !baseline && i === 0 && added < at(kind) && t - at(kind) <= RECENT;
      (news ? announce : quiet).push(notice);
    });
  }
  return { announce, quiet };
}

export const noticeKey = (vintageId: string, kind: DrinkNoticeKind) => `${vintageId}:${kind}`;

/** What a browser hands over when it allows notifications (the standard PushSubscription JSON). */
export const PushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => u.startsWith("https://"), "Must be https."),
  keys: z.object({
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(8).max(100),
  }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionSchema>;

export const PushEndpointSchema = z.object({ endpoint: z.string().max(1000) });

/** Whether reminders can be switched on here: `enabled` = the server can send them; `publicKey` to subscribe with. */
export interface PushStatusView {
  enabled: boolean;
  publicKey: string | null;
}
