import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { adminBottlePhoto, getAdminSession } from "@/server/admin/service";
import { Notice, PageTitle, Section, Table, date } from "../../_ui";
import { reviewAction } from "../actions";
import { LIBRARY_MISSING, STATUS_LABEL, vintage } from "../labels";

export const dynamic = "force-dynamic";

const input = "rounded-[10px] bg-surface px-3 py-2 ring-1 ring-hairline";
const button = "rounded-full bg-ink px-4 py-2 text-small text-canvas";
const quiet = "rounded-full px-4 py-2 text-small text-ink ring-1 ring-hairline";

/**
 * One sent bottle photo: the photo (admin only), what it is of, the consent and reward, and the review. The natural
 * next step is the wine's own picture editor, for a catalogue wine and a household's own wine alike; linking a
 * household's wine to a catalogue wine is optional and always the admin's explicit choice.
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
  const msg = (await searchParams).msg;
  const message = typeof msg === "string" ? msg.slice(0, 300) : null;
  const data = await adminBottlePhoto(session, id.data);
  if (data === "missing" || data === null)
    return (
      <>
        <PageTitle title="Bottle photo" />
        <Notice>{LIBRARY_MISSING} (And set the service role.)</Notice>
      </>
    );
  if (data === "none") notFound();
  const { detail: p, candidates } = data;
  const review = reviewAction.bind(null, p.id);
  // the wine the picture goes on: the one the photo was sent for (a household's own, or a catalogue wine)
  const wineId = p.sourceWineId ?? p.canonicalWineId;

  return (
    <>
      <PageTitle
        title={`${p.producer} — ${p.wine}`}
        note={`${vintage(p.year)} · ${p.type} · sent ${date(p.createdAt)} · ${STATUS_LABEL[p.status]}`}
      >
        <Link href="/admin/bottle-photos" prefetch={false} className="text-small text-accent-ink">
          ← All photos
        </Link>
      </PageTitle>
      {message && <Notice>{message}</Notice>}

      <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="flex flex-col gap-3">
          {(p.photos.length ? p.photos.map((x) => x.position) : [1]).map((n) => (
            <a
              key={n}
              href={`/admin/bottle-photos/${p.id}/photo?n=${n}`}
              target="_blank"
              rel="noreferrer"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a private, admin-only photo */}
              <img
                src={`/admin/bottle-photos/${p.id}/photo?n=${n}`}
                alt={`Bottle photo ${n} of ${p.producer} ${p.wine}`}
                data-testid="submission-photo"
                className="w-full rounded-[14px] bg-raised object-contain ring-1 ring-hairline"
              />
            </a>
          ))}
        </div>
        <div>
          <Section title="About this photo">
            <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-small">
              <dt className="text-ink-2">From</dt>
              <dd>
                <Link
                  href={`/admin/users/${p.userId}`}
                  prefetch={false}
                  className="text-accent-ink"
                >
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
                  <dt className="text-ink-2">Picture</dt>
                  <dd>
                    <Link
                      href={`/admin/wines/${wineId}`}
                      prefetch={false}
                      className="text-accent-ink"
                      data-testid="wine-link"
                    >
                      Open this wine&apos;s picture editor →
                    </Link>
                  </dd>
                </>
              )}
              {p.sourceCanonical === false && (
                <>
                  <dt className="text-ink-2">Catalogue link</dt>
                  <dd>
                    {p.canonicalWineId ? (
                      <Link
                        href={`/admin/wines/${p.canonicalWineId}`}
                        prefetch={false}
                        className="text-accent-ink"
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
            note="Approve a usable photo, then make the picture in the wine's picture editor. Reject one that is not usable. Publishing marks the photos you tick as used."
          >
            <form action={review} className="flex flex-col gap-3 text-small">
              {p.sourceCanonical === false && !p.canonicalWineId && (
                <details className="rounded-[10px] p-3 ring-1 ring-hairline">
                  <summary className="cursor-pointer text-ink-2">
                    Optional: link this household wine to a catalogue wine
                  </summary>
                  <p className="mt-2 text-caption text-ink-3">
                    Only when you have verified it is the same wine. While the household wine has no
                    picture of its own, it then shows the catalogue wine&apos;s picture. A link is
                    never made for you and is not replaced later.
                  </p>
                  <select name="canonicalWineId" defaultValue="" className={`${input} mt-2 w-full`}>
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
                    className={`${input} mt-2 w-full`}
                  />
                </details>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-ink-2">Note (internal)</span>
                <input name="note" maxLength={500} defaultValue="" className={input} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button name="status" value="approved" className={button}>
                  Approve
                </button>
                <button name="status" value="rejected" className={quiet}>
                  Reject
                </button>
                <button name="status" value="used" className={quiet}>
                  Mark as used
                </button>
                {p.status !== "pending" && (
                  <button name="status" value="pending" className={quiet}>
                    Back to pending
                  </button>
                )}
              </div>
            </form>
          </Section>

          {p.related.length > 0 && (
            <Section title="Other photos of this wine">
              <Table
                head={[{ label: "Sent" }, { label: "Status" }]}
                rows={p.related.map((r) => ({
                  key: r.id,
                  cells: [
                    <Link
                      key="d"
                      href={`/admin/bottle-photos/${r.id}`}
                      prefetch={false}
                      className="text-accent-ink"
                    >
                      {date(r.createdAt)}
                    </Link>,
                    STATUS_LABEL[r.status],
                  ],
                }))}
              />
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
