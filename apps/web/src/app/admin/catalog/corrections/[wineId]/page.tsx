import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { SignalField } from "@cellr/domain";
import { adminCorrection, getAdminSession } from "@/server/admin/service";
import { Notice, PageTitle, Section, Table, date } from "../../../_ui";
import { reviewSignalAction } from "../actions";
import { FIELD_LABEL, REVIEW_LABEL } from "../labels";

export const dynamic = "force-dynamic";

const input = "rounded-[10px] bg-surface px-3 py-2 ring-1 ring-hairline";
const quiet = "rounded-full px-3 py-1.5 text-caption text-ink ring-1 ring-hairline";

const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v));

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
        <Link
          href="/admin/catalog/corrections"
          prefetch={false}
          className="text-small text-accent-ink"
        >
          ← All corrections
        </Link>
      </PageTitle>
      {message && <Notice>{message}</Notice>}
      <Notice>
        Reviewing a signal changes nothing in the catalogue. To fix the record itself, edit it in
        the{" "}
        <Link
          href={`/admin/wines/${w.wineId}#details`}
          prefetch={false}
          className="text-accent-ink"
        >
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
              { label: "Proposed" },
              { label: "Confirmed" },
              { label: "Status" },
              { label: "Review" },
            ]}
            rows={g.rows.map((s) => ({
              key: s.id,
              cells: [
                s.lastSeenAt.slice(0, 10) === s.createdAt.slice(0, 10)
                  ? date(s.createdAt)
                  : `${date(s.createdAt)} · ${date(s.lastSeenAt)}`,
                s.changedFields.map((f) => FIELD_LABEL[f]).join(", "),
                s.changedFields
                  .map((f: SignalField) => `${FIELD_LABEL[f]}: ${show(s.proposed[f])}`)
                  .join(" · "),
                s.changedFields
                  .map((f: SignalField) => `${FIELD_LABEL[f]}: ${show(s.confirmed?.[f])}`)
                  .join(" · "),
                `${REVIEW_LABEL[s.status ?? "open"]}${s.note ? ` · ${s.note}` : ""}`,
                <form
                  key="r"
                  action={reviewSignalAction.bind(null, w.wineId, s.id)}
                  className="flex flex-wrap items-center gap-1.5"
                  data-testid="signal-review"
                >
                  <input
                    name="note"
                    maxLength={500}
                    placeholder="Note (optional)"
                    aria-label="Internal note"
                    className={`${input} w-40 py-1 text-caption`}
                  />
                  {s.status !== "reviewed" && (
                    <button name="status" value="reviewed" className={quiet}>
                      Reviewed
                    </button>
                  )}
                  {s.status !== "dismissed" && (
                    <button name="status" value="dismissed" className={quiet}>
                      Dismiss
                    </button>
                  )}
                  {s.status !== "open" && (
                    <button name="status" value="open" className={quiet}>
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
