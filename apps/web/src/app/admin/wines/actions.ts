"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  LinkInputSchema,
  MASTER_RESULT_MESSAGE,
  ProducerEditSchema,
  VintageInputSchema,
  WineDetailsSchema,
  parseAliases,
  parseGrapes,
  parseMasterResult,
  type MasterResult,
} from "@cellr/domain";
import { bottleLibrary, getAdminSession, wineMaster } from "@/server/admin/service";

/**
 * The Wine Master Database's actions. A wine's 2D bottle pictures: publish one (with the photos it was made from), take it off, or remove it. Each action
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
    ok === "bad-source"
      ? "Not published: a ticked photo is not of this wine. Nothing changed."
      : ok === true
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

// ---- The Wine Master Database (Sprint R) -------------------------------------------------------------------------
// Each edit is one audited database function that refuses stale, duplicate or out-of-scope changes; the browser
// sends ids and form values only, validated here first. Nothing here touches bottles, prices, places, ratings or notes.

const field = (form: FormData, name: string) => String(form.get(name) ?? "");
const done = (wine: string, result: unknown, ok: string): never =>
  back(
    wine,
    result === "ok"
      ? ok
      : result === null
        ? "Not saved: the service role is not configured."
        : result === "missing"
          ? "Not saved: run 20261107000030_wine_master.sql first."
          : MASTER_RESULT_MESSAGE[parseMasterResult(result) as Exclude<MasterResult, "ok">],
  );

export async function updateWineAction(wineId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  const parsed = WineDetailsSchema.safeParse({
    name: field(form, "name"),
    type: field(form, "type"),
    country: field(form, "country"),
    region: field(form, "region"),
    appellation: field(form, "appellation"),
    classification: field(form, "classification"),
    bottleStyle: field(form, "bottleStyle"),
    reason: field(form, "reason"),
  });
  if (!parsed.success) back(wine, MASTER_RESULT_MESSAGE.invalid);
  const result = await wineMaster.updateWine(session, wine, field(form, "expected"), parsed.data!);
  done(wine, result, "Wine details saved.");
}

export async function updateProducerAction(wineId: string, producerId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  const parsed = ProducerEditSchema.safeParse({
    name: field(form, "name"),
    country: field(form, "country"),
    reason: field(form, "reason"),
  });
  if (!parsed.success) back(wine, MASTER_RESULT_MESSAGE.invalid);
  const confirm = Number.parseInt(field(form, "confirmWines"), 10);
  const result = await wineMaster.updateProducer(
    session,
    Id.parse(producerId),
    field(form, "expected"),
    {
      ...parsed.data!,
      confirmWines: Number.isInteger(confirm) ? confirm : null,
    },
  );
  done(wine, result, "Producer saved.");
}

export async function reassignProducerAction(wineId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  const producer = Id.safeParse(field(form, "producer"));
  const reason = field(form, "reason").trim().slice(0, 500);
  if (!producer.success || !reason || field(form, "confirm") !== "yes")
    back(wine, "Not moved: choose the producer, give a reason and tick the confirmation.");
  const result = await wineMaster.reassignProducer(
    session,
    wine,
    field(form, "expected"),
    producer.data!,
    reason,
  );
  done(wine, result, "This wine now belongs to the chosen producer. Other wines are unchanged.");
}

export async function setAliasesAction(wineId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  const aliases = parseAliases(field(form, "aliases"));
  if (!aliases) back(wine, "Not saved: at most 20 aliases of at most 160 characters.");
  done(
    wine,
    await wineMaster.setAliases(session, wine, aliases!, field(form, "reason")),
    "Aliases saved.",
  );
}

export async function setGrapesAction(wineId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  const grapes = parseGrapes(field(form, "grapes"));
  if (!grapes) back(wine, "Not saved: one grape per line, shares within 100% together.");
  const result = await wineMaster.setGrapes(session, wine, grapes!, field(form, "reason"));
  done(wine, result, "Grapes saved.");
}

export async function createVintageAction(wineId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  const parsed = VintageInputSchema.safeParse({
    year: field(form, "year"),
    abv: field(form, "abv"),
    reason: field(form, "reason"),
  });
  if (!parsed.success) back(wine, MASTER_RESULT_MESSAGE.invalid);
  done(wine, await wineMaster.createVintage(session, wine, parsed.data!), "Vintage added.");
}

export async function updateVintageAction(wineId: string, vintageId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  const parsed = VintageInputSchema.safeParse({
    year: field(form, "year"),
    abv: field(form, "abv"),
    reason: field(form, "reason"),
  });
  if (!parsed.success) back(wine, MASTER_RESULT_MESSAGE.invalid);
  done(
    wine,
    await wineMaster.updateVintage(session, Id.parse(vintageId), parsed.data!),
    "Vintage saved.",
  );
}

export async function deleteVintageAction(wineId: string, vintageId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  if (field(form, "confirm") !== "yes") back(wine, "Not removed: tick the confirmation first.");
  const result = await wineMaster.deleteVintage(
    session,
    Id.parse(vintageId),
    field(form, "reason"),
  );
  done(wine, result, "Vintage removed.");
}

export async function linkAction(wineId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  const parsed = LinkInputSchema.safeParse({
    target: field(form, "target"),
    reason: field(form, "reason"),
    confirm: field(form, "confirm"),
  });
  if (!parsed.success)
    back(wine, "Not linked: compare both wines, give a reason and tick the confirmation.");
  const result = await wineMaster.link(session, wine, parsed.data!.target, parsed.data!.reason);
  done(
    wine,
    result === "conflict" ? "conflict" : result,
    "Linked: this household wine is verified to be the catalogue wine.",
  );
}

export async function unlinkAction(wineId: string, form: FormData) {
  const session = await admin();
  const wine = Id.parse(wineId);
  const reason = field(form, "reason").trim().slice(0, 500);
  if (field(form, "confirm") !== "yes" || !reason)
    back(wine, "Not unlinked: give a reason and tick the confirmation.");
  done(
    wine,
    await wineMaster.unlink(session, wine, reason),
    "Unlinked. It stays unlinked until you link it again.",
  );
}

export async function publishLabelAction(wineId: string, labelId: string) {
  const session = await admin();
  const ok = await wineMaster.publishLabel(session, Id.parse(labelId));
  back(
    Id.parse(wineId),
    ok === true ? "Label published for everyone who has this wine." : "Not published.",
  );
}

export async function unpublishLabelAction(wineId: string, labelId: string) {
  const session = await admin();
  const ok = await wineMaster.unpublishLabel(session, Id.parse(labelId));
  back(Id.parse(wineId), ok === true ? "Label taken off." : "Not changed.");
}

export async function removeLabelAction(wineId: string, labelId: string) {
  const session = await admin();
  const ok = await wineMaster.removeLabel(session, Id.parse(labelId));
  back(Id.parse(wineId), ok === true ? "Label removed." : "Not removed.");
}
