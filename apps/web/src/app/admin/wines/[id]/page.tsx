import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BOTTLE_ART_LIMITS } from "@cellr/domain";
import { adminWineVisual, getAdminSession } from "@/server/admin/service";
import { Kpi, Kpis, Notice, PageTitle, Section, date, num } from "../../_ui";
import { LIBRARY_MISSING, STATUS_LABEL, vintage } from "../../bottle-photos/labels";
import { publishAction, removeAction, unpublishAction } from "../actions";

export const dynamic = "force-dynamic";

const input = "rounded-[10px] bg-surface px-3 py-2 ring-1 ring-hairline";
const button = "rounded-full bg-ink px-4 py-2 text-small text-canvas";
const quiet = "rounded-full px-4 py-2 text-small text-ink ring-1 ring-hairline";

/**
 * One wine's visual side: its published 2D bottle picture, drafts, the photos people sent of it, and the upload.
 * Pictures go on canonical wines only (a household's own wine shows the picture of the canonical wine it maps to).
 */
export default async function AdminWinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const msg = (await searchParams).msg;
  const message = typeof msg === "string" ? msg.slice(0, 300) : null;
  const w = await adminWineVisual(session, id.data);
  if (w === "missing" || w === null)
    return (
      <>
        <PageTitle title="Wine visuals" />
        <Notice>{LIBRARY_MISSING} (And set the service role.)</Notice>
      </>
    );
  if (w === "none") notFound();
  const canonical = w.status === "canonical";
  const published = w.art.find((a) => a.publishedAt !== null) ?? null;
  const drafts = w.art.filter((a) => a.publishedAt === null);
  const sourceable = w.photos.filter((p) => p.status === "approved" || p.status === "pending");

  return (
    <>
      <PageTitle
        title={`${w.producer} — ${w.name}`}
        note={[
          w.type,
          w.country,
          w.region,
          w.appellation,
          canonical ? "catalogue wine" : "a household's own wine",
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <Link href="/admin/wines" prefetch={false} className="text-small text-accent-ink">
          ← All wines
        </Link>
      </PageTitle>
      {message && <Notice>{message}</Notice>}
      {!canonical && (
        <Notice>
          This is a household&apos;s own wine, not a catalogue one. Pictures go on catalogue wines
          only: open a photo of it and choose the catalogue wine it belongs to.
        </Notice>
      )}

      <Section title="Status">
        <Kpis>
          <Kpi label="2D bottle picture" value={published ? "Published" : "None"} />
          <Kpi label="Drafts" value={num(drafts.length)} />
          <Kpi label="Photos sent" value={num(w.photos.length)} />
          <Kpi
            label="Label photos in households"
            value={num(w.labelPhotos)}
            hint="Households' own label photos (count only)."
          />
        </Kpis>
      </Section>

      {published && (
        <Section title="Published picture" note={`Since ${date(published.publishedAt)}.`}>
          <div className="flex flex-wrap items-end gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- an admin preview */}
            <img
              src={`/admin/wines/${w.id}/art/${published.id}`}
              alt={`Published 2D bottle of ${w.producer} ${w.name}`}
              data-testid="published-art"
              className="h-64 w-auto rounded-[12px] bg-raised p-2 ring-1 ring-hairline"
            />
            <div className="flex flex-col gap-2 text-small">
              <span className="text-ink-2">
                {published.width} × {published.height} px · {published.contentType}
                {published.note ? ` · ${published.note}` : ""}
              </span>
              <form action={unpublishAction.bind(null, w.id, published.id)}>
                <button className={quiet}>Take it off (show the drawn bottle)</button>
              </form>
              <form action={removeAction.bind(null, w.id, published.id)}>
                <button className={quiet}>Remove picture</button>
              </form>
            </div>
          </div>
        </Section>
      )}

      {canonical && (
        <Section
          title={published ? "Replace the picture" : "Upload a 2D bottle picture"}
          note={`A finished picture of the whole bottle, ideally a PNG with a transparent background, upright, at least ${BOTTLE_ART_LIMITS.minEdge} px wide, at most 4 MB. It is kept as a draft until you publish it.`}
        >
          <form
            action={`/admin/wines/${w.id}/art`}
            method="post"
            encType="multipart/form-data"
            className="flex flex-wrap items-end gap-3 text-small"
          >
            <label className="flex flex-col gap-1">
              <span className="text-ink-2">Picture</span>
              <input
                type="file"
                name="picture"
                accept="image/png,image/jpeg"
                required
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ink-2">Note (internal, optional)</span>
              <input name="note" maxLength={500} className={input} />
            </label>
            <button type="submit" className={button}>
              Upload
            </button>
          </form>
        </Section>
      )}

      {drafts.length > 0 && (
        <Section
          title="Drafts"
          note="Publishing a draft makes it the wine's default picture (replacing the published one). Tick the photos it was made from: they are marked as used."
        >
          <ul className="flex flex-col gap-4">
            {drafts.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-start gap-4 rounded-[14px] border border-hairline bg-surface p-4"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- an admin preview */}
                <img
                  src={`/admin/wines/${w.id}/art/${d.id}`}
                  alt={`Draft 2D bottle of ${w.producer} ${w.name}`}
                  data-testid="draft-art"
                  className="h-48 w-auto rounded-[10px] bg-raised p-2"
                />
                <form
                  action={publishAction.bind(null, w.id, d.id)}
                  className="flex flex-col gap-2 text-small"
                >
                  <span className="text-ink-2">
                    {d.width} × {d.height} px · uploaded {date(d.createdAt)}
                    {d.note ? ` · ${d.note}` : ""}
                  </span>
                  {sourceable.length > 0 && (
                    <fieldset className="flex flex-col gap-1">
                      <legend className="text-ink-2">Made from</legend>
                      {sourceable.map((p) => (
                        <label key={p.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="source"
                            value={p.id}
                            defaultChecked={p.status === "approved"}
                          />
                          Photo of {date(p.createdAt)} · {vintage(p.year)} ·{" "}
                          {STATUS_LABEL[p.status]}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <div className="flex gap-2">
                    <button className={button}>Publish</button>
                    <button formAction={removeAction.bind(null, w.id, d.id)} className={quiet}>
                      Remove
                    </button>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Photos people sent of this wine">
        {w.photos.length === 0 ? (
          <p className="text-small text-ink-2">None yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {w.photos.map((p) => (
              <li key={p.id} className="text-caption text-ink-2">
                <Link href={`/admin/bottle-photos/${p.id}`} prefetch={false}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private, admin-only photo */}
                  <img
                    src={`/admin/bottle-photos/${p.id}/photo`}
                    alt={`Bottle photo sent ${date(p.createdAt)}`}
                    loading="lazy"
                    className="h-28 w-20 rounded-[8px] bg-raised object-cover ring-1 ring-hairline"
                  />
                  <span className="mt-1 block">
                    {STATUS_LABEL[p.status]} · {date(p.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
