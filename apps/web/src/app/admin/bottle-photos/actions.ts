"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BottlePhotoReviewSchema } from "@cellr/domain";
import { bottleLibrary, getAdminSession } from "@/server/admin/service";

/**
 * Reviewing a sent bottle photo: approve, reject or mark as used, optionally with the canonical wine it belongs to
 * and a note. The admin session is checked again here; nothing but the photo's id and the reviewed values is taken
 * from the browser.
 */
async function admin() {
  const session = await getAdminSession();
  if (!session) notFound();
  return session;
}

export async function reviewAction(id: string, form: FormData) {
  const session = await admin();
  const photo = z.uuid().parse(id);
  const parsed = BottlePhotoReviewSchema.safeParse({
    status: form.get("status"),
    // a pasted id wins over the list
    canonicalWineId: String(
      form.get("canonicalWineIdPaste") || form.get("canonicalWineId") || "",
    ).trim(),
    note: String(form.get("note") ?? ""),
  });
  const message = !parsed.success
    ? "Not saved: check the fields."
    : (await bottleLibrary.review(session, photo, parsed.data)) === true
      ? `Marked as ${parsed.data.status}.`
      : "Not saved: the photo is gone, or the target is not a canonical wine.";
  revalidatePath("/admin/bottle-photos");
  revalidatePath(`/admin/bottle-photos/${photo}`);
  redirect(`/admin/bottle-photos/${photo}?msg=${encodeURIComponent(message)}`);
}
