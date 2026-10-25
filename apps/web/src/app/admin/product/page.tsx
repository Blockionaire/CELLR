import { notFound } from "next/navigation";
import { parseAdminRange } from "@cellr/domain";
import { adminProduct, getAdminSession } from "@/server/admin/service";
import {
  DayBars,
  Kpi,
  Kpis,
  Notice,
  PageTitle,
  RangeTabs,
  Section,
  Table,
  num,
  pct,
  unavailable,
} from "../_ui";

export const dynamic = "force-dynamic";

const FEATURES: Record<string, string> = {
  scan: "Label scan",
  sommelier: "Sommelier",
  tonight: "Tonight*",
  wine_insight: "Wine profile",
  valuation: "Valuation",
  "3d_cellar": "3D cellar*",
  bottle_added: "Added a bottle",
  bottle_opened: "Opened a bottle",
  rating: "Rated a bottle",
};

export default async function AdminProductPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const days = parseAdminRange((await searchParams).days);
  const { metrics: m, series, totals } = await adminProduct(session, days);
  const blocked = unavailable(series);
  return (
    <>
      <PageTitle
        title="Product analytics"
        note="Per UTC day. * Tonight and the 3D cellar come from first-party events, which are not recorded for people with Do Not Track or GPC: those counts are a lower bound. Everything else is counted from the database."
      >
        <RangeTabs path="/admin/product" current={days} />
      </PageTitle>
      {blocked || !Array.isArray(series) || !totals ? (
        <Notice>{blocked}</Notice>
      ) : (
        <>
          <Section title="Acquisition and activity">
            <Kpis>
              <Kpi label={`Sign-ups, ${days} days`} value={num(totals.signups)} />
              <Kpi label="Busiest day, active people" value={num(totals.peakActive)} />
              <Kpi label={`Bottles added, ${days} days`} value={num(totals.bottlesAdded)} />
            </Kpis>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-caption text-ink-2">Sign-ups per day</p>
                <DayBars
                  label="Sign-ups per day"
                  days={series.map((d) => ({ day: d.day, value: d.signups }))}
                />
              </div>
              <div>
                <p className="mb-2 text-caption text-ink-2">Active people per day</p>
                <DayBars
                  label="Active people per day"
                  days={series.map((d) => ({ day: d.day, value: d.active }))}
                />
              </div>
            </div>
          </Section>
          {m && (
            <Section
              title="Activation and retention"
              note="Current values (rolling), as on the overview."
            >
              <Kpis>
                <Kpi
                  label="Activation rate"
                  value={pct(m.activationRate)}
                  hint="Activated ÷ registered"
                />
                <Kpi
                  label="7-day retention"
                  value={pct(m.retention7d.rate)}
                  hint={`${num(m.retention7d.retained)} of ${num(m.retention7d.cohort)}`}
                />
              </Kpis>
            </Section>
          )}
          <Section
            title="Label scans"
            note="AI extraction success = the label reader returned valid structured output. It is not confirmed recognition accuracy."
          >
            <Kpis>
              <Kpi label={`Scans, ${days} days`} value={num(totals.scans)} />
              <Kpi label="AI extraction success" value={pct(totals.extractionSuccess)} />
            </Kpis>
            <div className="mt-4">
              <DayBars
                label="Scans per day"
                days={series.map((d) => ({ day: d.day, value: d.scans }))}
              />
            </div>
          </Section>
          <Section
            title={`Engagement, ${days} days`}
            note="Number of uses (AI calls or events), not people."
          >
            <Kpis>
              <Kpi label="Sommelier questions" value={num(totals.sommelier)} />
              <Kpi label="Tonight recommendations*" value={num(totals.tonight)} />
              <Kpi label="Wine profiles" value={num(totals.insights)} />
              <Kpi label="Valuations" value={num(totals.valuations)} />
              <Kpi label="3D cellar opened*" value={num(totals.cellar3d)} />
            </Kpis>
          </Section>
          {m && (
            <Section
              title="Feature adoption, last 30 days"
              note="Distinct people per feature, and as a share of monthly active people."
            >
              <Table
                head={[
                  { label: "Feature" },
                  { label: "People", numeric: true },
                  { label: "Of MAU", numeric: true },
                ]}
                rows={m.adoption30d.map((a) => ({
                  key: a.feature,
                  cells: [FEATURES[a.feature] ?? a.feature, num(a.people), pct(a.ofMau)],
                }))}
                empty="No feature use in the last 30 days."
              />
            </Section>
          )}
        </>
      )}
    </>
  );
}
