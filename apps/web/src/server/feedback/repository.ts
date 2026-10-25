import "server-only";
import type { Db } from "@/server/db/clients";
import { mapDbError } from "@/server/db/errors";
import type { FeedbackRepository } from "./types";

const missing = (e: { code?: string }) => e.code === "PGRST205" || e.code === "42P01";

export function createFeedbackRepository(db: Db): FeedbackRepository {
  return {
    async add({ category, message, location, device }) {
      // No user id is sent: the database fills it in from the session (and its policy checks it). Nothing is read
      // back, because nobody may read feedback through the app.
      const { error } = await db
        .from("beta_feedback")
        .insert({ category, message, location, device });
      if (error && missing(error)) return false;
      if (error) throw mapDbError(error);
      return true;
    },
  };
}
