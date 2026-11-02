import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { adminBottlePhoto, adminNextPhoto, getAdminSession } from "@/server/admin/service";
import { cn } from "@/ui/cn";
import {
  Message,
  Notice,
  PageTitle,
  Pill,
  Section,
  Table,
  button,
  date,
  input,
  link,
  quiet,
} from "../../_ui";
import { reviewAction } from "../actions";
import { Workflow } from "../_workflow";
import {
  LIBRARY_MISSING,
  STAGE_LABEL,
  STAGE_SHORT,
  STAGE_TONE,
  STATUS_LABEL,
  artHref,
  artWine,
  vintage,
} from "../labels";

export const dynamic = "force-dynamic";

/** A list's own query string, handed over when a row was opened: only ever kept for the photo list itself. */
const backTo = (v: unknown) =>
  typeof v === "string" && v.length <= 300 && /^[\w%.+\-=&]*$/.test(v)
    ? `/admin/bottle-photos${v ? `?${v}` : ""}`
    : "/admin/bottle-photos";

/**
 * One sent bottle photo: the photo (admin only), where it is in the workflow, and the one next step. The artwork is
 * made by the admin outside CELLR and uploaded on the wine's own artwork section; the photo page links straight to it.
 * A household's own wine keeps its picture to itself; linking it to a catalogue wine is optional and always the
 * admin's explicit choice.
 */
export default async function AdminBottlePhotoPage({
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
  const sp = await searchParams;
  const message = typeof sp.msg === "string" ? sp.msg.slice(0, 300) : null;
  const list = backTo(sp.back);
  const data = await adminBottlePhoto(session, id.data);
  if (data === "missing" || data === null)
    return (
      <>
        <PageTitle title="Bottle photo" crumbs={[{ label: "Bottle photos", href: list }]} />
        <Notice tone="warn">{LIBRARY_MISSING} (And set the service role.)</Notice>
      </>
    );
  if (data === "none") notFound();
  const { detail: p, candidates, stage } = data;
  const review = reviewAction.bind(null, p.id);
  // the wine the picture goes on: the one the photo was sent for (a household's own, or a catalogue wine)
  const wineId = artWine(p);
  const household = p.sourceCanonical === false;
  const next = stage === "published" ? await adminNextPhoto(session, "artwork_needed") : null;
  const title = `${p.producer} — ${p.wine}`;

  return (
    <>
      <PageTitle
        title={title}
        crumbs={[{ label: "Bottle photos", href: list }, { label: title }]}
        note={`${vintage(p.year)} · ${p.type} · sent ${date(p.createdAt)} · review status: ${STATUS_LABEL[p.status]}`}
      >
        <Pill tone={STAGE_TONE[stage]}>{STAGE_SHORT[stage]}</Pill>
      </PageTitle>
      <Message text={message} />
      <Workflow stage={stage} />

      <NextStep
        stage={stage}
        used={p.status === "used"}
        wineId={wineId}
        photoId={p.id}
        next={next && next.id !== p.id ? next : null}
      />

      {wineId && (
        <div
          data-testid="publication-scope"
          data-scope={household ? "household" : "catalogue"}
          className={cn(
            "mb-6 rounded-[14px] border p-4 text-small",
            household
              ? "border-transparent bg-peak-bg text-peak-ink"
              : "border-hairline bg-surface text-ink",
          )}
        >
          <p className="font-semibold">
            {household
              ? `Publication scope: household wine of ${p.household ?? "one household"}`
              : "Publication scope: catalogue (canonical) wine"}
          </p>
          <p className="mt-1">
            {household ? (
              <>
                Artwork published on this wine is visible only to {p.household ?? "that household"}{" "}
                and cannot be reused for anyone else. To share artwork with every household, it has
                to be published on a catalogue wine, which this household wine only inherits through
                a verified catalogue link.{" "}
                <Link
                  href={`/admin/wines/${p.sourceWineId}#links`}
                  prefetch={false}
                  className="font-semibold underline underline-offset-4"
                >
                  Catalogue links →
                </Link>{" "}
                Nothing is linked, promoted or shared automatically.
              </>
            ) : (
              "Artwork published on this wine is shared with every household that has it, and with household wines verified as this wine that have no picture of their own."
            )}
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="flex max-w-xs flex-col gap-3 lg:max-w-none">
          <h2 className="sr-only">Photos</h2>
          {(p.photos.length ? p.photos.map((x) => x.position) : [1]).map((n) => (
            <a
              key={n}
              href={`/admin/bottle-photos/${p.id}/photo?n=${n}`}
              target="_blank"
              rel="noreferrer"
              className="block rounded-[14px]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a private, admin-only photo */}
              <img
                src={`/admin/bottle-photos/${p.id}/photo?n=${n}`}
                alt={`Bottle photo ${n} of ${p.producer} ${p.wine}`}
                data-testid="submission-photo"
                className="w-full rounded-[14px] bg-raised object-contain ring-1 ring-hairline"
              />
              <span className="sr-only"> (opens the full photo in a new tab)</span>
            </a>
          ))}
        </div>
        <div className="min-w-0">
          <Section title="About this photo" tag="Read-only">
            <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 rounded-[14px] border border-hairline bg-surface p-4 text-small">
              <dt className="text-ink-2">From</dt>
              <dd>
                <Link href={`/admin/users/${p.userId}`} prefetch={false} className={link}>
                  {p.submitter ?? p.userId}
                </Link>
              </dd>
              <dt className="text-ink-2">Consent</dt>
              <dd>{p.consentAt ? `Given ${date(p.consentAt)}` : "Not given"}</dd>
              <dt className="text-ink-2">Reward</dt>
              <dd>
                {p.rewardPoints
                  ? `+${p.rewardPoints} points (${date(p.rewardAt)})`
                  : "None (already rewarded for this wine)"}
              </dd>
              <dt className="text-ink-2">Size</dt>
              <dd>
                {p.width} × {p.height} px
              </dd>
              <dt className="text-ink-2">Household</dt>
              <dd>{p.household ?? (p.householdId ? p.householdId : "—")}</dd>
              <dt className="text-ink-2">Wine</dt>
              <dd>
                {p.sourceWineId === null
                  ? "No longer there (the household removed it)"
                  : p.sourceCanonical
                    ? "A catalogue wine: its picture is shared with everyone who has it"
                    : `A household's own wine: its picture is seen only by ${p.household ?? "that household"}`}
              </dd>
              {wineId && (
                <>
                  <dt className="text-ink-2">Wine record</dt>
                  <dd className="flex flex-wrap gap-x-4">
                    <Link href={`/admin/wines/${wineId}`} prefetch={false} className={link}>
                      Open the wine
                    </Link>
                    <Link href={artHref(wineId, p.id)} prefetch={false} className={link}>
                      Its 2D artwork
                    </Link>
                  </dd>
                </>
              )}
              {household && (
                <>
                  <dt className="text-ink-2">Catalogue link</dt>
                  <dd>
                    {p.canonicalWineId ? (
                      <Link
                        href={`/admin/wines/${p.canonicalWineId}`}
                        prefetch={false}
                        className={link}
                      >
                        {p.canonicalName ?? p.canonicalWineId}
                      </Link>
                    ) : (
                      "None (not needed)"
                    )}
                  </dd>
                </>
              )}
              {p.note && (
                <>
                  <dt className="text-ink-2">Note</dt>
                  <dd>{p.note}</dd>
                </>
              )}
            </dl>
          </Section>

          <Section
            title="Review"
            tag="Editable"
            note="Approve a usable photo, then create the artwork and upload it on the wine. Reject one that is not usable. Publishing the artwork marks the photos you tick as used."
          >
            <form
              action={review}
              className="flex flex-col gap-3 rounded-[14px] border border-hairline bg-surface p-4 text-small"
            >
              {household && !p.canonicalWineId && (
                <details className="rounded-[10px] p-3 ring-1 ring-hairline">
                  <summary className="cursor-pointer text-ink-2">
                    Optional: link this household wine to a catalogue wine
                  </summary>
                  <p className="mt-2 text-caption text-ink-2">
                    Only when you have verified it is the same wine. While the household wine has no
                    picture of its own, it then shows the catalogue wine&apos;s picture. A link is
                    never made for you and is not replaced later.
                  </p>
                  <select
                    name="canonicalWineId"
                    defaultValue=""
                    aria-label="Catalogue wine"
                    className={cn(input, "mt-2 w-full")}
                  >
                    <option value="">— no link —</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.producer} — {c.name} ({c.type}
                        {c.country ? `, ${c.country}` : ""})
                      </option>
                    ))}
                  </select>
                  <input
                    name="canonicalWineIdPaste"
                    placeholder="…or paste a catalogue wine id"
                    aria-label="Catalogue wine id"
                    className={cn(input, "mt-2 w-full")}
                  />
                </details>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-ink-2">Note (internal)</span>
                <input name="note" maxLength={500} defaultValue="" className={input} />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button name="status" value="approved" className={button}>
                  Approve
                </button>
                <button name="status" value="used" className={quiet}>
                  Mark as used
                </button>
                {p.status !== "pending" && (
                  <button name="status" value="pending" className={quiet}>
                    Back to pending
                  </button>
                )}
                <span aria-hidden="true" className="mx-1 h-6 w-px bg-hairline" />
                <button
                  name="status"
                  value="rejected"
                  className="inline-flex items-center rounded-full px-4 py-2 text-small font-medium text-danger ring-1 ring-danger/60 hover:bg-danger/10"
                >
                  Reject
                </button>
              </div>
            </form>
          </Section>

          {p.related.length > 0 && (
            <Section title="Other photos of this wine">
              <Table
                head={[{ label: "Sent" }, { label: "Review status" }]}
                rows={p.related.map((r) => ({
                  key: r.id,
                  href: `/admin/bottle-photos/${r.id}`,
                  cells: [date(r.createdAt), STATUS_LABEL[r.status]],
                }))}
              />
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function NextStep({
  stage,
  used,
  wineId,
  photoId,
  next,
}: {
  stage: keyof typeof STAGE_LABEL;
  /** Its review status is used: it was the source of a picture once (kept as it was, whatever happened since). */
  used: boolean;
  wineId: string | null;
  photoId: string;
  next: { id: string; producer: string; wine: string } | null;
}) {
  const box = "mb-6 rounded-[14px] border p-4";
  if (stage === "pending")
    return (
      <div className={cn(box, "border-hairline bg-surface")} data-testid="next-step">
        <p className="text-body font-semibold text-ink">Next step: review this photo</p>
        <p className="mt-1 text-small text-ink-2">
          Approve it below if it shows the whole bottle clearly enough to make a 2D artwork from;
          reject it if not.
        </p>
      </div>
    );
  if (stage === "rejected")
    return (
      <div className={cn(box, "border-hairline bg-surface")} data-testid="next-step">
        <p className="text-body font-semibold text-ink">Rejected: nothing more to do</p>
        <p className="mt-1 text-small text-ink-2">
          The person may send new photos of this wine. Changed your mind? Use Back to pending below.
        </p>
      </div>
    );
  if (!wineId)
    return (
      <Notice tone="warn">
        The wine this photo was sent for is no longer there, so there is nowhere to publish artwork.
      </Notice>
    );
  if (stage === "published")
    return (
      <div
        className={cn(box, "border-transparent bg-ready-bg text-ready-ink")}
        data-testid="next-step"
      >
        <p className="text-body font-semibold">✓ Artwork published</p>
        <p className="mt-1 text-small">This contribution is done.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={artHref(wineId, photoId)}
            prefetch={false}
            className={quiet}
            data-testid="wine-link"
          >
            View the wine&apos;s artwork
          </Link>
          {next ? (
            <Link href={`/admin/bottle-photos/${next.id}`} prefetch={false} className={button}>
              Next contribution needing artwork: {next.producer} — {next.wine} →
            </Link>
          ) : (
            <Link href="/admin/bottle-photos?stage=pending" prefetch={false} className={quiet}>
              Photos awaiting review →
            </Link>
          )}
        </div>
      </div>
    );
  return (
    <div
      className={cn(box, "border-accent-fg bg-surface")}
      data-testid="next-step"
      data-stage={stage}
    >
      <p className="text-body font-semibold text-ink">
        {stage === "draft"
          ? "Next step: check the draft artwork and publish it"
          : "Next step: create the 2D artwork"}
      </p>
      {used && (
        <p className="mt-1 max-w-3xl text-small text-ink" data-testid="used-unpublished">
          This photo was used for a picture that is no longer published (taken off or removed):
          nothing is published for this wine now. Its review status stays Used.
        </p>
      )}
      <p className="mt-1 max-w-3xl text-small text-ink-2">
        {stage === "draft"
          ? "A finished picture is uploaded for this wine and waits as a draft. Check it, then publish it with this photo ticked as its source."
          : "Make the finished 2D bottle picture from the reference photos yourself, outside CELLR (ideally a transparent PNG of the whole bottle, upright). Then upload it on the wine: it stays a draft until you publish it."}
      </p>
      <Link
        href={artHref(wineId, photoId)}
        prefetch={false}
        className={cn(button, "mt-3 px-5 py-2.5 text-body")}
        data-testid="wine-link"
      >
        {stage === "draft" ? "Review & publish 2D Artwork →" : "Create / Upload 2D Artwork →"}
      </Link>
    </div>
  );
}
