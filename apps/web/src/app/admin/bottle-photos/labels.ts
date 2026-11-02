import type { BottlePhotoStatus, PhotoStage } from "@cellr/domain";
import type { Tone } from "../_ui";

/** The review status kept on the submission (what the database stores). */
export const STATUS_LABEL: Record<BottlePhotoStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  used: "Used",
};

/** Where a contribution is in the photo → 2D-artwork workflow (derived from the status and the wine's artwork). */
export const STAGE_LABEL: Record<PhotoStage, string> = {
  pending: "Pending review",
  artwork_needed: "Approved — artwork needed",
  draft: "Artwork uploaded — draft",
  published: "Artwork published",
  rejected: "Rejected",
};
export const STAGE_SHORT: Record<PhotoStage, string> = {
  pending: "Pending review",
  artwork_needed: "Artwork needed",
  draft: "Draft waiting",
  published: "Published",
  rejected: "Rejected",
};
export const STAGE_TONE: Record<PhotoStage, Tone> = {
  pending: "info",
  artwork_needed: "warn",
  draft: "warn",
  published: "ok",
  rejected: "neutral",
};
/** The workflow in order, as the admin walks it (rejected is a side exit). */
export const STAGE_ORDER: PhotoStage[] = ["pending", "artwork_needed", "draft", "published"];

export const vintage = (year: number | null) => (year === null ? "NV" : String(year));

/** The wine a contribution's artwork goes on: the wine it was sent for, else the catalogue wine it was reviewed for. */
export const artWine = (p: { sourceWineId: string | null; canonicalWineId: string | null }) =>
  p.sourceWineId ?? p.canonicalWineId;

/** The wine's artwork section, remembering which contribution the admin came from. */
export const artHref = (wineId: string, from: string) => `/admin/wines/${wineId}?from=${from}#art`;

export const LIBRARY_MISSING =
  "The bottle library database step (supabase/migrations/20261105000028_bottle_library.sql) has not been run yet.";
