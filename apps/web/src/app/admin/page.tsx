import { notFound } from "next/navigation";
import { adminOverview, getAdminSession } from "@/server/admin/service";
import { Kpi, Kpis, Notice, PageTitle, Section, num, pct, unavailable, usd } from "./_ui";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const session = await getAdminSession();
  if (!session) notFound();
  const { metrics: m, spendToday, spendMonth } = await adminOverview(session);
  const costNote = unavailable(spendToday);
  return (
    <>
      <PageTitle
        title="Overview"
        note="Definitions as in docs/METRICS.md. Activity windows are rolling, in UTC. A rate shows as unavailable when there is nothing to divide by."
      />
      {!m ? (
        <Notice>
          Platform metrics are unavailable: the service role is not configured, or the AI-costs
          database step (20261024000017) has not been run.
        </Notice>
      ) : (
        <>
          <Section title="Users">
            <Kpis>
              <Kpi label="Registered" value={num(m.users.registered)} />
              <Kpi label="New, last 7 days" value={num(m.users.new7d)} />
              <Kpi label="New, last 30 days" value={num(m.users.new30d)} />
              <Kpi label="Onboarded" value={num(m.onboarded)} hint="Display name and a household" />
              <Kpi
                label="Activated"
                value={num(m.activated)}
                hint={`${pct(m.activationRate)} of registered · onboarded and one bottle added`}
              />
            </Kpis>
          </Section>
          <Section
            title="Activity"
            note="Database actions plus optional first-party events; Do Not Track never makes someone look inactive."
          >
            <Kpis>
              <Kpi label="DAU" value={num(m.active.dau)} />
              <Kpi label="WAU" value={num(m.active.wau)} />
              <Kpi label="MAU" value={num(m.active.mau)} />
              <Kpi
                label="7-day retention"
                value={pct(m.retention7d.rate)}
                hint={`${num(m.retention7d.retained)} of ${num(m.retention7d.cohort)} who signed up 7–14 days ago`}
              />
            </Kpis>
          </Section>
          <Section title="AI">
            <Kpis>
              <Kpi
                label="AI extraction success, 30 days"
                value={pct(m.aiExtraction.rate)}
                hint="Valid structured output from the label reader; not confirmed recognition accuracy"
              />
              <Kpi
                label="Estimated AI spend today"
                value={
                  costNote
                    ? "—"
                    : usd(typeof spendToday === "object" ? spendToday?.knownCostUsdMicro : null)
                }
                hint={
                  typeof spendToday === "object" && spendToday?.unknownCostCalls
                    ? `+ ${num(spendToday.unknownCostCalls)} calls with unknown cost`
                    : "UTC day · estimate, not an invoice"
                }
              />
              <Kpi
                label="Estimated AI spend this month"
                value={
                  costNote
                    ? "—"
                    : usd(typeof spendMonth === "object" ? spendMonth?.knownCostUsdMicro : null)
                }
                hint={
                  typeof spendMonth === "object" && spendMonth?.unknownCostCalls
                    ? `+ ${num(spendMonth.unknownCostCalls)} calls with unknown cost`
                    : "UTC month · estimate, not an invoice"
                }
              />
            </Kpis>
            {costNote && <p className="mt-3 text-caption text-ink-2">{costNote}</p>}
          </Section>
        </>
      )}
    </>
  );
}
