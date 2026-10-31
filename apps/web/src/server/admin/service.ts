import "server-only";
import { cache } from "react";
import {
  ADMIN_PAGE_SIZE,
  FEEDBACK_PAGE_SIZE,
  budgetUse,
  isUserId,
  summarizeAiCosts,
  summarizeRecognitionCache,
  summarizeSharedProfiles,
  automationVerdict,
  candidateCounts,
  candidatePriority,
  candidateState,
  listCandidates,
  type CandidateSort,
  type CandidateState,
  catalogShare,
  sumActivity,
  type AdminRange,
  type FeedbackCategory,
  cleanBottleArt,
  type BottlePhotoStatus,
  type WineVisualFilter,
} from "@cellr/domain";
import { getPageContext } from "@/server/context";
import { getAdminAllowlist, getAiBudgetEnv } from "@/server/env";
import {
  readActivity,
  readAiCosts,
  readBudgetStatus,
  readFeedback,
  readRecognitionCache,
  readSharedProfiles,
  readCatalog,
  readUserDirectory,
  readUserSummary,
} from "@/server/privileged/admin";
import {
  addCandidateSource,
  approveCandidate,
  mergeCandidate,
  readCandidate,
  readCandidates,
  readLearningMode,
  setCandidateStatus,
  setLearningMode,
  updateCandidate,
} from "@/server/privileged/catalog-admin";
import { getPlatformMetrics } from "@/server/privileged/metrics";
import {
  addBottleArt,
  publishBottleArt,
  readBottleArtFile,
  readBottlePhoto,
  readBottlePhotoFile,
  readBottlePhotos,
  readWineVisual,
  readWineVisuals,
  removeBottleArt,
  reviewBottlePhoto,
  unpublishBottleArt,
} from "@/server/privileged/bottle-library";
import { assertAdmin, verifyAdmin, type AdminSession } from "./access";

/**
 * The admin dashboard's data, for its Server Components only (there is no admin API: nothing here is reachable
 * over HTTP except through a page that has passed the check). Every read takes the admin session again.
 */

/** The admin check for a page render: the verified session's user id against the server-only allowlist. */
export const getAdminSession = cache(async (): Promise<AdminSession | null> =>
  verifyAdmin({
    session: async () => getPageContext(),
    confirm: async () => {
      const ctx = await getPageContext();
      if (!ctx) return null;
      const { data, error } = await ctx.db.auth.getUser();
      return error ? null : (data.user?.id ?? null);
    },
    allowlist: getAdminAllowlist,
  }),
);

const day = 86_400_000;
const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfUtcMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export async function adminOverview(session: AdminSession, now = new Date()) {
  assertAdmin(session);
  const end = new Date(now.getTime() + 60_000);
  const [metrics, today, month] = await Promise.all([
    getPlatformMetrics(now).catch(() => null),
    readAiCosts(session, startOfUtcDay(now), end),
    readAiCosts(session, startOfUtcMonth(now), end),
  ]);
  return {
    metrics,
    spendToday: typeof today === "object" && today ? summarizeAiCosts(today) : today,
    spendMonth: typeof month === "object" && month ? summarizeAiCosts(month) : month,
  };
}

export async function adminUsers(session: AdminSession, page: number) {
  assertAdmin(session);
  const rows = await readUserDirectory(session, page, ADMIN_PAGE_SIZE);
  if (!Array.isArray(rows)) return rows;
  const total = rows[0]?.total ?? 0;
  return { rows, page, total, pages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) };
}

export async function adminUser(session: AdminSession, userId: string) {
  assertAdmin(session);
  if (!isUserId(userId)) return "none" as const;
  return readUserSummary(session, userId.toLowerCase());
}

export async function adminProduct(session: AdminSession, days: AdminRange, now = new Date()) {
  assertAdmin(session);
  const [metrics, series] = await Promise.all([
    getPlatformMetrics(now).catch(() => null),
    readActivity(session, days, now),
  ]);
  return { metrics, series, totals: Array.isArray(series) ? sumActivity(series) : null };
}

export async function adminAi(session: AdminSession, days: AdminRange, now = new Date()) {
  assertAdmin(session);
  const end = new Date(now.getTime() + 60_000);
  const from = new Date(startOfUtcDay(now).getTime() - (days - 1) * day);
  const [range, today, week, month, budget, cache, shared, catalog] = await Promise.all([
    readAiCosts(session, from, end),
    readAiCosts(session, startOfUtcDay(now), end),
    readAiCosts(session, new Date(startOfUtcDay(now).getTime() - 6 * day), end),
    readAiCosts(session, startOfUtcMonth(now), end),
    readBudgetStatus(session, now),
    readRecognitionCache(session, from, end),
    readSharedProfiles(session, from, end),
    readCatalog(session, from, end),
  ]);
  const sum = (c: typeof range) => (typeof c === "object" && c ? summarizeAiCosts(c) : null);
  const limits = getAiBudgetEnv();
  return {
    range,
    summary: sum(range),
    today: sum(today),
    week: sum(week),
    month: sum(month),
    budget:
      typeof budget === "object" && budget
        ? budgetUse(budget, { daily: limits.dailyUsdMicro, monthly: limits.monthlyUsdMicro })
        : budget,
    /** Null: not configured, or the cache's database step is not taken yet. */
    cache: typeof cache === "object" && cache ? summarizeRecognitionCache(cache) : null,
    /** Null: not configured, or the shared-profile step is not taken yet. */
    shared:
      typeof shared === "object" && shared
        ? summarizeSharedProfiles(
            shared,
            typeof range === "object" && range
              ? (range.by_task.find((t) => t.key === "wine_insight")?.calls ?? 0)
              : null,
          )
        : null,
    /** Null: not configured, or the catalogue step is not taken yet. */
    catalog:
      typeof catalog === "object" && catalog ? { ...catalog, share: catalogShare(catalog) } : null,
    ready: range !== "missing",
  };
}

export async function adminFeedback(
  session: AdminSession,
  category: FeedbackCategory | null,
  page: number,
) {
  assertAdmin(session);
  const data = await readFeedback(session, category, page, FEEDBACK_PAGE_SIZE);
  if (typeof data !== "object" || data === null) return data;
  return { ...data, page, pages: Math.max(1, Math.ceil(data.total / FEEDBACK_PAGE_SIZE)) };
}

/** The catalogue review list: candidates (counts only), the learning switch, and the catalogue's size. */
export async function adminCatalog(
  session: AdminSession,
  state: CandidateState | "open" | "all",
  sort: CandidateSort,
  now = new Date(),
) {
  assertAdmin(session);
  const end = new Date(now.getTime() + 60_000);
  const from = new Date(end.getTime() - 30 * day);
  const [rows, mode, catalog, shared] = await Promise.all([
    readCandidates(session),
    readLearningMode(session),
    readCatalog(session, from, end),
    readSharedProfiles(session, from, end),
  ]);
  if (!Array.isArray(rows)) return { ready: false as const, reason: rows };
  return {
    ready: true as const,
    mode: typeof mode === "string" && mode !== "missing" ? mode : "off",
    counts: candidateCounts(rows),
    rows: listCandidates(rows, state, sort).map((r) => ({
      ...r,
      state: candidateState(r),
      priority: candidatePriority(r),
    })),
    catalog: typeof catalog === "object" && catalog ? catalog : null,
    sharedProfiles: typeof shared === "object" && shared ? shared.profiles : null,
  };
}

/** One candidate: its evidence (counts only), state and the (advisory) automation verdict. */
export async function adminCandidate(session: AdminSession, id: string) {
  assertAdmin(session);
  const [detail, rows] = await Promise.all([readCandidate(session, id), readCandidates(session)]);
  if (typeof detail !== "object" || detail === null) return detail;
  const row = Array.isArray(rows) ? rows.find((r) => r.id === id) : undefined;
  if (!row) return "none" as const;
  return {
    detail,
    row,
    state: candidateState(row),
    priority: candidatePriority(row),
    verdict: automationVerdict(row, detail.siblings),
  };
}

/**
 * The catalogue review's writes, for its Server Actions only. Each privileged call checks the admin session again;
 * every value has been validated by the action before it gets here.
 */
export const catalogReview = {
  setMode: setLearningMode,
  update: updateCandidate,
  setStatus: setCandidateStatus,
  merge: mergeCandidate,
  addSource: addCandidateSource,
  approve: approveCandidate,
};

/** The bottle library: photos people sent, and each canonical wine's 2D bottle pictures. */
export async function adminBottlePhotos(
  session: AdminSession,
  status: BottlePhotoStatus | "all",
  page: number,
) {
  assertAdmin(session);
  const size = 50;
  const data = await readBottlePhotos(session, status, size, (Math.max(1, page) - 1) * size);
  if (data === null || data === "missing") return { ready: false as const, reason: data };
  return { ready: true as const, ...data, page, size };
}

export async function adminBottlePhoto(session: AdminSession, id: string) {
  assertAdmin(session);
  const detail = await readBottlePhoto(session, id);
  if (detail === null || detail === "missing" || detail === "none") return detail;
  // canonical wines that could be its target: the same producer's, to pick from when it is a household's own wine
  const candidates = detail.canonicalWineId
    ? []
    : await readWineVisuals(session, "all", detail.producer, 20).then((r) =>
        Array.isArray(r) ? r : [],
      );
  return { detail, candidates };
}

export async function adminWineVisuals(
  session: AdminSession,
  filter: WineVisualFilter,
  query: string,
) {
  assertAdmin(session);
  const rows = await readWineVisuals(session, filter, query.slice(0, 80));
  if (rows === null || rows === "missing") return { ready: false as const, reason: rows };
  return { ready: true as const, rows };
}

export async function adminWineVisual(session: AdminSession, wineId: string) {
  assertAdmin(session);
  return readWineVisual(session, wineId);
}

/** Checks an uploaded picture (a clean PNG or JPEG within the limits) and keeps it as a draft for the wine. */
export async function adminUploadBottleArt(
  session: AdminSession,
  wineId: string,
  bytes: Uint8Array,
  note: string,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  assertAdmin(session);
  const clean = cleanBottleArt(bytes);
  if (!clean.ok)
    return {
      ok: false,
      message:
        clean.reason === "too-big"
          ? "Too large: at most 4 MB and 4096 px."
          : clean.reason === "unsupported"
            ? "Too small: at least 200 px on each side."
            : "Not a usable PNG or JPEG.",
    };
  const id = await addBottleArt(session, wineId, clean, note.slice(0, 500));
  if (id === null) return { ok: false, message: "The service role is not configured." };
  if (id === "missing")
    return { ok: false, message: "Run 20261105000028_bottle_library.sql first." };
  if (id === "not-canonical") return { ok: false, message: "Pictures go on canonical wines only." };
  return { ok: true, id };
}

export const bottleLibrary = {
  review: reviewBottlePhoto,
  publish: publishBottleArt,
  unpublish: unpublishBottleArt,
  remove: removeBottleArt,
  photoFile: readBottlePhotoFile,
  artFile: readBottleArtFile,
};
