import Link from "next/link";
import { notFound } from "next/navigation";
import { CATALOG_REVIEW } from "@cellr/domain";
import { adminCorrections, getAdminSession } from "@/server/admin/service";
import { Kpi, Kpis, Notice, PageTitle, Section, Table, date, num } from "../../_ui";
import { CORRECTION_STATE_LABEL, FIELD_LABEL, fieldList } from "./labels";

export const dynamic = "force-dynamic";

/**
 * Correction signals: catalogue wines a scan proposed and people kept, corrected or replaced when they saved. Counts
 * of independent households and the values they confirmed, never who. Nothing here changes a catalogue wine.
 */
export default async function AdminCorrectionsPage() {
  const session = await getAdminSession();
  if (!session) notFound();
  const data = await adminCorrections(session);
  if (!data.ready)
    return (
      <>
        <PageTitle title="Corrections" />
        <Notice>
          {data.reason === "missing"
            ? "The correction-signals database step (supabase/migrations/20261106000029_catalog_corrections.sql) has not been run yet."
            : "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read."}
        </Notice>
      </>
    );
  const open = data.rows.filter((r) => r.state !== "resolved");
  return (
    <>
      <PageTitle
        title="Corrections"
        note={`What people did with a catalogue wine a scan proposed, when they saved: corrected one of its catalogue details (producer, name, colour, country, region) or chose another wine. ${CATALOG_REVIEW.ready} independent households asking for a change make it "review needed"; households disagreeing is a conflict. A corrected vintage is a scan misread and is counted below, not here. Nothing is changed automatically; editing catalogue wines comes later.`}
      >
        <Link href="/admin/catalog" prefetch={false} className="text-small text-accent-ink">
          ← Candidates
        </Link>
      </PageTitle>

      <Section title="Overview">
        <Kpis>
          <Kpi label="Wines with open signals" value={num(open.length)} />
          <Kpi
            label="Review needed"
            value={num(data.rows.filter((r) => r.state === "review_needed").length)}
          />
          <Kpi
            label="Conflicts"
            value={num(data.rows.filter((r) => r.state === "conflict").length)}
          />
          <Kpi
            label="Identity mismatches"
            value={num(data.rows.reduce((n, r) => n + r.identity, 0))}
            hint="Households, open"
          />
        </Kpis>
      </Section>

      <Section
        title="Catalogue wines"
        note="Independent households: two people of one household, or one person in two households, count once."
      >
        <Table
          head={[
            { label: "Wine" },
            { label: "State" },
            { label: "Open households", numeric: true },
            { label: "Detail corrections", numeric: true },
            { label: "Identity mismatches", numeric: true },
            { label: "Fields changed" },
            { label: "Accepted as is", numeric: true },
            { label: "Last" },
          ]}
          rows={data.rows.map((r) => ({
            key: r.wineId,
            cells: [
              <Link
                key="w"
                href={`/admin/catalog/corrections/${r.wineId}`}
                prefetch={false}
                className="text-accent-ink"
              >
                {r.producer} — {r.name}
              </Link>,
              CORRECTION_STATE_LABEL[r.state],
              num(r.openHouseholds),
              num(r.corrected),
              num(r.identity),
              fieldList(r.fields),
              num(r.accepted),
              date(r.lastAt),
            ],
          }))}
          empty="No signals yet. They are collected only while catalogue learning is on."
        />
      </Section>

      {data.ai && (
        <Section
          title="Scan readings (last 30 days)"
          note="How the scan's own reading fared: the vintage it read on a catalogue wine, and the AI's whole reading when nothing in the catalogue matched. A misread is a recognition error, not a catalogue error: it never counts towards the corrections above. Counts only; no values are kept."
        >
          <Kpis>
            <Kpi label="Kept as read" value={num(data.ai.accepted)} />
            <Kpi label="Details corrected" value={num(data.ai.corrected)} />
            <Kpi label="Another wine" value={num(data.ai.differentWine)} />
            <Kpi
              label="Fields corrected"
              value={
                Object.entries(data.ai.fields)
                  .map(([f, n]) => `${FIELD_LABEL[f as keyof typeof FIELD_LABEL] ?? f} ${n}`)
                  .join(" · ") || "—"
              }
            />
          </Kpis>
        </Section>
      )}
    </>
  );
}
