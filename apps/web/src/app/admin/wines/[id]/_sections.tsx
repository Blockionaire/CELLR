import Link from "next/link";
import type { ReactNode } from "react";
import {
  BOTTLE_ART_LIMITS,
  WINE_TYPES,
  auditChanges,
  type CorrectionDetail,
  type SignalField,
  type WineMasterRecord,
  type WineMasterRow,
  type WineVisual,
} from "@cellr/domain";
import { Notice, Section, Table, date, num } from "../../_ui";
import { STATUS_LABEL, vintage } from "../../bottle-photos/labels";
import { FIELD_LABEL, REVIEW_LABEL } from "../../catalog/corrections/labels";
import { reviewSignalAction } from "../../catalog/corrections/actions";
import {
  createVintageAction,
  deleteVintageAction,
  linkAction,
  publishAction,
  publishLabelAction,
  reassignProducerAction,
  removeAction,
  removeLabelAction,
  setAliasesAction,
  setGrapesAction,
  unlinkAction,
  unpublishAction,
  unpublishLabelAction,
  updateProducerAction,
  updateVintageAction,
  updateWineAction,
} from "../actions";

/**
 * The sections of one wine's master page. Server-rendered; every form posts to an admin action that checks the
 * session again. Each section says what a change reaches: the shared catalogue (every household that has the wine)
 * or one household's own wine.
 */
export const input = "rounded-[10px] bg-surface px-3 py-2 ring-1 ring-hairline";
export const button = "rounded-full bg-ink px-4 py-2 text-small text-canvas";
export const quiet = "rounded-full px-4 py-2 text-small text-ink ring-1 ring-hairline";

type R = WineMasterRecord;

export function Scope({ record }: { record: R }) {
  return (
    <p
      className="mb-3 inline-block rounded-full bg-raised px-3 py-1 text-caption text-ink-2"
      data-testid="scope"
    >
      {record.status === "canonical"
        ? "Scope: shared catalogue — a change here reaches every household that has this wine."
        : `Scope: household wine of ${record.household ?? record.householdId} — a change here reaches that household only.`}
    </p>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-small">
      <span className="text-ink-2">{label}</span>
      {children}
    </label>
  );
}

const Reason = ({ required }: { required?: boolean }) => (
  <Field label={required ? "Reason (required)" : "Reason (internal, optional)"}>
    <input name="reason" maxLength={500} required={required} className={`${input} w-72`} />
  </Field>
);

export function OverviewSection({ record, visual }: { record: R; visual: WineVisual | null }) {
  const published = visual?.art.some((a) => a.publishedAt !== null) ?? false;
  const bottles = record.vintages.reduce((n, v) => n + v.bottles, 0);
  return (
    <Section title="Overview" id="overview">
      <Scope record={record} />
      <dl className="grid grid-cols-[12rem_1fr] gap-y-1 text-small">
        <dt className="text-ink-2">Status</dt>
        <dd>
          {record.status === "canonical" ? "Catalogue (canonical)" : "Household (provisional)"} ·
          origin {record.origin}
        </dd>
        <dt className="text-ink-2">Wine id</dt>
        <dd className="font-mono text-caption">{record.id}</dd>
        <dt className="text-ink-2">Producer</dt>
        <dd>
          {record.producer.name} · holds {num(record.producer.wines)}{" "}
          {record.producer.wines === 1 ? "wine" : "wines"}
        </dd>
        <dt className="text-ink-2">Vintages · bottles</dt>
        <dd>
          {num(record.vintages.length)} · {num(bottles)} in cellars
        </dd>
        <dt className="text-ink-2">2D artwork</dt>
        <dd>{published ? "Published" : "None published"}</dd>
        <dt className="text-ink-2">Catalogue link</dt>
        <dd>
          {record.status === "canonical"
            ? `${num(record.linkedFrom)} household ${record.linkedFrom === 1 ? "wine" : "wines"} verified as this wine`
            : record.link?.canonicalWineId
              ? `→ ${record.link.canonicalName}`
              : record.link
                ? "Explicitly not linked"
                : "Not linked"}
        </dd>
        <dt className="text-ink-2">Last changed</dt>
        <dd>{date(record.updatedAt)}</dd>
      </dl>
    </Section>
  );
}

export function DetailsSection({ record }: { record: R }) {
  const w = record;
  const p = record.producer;
  return (
    <Section
      title="Wine details"
      id="details"
      note="Validated here and in the database. A change that would duplicate another wine is refused; so is a change made on stale data. Bottles, prices, places, ratings and notes are never touched."
    >
      <Scope record={record} />
      <form
        action={updateWineAction.bind(null, w.id)}
        className="grid max-w-4xl grid-cols-1 gap-3 md:grid-cols-3"
        data-testid="wine-details"
      >
        <input type="hidden" name="expected" value={w.updatedAt} />
        <Field label="Wine name">
          <input name="name" defaultValue={w.name} required maxLength={160} className={input} />
        </Field>
        <Field label="Type">
          <select name="type" defaultValue={w.type} className={input}>
            {WINE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Country (2 letters)">
          <input name="country" defaultValue={w.country ?? ""} maxLength={2} className={input} />
        </Field>
        <Field label="Region">
          <input name="region" defaultValue={w.region ?? ""} maxLength={120} className={input} />
        </Field>
        <Field label="Appellation">
          <input
            name="appellation"
            defaultValue={w.appellation ?? ""}
            maxLength={160}
            className={input}
          />
        </Field>
        <Field label="Classification">
          <input
            name="classification"
            defaultValue={w.classification ?? ""}
            maxLength={120}
            className={input}
          />
        </Field>
        <Field label="Bottle style (JSON, optional)">
          <input
            name="bottleStyle"
            defaultValue={w.bottleStyle ? JSON.stringify(w.bottleStyle) : ""}
            maxLength={800}
            className={`${input} font-mono text-caption`}
          />
        </Field>
        <Reason />
        <div className="flex items-end">
          <button className={button}>Save wine details</button>
        </div>
      </form>

      <div className="mt-6 grid max-w-4xl gap-6 md:grid-cols-2">
        <form action={setAliasesAction.bind(null, w.id)} className="flex flex-col gap-2">
          <Field label="Aliases (one per line)">
            <textarea
              name="aliases"
              rows={4}
              defaultValue={record.aliases.join("\n")}
              className={input}
            />
          </Field>
          <Reason />
          <button className={`${quiet} self-start`}>Save aliases</button>
        </form>
        <form action={setGrapesAction.bind(null, w.id)} className="flex flex-col gap-2">
          <Field label="Grapes (one per line, e.g. “Merlot 70%”)">
            <textarea
              name="grapes"
              rows={4}
              defaultValue={record.grapes
                .map((g) => (g.pct === null ? g.grape : `${g.grape} ${g.pct}%`))
                .join("\n")}
              className={input}
            />
          </Field>
          <Reason />
          <button className={`${quiet} self-start`}>Save grapes</button>
        </form>
      </div>

      <h3 className="mt-8 text-small font-semibold text-ink">Producer</h3>
      {p.wines > 1 && (
        <Notice>
          This producer is shared by {p.wines} wines. Renaming it renames it for all of them. To
          move only this wine to another producer, use “Move this wine to another producer” below.
        </Notice>
      )}
      <div className="mt-3 grid max-w-4xl gap-6 md:grid-cols-2">
        <form
          action={updateProducerAction.bind(null, w.id, p.id)}
          className="flex flex-col gap-2"
          data-testid="producer-rename"
        >
          <input type="hidden" name="expected" value={p.updatedAt} />
          <Field label="Producer name (renames the producer itself)">
            <input name="name" defaultValue={p.name} required maxLength={160} className={input} />
          </Field>
          <Field label="Producer country (2 letters)">
            <input name="country" defaultValue={p.country ?? ""} maxLength={2} className={input} />
          </Field>
          {p.wines > 1 && (
            <label className="flex items-center gap-2 text-small">
              <input type="checkbox" name="confirmWines" value={p.wines} />I understand this changes
              all {p.wines} wines of this producer
            </label>
          )}
          <Reason />
          <button className={`${quiet} self-start`}>Save producer</button>
        </form>
        <form
          action={reassignProducerAction.bind(null, w.id)}
          className="flex flex-col gap-2"
          data-testid="producer-reassign"
        >
          <input type="hidden" name="expected" value={w.updatedAt} />
          <Field label="Move this wine to another producer (same scope)">
            <select name="producer" defaultValue="" required className={input}>
              <option value="" disabled>
                Choose a producer…
              </option>
              {record.otherProducers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.country ? ` (${o.country})` : ""}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-small">
            <input type="checkbox" name="confirm" value="yes" />
            Move only this wine; {p.name} and its other wines stay as they are
          </label>
          <Reason required />
          <button className={`${quiet} self-start`}>Move this wine</button>
        </form>
      </div>
    </Section>
  );
}

export function VintagesSection({ record }: { record: R }) {
  return (
    <Section
      title="Vintages"
      id="vintages"
      note="Alcohol can always be corrected. A vintage's year cannot change, and it cannot be removed, while bottles in a cellar refer to it."
    >
      <Scope record={record} />
      <Table
        head={[
          { label: "Vintage" },
          { label: "Bottles", numeric: true },
          { label: "Label photos (front · back)" },
          { label: "Shared profile" },
          { label: "Edit" },
        ]}
        rows={record.vintages.map((v) => ({
          key: v.id,
          cells: [
            vintage(v.year),
            num(v.bottles),
            `${num(v.frontPhotos)} · ${num(v.backPhotos)}`,
            v.sharedProfile ? "Yes" : "—",
            <div key="e" className="flex flex-wrap items-center gap-2">
              <form
                action={updateVintageAction.bind(null, record.id, v.id)}
                className="flex flex-wrap items-center gap-1.5"
                data-testid={`vintage-${vintage(v.year)}`}
              >
                <input
                  name="year"
                  defaultValue={v.year === null ? "NV" : String(v.year)}
                  aria-label="Year"
                  readOnly={v.bottles > 0}
                  title={v.bottles > 0 ? "Bottles refer to this vintage" : undefined}
                  className={`${input} w-20 py-1 text-caption`}
                />
                <input
                  name="abv"
                  defaultValue={v.abv ?? ""}
                  aria-label="ABV %"
                  placeholder="ABV %"
                  className={`${input} w-20 py-1 text-caption`}
                />
                <input type="hidden" name="reason" value="" />
                <button className="rounded-full px-3 py-1 text-caption ring-1 ring-hairline">
                  Save
                </button>
              </form>
              {v.bottles === 0 && (
                <form
                  action={deleteVintageAction.bind(null, record.id, v.id)}
                  className="flex items-center gap-1.5 text-caption"
                >
                  <label className="flex items-center gap-1">
                    <input type="checkbox" name="confirm" value="yes" />
                    sure
                  </label>
                  <button className="rounded-full px-3 py-1 text-caption ring-1 ring-hairline">
                    Remove vintage
                  </button>
                </form>
              )}
            </div>,
          ],
        }))}
        empty="No vintages yet."
      />
      <form
        action={createVintageAction.bind(null, record.id)}
        className="mt-3 flex flex-wrap items-end gap-3"
        data-testid="vintage-create"
      >
        <Field label="New vintage (year, or NV)">
          <input name="year" required className={`${input} w-32`} />
        </Field>
        <Field label="ABV % (optional)">
          <input name="abv" className={`${input} w-28`} />
        </Field>
        <Reason />
        <button className={quiet}>Add vintage</button>
      </form>
    </Section>
  );
}

export function LabelsSection({ record }: { record: R }) {
  const canonical = record.status === "canonical";
  const year = (id: string | null) =>
    id === null ? "every vintage" : vintage(record.vintages.find((v) => v.id === id)?.year ?? null);
  return (
    <Section
      title="Labels"
      id="labels"
      note="Household label photos are private to their household: shown here for the admin only, never shared or copied. Shared labels are curated images the admin uploads for catalogue wines."
    >
      <Scope record={record} />
      <h3 className="text-small font-semibold text-ink">Household label photos</h3>
      {record.householdLabels.length === 0 ? (
        <p className="mt-1 text-small text-ink-2">None.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-3">
          {record.householdLabels.map((l) => (
            <li key={l.id} className="text-caption text-ink-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a private, admin-only photo */}
              <img
                src={`/admin/wines/${record.id}/household-labels/${l.id}`}
                alt={`${l.side} label photo, ${vintage(l.year)}`}
                loading="lazy"
                className="h-28 w-20 rounded-[8px] bg-raised object-cover ring-1 ring-hairline"
              />
              <span className="mt-1 block">
                {l.side} · {vintage(l.year)} · {l.household ?? "a household"} · {date(l.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 text-small font-semibold text-ink">Shared labels (curated)</h3>
      {!canonical ? (
        <p className="mt-1 text-small text-ink-2">
          Shared labels are for catalogue wines only. A household&rsquo;s photos are never shared.
        </p>
      ) : (
        <>
          {record.catalogLabels.length === 0 ? (
            <p className="mt-1 text-small text-ink-2">None yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3" data-testid="catalog-labels">
              {record.catalogLabels.map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center gap-4 rounded-[14px] border border-hairline bg-surface p-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- an admin preview */}
                  <img
                    src={`/admin/wines/${record.id}/labels/${l.id}`}
                    alt={`Shared ${l.side} label`}
                    className="h-28 w-auto rounded-[8px] bg-raised"
                  />
                  <span className="text-small text-ink-2">
                    {l.side} · {year(l.vintageId)} · {l.width} × {l.height} px · source: {l.source}{" "}
                    · {l.publishedAt ? `published ${date(l.publishedAt)}` : "draft"}
                  </span>
                  <div className="flex gap-2">
                    {l.publishedAt ? (
                      <form action={unpublishLabelAction.bind(null, record.id, l.id)}>
                        <button className={quiet}>Stop sharing label</button>
                      </form>
                    ) : (
                      <form action={publishLabelAction.bind(null, record.id, l.id)}>
                        <button className={quiet}>Share label</button>
                      </form>
                    )}
                    <form action={removeLabelAction.bind(null, record.id, l.id)}>
                      <button className={quiet}>Delete label</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form
            action={`/admin/wines/${record.id}/labels`}
            method="post"
            encType="multipart/form-data"
            className="mt-3 flex flex-wrap items-end gap-3"
          >
            <Field label="Label image (PNG or JPEG, at most 4 MB)">
              <input
                type="file"
                name="label"
                accept="image/png,image/jpeg"
                required
                className={input}
              />
            </Field>
            <Field label="Side">
              <select name="side" className={input}>
                <option value="front">Front</option>
                <option value="back">Back</option>
              </select>
            </Field>
            <Field label="Vintage">
              <select name="vintage" className={input} defaultValue="">
                <option value="">Every vintage</option>
                {record.vintages.map((v) => (
                  <option key={v.id} value={v.id}>
                    {vintage(v.year)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Source (where it comes from, on what terms)">
              <input name="source" required maxLength={200} className={`${input} w-72`} />
            </Field>
            <button className={button}>Add shared label</button>
          </form>
        </>
      )}
    </Section>
  );
}

/** The 2D artwork of Sprint P, unchanged in function: one published default per wine, drafts, sent photos. */
export function ArtSection({ record, visual }: { record: R; visual: WineVisual | null }) {
  if (!visual)
    return (
      <Section title="2D Bottle Artwork" id="art">
        <Notice>
          The bottle library is not available (run 20261105000028_bottle_library.sql).
        </Notice>
      </Section>
    );
  const w = visual;
  const published = w.art.find((a) => a.publishedAt !== null) ?? null;
  const drafts = w.art.filter((a) => a.publishedAt === null);
  // photos a picture of this wine may be made from: sent for it, or explicitly linked to it after review
  const sourceable = w.photos.filter(
    (p) =>
      (p.sourceWineId === w.id && (p.status === "approved" || p.status === "pending")) ||
      (p.sourceWineId !== w.id && p.status === "approved" && p.reviewedAt !== null),
  );
  return (
    <Section
      title="2D Bottle Artwork"
      id="art"
      note={
        record.status === "canonical"
          ? "Its published picture is the default for everyone who has this wine, and for household wines verified as this wine that have no picture of their own."
          : "Its published picture is shown only to that household. Without one, the picture of the catalogue wine it is verified as (if any) is used; otherwise the drawn bottle."
      }
    >
      <Scope record={record} />
      {published && (
        <div className="mb-4 flex flex-wrap items-end gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- an admin preview */}
          <img
            src={`/admin/wines/${w.id}/art/${published.id}`}
            alt={`Published 2D bottle of ${w.producer} ${w.name}`}
            data-testid="published-art"
            className="h-64 w-auto rounded-[12px] bg-raised p-2 ring-1 ring-hairline"
          />
          <div className="flex flex-col gap-2 text-small">
            <span className="text-ink-2">
              Published {date(published.publishedAt)} · {published.width} × {published.height} px ·{" "}
              {published.contentType}
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
      )}
      <form
        action={`/admin/wines/${w.id}/art`}
        method="post"
        encType="multipart/form-data"
        className="flex flex-wrap items-end gap-3 text-small"
      >
        <p className="w-full text-caption text-ink-2">
          {published ? "Replace the picture" : "Upload a 2D bottle picture"}: a finished picture of
          the whole bottle, ideally a PNG with a transparent background, upright, at least{" "}
          {BOTTLE_ART_LIMITS.minEdge} px wide, at most 4 MB. It is kept as a draft until you publish
          it.
        </p>
        <Field label="Picture">
          <input
            type="file"
            name="picture"
            accept="image/png,image/jpeg"
            required
            className={input}
          />
        </Field>
        <Field label="Note (internal, optional)">
          <input name="note" maxLength={500} className={input} />
        </Field>
        <button type="submit" className={button}>
          Upload
        </button>
      </form>
      {drafts.length > 0 && (
        <ul className="mt-4 flex flex-col gap-4">
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
                  Draft · {d.width} × {d.height} px · uploaded {date(d.createdAt)}
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
                        Photo of {date(p.createdAt)} · {vintage(p.year)} · {STATUS_LABEL[p.status]}
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
      )}
      <h3 className="mt-6 text-small font-semibold text-ink">Photos people sent of this wine</h3>
      {w.photos.length === 0 ? (
        <p className="mt-1 text-small text-ink-2">None yet.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-3">
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
  );
}

const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));

export function CorrectionsSection({
  record,
  correction,
}: {
  record: R;
  correction: CorrectionDetail | null;
}) {
  if (record.status !== "canonical")
    return (
      <Section title="Corrections" id="corrections">
        <p className="text-small text-ink-2">
          Correction signals are collected for catalogue wines only.
        </p>
      </Section>
    );
  const open = (correction?.signals ?? []).filter(
    (s) => s.signal !== "accepted" && (s.status ?? "open") === "open",
  );
  return (
    <Section
      title="Corrections"
      id="corrections"
      note="What people confirmed instead of what a scan proposed. Reviewing a signal changes nothing; fix the record yourself in Wine details if it is wrong."
    >
      <p className="mb-2 text-small">
        <Link
          href={`/admin/catalog/corrections/${record.id}`}
          prefetch={false}
          className="text-accent-ink"
        >
          All signals of this wine →
        </Link>
      </p>
      <Table
        head={[
          { label: "Sent" },
          { label: "Kind" },
          { label: "Proposed" },
          { label: "Confirmed" },
          { label: "Review" },
        ]}
        rows={open.map((s) => ({
          key: s.id,
          cells: [
            date(s.createdAt),
            s.signal === "corrected" ? "Detail correction" : "Identity mismatch",
            s.changedFields
              .map((f: SignalField) => `${FIELD_LABEL[f]}: ${show(s.proposed[f])}`)
              .join(" · ") || "—",
            s.changedFields
              .map((f: SignalField) => `${FIELD_LABEL[f]}: ${show(s.confirmed?.[f])}`)
              .join(" · ") || "—",
            <form
              key="r"
              action={reviewSignalAction.bind(null, record.id, s.id)}
              className="flex flex-wrap items-center gap-1.5"
            >
              <input
                name="note"
                maxLength={500}
                placeholder="Note (optional)"
                aria-label="Internal note"
                className={`${input} w-40 py-1 text-caption`}
              />
              <button name="status" value="reviewed" className={quiet}>
                {REVIEW_LABEL.reviewed}
              </button>
              <button name="status" value="dismissed" className={quiet}>
                Dismiss
              </button>
            </form>,
          ],
        }))}
        empty="No open signals."
      />
    </Section>
  );
}

function Side({ title, w }: { title: string; w: R }) {
  return (
    <div className="rounded-[14px] border border-hairline bg-surface p-4 text-small">
      <h4 className="font-semibold text-ink">{title}</h4>
      <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1">
        <dt className="text-ink-2">Producer</dt>
        <dd>{w.producer.name}</dd>
        <dt className="text-ink-2">Wine</dt>
        <dd>{w.name}</dd>
        <dt className="text-ink-2">Type</dt>
        <dd>{w.type}</dd>
        <dt className="text-ink-2">Origin</dt>
        <dd>{[w.country, w.region, w.appellation].filter(Boolean).join(" · ") || "—"}</dd>
        <dt className="text-ink-2">Vintages</dt>
        <dd>{w.vintages.map((v) => vintage(v.year)).join(", ") || "—"}</dd>
        <dt className="text-ink-2">Grapes</dt>
        <dd>{w.grapes.map((g) => g.grape).join(", ") || "—"}</dd>
      </dl>
    </div>
  );
}

export function LinksSection({
  record,
  candidates,
  compare,
  query,
}: {
  record: R;
  candidates: WineMasterRow[];
  compare: R | null;
  query: string;
}) {
  if (record.status === "canonical")
    return (
      <Section
        title="Catalogue links"
        id="links"
        note="Household wines an admin verified to be this catalogue wine. They inherit its 2D artwork when they have none of their own."
      >
        <Table
          head={[{ label: "Household wine" }, { label: "Household" }, { label: "Linked" }]}
          rows={record.linkedSources.map((s) => ({
            key: s.id,
            cells: [
              <Link
                key="l"
                href={`/admin/wines/${s.id}#links`}
                prefetch={false}
                className="text-accent-ink"
              >
                {s.producer} — {s.name}
              </Link>,
              s.household ?? "—",
              `${date(s.linkedAt)}${s.reason ? ` · ${s.reason}` : ""}`,
            ],
          }))}
          empty="No household wine is linked to this wine."
        />
      </Section>
    );
  const link = record.link;
  return (
    <Section
      title="Catalogue links"
      id="links"
      note="A link says: this household wine IS that catalogue wine, verified by an admin (never by similarity). It decides which 2D artwork the household inherits: its own first, then the linked catalogue wine's, then the drawn bottle. It does not change the household's wine or bottles."
    >
      <Scope record={record} />
      {link?.canonicalWineId ? (
        <div className="flex flex-col gap-3">
          <p className="text-small" data-testid="current-link">
            Linked to{" "}
            <Link
              href={`/admin/wines/${link.canonicalWineId}`}
              prefetch={false}
              className="text-accent-ink"
            >
              {link.canonicalName}
            </Link>{" "}
            since {date(link.linkedAt)}
            {link.reason ? ` · ${link.reason}` : ""}
          </p>
          <form
            action={unlinkAction.bind(null, record.id)}
            className="flex flex-wrap items-end gap-3"
          >
            <Reason required />
            <label className="flex items-center gap-2 text-small">
              <input type="checkbox" name="confirm" value="yes" />
              This link is wrong
            </label>
            <button className={quiet}>Unlink</button>
          </form>
        </div>
      ) : (
        <>
          {link && (
            <p className="mb-2 text-small text-ink-2">
              Explicitly unlinked on {date(link.linkedAt)}
              {link.reason ? ` · ${link.reason}` : ""}. Nothing is inherited until it is linked
              again.
            </p>
          )}
          <form
            className="flex flex-wrap items-end gap-2 text-small"
            action={`/admin/wines/${record.id}`}
          >
            <input
              name="link_q"
              defaultValue={query}
              placeholder="Search the catalogue (producer, wine, alias)"
              aria-label="Search the catalogue"
              className={`${input} w-80`}
            />
            <button className={quiet}>Find catalogue wines</button>
          </form>
          {query && (
            <ul className="mt-3 flex flex-col gap-1 text-small" data-testid="link-candidates">
              {candidates.length === 0 && <li className="text-ink-2">No catalogue wine found.</li>}
              {candidates.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/admin/wines/${record.id}?link_q=${encodeURIComponent(query)}&compare=${c.id}#links`}
                    prefetch={false}
                    className="text-accent-ink"
                  >
                    Compare with {c.producer} — {c.name}
                  </Link>{" "}
                  <span className="text-ink-2">
                    ({[c.type, c.country, c.region].filter(Boolean).join(" · ")})
                  </span>
                </li>
              ))}
            </ul>
          )}
          {compare && (
            <div className="mt-4" data-testid="link-compare">
              <div className="grid gap-4 md:grid-cols-2">
                <Side title="This household wine" w={record} />
                <Side title="Catalogue wine" w={compare} />
              </div>
              <form
                action={linkAction.bind(null, record.id)}
                className="mt-3 flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="target" value={compare.id} />
                <Field label="Why they are the same wine (required)">
                  <input
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    className={`${input} w-96`}
                  />
                </Field>
                <label className="flex items-center gap-2 text-small">
                  <input type="checkbox" name="confirm" value="yes" />I verified these are the same
                  wine
                </label>
                <button className={button}>Link to this catalogue wine</button>
              </form>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

const ACTION_LABEL: Record<string, string> = {
  update_wine: "Details changed",
  update_producer: "Producer renamed",
  reassign_producer: "Moved to another producer",
  set_aliases: "Aliases changed",
  set_grapes: "Grapes changed",
  create_vintage: "Vintage added",
  update_vintage: "Vintage changed",
  delete_vintage: "Vintage removed",
  link: "Linked",
  unlink: "Unlinked",
  add_label: "Label uploaded",
  publish_label: "Label published",
  unpublish_label: "Label unpublished",
  remove_label: "Label removed",
};

export function HistorySection({ record }: { record: R }) {
  return (
    <Section
      title="History"
      id="history"
      note="Every master-data change: what, when, before and after, and why. Shown to admins only; it holds master data, never a household's bottles or people's details."
    >
      <Table
        head={[
          { label: "When" },
          { label: "Change" },
          { label: "Before → after" },
          { label: "Reason" },
          { label: "By" },
        ]}
        rows={record.history.map((h, i) => ({
          key: `${h.at}-${i}`,
          cells: [
            new Date(h.at).toISOString().slice(0, 16).replace("T", " "),
            `${ACTION_LABEL[h.action] ?? h.action} (${h.entity})`,
            auditChanges(h.before, h.after).join(" · ") || "—",
            h.reason ?? "—",
            h.actor ? (
              <Link
                key="a"
                href={`/admin/users/${h.actor}`}
                prefetch={false}
                className="font-mono text-caption text-accent-ink"
              >
                admin {h.actor.slice(0, 8)}
              </Link>
            ) : (
              "—"
            ),
          ],
        }))}
        empty="No changes yet."
      />
    </Section>
  );
}
