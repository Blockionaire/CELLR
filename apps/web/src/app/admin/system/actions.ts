"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminSession, systemHealth } from "@/server/admin/service";

/**
 * System › Health's one action: measure now. It checks the admin session again (never trusting the page that showed
 * the button), takes nothing from the browser, and runs the same bounded round as the heartbeat (at most one a
 * minute, whoever asks).
 */

async function admin() {
  const session = await getAdminSession();
  if (!session) notFound();
  return session;
}

const MESSAGE = {
  recorded: "Measured: the results below are new.",
  skipped: "Not measured: a round ran less than a minute ago. The results below are from it.",
  not_configured: "Not measured: the service role is not configured on this server.",
  not_installed: "Not measured: the health database step (migration 0047) is not applied here.",
  database_unreachable:
    "Not measured: the database did not take the round. That is itself a failure to look into.",
  record_failed: "Not measured: the results could not be stored.",
} as const;

export async function measureNowAction() {
  const session = await admin();
  const result = await systemHealth.measureNow(session);
  revalidatePath("/admin/system/health");
  revalidatePath("/admin/system");
  redirect(`/admin/system/health?msg=${encodeURIComponent(MESSAGE[result.kind])}`);
}
