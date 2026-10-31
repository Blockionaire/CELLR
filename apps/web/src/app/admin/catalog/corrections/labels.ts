import type { CorrectionState, SignalField, SignalReview } from "@cellr/domain";

export const CORRECTION_STATE_LABEL: Record<CorrectionState, string> = {
  collecting: "Collecting",
  review_needed: "Review needed",
  conflict: "Conflict",
  resolved: "Resolved",
};

export const FIELD_LABEL: Record<SignalField, string> = {
  producer: "Producer",
  name: "Wine name",
  type: "Colour",
  country: "Country",
  region: "Region",
  year: "Vintage",
};

export const REVIEW_LABEL: Record<SignalReview, string> = {
  open: "Open",
  reviewed: "Reviewed",
  dismissed: "Dismissed",
};

export const fieldList = (fields: Record<string, number>) =>
  Object.entries(fields)
    .map(([f, n]) => `${FIELD_LABEL[f as SignalField] ?? f} (${n})`)
    .join(", ") || "—";
