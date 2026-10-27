import type { CandidateState } from "@cellr/domain";

export const STATE_LABEL: Record<CandidateState, string> = {
  collecting: "Collecting",
  review_ready: "Ready for review",
  conflict: "Conflict",
  approved: "Approved",
  rejected: "Rejected",
  merged: "Merged",
};
