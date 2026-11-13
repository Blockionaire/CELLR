"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminSources, getAdminSession } from "@/server/admin/service";

/**
 * The actions of /admin/sources. Each one checks the admin session again (never trusting the page that showed the
 * form), validates every field, requires a reason, and calls one audited service-role database function. None of
 * them can switch a source on or mark rights as verified.
 */

const Id = z.uuid();
const Reason = z.string().trim().min(3).max(400);
const Provider = z.string().regex(/^[a-z0-9_]{1,40}$/);

async function admin() {
  const session = await getAdminSession();
  if (!session) notFound();
  return session;
}

const back = (message: string, query = ""): never => {
  revalidatePath("/admin/sources");
  redirect(`/admin/sources?${query}${query ? "&" : ""}msg=${encodeURIComponent(message)}`);
};

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

export async function decideLinkAction(form: FormData) {
  const session = await admin();
  const parsed = z
    .object({
      recordId: Id,
      wineId: Id,
      state: z.enum(["verified", "rejected", "investigate"]),
      reason: Reason,
    })
    .safeParse({
      recordId: field(form, "recordId"),
      wineId: field(form, "wineId"),
      state: field(form, "state"),
      reason: field(form, "reason"),
    });
  const source = Provider.safeParse(field(form, "source"));
  const query = `state=${encodeURIComponent(field(form, "tab") || "suggested")}${
    source.success ? `&source=${source.data}` : ""
  }`;
  if (!parsed.success)
    return back("Not saved: a reason of at least three characters is needed.", query);
  const { recordId, wineId, state, reason } = parsed.data;
  const result =
    state === "investigate"
      ? await adminSources.flagLink(session, { recordId, reason })
      : await adminSources.decideLink(session, { recordId, wineId, state, reason });
  if (result === "ok")
    return back(
      state === "verified"
        ? "Link approved."
        : state === "rejected"
          ? "Link rejected."
          : "Marked as needing investigation.",
      query,
    );
  return back(
    result === "already_decided"
      ? "Not changed: this link was already decided."
      : result === "not_canonical"
        ? "Not changed: the wine is not a catalogue wine."
        : "Not changed: the record or its link was not found.",
    query,
  );
}

export async function disableSourceAction(form: FormData) {
  const session = await admin();
  const parsed = z
    .object({ providerId: Provider, reason: Reason })
    .safeParse({ providerId: field(form, "providerId"), reason: field(form, "reason") });
  if (!parsed.success) return back("Not changed: a reason of at least three characters is needed.");
  const block = form.get("block") === "on";
  try {
    const done = await adminSources.disable(session, { ...parsed.data, block });
    if (done !== true) return back("Not changed: the database step for this has not been taken.");
  } catch {
    return back("Not changed: the source could not be switched off. Nothing was altered.");
  }
  return back(
    block
      ? "Source switched off and blocked: it is out of search and credits, and cannot be imported."
      : "Source switched off: it is out of search and credits.",
  );
}
