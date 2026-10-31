import type { BottlePhotoStatus } from "@cellr/domain";

export const STATUS_LABEL: Record<BottlePhotoStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  used: "Used",
};

export const vintage = (year: number | null) => (year === null ? "NV" : String(year));

export const LIBRARY_MISSING =
  "The bottle library database step (supabase/migrations/20261105000028_bottle_library.sql) has not been run yet.";
