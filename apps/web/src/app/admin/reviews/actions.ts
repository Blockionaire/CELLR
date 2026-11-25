"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminReviews, getAdminSession } from "@/server/admin/service";

/**
 * The one action of /admin/reviews: a moderator's decision on a reported review (hide, restore, remove), with a
 * reason. It checks the admin session again, validates every field and calls one audited service-role function.
 */

async function admin() {
  const session = await getAdminSession();
  if (!session) notFound();
  return session;
}

const back = (message: string): never => {
  revalidatePath("/admin/reviews");
  redirect(`/admin/reviews?msg=${encodeURIComponent(message)}`);
};

export async function moderateReviewAction(form: FormData) {
  const session = await admin();
  const parsed = adminReviews.schema.safeParse({
    reviewId: String(form.get("reviewId") ?? ""),
    action: String(form.get("action") ?? ""),
    reason: String(form.get("reason") ?? ""),
  });
  if (!parsed.success) return back("Not saved: a reason of at least three characters is needed.");
  try {
    const r = await adminReviews.moderate(session, parsed.data);
    if (r === "missing")
      return back("Not saved: the database step for reviews has not been run yet.");
    if (r === null) return back("Not saved: no service role on the server.");
    return back(`Saved: the review is ${r.status}.`);
  } catch {
    return back("Not saved: the review could not be changed (its tasting may be gone).");
  }
}
