import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { SignalField } from "@cellr/domain";
import { adminCorrection, getAdminSession } from "@/server/admin/service";
import { Message, Notice, PageTitle, Section, Table, date, input, small, link } from "../../../_ui";
import { reviewSignalAction } from "../actions";
import { FIELD_LABEL, REVIEW_LABEL } from "../labels";

export const dynamic = "force-dynamic";

const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));

/** One value per changed field, the field named: easy to compare line by line, on a phone as on a desktop. */
function Values({
  fields,
  values,
}: {
  fields: readonly SignalField[];
  values: Partial<Record<SignalField, unknown>> | null | undefined;
}) {
  return (
    <ul className="space-y-0.5">
      {fields.map((f) => (
        <li key={f}>
          <span className="text-ink-2">{FIELD_LABEL[f]}:</span>{" "}
          <span className="font-medium">{show(values?.[f])}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One catalogue wine's correction signals: what was proposed, what people confirmed instead, and the review. Never who
 * sent them. Identity mismatches are listed apart from detail corrections.
 */
export default async function AdminCorrectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ wineId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const id = z.uuid().safeParse((await params).wineId);
  if (!id.success) notFound();
  const msg = (await searchParams).msg;
  const message = typeof msg === "string" ? msg.slice(0, 300) : null;
  const w = await adminCorrection(session, id.data);
  if (w === "missing" || w === null)
    return (
      <>
        <PageTitle title="Corrections" />
        <Notice>
          Not available: run 20261106000029_catalog_corrections.sql (and set the service role).
        </Notice>
      </>
    );
  if (w === "none") notFound();
  const groups = [
    { title: "Detail corrections", rows: w.signals.filter((s) => s.signal === "corrected") },
    { title: "Identity mismatches", rows: w.signals.filter((s) => s.signal === "different_wine") },
  ];
  const accepted = w.signals.filter((s) => s.signal === "accepted").length;

  return (
    <>
      <PageTitle
        title={`${w.producer} — ${w.name}`}
        note={`Catalogue record: ${[w.type, w.country, w.region].filter(Boolean).join(" · ")} · accepted as is by ${accepted} ${accepted === 1 ? "person" : "people"}`}
      >
        {/* on a phone the header's back button does this */}
        <Link
          href="/admin/catalog/corrections"
          prefetch={false}
          className={`${link} hidden text-small lg:inline`}
        >
          ← All corrections
        </Link>
      </PageTitle>
      <Message text={message} />
      <Notice>
        Reviewing a signal changes nothing in the catalogue. To fix the record itself, edit it in
        the{" "}
        <Link href={`/admin/wines/${w.wineId}#details`} prefetch={false} className={link}>
          Wine Master Database
        </Link>
        .
      </Notice>

      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          <Table
            head={[
              { label: "Sent · last seen" },
              { label: "Fields" },
              { label: "Proposed", wideOnPhone: true },
              { label: "Confirmed", wideOnPhone: true },
              { label: "Status" },
              { label: "Review", wideOnPhone: true },
            ]}
            rows={g.rows.map((s) => ({
              key: s.id,
              cells: [
                `${
                  s.lastSeenAt.slice(0, 10) === s.createdAt.slice(0, 10)
                    ? date(s.createdAt)
                    : `${date(s.createdAt)} · ${date(s.lastSeenAt)}`
                }${s.source === "text" ? " · via label text" : ""}`,
                s.changedFields.map((f) => FIELD_LABEL[f]).join(", "),
                <Values key="p" fields={s.changedFields} values={s.proposed} />,
                <Values key="c" fields={s.changedFields} values={s.confirmed} />,
                `${REVIEW_LABEL[s.status ?? "open"]}${s.note ? ` · ${s.note}` : ""}`,
                <form
                  key="r"
                  action={reviewSignalAction.bind(null, w.wineId, s.id)}
                  className="flex w-full flex-wrap items-center gap-1.5"
                  data-testid="signal-review"
                >
                  <input
                    name="note"
                    maxLength={500}
                    placeholder="Note (optional)"
                    aria-label="Internal note"
                    className={`${input} w-full py-1 text-caption sm:w-40`}
                  />
                  {s.status !== "reviewed" && (
                    <button name="status" value="reviewed" className={small}>
                      Reviewed
                    </button>
                  )}
                  {s.status !== "dismissed" && (
                    <button name="status" value="dismissed" className={small}>
                      Dismiss
                    </button>
                  )}
                  {s.status !== "open" && (
                    <button name="status" value="open" className={small}>
                      Reopen
                    </button>
                  )}
                </form>,
              ],
            }))}
            empty="None."
          />
        </Section>
      ))}
    </>
  );
}
