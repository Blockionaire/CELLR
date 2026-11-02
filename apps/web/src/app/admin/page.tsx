import Link from "next/link";
import { notFound } from "next/navigation";
import type { WorkQueue } from "@cellr/domain";
import { adminOverview, getAdminSession } from "@/server/admin/service";
import { cn } from "@/ui/cn";
import { Kpi, Kpis, Notice, PageTitle, Section, num, pct, unavailable, usd } from "./_ui";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const session = await getAdminSession();
  if (!session) notFound();
  const { metrics: m, spendToday, spendMonth, queue } = await adminOverview(session);
  const costNote = unavailable(spendToday);
  return (
    <>
      <PageTitle
        title="Overview"
        note="What waits for you first, then the platform's numbers. Definitions as in docs/METRICS.md. Activity windows are rolling, in UTC. A rate shows as unavailable when there is nothing to divide by."
      />
      <Section title="Work queue" note="Each item opens the list it counts, already filtered.">
        {queue && queue !== "missing" ? (
          <Queue q={queue} />
        ) : (
          <Notice tone="warn">
            {queue === "missing"
              ? "The work queue needs 20261111000034_admin_portal_workflow.sql."
              : "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read."}
          </Notice>
        )}
      </Section>
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

function Queue({ q }: { q: WorkQueue }) {
  const items = [
    {
      label: "Bottle photos awaiting review",
      value: q.photosPending,
      href: "/admin/bottle-photos?stage=pending",
      hint: "Approve or reject",
    },
    {
      label: "Approved contributions awaiting artwork",
      value: q.artworkNeeded,
      href: "/admin/bottle-photos?stage=artwork_needed",
      hint: "Create and upload the 2D artwork",
    },
    {
      label: "Artwork drafts awaiting publication",
      value: q.artDrafts,
      href: "/admin/wines?art=draft",
      hint: `${num(q.photosWithDraft)} approved ${q.photosWithDraft === 1 ? "photo waits" : "photos wait"} on them`,
    },
    {
      label: "Catalogue wines with open corrections",
      value: q.corrections,
      href: "/admin/catalog/corrections",
      hint: "Signals from scans to review",
    },
    {
      label: "Catalogue wines without artwork",
      value: q.catalogueWithoutArt,
      href: "/admin/wines?scope=catalogue&art=missing",
      hint: "Shown with the drawn bottle",
    },
  ];
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="work-queue">
      {items.map((i, n) => (
        <li key={i.label}>
          <Link
            href={i.href}
            prefetch={false}
            className={cn(
              "flex h-full flex-col rounded-[14px] border bg-surface p-4 transition-colors hover:border-ink-3 hover:bg-raised",
              i.value > 0 && n < 3 ? "border-accent-fg" : "border-hairline",
            )}
          >
            <span className="text-small font-medium text-ink">{i.label}</span>
            <span className="mt-1 font-display text-display tnum text-ink">{num(i.value)}</span>
            <span className="mt-auto pt-1 text-caption text-ink-2">
              {i.hint} <span aria-hidden="true">→</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
