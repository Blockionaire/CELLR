"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ApproveVintagesSchema,
  CandidateEditSchema,
  CandidateSourceSchema,
  LEARNING_MODES,
} from "@cellr/domain";
import { catalogReview, getAdminSession } from "@/server/admin/service";

/**
 * The catalogue review actions. Each one checks the admin session again (never trusting the page that showed the
 * form), validates every field, and calls one service-role database function; nothing here takes SQL, ids of
 * households or anything else from the browser beyond the candidate's own id and the reviewed values.
 */

const Id = z.uuid();

async function admin() {
  const session = await getAdminSession();
  if (!session) notFound();
  return session;
}

const back = (id: string | null, message: string): never => {
  revalidatePath("/admin/catalog");
  if (id) revalidatePath(`/admin/catalog/${id}`);
  redirect(`${id ? `/admin/catalog/${id}` : "/admin/catalog"}?msg=${encodeURIComponent(message)}`);
};

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

export async function setModeAction(form: FormData) {
  const session = await admin();
  const mode = z.enum(LEARNING_MODES).parse(field(form, "mode"));
  await catalogReview.setMode(session, mode);
  back(null, `Catalogue learning is now ${mode}.`);
}

export async function editAction(id: string, form: FormData) {
  const session = await admin();
  const candidate = Id.parse(id);
  const parsed = CandidateEditSchema.safeParse({
    producer: field(form, "producer"),
    name: field(form, "name"),
    type: field(form, "type"),
    country: field(form, "country"),
    region: field(form, "region"),
    appellation: field(form, "appellation"),
    classification: field(form, "classification"),
    aliases: field(form, "aliases"),
  });
  if (!parsed.success) back(candidate, "Not saved: check the fields.");
  const ok = await catalogReview.update(session, candidate, parsed.data!);
  back(candidate, ok === true ? "Saved." : "Not saved: only an open candidate can be edited.");
}

export async function sourceAction(id: string, form: FormData) {
  const session = await admin();
  const candidate = Id.parse(id);
  const parsed = CandidateSourceSchema.safeParse({
    name: field(form, "name"),
    url: field(form, "url"),
    license: field(form, "license"),
    verified: form.get("verified") === "on",
  });
  if (!parsed.success) back(candidate, "Not saved: a name and an https link are needed.");
  const ok = await catalogReview.addSource(session, candidate, parsed.data!);
  back(
    candidate,
    ok === true ? "Source saved." : "Not saved: only an open candidate takes sources.",
  );
}

export async function approveAction(id: string, form: FormData) {
  const session = await admin();
  const candidate = Id.parse(id);
  const vintages = ApproveVintagesSchema.parse(
    form.getAll("vintage").map((v) => (v === "nv" ? null : Number(v))),
  );
  const result = await catalogReview.approve(session, candidate, vintages);
  if (typeof result !== "object" || !result) back(candidate, "Not available: run the migration.");
  const r = result as { status: string; messages?: string[] };
  back(
    candidate,
    ["created", "updated", "unchanged"].includes(r.status)
      ? `Published to the catalogue (${r.status}).`
      : `Not published: ${(r.messages ?? [r.status]).join("; ")}`,
  );
}

export async function statusAction(id: string, status: "rejected" | "open", form: FormData) {
  const session = await admin();
  const candidate = Id.parse(id);
  const note = field(form, "note").trim().slice(0, 500) || null;
  const ok = await catalogReview.setStatus(
    session,
    candidate,
    z.enum(["rejected", "open"]).parse(status),
    note,
  );
  back(
    candidate,
    ok === true ? (status === "rejected" ? "Rejected." : "Reopened.") : "Nothing changed.",
  );
}

export async function mergeAction(id: string, form: FormData) {
  const session = await admin();
  const candidate = Id.parse(id);
  const into = Id.safeParse(field(form, "into"));
  if (!into.success) back(candidate, "Pick the candidate to merge into.");
  const ok = await catalogReview.merge(session, candidate, into.data!);
  back(
    ok === true ? into.data! : candidate,
    ok === true ? "Merged." : "Not merged: both must be open.",
  );
}
