import { normalizeText, type WineType } from "./cellar";
import type { ImageRef } from "./image";
import type { Descriptor } from "./tasting";

/**
 * MY TASTING JOURNAL: what the signed-in person wrote about the wines they opened in their active household.
 * Personal: only their own tastings, never another member's or another household's. Read from the existing
 * tastings (stars stored 1..10 as half stars), never a second copy.
 */
export interface JournalEntry {
  tastingId: string;
  vintageId: string;
  wineId: string;
  /** The bottle it was written about; null for an old tasting whose bottle was deleted. */
  bottleId: string | null;
  /** The bottle is still opened in this household, so the existing rating sheet can change this tasting. */
  editable: boolean;
  /** The household still has this wine and vintage (in the cellar or opened), so its page opens. */
  wineAvailable: boolean;
  producer: string;
  wineName: string;
  year: number | null;
  type: WineType;
  /** The bottle's own label photo, when it has one. */
  image: ImageRef | null;
  /** 1..10 (half stars), or null when only words or a note were left. */
  score: number | null;
  descriptors: Descriptor[];
  note: string | null;
  tastedAt: string;
}

/** Over all of this person's tastings in the household (not only the entries shown). */
export interface JournalSummary {
  entries: number;
  /** Tastings with stars. */
  scored: number;
  /** Different wines tasted (two vintages of one wine are one wine). */
  wines: number;
  /** Mean in stars, one decimal; null without any stars. */
  average: number | null;
  /** How many tastings at each score 1..10 (index 0 = half a star … 9 = five stars). */
  distribution: number[];
}

export interface JournalView {
  /** False until the tastings database step has been taken. */
  ready: boolean;
  /** Newest first, at most JOURNAL_LIMIT. */
  entries: JournalEntry[];
  /** True when there are more tastings than were loaded. */
  truncated: boolean;
  summary: JournalSummary;
}

/** At most this many entries are loaded for the journal (the summary still counts every tasting). */
export const JOURNAL_LIMIT = 500;

export function summarizeJournal(
  rows: ReadonlyArray<{ wineId: string; score: number | null }>,
): JournalSummary {
  const distribution = Array.from({ length: 10 }, () => 0);
  let sum = 0;
  let scored = 0;
  for (const r of rows) {
    if (r.score === null || r.score < 1 || r.score > 10) continue;
    distribution[r.score - 1]! += 1;
    sum += r.score;
    scored += 1;
  }
  return {
    entries: rows.length,
    scored,
    wines: new Set(rows.map((r) => r.wineId)).size,
    average: scored > 0 ? Math.round((sum / scored) * 5) / 10 : null,
    distribution,
  };
}

/** The best-rated wines: one entry per wine and vintage (its highest score, then the most recent), best first. */
export function topRated(entries: readonly JournalEntry[], count = 3): JournalEntry[] {
  const best = new Map<string, JournalEntry>();
  for (const e of entries) {
    if (e.score === null) continue;
    const had = best.get(e.vintageId);
    if (!had || e.score > had.score! || (e.score === had.score && e.tastedAt > had.tastedAt))
      best.set(e.vintageId, e);
  }
  return [...best.values()]
    .sort((a, b) => b.score! - a.score! || b.tastedAt.localeCompare(a.tastedAt))
    .slice(0, count);
}

export const JOURNAL_SORTS = ["recent", "best", "worst"] as const;
export type JournalSort = (typeof JOURNAL_SORTS)[number];

/**
 * Search (producer or wine name, accents and case ignored), a kind of wine, and an order. Unrated entries stay
 * in the list: by rating they come after every rated one, newest first.
 */
export function filterJournal(
  entries: readonly JournalEntry[],
  {
    query = "",
    type = null,
    sort = "recent",
  }: { query?: string; type?: WineType | null; sort?: JournalSort },
): JournalEntry[] {
  const words = normalizeText(query).split(" ").filter(Boolean);
  const hit = (e: JournalEntry) => {
    if (type && e.type !== type) return false;
    const text = normalizeText(`${e.producer} ${e.wineName}`);
    return words.every((w) => text.includes(w));
  };
  const recent = (a: JournalEntry, b: JournalEntry) =>
    b.tastedAt.localeCompare(a.tastedAt) || a.tastingId.localeCompare(b.tastingId);
  const byScore = (dir: 1 | -1) => (a: JournalEntry, b: JournalEntry) => {
    if (a.score === null || b.score === null)
      return a.score === b.score ? recent(a, b) : a.score === null ? 1 : -1;
    return dir * (b.score - a.score) || recent(a, b);
  };
  const order = sort === "best" ? byScore(1) : sort === "worst" ? byScore(-1) : recent;
  return entries.filter(hit).sort(order);
}

/** The kinds of wine present, for the filter (only ones that would show something). */
export const journalTypes = (entries: readonly JournalEntry[]): WineType[] => [
  ...new Set(entries.map((e) => e.type)),
];

/**
 * Where an entry leads. Editable: the wine's page with the existing rating sheet open for that bottle. Otherwise,
 * while the wine's page still opens: that page (nothing to edit there). Otherwise nowhere: the tasting is kept in
 * the journal as an archived memory, never a link to a page that cannot open.
 */
export function journalEditHref(
  e: Pick<JournalEntry, "vintageId" | "bottleId" | "editable" | "wineAvailable">,
): string | null {
  if (e.editable && e.bottleId)
    return `/cellar/${e.vintageId}?rate=${encodeURIComponent(e.bottleId)}`;
  return e.wineAvailable ? `/cellar/${e.vintageId}` : null;
}

/** The wine's own page, when it still opens. */
export const journalWineHref = (e: Pick<JournalEntry, "vintageId" | "wineAvailable">) =>
  e.wineAvailable ? `/cellar/${e.vintageId}` : null;
