import "server-only";
import { z } from "zod";
import { assertAdmin, type AdminSession } from "@/server/admin/access";
import { createServiceClient } from "./client";

/**
 * COMMUNITY REVIEW MODERATION FOR THE ADMIN (docs/sprints/ratings/DESIGN.md §3): the queue of reported reviews and
 * the decision on one. Every function takes the admin session that only `verifyAdmin` issues and checks it again;
 * the database functions are service-role only, and every decision is logged with its reason and the admin.
 *
 * "missing" = the database step (20261130000052_community_reviews.sql) is not taken yet; null = no service role.
 */
type Result<T> = Promise<T | "missing" | null>;

const missing = (e: { code?: string }) => e.code === "PGRST202" || e.code === "42883";

async function rpc<T>(
  session: AdminSession,
  fn: string,
  args: Record<string, unknown>,
  parse: (d: unknown) => T,
): Result<T> {
  assertAdmin(session);
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await (
    db.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
  )(fn, args);
  if (error) {
    if (missing(error)) return "missing";
    throw error;
  }
  return parse(data);
}

export const ReviewQueueItemSchema = z.object({
  reviewId: z.string().uuid(),
  status: z.enum(["published", "hidden", "removed"]),
  score: z.number(),
  body: z.string().nullable(),
  vintage: z.number().nullable(),
  publishedAt: z.string(),
  wine: z.string().nullable().optional(),
  openReports: z.number(),
  reasons: z.array(z.string()),
});
export type ReviewQueueItem = z.infer<typeof ReviewQueueItemSchema>;

export const reviewQueue = (session: AdminSession) =>
  rpc(session, "admin_community_review_queue", { p_limit: 100 }, (d) =>
    z.array(ReviewQueueItemSchema).parse(d ?? []),
  );

export const ModerationSchema = z.object({
  reviewId: z.uuid(),
  action: z.enum(["hide", "restore", "remove"]),
  reason: z.string().trim().min(3).max(300),
});

export const moderateReview = (session: AdminSession, input: z.infer<typeof ModerationSchema>) =>
  rpc(
    session,
    "admin_moderate_community_review",
    {
      p_review_id: input.reviewId,
      p_action: input.action,
      p_reason: input.reason,
      p_actor: `admin ${session.userId}`,
      p_moderator: session.userId,
    },
    (d) => z.object({ review: z.string(), status: z.string() }).parse(d),
  );
