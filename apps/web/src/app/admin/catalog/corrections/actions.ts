"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SignalReviewSchema } from "@cellr/domain";
import { catalogReview, getAdminSession } from "@/server/admin/service";

/**
 * Reviewing a correction signal: reviewed, dismissed or open again, with an optional internal note. It changes no
 * wine (editing catalogue wines is a later, separate step). The admin session is checked again here.
 */
async function admin() {
  const session = await getAdminSession();
  if (!session) notFound();
  return session;
}

export async function reviewSignalAction(wineId: string, signalId: string, form: FormData) {
  const session = await admin();
  const wine = z.uuid().parse(wineId);
  const parsed = SignalReviewSchema.safeParse({
    status: form.get("status"),
    note: String(form.get("note") ?? ""),
  });
  const ok = parsed.success
    ? await catalogReview.reviewSignal(session, z.uuid().parse(signalId), parsed.data)
    : false;
  const message =
    ok === true ? `Marked as ${parsed.data!.status}.` : "Not saved: this signal can't be reviewed.";
  revalidatePath("/admin/catalog/corrections");
  revalidatePath(`/admin/catalog/corrections/${wine}`);
  redirect(`/admin/catalog/corrections/${wine}?msg=${encodeURIComponent(message)}`);
}
