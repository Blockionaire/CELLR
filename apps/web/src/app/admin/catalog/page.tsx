import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CANDIDATE_SORTS,
  CATALOG_REVIEW,
  LEARNING_MODES,
  parseCandidateSort,
  parseCandidateState,
  type CandidateSort,
  type CandidateState,
} from "@cellr/domain";
import { adminCatalog, getAdminSession } from "@/server/admin/service";
import { cn } from "@/ui/cn";
import { Kpi, Kpis, Notice, PageTitle, Section, Table, date, num } from "../_ui";
import { setModeAction } from "./actions";
import { STATE_LABEL } from "./labels";

export const dynamic = "force-dynamic";

const FILTERS: Array<CandidateState | "open" | "all"> = [
  "open",
  "review_ready",
  "conflict",
  "collecting",
  "approved",
  "rejected",
  "all",
];
const SORT_LABEL: Record<CandidateSort, string> = {
  households: "Most households",
  recent: "Latest confirmation",
  producer: "Producer",
};
const MODE_LABEL = {
  off: "Off: nothing is collected",
  opt_out: "On for everyone who did not say no (opt-out)",
  opt_in: "On only for people who said yes (opt-in)",
} as const;

const href = (state: string, sort: string) => `/admin/catalog?state=${state}&sort=${sort}`;

/**
 * Catalogue learning: wines households confirmed, grouped as candidates for the shared catalogue, with counts of
 * independent households (never which ones). Nothing is published from here without an explicit approval.
 */
export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const state = parseCandidateState(params.state);
  const sort = parseCandidateSort(params.sort);
  const message = typeof params.msg === "string" ? params.msg.slice(0, 300) : null;
  const data = await adminCatalog(session, state, sort);
  if (!data.ready)
    return (
      <>
        <PageTitle title="Wine catalogue" />
        <Notice>
          {data.reason === "missing"
            ? "The catalogue-learning database step (supabase/migrations/20261101000024_catalog_learning.sql) has not been run yet."
            : "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read."}
        </Notice>
      </>
    );
  return (
    <>
      <PageTitle
        title="Wine catalogue"
        note={`Wines households confirmed, grouped as candidates. A candidate asks for review from ${CATALOG_REVIEW.ready} independent households that confirmed it from a label (typed wines are shown apart and never count). Nothing is published without your approval; automatic publication is off.`}
      />
      {message && <Notice>{message}</Notice>}

      <Section
        title="Collection"
        note="Today CELLR tells people that nothing but the label photo is shared. Before switching this on, update the privacy text and decide opt-out or opt-in (docs/CATALOG.md, Catalogue learning)."
      >
        <form action={setModeAction} className="flex flex-wrap items-end gap-3 text-small">
          <label className="flex flex-col gap-1">
            <span className="text-ink-2">Catalogue learning</span>
            <select
              name="mode"
              defaultValue={data.mode}
              className="rounded-[10px] bg-surface px-3 py-2 ring-1 ring-hairline"
            >
              {LEARNING_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-full bg-ink px-4 py-2 text-canvas">
            Save
          </button>
        </form>
      </Section>

      <Section title="Overview">
        <Kpis>
          <Kpi label="Ready for review" value={num(data.counts.review_ready)} />
          <Kpi label="Collecting" value={num(data.counts.collecting)} />
          <Kpi label="Conflicts" value={num(data.counts.conflict)} />
          <Kpi label="Approved" value={num(data.counts.approved)} />
          <Kpi label="Rejected" value={num(data.counts.rejected)} />
          <Kpi
            label="Catalogue"
            value={data.catalog ? `${num(data.catalog.wines)} wines` : "—"}
            {...(data.catalog ? { hint: `${num(data.catalog.producers)} producers` } : {})}
          />
          <Kpi label="Shared wine profiles" value={num(data.sharedProfiles)} />
        </Kpis>
      </Section>

      <nav aria-label="State" className="mb-2 flex flex-wrap gap-2 text-small">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={href(f, sort)}
            prefetch={false}
            aria-current={f === state ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 ring-1 ring-hairline",
              f === state ? "bg-raised text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {f === "open" ? "All open" : f === "all" ? "Everything" : STATE_LABEL[f]}
          </Link>
        ))}
      </nav>
      <nav aria-label="Sort" className="mb-4 flex flex-wrap gap-3 text-caption text-ink-2">
        Sort:
        {CANDIDATE_SORTS.map((s) => (
          <Link
            key={s}
            href={href(state, s)}
            prefetch={false}
            aria-current={s === sort ? "true" : undefined}
            className={s === sort ? "text-ink underline" : "hover:text-ink"}
          >
            {SORT_LABEL[s]}
          </Link>
        ))}
      </nav>
      <Table
        head={[
          { label: "Wine" },
          { label: "Type · origin" },
          { label: "Vintages" },
          { label: "Households", numeric: true },
          { label: "State" },
          { label: "Sources", numeric: true },
          { label: "Last confirmed" },
        ]}
        rows={data.rows.map((r) => ({
          key: r.id,
          cells: [
            <Link
              key="w"
              href={`/admin/catalog/${r.id}`}
              prefetch={false}
              className="text-accent-ink"
            >
              {r.producer} — {r.name}
            </Link>,
            [r.type, r.country, r.region].filter(Boolean).join(" · "),
            r.vintages.map((y) => (y === null ? "NV" : String(y))).join(", ") || "—",
            `${num(r.scanHouseholds)} label${r.manualHouseholds ? ` (+${num(r.manualHouseholds)} typed)` : ""}`,
            `${STATE_LABEL[r.state]}${r.priority === "high" ? " · high priority" : ""}`,
            `${num(r.verifiedSources)}/${num(r.sources)}`,
            date(r.lastConfirmedAt),
          ],
        }))}
        empty="No candidates here."
      />
    </>
  );
}
