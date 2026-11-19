import { notFound } from "next/navigation";
import {
  HEALTH_STATUS_LABEL,
  PROBE_KIND_LABEL,
  type HealthStatus,
  type ProbeHealth,
  type ProbeKind,
} from "@cellr/domain";
import {
  HEALTH_COLOR,
  HEALTH_GLYPH,
  age,
  headline,
  historyStrip,
  reasonText,
} from "@/features/admin/system/health-model";
import {
  adminArchitecture,
  adminHealth,
  adminHealthConfig,
  getAdminSession,
} from "@/server/admin/service";
import { cn } from "@/ui/cn";
import { Notice, PageTitle, Pill, Section, failed, link, quiet, type Tone } from "../../_ui";
import { measureNowAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * System › Health (System Intelligence sprint 2): what the monitor measured, judged now. Server-rendered, read with a
 * hard limit: when monitoring is down this page says so and the rest of the admin (and the map) is unaffected.
 * Missing or stale measurements read unknown, never healthy; every check says what it does not prove.
 */
const TONE: Record<HealthStatus, Tone> = {
  healthy: "ok",
  degraded: "warn",
  failed: "danger",
  unknown: "neutral",
};

const UNAVAILABLE = {
  not_installed:
    "The health database step (supabase/migrations/20261124000047_system_health.sql) has not been applied to this database, so nothing is measured or stored yet.",
  not_configured:
    "SUPABASE_SERVICE_ROLE_KEY is not configured on this server, so the monitor can neither measure nor read.",
  error:
    "The stored measurements could not be read. That can itself mean the database is in trouble.",
  timeout:
    "The stored measurements did not arrive within 4 seconds. That can itself mean the database is in trouble.",
} as const;

const MONITOR_TEXT = {
  running: "Running: rounds arrive on schedule.",
  late: "Late: the last round is older than one interval.",
  stopped:
    "Stopped: no round in the last 30 minutes. Every check below reads unknown until rounds come again.",
  never: "Never ran: no round has been recorded here yet.",
} as const;

const KIND_ORDER: readonly ProbeKind[] = [
  "monitor",
  "infrastructure",
  "job",
  "traffic",
  "delivery",
];

function Status({ status }: { status: HealthStatus }) {
  return (
    <Pill tone={TONE[status]}>
      <span aria-hidden="true" className="mr-1">
        {HEALTH_GLYPH[status]}
      </span>
      {HEALTH_STATUS_LABEL[status]}
    </Pill>
  );
}

export default async function AdminSystemHealthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const message = typeof params.msg === "string" ? params.msg.slice(0, 300) : null;
  const [view, config] = [await adminHealth(session), adminHealthConfig(session)];
  const names = new Map(adminArchitecture(session).registry.components.map((c) => [c.id, c.name]));

  return (
    <>
      <PageTitle
        title="Health"
        crumbs={[{ label: "System", href: "/admin/system" }, { label: "Health" }]}
        note="What the monitor measured, judged now. A check proves only what it measures: a pass means that aspect answered, not that the feature works for people. Missing or old measurements show as unknown, never as healthy."
      >
        <form action={measureNowAction}>
          <button type="submit" className={quiet}>
            Measure now
          </button>
        </form>
      </PageTitle>
      {message && (
        <Notice tone={failed(message) ? "warn" : "ok"} testId="health-message">
          {message}
        </Notice>
      )}

      {view.state === "unavailable" ? (
        <Notice tone="warn" testId="health-unavailable">
          <p className="font-semibold text-ink">Health is not available</p>
          <p className="mt-1">{UNAVAILABLE[view.reason]}</p>
          <p className="mt-1">
            The architecture map and the rest of CELLR are not affected. The external heartbeat and
            uptime check (below) are what notice a full outage.
          </p>
        </Notice>
      ) : (
        <Board view={view} names={names} />
      )}

      <Section
        title="Outside CELLR: who notices a full outage"
        id="outside"
        tag="Read-only"
        note="This page runs inside CELLR, so it cannot report CELLR being down. These run outside it; their state is set in GitHub and the server's settings (OPERATIONS.md)."
      >
        <ul className="grid gap-2 text-small sm:grid-cols-2" data-testid="health-config">
          <ConfigItem
            on={config.cronSecret}
            title="Heartbeat (GitHub Actions, every 10 min)"
            yes="This server accepts the heartbeat (CRON_SECRET is set). Whether it arrives shows as the monitor's state above; a failed heartbeat run notifies by GitHub's own e-mail."
            no="CRON_SECRET is not set: the heartbeat cannot start rounds."
          />
          <ConfigItem
            on={config.pingUrl}
            title="Dead man's switch (uptime provider)"
            yes="After every recorded round the monitor calls the configured URL; the provider alerts when the calls stop."
            no="Not configured (CELLR_HEALTH_PING_URL). Planned with the uptime provider in sprint 3."
          />
          <ConfigItem
            on={config.readyToken}
            title="Readiness check (/api/health/ready)"
            yes="Open to an uptime provider with its token: one word, 503 when the monitor stopped or infrastructure failed."
            no="Not configured (CELLR_HEALTH_READY_TOKEN): the endpoint answers 404."
          />
          <ConfigItem
            on={config.github && config.vercel}
            title="CI and deployment status"
            yes="Read from GitHub and Vercel with read-only tokens."
            no={`Not configured${config.github ? " for Vercel" : config.vercel ? " for GitHub" : ""}: those checks read unknown.`}
          />
        </ul>
      </Section>
    </>
  );
}

function ConfigItem({
  on,
  title,
  yes,
  no,
}: {
  on: boolean;
  title: string;
  yes: string;
  no: string;
}) {
  return (
    <li className="rounded-[14px] border border-hairline bg-surface p-3">
      <p className="flex items-center gap-2 font-semibold text-ink">
        <Pill tone={on ? "ok" : "neutral"}>{on ? "Configured" : "Not configured"}</Pill>
        {title}
      </p>
      <p className="mt-1 text-caption text-ink-2">{on ? yes : no}</p>
    </li>
  );
}

type Available = Extract<Awaited<ReturnType<typeof adminHealth>>, { state: "available" }>;

function Board({ view, names }: { view: Available; names: ReadonlyMap<string, string> }) {
  const o = view.overview;
  const now = new Date(o.now);
  const head = headline(o.counts);
  const measured = new Set(o.components.map((c) => c.componentId));
  const unmeasured = [...names].filter(([id]) => !measured.has(id));
  return (
    <>
      <div
        className="mb-6 rounded-[18px] border border-hairline bg-surface p-4"
        data-testid="health-headline"
        data-status={head.status}
        data-monitor={o.monitor.state}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Status status={head.status} />
          <p className="text-title font-semibold text-ink">{head.text}</p>
        </div>
        <p
          className={cn(
            "mt-2 text-small",
            o.monitor.state === "running" ? "text-ink-2" : "font-medium text-peak-ink",
          )}
          data-testid="health-monitor"
        >
          Monitor: {MONITOR_TEXT[o.monitor.state]}
          {o.monitor.lastRound?.finishedAt &&
            ` Last round ${age(o.monitor.ageSec)} (${o.monitor.lastRound.trigger}${o.monitor.lastRound.outcome === "partial" ? ", some checks could not run" : ""}).`}
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-small text-ink-2">
          {(["failed", "degraded", "unknown", "healthy"] as const).map((s) => (
            <div key={s} className="flex items-center gap-1.5">
              <dt>{HEALTH_STATUS_LABEL[s]}</dt>
              <dd className="font-semibold text-ink tnum">{o.counts[s]}</dd>
            </div>
          ))}
        </dl>
      </div>

      {KIND_ORDER.map((kind) => {
        const probes = o.probes.filter((p) => p.probe.kind === kind);
        if (!probes.length) return null;
        return (
          <Section key={kind} title={PROBE_KIND_LABEL[kind]} id={`kind-${kind}`}>
            <ul className="space-y-2">
              {probes.map((p) => (
                <ProbeRow
                  key={p.probe.id}
                  p={p}
                  names={names}
                  strip={historyStrip(view.history, p.probe.id, now)}
                />
              ))}
            </ul>
          </Section>
        );
      })}

      <Section
        title="Components"
        id="components"
        note="A component is as healthy as the worst of its checks, and unknown when any of them has no current measurement."
      >
        <ul className="flex flex-wrap gap-2" data-testid="health-components">
          {o.components.map((c) => (
            <li
              key={c.componentId}
              data-component={c.componentId}
              data-status={c.status}
              className="flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1 text-small"
            >
              <Status status={c.status} />
              <span className="text-ink">{names.get(c.componentId) ?? c.componentId}</span>
            </li>
          ))}
        </ul>
        <details className="mt-3 text-small text-ink-2">
          <summary className="cursor-pointer font-medium text-ink">
            {unmeasured.length} components no check measures
          </summary>
          <p className="mt-2">
            They are not healthy or unhealthy here: nothing measures them. Their state shows only
            through the components they depend on.
          </p>
          <p className="mt-1">{unmeasured.map(([, n]) => n).join(" · ")}</p>
        </details>
        <p className="mt-3 text-small">
          <a href="/admin/system" className={link}>
            See them on the architecture map
          </a>
        </p>
      </Section>
    </>
  );
}

function ProbeRow({
  p,
  names,
  strip,
}: {
  p: ProbeHealth;
  names: ReadonlyMap<string, string>;
  strip: ReturnType<typeof historyStrip>;
}) {
  const facts = Object.entries(p.detail).filter(([, v]) => v !== null);
  return (
    <li
      className="rounded-[14px] border border-hairline bg-surface p-3"
      data-probe={p.probe.id}
      data-status={p.status}
      data-reason={p.reason}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Status status={p.status} />
        <span className="font-semibold text-ink">{p.probe.label}</span>
        <span className="text-caption text-ink-2">{reasonText(p.reason)}</span>
        <span className="ml-auto text-caption text-ink-2 tnum">
          {p.latencyMs !== null && `${p.latencyMs} ms · `}
          {p.measuredAt ? `measured ${age(p.ageSec)}` : "never measured"}
          {p.status === "unknown" && p.lastStatus && p.reason === "stale"
            ? ` · last said ${HEALTH_STATUS_LABEL[p.lastStatus].toLowerCase()}`
            : ""}
        </span>
      </div>
      <div
        className="mt-2 flex h-3 gap-px"
        role="img"
        aria-label={`Last 24 hours: ${strip.filter((s) => s.status === null).length} of ${strip.length} half-hours without a measurement`}
      >
        {strip.map((s) => (
          <span
            key={s.from}
            title={`${s.from.slice(11, 16)} UTC: ${s.status ? HEALTH_STATUS_LABEL[s.status] : "no measurement"}`}
            className={cn("flex-1 rounded-[2px]", !s.status && "border border-hairline")}
            style={s.status ? { background: HEALTH_COLOR[s.status] } : undefined}
          />
        ))}
      </div>
      <details className="mt-2 text-caption text-ink-2">
        <summary className="cursor-pointer">
          Speaks for {p.probe.components.map((c) => names.get(c) ?? c).join(", ")}
          {facts.length > 0 &&
            ` · ${facts.map(([k, v]) => `${k} ${typeof v === "boolean" ? (v ? "yes" : "no") : v}`).join(", ")}`}
        </summary>
        <p className="mt-1">
          <span className="font-semibold text-ink">Proves:</span> {p.probe.proves}
        </p>
        <p className="mt-1">
          <span className="font-semibold text-ink">Does not prove:</span> {p.probe.doesNotProve}
        </p>
      </details>
    </li>
  );
}
