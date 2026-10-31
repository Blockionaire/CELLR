"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { bottleLibrary, getAdminSession } from "@/server/admin/service";

/**
 * A wine's 2D bottle pictures: publish one (with the photos it was made from), take it off, or remove it. Each action
 * checks the admin session again and takes only ids from the browser.
 */
const Id = z.uuid();

async function admin() {
  const session = await getAdminSession();
  if (!session) notFound();
  return session;
}

const back = (wine: string, message: string): never => {
  revalidatePath("/admin/wines");
  revalidatePath(`/admin/wines/${wine}`);
  redirect(`/admin/wines/${wine}?msg=${encodeURIComponent(message)}`);
};

export async function publishAction(wineId: string, artId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  const sources = form
    .getAll("source")
    .map(String)
    .filter((s) => Id.safeParse(s).success)
    .slice(0, 50);
  const ok = await bottleLibrary.publish(session, Id.parse(artId), sources);
  back(
    wine,
    ok === true
      ? `Published: this is now the wine's default picture${sources.length ? `, made from ${sources.length} photo${sources.length === 1 ? "" : "s"}` : ""}.`
      : "Not published.",
  );
}

export async function unpublishAction(wineId: string, artId: string) {
  const session = await admin();
  const ok = await bottleLibrary.unpublish(session, Id.parse(artId));
  back(
    Id.parse(wineId),
    ok === true ? "Taken off: the app shows the drawn bottle again." : "Not changed.",
  );
}

export async function removeAction(wineId: string, artId: string) {
  const session = await admin();
  const ok = await bottleLibrary.remove(session, Id.parse(artId));
  back(Id.parse(wineId), ok === true ? "Picture removed." : "Not removed.");
}
