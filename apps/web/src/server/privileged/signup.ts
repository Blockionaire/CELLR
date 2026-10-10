import "server-only";
import { logError, logWarn } from "@/server/log";
import { createServiceClient } from "./client";

let warned = false;

/**
 * Friendly pre-check for the private beta ("this email isn't on the list yet"). The authoritative
 * gate is the database trigger on auth.users (migration 0007) — this only improves the message — so
 * if the service-role key is missing or the lookup fails we fail OPEN and let the trigger decide.
 */
export async function isSignupAllowed(email: string): Promise<boolean> {
  const db = createServiceClient();
  if (!db) {
    if (!warned) {
      warned = true;
      logWarn("signup_precheck_skipped", { reason: "no_service_role_key" });
    }
    return true;
  }
  const { data, error } = await db.rpc("check_signup_allowed", { p_email: email });
  if (error) {
    logError("signup_precheck_failed", error);
    return true;
  }
  return data === true;
}
