import "server-only";

/** A report as stored: always for the signed-in person (the database takes their id from the session). */
export interface FeedbackRow {
  category: "bug" | "confusing" | "idea" | "other";
  message: string;
  location: string | null;
  device: string | null;
}

export interface FeedbackRepository {
  /** False before the beta-feedback database step (20261028000020_beta_feedback.sql). */
  add(row: FeedbackRow): Promise<boolean>;
}
