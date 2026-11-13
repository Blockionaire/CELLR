import { notFound } from "next/navigation";
import {
  identityRelation,
  parseAdminPage,
  type IdentityRelation,
  type WineType,
} from "@cellr/domain";
import {
  adminSources,
  getAdminSession,
  LINK_STATES,
  type IntelligenceMetrics,
  type LinkRow,
  type LinkState,
  type SourceOverview,
} from "@/server/admin/service";
import {
  Kpi,
  Kpis,
  Message,
  Notice,
  PageTitle,
  Pager,
  Pill,
  Section,
  Tab,
  date,
  input,
  num,
  small,
  smallDanger,
} from "../_ui";
import { decideLinkAction, disableSourceAction } from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const NOT_READY =
  "The database step for this page (supabase/migrations/20261118000041_wi06_admin_sources.sql) has not been run yet.";
const NO_SERVICE_ROLE =
  "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read.";

const RELATION: Record<IdentityRelation, { label: string; tone: "ok" | "warn" | "danger" }> = {
  same: { label: "Same producer and name", tone: "ok" },
  variant: { label: "Same wine, written differently", tone: "ok" },
  uncertain: { label: "Uncertain: look closely", tone: "warn" },
  different_cuvee: { label: "Another bottling", tone: "danger" },
  different_type: { label: "Another colour", tone: "danger" },
  different_country: { label: "Another country", tone: "danger" },
  different_producer: { label: "Another producer", tone: "danger" },
  different_wine: { label: "Another wine", tone: "danger" },
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const parseState = (v: string | undefined): LinkState =>
  (LINK_STATES as readonly string[]).includes(v ?? "") ? (v as LinkState) : "suggested";
const parseSource = (v: string | undefined) => (v && /^[a-z0-9_]{1,40}$/.test(v) ? v : null);
const href = (state: LinkState, page = 1, source: string | null = null) =>
  `/admin/sources?state=${state}${source ? `&source=${source}` : ""}${page > 1 ? `&page=${page}` : ""}#links`;

/**
 * External sources: what each is cleared for, what was imported, which links wait for a decision, and the off
 * switch. Nothing on this page can switch a source on or mark its rights as verified: that is a human decision made
 * with evidence, outside the dashboard (docs/sprints/wine-intelligence-mega/ADR-002-provider-rights.md).
 */
export default async function AdminSourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const state = parseState(first(params.state));
  const page = parseAdminPage(params.page);
  const source = parseSource(first(params.source));
  const [sources, queue, metrics] = await Promise.all([
    adminSources.overview(session),
    adminSources.links(session, state, page, PAGE_SIZE, source),
    // The counts are a convenience: if they cannot be read (or do not have the expected shape), the rest of the
    // page, the off switch included, must still work.
    adminSources.metrics(session, 30).catch(() => null),
  ]);
  const blocked =
    sources === "missing" || queue === "missing"
      ? NOT_READY
      : sources === null || queue === null
        ? NO_SERVICE_ROLE
        : null;
  if (blocked || !Array.isArray(sources) || typeof queue !== "object" || queue === null)
    return (
      <>
        <PageTitle title="External sources" crumbs={[{ label: "External sources" }]} />
        <Notice>{blocked}</Notice>
      </>
    );
  const suggested = sources.reduce((n, s) => n + s.links.suggested, 0);
  return (
    <>
      <PageTitle
        title="External sources"
        crumbs={[{ label: "External sources" }]}
        note="Wine datasets from outside CELLR: their rights, what was imported, and which of their records are the same wine as a catalogue wine."
      />
      <Message text={first(params.msg)?.slice(0, 300) ?? null} />
      <Notice testId="rights-notice">
        <span className="font-semibold">Clearing a source is a human decision.</span> Whether a
        licence allows CELLR to store, show and commercially use a dataset is checked by a person
        against the source&apos;s own terms, and recorded with evidence. No model and no import
        decides it, and this page cannot switch a source on. Here you can review links and switch a
        source off.
      </Notice>

      <Section
        title="Sources"
        note="Shown to people only when rights are verified AND the scope is public."
      >
        <Kpis>
          <Kpi label="Sources" value={num(sources.length)} />
          <Kpi
            label="Shown to people"
            value={num(sources.filter((s) => s.searchScope === "public").length)}
          />
          <Kpi label="Links to review" value={num(suggested)} />
          <Kpi label="Imports left open" value={num(sources.reduce((n, s) => n + s.openRuns, 0))} />
        </Kpis>
        {sources.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-hairline p-6 text-small text-ink-2">
            No source is registered in this database.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {sources.map((s) => (
              <SourceCard key={s.id} source={s} linksHref={href("suggested", 1, s.id)} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="links"
        title="Links between source records and catalogue wines"
        tag="Editable"
        note="An import only ever suggests a link, and only for an exact identity. Nothing is shown to people until a link is approved here. Every decision is logged with who made it and why."
      >
        {source && (
          <p className="mb-3 text-small text-ink-2" data-testid="links-filter">
            Only links of {sources.find((x) => x.id === source)?.name ?? source}.{" "}
            <a
              href={href(state)}
              className="font-medium text-accent-fg underline underline-offset-4"
            >
              Show all sources
            </a>
          </p>
        )}
        <div className="mb-4 flex flex-wrap gap-2">
          {LINK_STATES.map((s) => (
            <Tab
              key={s}
              href={href(s, 1, source)}
              current={s === state}
              count={sources
                .filter((x) => !source || x.id === source)
                .reduce((n, x) => n + x.links[s], 0)}
            >
              {s === "suggested" ? "To review" : s === "verified" ? "Approved" : "Rejected"}
            </Tab>
          ))}
        </div>
        {queue.rows.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-hairline p-6 text-small text-ink-2">
            Nothing here.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {queue.rows.map((row) => (
              <LinkCard key={row.recordId} row={row} tab={state} source={source} />
            ))}
          </ul>
        )}
        <Pager
          page={page}
          pages={Math.max(1, Math.ceil(queue.total / PAGE_SIZE))}
          href={(p) => href(state, p, source)}
        />
      </Section>

      <Section
        title="Use of search, scan matching and Koopcheck (30 days)"
        note="Counts of product events only: how often, and a few fixed labels. Like every product event they are stored with the account that sent them, but they never hold what someone typed, a wine, a source, a price, an advice or a rating, and they are not sent at all under Do Not Track. A label that is not one the app sends is counted as other."
      >
        <Metrics metrics={typeof metrics === "object" && metrics ? metrics : null} />
      </Section>
    </>
  );
}

function SourceCard({ source: s, linksHref }: { source: SourceOverview; linksHref: string }) {
  const shown = s.searchScope === "public" && s.rightsStatus === "verified";
  return (
    <li
      className="rounded-[14px] border border-hairline bg-surface p-4"
      data-testid="source-card"
      data-source={s.id}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-semibold text-ink">{s.name}</h3>
        <Pill
          tone={
            s.rightsStatus === "verified" ? "ok" : s.rightsStatus === "blocked" ? "danger" : "warn"
          }
        >
          Rights: {s.rightsStatus}
        </Pill>
        <Pill tone={shown ? "ok" : s.searchScope === "pilot" ? "warn" : "neutral"}>
          {shown ? "Shown to people" : s.searchScope === "pilot" ? "Pilot only" : "Off"}
        </Pill>
        {s.openRuns > 0 && <Pill tone="warn">{num(s.openRuns)} import open</Pill>}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-small text-ink-2 md:grid-cols-2">
        <div>
          <dt className="font-medium text-ink">Licence</dt>
          <dd>
            {s.license}
            {s.commercialUse ? "" : " · commercial use not established"}
            {s.mayDisplay ? "" : " · may not be displayed"}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Evidence for the rights</dt>
          <dd>
            {s.rightsEvidence ?? "None recorded."}
            {s.rightsVerifiedAt
              ? ` Verified ${date(s.rightsVerifiedAt)} by ${s.rightsVerifiedBy ?? "unknown"}.`
              : ""}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Records</dt>
          <dd>
            {num(s.records.active)} active · {num(s.records.withdrawn)} withdrawn
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Links</dt>
          <dd>
            {num(s.links.suggested)} to review · {num(s.links.verified)} approved ·{" "}
            {num(s.links.rejected)} rejected ·{" "}
            <a href={linksHref} className="font-medium text-accent-fg underline underline-offset-4">
              Review this source&apos;s links
            </a>
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Last complete import</dt>
          <dd>
            {s.lastImport
              ? `${s.lastImport.datasetVersion ?? "no version"} · finished ${date(s.lastImport.finishedAt)} · file retrieved ${date(s.lastImport.retrievedAt)}${s.lastImport.pilot ? " · pilot run" : ""}`
              : "None."}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Imports that did not finish</dt>
          <dd>
            {s.abandonedRuns.length === 0
              ? "None."
              : s.abandonedRuns
                  .map((r) => `${date(r.at)}: ${r.reason ?? "no reason recorded"}`)
                  .join(" · ")}
          </dd>
        </div>
      </dl>
      {s.log.length > 0 && (
        <details className="mt-3 text-small text-ink-2">
          <summary className="cursor-pointer font-medium text-ink">
            Rights history ({s.log.length} latest)
          </summary>
          <ol className="mt-2 flex flex-col gap-1.5">
            {s.log.map((l) => (
              <li key={`${l.at}-${l.reason}`}>
                {date(l.at)} · {l.actor}: {l.from.rightsStatus ?? "new"} /{" "}
                {l.from.searchScope ?? "—"} → {l.to.rightsStatus ?? "?"} / {l.to.searchScope ?? "?"}{" "}
                · “{l.reason}”
              </li>
            ))}
          </ol>
        </details>
      )}
      {(s.searchScope !== "off" || s.rightsStatus !== "blocked") && (
        <form
          action={disableSourceAction}
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-hairline pt-4"
        >
          <input type="hidden" name="providerId" value={s.id} />
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-small text-ink-2">
            Reason for switching {s.name} off (logged)
            <input name="reason" required minLength={3} maxLength={400} className={input} />
          </label>
          <label className="flex items-center gap-2 text-small text-ink-2">
            <input type="checkbox" name="block" /> Also block further imports
          </label>
          <button type="submit" className={smallDanger}>
            Switch off
          </button>
        </form>
      )}
    </li>
  );
}

function Facts({
  title,
  facts,
  extra,
}: {
  title: string;
  facts: {
    producer: string;
    name: string;
    type: string | null;
    countryCode: string | null;
    region: string | null;
    appellation: string | null;
  };
  extra?: string | null;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-[10px] bg-raised p-3">
      <p className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</p>
      <p className="mt-1 text-small text-ink-2">{facts.producer}</p>
      <p className="text-body font-medium text-ink">{facts.name}</p>
      <p className="text-small text-ink-2">
        {[
          facts.type ?? "type unknown",
          facts.countryCode ?? "country unknown",
          facts.region,
          facts.appellation,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {extra && <p className="mt-1 text-small text-ink-3">{extra}</p>}
    </div>
  );
}

function LinkCard({ row, tab, source }: { row: LinkRow; tab: LinkState; source: string | null }) {
  const compared = identityRelation(
    {
      producer: row.record.producer,
      name: row.record.name,
      type: row.record.type as WineType | null,
      countryCode: row.record.countryCode,
    },
    {
      producer: row.wine.producer,
      name: row.wine.name,
      type: row.wine.type as WineType | null,
      countryCode: row.wine.countryCode,
    },
  );
  const relation = RELATION[compared.relation];
  const viaAlias =
    compared.relation !== "same" &&
    row.wine.aliases.some(
      (a) =>
        identityRelation(
          { producer: row.record.producer, name: row.record.name },
          { producer: row.wine.producer, name: a },
        ).relation === "same",
    );
  return (
    <li
      className="rounded-[14px] border border-hairline bg-surface p-4"
      data-testid="link-card"
      data-record={row.externalId}
    >
      <div className="flex flex-wrap items-center gap-2 text-small text-ink-2">
        <span className="font-medium text-ink">{row.provider.name}</span>
        <span>record {row.externalId}</span>
        <Pill tone={relation.tone}>{relation.label}</Pill>
        {viaAlias && <Pill tone="ok">Matches a verified alias</Pill>}
        {row.recordStatus === "withdrawn" && <Pill tone="warn">Withdrawn by the source</Pill>}
        {row.sameSourceLinks > 0 && (
          <Pill tone="warn">
            {num(row.sameSourceLinks)} other record of this source on the same wine
          </Pill>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-3 md:flex-row">
        <Facts
          title="The source's record"
          facts={row.record}
          extra={
            row.record.vintages.length > 0
              ? `Vintages listed: ${row.record.vintages.slice(0, 12).join(", ")}${row.record.vintages.length > 12 ? "…" : ""}`
              : null
          }
        />
        <Facts
          title="CELLR catalogue wine"
          facts={row.wine}
          extra={
            row.wine.aliases.length > 0 ? `Also known as: ${row.wine.aliases.join(", ")}` : null
          }
        />
      </div>
      {(compared.onlyInA.length > 0 || compared.onlyInB.length > 0) && (
        <p className="mt-2 text-small text-ink-2" data-testid="link-differences">
          Words only in the record: {compared.onlyInA.join(", ") || "none"} · only in the catalogue
          wine: {compared.onlyInB.join(", ") || "none"}
          {compared.discriminators.length > 0
            ? ` · words that usually mean another bottling: ${compared.discriminators.join(", ")}`
            : ""}
        </p>
      )}
      {row.reason && (
        <p className="mt-2 text-small text-ink-2">
          Note: {row.reason}
          {row.decidedAt ? ` (${date(row.decidedAt)})` : ""}
        </p>
      )}
      <form action={decideLinkAction} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="recordId" value={row.recordId} />
        <input type="hidden" name="wineId" value={row.wine.id} />
        <input type="hidden" name="tab" value={tab} />
        {source && <input type="hidden" name="source" value={source} />}
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-small text-ink-2">
          Reason (logged)
          <input name="reason" required minLength={3} maxLength={400} className={input} />
        </label>
        {row.state !== "verified" && (
          <button type="submit" name="state" value="verified" className={small}>
            Approve
          </button>
        )}
        {row.state !== "rejected" && (
          <button type="submit" name="state" value="rejected" className={smallDanger}>
            Reject
          </button>
        )}
        {row.state === "suggested" && (
          <button type="submit" name="state" value="investigate" className={small}>
            Needs investigation
          </button>
        )}
      </form>
    </li>
  );
}

const spread = (counts: Record<string, number>) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k.replace(/_/g, " ")}: ${num(n)}`)
    .join(" · ") || "none";

function Metrics({ metrics }: { metrics: IntelligenceMetrics | null }) {
  if (!metrics)
    return (
      <p className="rounded-[14px] border border-dashed border-hairline p-6 text-small text-ink-2">
        No counts available.
      </p>
    );
  const { search, purchaseCheck, scan } = metrics;
  return (
    <div className="flex flex-col gap-4" data-testid="wi-metrics">
      <Kpis>
        <Kpi
          label="Search fields used"
          value={num(search?.sessions ?? 0)}
          hint={`${num(search?.requests ?? 0)} requests`}
        />
        <Kpi label="Ended with a choice" value={num(search?.withSelection ?? 0)} />
        <Kpi label="Had an empty result" value={num(search?.zeroResult ?? 0)} />
        <Kpi
          label="Hit the rate limit / failed"
          value={`${num(search?.limited ?? 0)} / ${num(search?.failed ?? 0)}`}
        />
        <Kpi label="Koopchecks completed" value={num(purchaseCheck?.completed ?? 0)} />
        <Kpi label="Scans completed" value={num(scan?.completed ?? 0)} />
      </Kpis>
      <dl className="grid gap-x-6 gap-y-2 text-small text-ink-2 md:grid-cols-2">
        <div>
          <dt className="font-medium text-ink">Search: where</dt>
          <dd>{spread(search?.bySurface ?? {})}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Search: what was chosen</dt>
          <dd>{spread(search?.bySource ?? {})}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Search: place of the chosen result</dt>
          <dd>{spread(search?.byRank ?? {})}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Search: slowest answer per field</dt>
          <dd>{spread(search?.bySlowest ?? {})}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Koopcheck: what CELLR already knew</dt>
          <dd>{spread(purchaseCheck?.byKnowledge ?? {})}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Koopcheck: how the wine was entered</dt>
          <dd>{spread(purchaseCheck?.byEntry ?? {})}</dd>
        </div>
        <div>
          <dt className="font-medium text-ink">Scan: how the match ended (resolver on)</dt>
          <dd>{spread(scan?.byResolution ?? {})}</dd>
        </div>
      </dl>
    </div>
  );
}
