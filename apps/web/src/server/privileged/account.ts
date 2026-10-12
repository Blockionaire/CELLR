import "server-only";
import { logError } from "@/server/log";
import { createServiceClient } from "./client";

/** Whether this deployment is able to delete accounts at all (it needs the service key). */
export const canDeleteAccounts = (): boolean => createServiceClient() !== null;

/**
 * Removes a person's sign-in. Only the service role may, which is why this lives here and nowhere else; the
 * caller has already made sure it is the person themselves, and has taken their households into account.
 * Everything that belongs to the person alone (profile, favourites, ratings) goes with it by cascade.
 */
export async function deleteAuthUser(userId: string): Promise<boolean> {
  const db = createServiceClient();
  if (!db) return false;
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) {
    logError("account_delete_failed", error);
    return false;
  }
  return true;
}
