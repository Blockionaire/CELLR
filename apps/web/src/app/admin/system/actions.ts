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

export async function measureNowAction() {
  const session = await admin();
  const result = await systemHealth.measureNow(session);
  revalidatePath("/admin/system/health");
  revalidatePath("/admin/system");
  // only the result's kind travels in the URL; the page turns it into words (no free text from a link is shown)
  redirect(`/admin/system/health?result=${result.kind}`);
}
