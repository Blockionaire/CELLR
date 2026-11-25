import "server-only";
import {
  CatalogRecordPageSchema,
  CommunityRowSchema,
  DomainError,
  ExternalRatingsRowSchema,
  MyReviewSchema,
  PublishResultSchema,
  mergeWineRatings,
  NO_RATINGS,
  type CatalogRecordPage,
  type CommunityRow,
  type ExternalRatingsRow,
  type PublishReview,
  type MyReview,
  type ReportReason,
  type WineRatingsData,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { mapDbError } from "@/server/db/errors";

/**
 * RATINGS AND COMMUNITY REVIEWS (docs/sprints/ratings/DESIGN.md). Everything is read and written as the signed-in
 * person, through the database's gated functions only (20261129000051, 20261130000052): which record a wine's ratings
 * come from, whether a source may be shown, which reviews are published and whose they are, is decided there.
 * Before those database steps are taken every read is "not available" and nothing fails.
 */
export interface RatingsRepository {
  wineExternal(householdId: string, wineId: string): Promise<unknown>;
  wineCommunity(householdId: string, wineId: string): Promise<unknown>;
  recordExternal(recordId: string): Promise<unknown>;
  recordCommunity(recordId: string): Promise<unknown>;
  publish(tastingId: string, body: string | null): Promise<unknown>;
  remove(reviewId: string): Promise<string | null>;
  report(reviewId: string, reason: ReportReason, detail: string | null): Promise<string | null>;
  mine(tastingId: string): Promise<unknown>;
  recordPage(recordId: string): Promise<unknown>;
  /** Whether the community is open in the database (20261202000054); null before that step. */
  communityOpen(): Promise<unknown>;
}

const MISSING = new Set(["PGRST202", "42883"]);

export function createRatingsRepository(db: Db): RatingsRepository {
  // the new functions are called by name; their shapes are checked below, not trusted
  const call = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await (
      db.rpc as unknown as (
        f: string,
        a: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
    )(fn, args);
    if (error && error.code && MISSING.has(error.code)) return undefined;
    if (error) throw mapDbError(error as Parameters<typeof mapDbError>[0]);
    return data;
  };
  return {
    wineExternal: (h, w) => call("catalog_wine_ratings", { p_household_id: h, p_wine_id: w }),
    wineCommunity: (h, w) =>
      call("community_reviews_for_wine", { p_household_id: h, p_wine_id: w, p_limit: 50 }),
    recordExternal: (r) => call("catalog_record_ratings", { p_record_id: r }),
    recordCommunity: (r) => call("community_reviews_for_record", { p_record_id: r, p_limit: 50 }),
    publish: (t, body) =>
      call("publish_community_review", { p_tasting_id: t, p_body: body, p_consent: true }),
    remove: async (id) =>
      (await call("delete_community_review", { p_review_id: id })) as string | null,
    report: async (id, reason, detail) =>
      (await call("report_community_review", {
        p_review_id: id,
        p_reason: reason,
        p_detail: detail,
      })) as string | null,
    mine: (t) => call("my_community_review", { p_tasting_id: t }),
    recordPage: (r) => call("catalog_record_page", { p_record_id: r }),
    communityOpen: () => call("community_is_open", {}),
  };
}

function parseExternal(raw: unknown): ExternalRatingsRow | null {
  if (raw === null || raw === undefined) return null;
  const p = ExternalRatingsRowSchema.safeParse(raw);
  // a malformed answer shows nothing rather than a wrong number
  return p.success ? p.data : null;
}
function parseCommunity(raw: unknown): CommunityRow | null {
  if (raw === null || raw === undefined) return null;
  const p = CommunityRowSchema.safeParse(raw);
  return p.success ? p.data : null;
}

export interface RatingsDeps {
  repo: RatingsRepository;
  householdId: () => Promise<string>;
  /** Feature switches: external ratings at all; community reviews (needs the first). */
  features: { ratings: boolean; community: boolean };
}

export function createRatingsService({ repo, householdId, features }: RatingsDeps) {
  const off = () => {
    if (!features.ratings) throw new DomainError("NOT_FOUND");
  };
  const offCommunity = () => {
    if (!features.ratings || !features.community) throw new DomainError("NOT_FOUND");
  };
  return {
    /** A wine in the person's household: its record's ratings and its community reviews. */
    async forWine(wineId: string): Promise<WineRatingsData> {
      off();
      const h = await householdId();
      const [e, c, open] = await Promise.all([
        repo.wineExternal(h, wineId).catch(() => null),
        features.community
          ? repo.wineCommunity(h, wineId).catch(() => null)
          : Promise.resolve(null),
        // publishing is offered only while the community is open in the database (a closed one refuses anyway)
        features.community ? repo.communityOpen().catch(() => false) : Promise.resolve(false),
      ]);
      const data = mergeWineRatings(parseExternal(e), parseCommunity(c));
      return open === true ? data : { ...data, reviewable: false };
    },
    /** A provider record shown to people (the catalogue page of a search result). */
    async forRecord(recordId: string): Promise<WineRatingsData> {
      off();
      const [e, c] = await Promise.all([
        repo.recordExternal(recordId).catch(() => null),
        features.community
          ? repo.recordCommunity(recordId).catch(() => null)
          : Promise.resolve(null),
      ]);
      const ext = parseExternal(e);
      const com = parseCommunity(c);
      if (!ext && !com) return NO_RATINGS;
      // a record page never offers publishing: a review is made from one's own tasting of one's own wine
      return { ...mergeWineRatings(ext, com), reviewable: false };
    },
    async publish(
      tastingId: string,
      input: PublishReview,
    ): Promise<{ status: "published" | "updated"; reviewId: string }> {
      offCommunity();
      const parsed = PublishResultSchema.safeParse(await repo.publish(tastingId, input.body));
      if (!parsed.success) throw new DomainError("NOT_FOUND");
      const { status, reviewId } = parsed.data;
      switch (status) {
        case "published":
        case "updated":
          if (!reviewId) throw new DomainError("NOT_FOUND");
          return { status, reviewId };
        case "rate_limited":
          throw new DomainError("RATE_LIMITED");
        case "invalid_text":
        case "no_consent":
          throw new DomainError(
            "VALIDATION",
            "Links are not allowed, and a review is at most 1500 characters.",
          );
        case "no_score":
          throw new DomainError("CONFLICT", "Give it stars first, then share it.");
        case "no_identity":
          throw new DomainError(
            "CONFLICT",
            "This wine can't be reviewed publicly yet: CELLR doesn't know it as a catalogue wine.",
          );
        case "moderated":
          throw new DomainError(
            "CONFLICT",
            "A moderator has looked at your review of this wine, so it can't be changed.",
          );
        default:
          throw new DomainError("NOT_FOUND");
      }
    },
    async remove(reviewId: string): Promise<{ deleted: boolean }> {
      offCommunity();
      const r = await repo.remove(reviewId);
      if (r !== "deleted") throw new DomainError("NOT_FOUND");
      return { deleted: true };
    },
    async report(
      reviewId: string,
      reason: ReportReason,
      detail?: string,
    ): Promise<{ reported: boolean }> {
      offCommunity();
      const r = await repo.report(reviewId, reason, detail?.trim() || null);
      if (r === "rate_limited") throw new DomainError("RATE_LIMITED");
      if (r !== "reported" && r !== "already_reported") throw new DomainError("NOT_FOUND");
      return { reported: true };
    },
    /** A provider record's own catalogue page (a search or scan result shown to people); NOT_FOUND otherwise. */
    async record(recordId: string): Promise<CatalogRecordPage> {
      off();
      const p = CatalogRecordPageSchema.safeParse(await repo.recordPage(recordId));
      if (!p.success) throw new DomainError("NOT_FOUND");
      return p.data;
    },
    async mine(tastingId: string): Promise<{ review: MyReview }> {
      offCommunity();
      const p = MyReviewSchema.safeParse((await repo.mine(tastingId)) ?? null);
      return { review: p.success ? p.data : null };
    },
  };
}

export type RatingsService = ReturnType<typeof createRatingsService>;
