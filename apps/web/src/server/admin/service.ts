import "server-only";
import { cache } from "react";
import {
  ADMIN_PAGE_SIZE,
  FEEDBACK_PAGE_SIZE,
  budgetUse,
  isUserId,
  summarizeAiCosts,
  summarizeRecognitionCache,
  summarizeRecognitionPaths,
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
  correctionState,
  type BottlePhotoStatus,
  type WineVisualFilter,
  type WineVisualScope,
  MASTER_PAGE_SIZE,
  photoStage,
  type MasterQuery,
  type PhotoStage,
} from "@cellr/domain";
import { getPageContext } from "@/server/context";
import { getAdminAllowlist, getAiBudgetEnv } from "@/server/env";
import {
  readActivity,
  readAiCosts,
  readBudgetStatus,
  readFeedback,
  readRecognitionCache,
  readRecognitionPaths,
  readSharedProfiles,
  readCatalog,
  readUserDirectory,
  readUserSummary,
} from "@/server/privileged/admin";
import {
  readAiSignals,
  readCorrection,
  readCorrections,
  reviewSignal,
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
  purgeBottleArtFiles,
  readBottleArtFile,
  readBottlePhoto,
  readBottlePhotoFile,
  readBottlePhotoQueue,
  readWineVisual,
  readWineVisuals,
  removeBottleArt,
  reviewBottlePhoto,
  unpublishBottleArt,
} from "@/server/privileged/bottle-library";
import {
  addCatalogLabel,
  createVintage,
  deleteVintage,
  linkWine,
  publishCatalogLabel,
  readCatalogLabelFile,
  readHouseholdLabelFile,
  readWineMaster,
  readWineMasterCounts,
  readWineMasterFacets,
  readWineMasterRecord,
  readWineMasterSearch,
  readWorkQueue,
  reassignProducer,
  removeCatalogLabel,
  setAliases,
  setGrapes,
  unlinkWine,
  unpublishCatalogLabel,
  updateProducer,
  updateVintage,
  updateWineDetails,
} from "@/server/privileged/wine-master";
import { DEPENDENCY_SOURCE, MissingDependencyError } from "@/server/privileged/db-errors";
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
  const [metrics, today, month, queue] = await Promise.all([
    getPlatformMetrics(now).catch(() => null),
    readAiCosts(session, startOfUtcDay(now), end),
    readAiCosts(session, startOfUtcMonth(now), end),
    readWorkQueue(session),
  ]);
  return {
    metrics,
    /** What waits for the admin; "missing" until 20261111000034 is applied, null without the service role. */
    queue,
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
  const [range, today, week, month, budget, cache, shared, catalog, paths] = await Promise.all([
    readAiCosts(session, from, end),
    readAiCosts(session, startOfUtcDay(now), end),
    readAiCosts(session, new Date(startOfUtcDay(now).getTime() - 6 * day), end),
    readAiCosts(session, startOfUtcMonth(now), end),
    readBudgetStatus(session, now),
    readRecognitionCache(session, from, end),
    readSharedProfiles(session, from, end),
    readCatalog(session, from, end),
    readRecognitionPaths(session, from, end),
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
    /** Null: not configured, or the label-text step (Sprint S) is not taken yet. */
    paths: typeof paths === "object" && paths ? summarizeRecognitionPaths(paths) : null,
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
/** Correction signals: what people did with the catalogue wines scans proposed (counts and values, never who). */
export async function adminCorrections(session: AdminSession) {
  assertAdmin(session);
  const [rows, ai] = await Promise.all([readCorrections(session), readAiSignals(session, 30)]);
  if (rows === null || rows === "missing") return { ready: false as const, reason: rows };
  const listed = rows.map((r) => ({ ...r, state: correctionState(r) }));
  const order = { conflict: 0, review_needed: 1, collecting: 2, resolved: 3 } as const;
  listed.sort((a, b) => order[a.state] - order[b.state] || b.openHouseholds - a.openHouseholds);
  return {
    ready: true as const,
    rows: listed,
    ai: ai === null || ai === "missing" ? null : ai,
  };
}

export async function adminCorrection(session: AdminSession, wineId: string) {
  assertAdmin(session);
  return readCorrection(session, wineId);
}

export const catalogReview = {
  setMode: setLearningMode,
  update: updateCandidate,
  setStatus: setCandidateStatus,
  merge: mergeCandidate,
  addSource: addCandidateSource,
  approve: approveCandidate,
  reviewSignal,
};

/** The bottle library: photos people sent, with their workflow stage, filtered and paged in the database. */
export async function adminBottlePhotos(
  session: AdminSession,
  filter: {
    status: BottlePhotoStatus | "all" | null;
    stage: PhotoStage | "all" | null;
    query: string;
  },
  page: number,
) {
  assertAdmin(session);
  const size = 50;
  const data = await readBottlePhotoQueue(
    session,
    { ...filter, query: filter.query.slice(0, 80) },
    size,
    (Math.max(1, page) - 1) * size,
  );
  if (data === null || data === "missing") return { ready: false as const, reason: data };
  return {
    ready: true as const,
    ...data,
    page,
    size,
    pages: Math.max(1, Math.ceil(data.total / size)),
  };
}

/** The first photo waiting for the next step of a stage (for "next item" links), or null. */
export async function adminNextPhoto(session: AdminSession, stage: PhotoStage) {
  assertAdmin(session);
  const data = await readBottlePhotoQueue(session, { status: null, stage, query: "" }, 1, 0);
  return data && data !== "missing" ? (data.rows[0] ?? null) : null;
}

export async function adminBottlePhoto(session: AdminSession, id: string) {
  assertAdmin(session);
  const detail = await readBottlePhoto(session, id);
  if (detail === null || detail === "missing" || detail === "none") return detail;
  // For an optional, explicit link from a household's own wine to a catalogue wine: the same producer's catalogue
  // wines, to choose from. Never chosen for the admin.
  const wines = [
    ...new Set([detail.sourceWineId, detail.canonicalWineId].filter(Boolean)),
  ] as string[];
  const [candidates, visuals] = await Promise.all([
    detail.sourceCanonical === false && !detail.canonicalWineId
      ? readWineVisuals(session, "catalogue", "all", detail.producer, 20).then((r) =>
          Array.isArray(r) ? r : [],
        )
      : Promise.resolve([]),
    Promise.all(wines.map((w) => readWineVisual(session, w))),
  ]);
  // the artwork of the wine(s) the photo is about: the same rule as the database's workflow stage
  const art = visuals.flatMap((v) => (v && v !== "missing" && v !== "none" ? v.art : []));
  const artState = {
    published: art.some((a) => a.publishedAt !== null),
    draft: art.some((a) => a.publishedAt === null),
  };
  return { detail, candidates, art: artState, stage: photoStage(detail.status, artState) };
}

export async function adminWineVisuals(
  session: AdminSession,
  scope: WineVisualScope,
  filter: WineVisualFilter,
  query: string,
) {
  assertAdmin(session);
  const rows = await readWineVisuals(session, scope, filter, query.slice(0, 80));
  if (rows === null || rows === "missing") return { ready: false as const, reason: rows };
  // files of pictures that went with their wine or household: tidy them up while the admin looks
  await purgeBottleArtFiles().catch(() => {});
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
  if (id === "gone") return { ok: false, message: "This wine is no longer there." };
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

// ---- The Wine Master Database (Sprint R) -------------------------------------------------------------------------

/** Every wine, searched, filtered, sorted and paged in the database, with the overview's counts and the filters' choices. */
export async function adminWineMaster(session: AdminSession, query: MasterQuery) {
  assertAdmin(session);
  const size = MASTER_PAGE_SIZE;
  const [list, counts, facets] = await Promise.all([
    readWineMasterSearch(session, query, size, (Math.max(1, query.page) - 1) * size),
    readWineMasterCounts(session),
    readWineMasterFacets(session),
  ]);
  if (
    list === null ||
    list === "missing" ||
    counts === null ||
    counts === "missing" ||
    facets === null ||
    facets === "missing"
  )
    return {
      ready: false as const,
      reason: list === null || counts === null || facets === null ? null : ("missing" as const),
    };
  await purgeBottleArtFiles().catch(() => {});
  return {
    ready: true as const,
    ...list,
    counts,
    countries: facets.countries,
    page: query.page,
    size,
    pages: Math.max(1, Math.ceil(list.total / size)),
  };
}

/**
 * One wine's master record, with the parts that already have their own pages: its 2D artwork and photos (Sprint P)
 * and, for a catalogue wine, its correction signals (Sprint Q). For a household wine being linked: the catalogue
 * wines matching the admin's search, and the one chosen to compare side by side. Nothing is ever chosen for the admin.
 */
export async function adminWineMasterRecord(
  session: AdminSession,
  wineId: string,
  link: { query: string; compare: string | null; from?: string | null } = {
    query: "",
    compare: null,
  },
) {
  assertAdmin(session);
  try {
    const record = await readWineMasterRecord(session, wineId);
    if (record === null || record === "missing" || record === "none") return record;
    const canonical = record.status === "canonical";
    const [visual, correction, candidates, compare, from] = await Promise.all([
      readWineVisual(session, wineId),
      canonical ? readCorrection(session, wineId) : Promise.resolve(null),
      !canonical && link.query
        ? readWineMaster(session, "catalogue", [], link.query.slice(0, 80), 20, 0)
        : Promise.resolve(null),
      !canonical && link.compare
        ? readWineMasterRecord(session, link.compare)
        : Promise.resolve(null),
      // the contribution the admin came from (Sprint U), shown only when it is about this wine
      link.from ? readBottlePhoto(session, link.from) : Promise.resolve(null),
    ]);
    return {
      record,
      visual: visual && visual !== "missing" && visual !== "none" ? visual : null,
      correction:
        correction && correction !== "missing" && correction !== "none" ? correction : null,
      candidates: candidates && candidates !== "missing" ? candidates.rows : [],
      compare:
        compare && compare !== "missing" && compare !== "none" && compare.status === "canonical"
          ? compare
          : null,
      from:
        from &&
        from !== "missing" &&
        from !== "none" &&
        (from.sourceWineId === wineId || from.canonicalWineId === wineId)
          ? from
          : null,
    };
  } catch (e) {
    // a database function the page needs uses an object another migration creates, and it is not there (logged)
    if (e instanceof MissingDependencyError)
      return { dependency: e.object, source: DEPENDENCY_SOURCE[e.object] ?? null } as const;
    throw e;
  }
}

/** Checks an uploaded label image (a clean PNG or JPEG within the limits) and keeps it as a draft for the wine. */
export async function adminUploadCatalogLabel(
  session: AdminSession,
  wineId: string,
  bytes: Uint8Array,
  meta: { side: "front" | "back"; vintageId: string | null; source: string },
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
  const id = await addCatalogLabel(session, wineId, { ...clean, ...meta });
  if (id === null) return { ok: false, message: "The service role is not configured." };
  if (id === "missing") return { ok: false, message: "Run 20261107000030_wine_master.sql first." };
  if (id === "gone")
    return {
      ok: false,
      message: "Not uploaded: shared labels are for catalogue wines (and their own vintages) only.",
    };
  return { ok: true, id };
}

export const wineMaster = {
  updateWine: updateWineDetails,
  updateProducer,
  reassignProducer,
  setAliases,
  setGrapes,
  createVintage,
  updateVintage,
  deleteVintage,
  link: linkWine,
  unlink: unlinkWine,
  publishLabel: publishCatalogLabel,
  unpublishLabel: unpublishCatalogLabel,
  removeLabel: removeCatalogLabel,
  labelFile: readCatalogLabelFile,
  householdLabelFile: readHouseholdLabelFile,
};

// ---- External sources (Wine Intelligence WI-06) ------------------------------------------------------------------
import {
  decideLink,
  disableSource,
  flagLink,
  readIntelligenceMetrics,
  readLinkQueue,
  readSources,
} from "@/server/privileged/sources-admin";

export {
  LINK_STATES,
  type IntelligenceMetrics,
  type LinkRow,
  type LinkState,
  type SourceOverview,
} from "@/server/privileged/sources-admin";

/**
 * What the admin can see and do about external sources: read their rights and imports, decide links, and switch a
 * source off. Each function checks the admin session itself. Nothing here can switch a source on.
 */
export const adminSources = {
  overview: readSources,
  links: readLinkQueue,
  metrics: readIntelligenceMetrics,
  decideLink,
  flagLink,
  disable: disableSource,
};
