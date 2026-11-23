import {
  Activity,
  Bot,
  ChevronRight,
  Database,
  Images,
  ListChecks,
  Network,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HEALTH_STATUS_LABEL, type HealthStatus, type WorkQueue } from "@cellr/domain";
import { HEALTH_GLYPH, age, headline } from "@/features/admin/system/health-model";
import { adminHealth, adminOverview, getAdminSession } from "@/server/admin/service";
import { cn } from "@/ui/cn";
import {
  Kpi,
  Kpis,
  Notice,
  PageTitle,
  Pill,
  Section,
  num,
  pct,
  unavailable,
  usd,
  type Tone,
} from "./_ui";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const session = await getAdminSession();
  if (!session) notFound();
  // health is read with a short limit and never throws: when monitoring is down the overview still renders
  const [{ metrics: m, spendToday, spendMonth, queue }, health] = await Promise.all([
    adminOverview(session),
    adminHealth(session, { timeoutMs: 1_500, history: false }),
  ]);
  const costNote = unavailable(spendToday);
  return (
    <>
      <PageTitle
        title="Overview"
        note="Whether CELLR works, what waits for you, then the platform's numbers. Definitions as in docs/METRICS.md. Activity windows are rolling, in UTC. A rate shows as unavailable when there is nothing to divide by."
      />
      <CellrStatus health={health} />
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
      <QuickActions />
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
    <ul
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-5"
      data-testid="work-queue"
    >
      {items.map((i, n) => (
        <li key={i.label}>
          {/* a phone: one row per item, the count on the right; wider: a tile */}
          <Link
            href={i.href}
            prefetch={false}
            className={cn(
              "flex h-full items-center gap-3 rounded-[14px] border bg-surface px-4 py-3 transition-colors hover:border-ink-3 hover:bg-raised sm:flex-col sm:items-stretch sm:gap-0 sm:p-4",
              i.value > 0 && n < 3 ? "border-accent-fg" : "border-hairline",
            )}
          >
            <span className="min-w-0 flex-1 sm:flex-none">
              <span className="block text-small font-medium text-ink">{i.label}</span>
              <span className="block text-caption text-ink-2 sm:hidden">{i.hint}</span>
            </span>
            <span className="font-display text-title tnum text-ink sm:mt-1 sm:text-display">
              {num(i.value)}
            </span>
            <span className="hidden pt-1 text-caption text-ink-2 sm:mt-auto sm:block">
              {i.hint} <span aria-hidden="true">→</span>
            </span>
            <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-3 sm:hidden" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const TONE: Record<HealthStatus, Tone> = {
  healthy: "ok",
  degraded: "warn",
  failed: "danger",
  unknown: "neutral",
};

const MONITOR: Record<string, string> = {
  running: "Monitoring runs on schedule",
  late: "Monitoring is late: the last round is older than one interval",
  failing: "Monitoring is failing: the newest round could not be recorded",
  stopped: "Monitoring has stopped: no round in the last 30 minutes",
  never: "Monitoring has never run here",
};

const UNAVAILABLE: Record<string, string> = {
  not_installed: "Health is not measured here yet (migration 0047 is not applied).",
  not_configured: "Health cannot be read: the service role is not configured.",
  error: "Health could not be read. That can itself mean the database is in trouble.",
  timeout: "Health did not arrive in time. That can itself mean the database is in trouble.",
};

/**
 * Is CELLR working? The newest health judgement, how fresh it is, and the way to System › Health. Unknown and stale
 * stay unknown (never shown as healthy); when health cannot be read, the card says so and the page goes on.
 */
function CellrStatus({ health }: { health: Awaited<ReturnType<typeof adminHealth>> }) {
  if (health.state === "unavailable")
    return (
      <Link
        href="/admin/system/health"
        prefetch={false}
        data-testid="overview-status"
        data-status="unknown"
        className="mb-6 flex items-center gap-3 rounded-[18px] border border-hairline bg-surface p-4 hover:bg-raised"
      >
        <Pill tone="neutral">
          <span aria-hidden="true" className="mr-1">
            ?
          </span>
          Unknown
        </Pill>
        <span className="min-w-0 flex-1 text-small text-ink-2">{UNAVAILABLE[health.reason]}</span>
        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-3" />
      </Link>
    );
  const o = health.overview;
  const head = headline(o.counts);
  const fresh = o.monitor.state === "running";
  return (
    <Link
      href="/admin/system/health"
      prefetch={false}
      data-testid="overview-status"
      data-status={head.status}
      data-monitor={o.monitor.state}
      className="mb-6 block rounded-[18px] border border-hairline bg-surface p-4 transition-colors hover:bg-raised"
    >
      <span className="flex items-center gap-2">
        <span className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-3">
          CELLR status
        </span>
        <ChevronRight size={18} aria-hidden="true" className="ml-auto shrink-0 text-ink-3" />
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-2">
        <Pill tone={TONE[head.status]}>
          <span aria-hidden="true" className="mr-1">
            {HEALTH_GLYPH[head.status]}
          </span>
          {HEALTH_STATUS_LABEL[head.status]}
        </Pill>
        <span className="min-w-0 text-body font-semibold text-ink">{head.text}</span>
      </span>
      <span
        className={cn("mt-2 block text-small", fresh ? "text-ink-2" : "font-medium text-peak-ink")}
      >
        {!fresh && (
          <span aria-hidden="true" className="mr-1">
            !
          </span>
        )}
        {MONITOR[o.monitor.state] ?? "Monitoring state unknown"}
        {o.monitor.lastRound?.finishedAt ? ` · last measured ${age(o.monitor.ageSec)}` : ""}.
      </span>
      <span className="mt-1 block text-small font-medium text-accent-fg">Open Health</span>
    </Link>
  );
}

const ACTIONS: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/admin/wines", label: "Wine Master Database", icon: Database },
  { href: "/admin/bottle-photos", label: "Bottle photos", icon: Images },
  { href: "/admin/catalog/corrections", label: "Corrections", icon: ListChecks },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/ai", label: "AI & costs", icon: Bot },
  { href: "/admin/system", label: "Architecture", icon: Network },
  { href: "/admin/system/health", label: "Health", icon: Activity },
];

function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="mb-8" data-testid="quick-actions">
      <h2 className="mb-2 text-caption font-semibold uppercase tracking-[0.08em] text-ink-3">
        Quick actions
      </h2>
      <ul className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
        {ACTIONS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              prefetch={false}
              className="flex h-full min-h-14 items-center gap-2.5 rounded-[14px] border border-hairline bg-surface px-3 py-2.5 text-small font-medium text-ink transition-colors hover:border-ink-3 hover:bg-raised"
            >
              <Icon size={18} aria-hidden="true" className="shrink-0 text-accent-fg" />
              <span className="min-w-0">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
