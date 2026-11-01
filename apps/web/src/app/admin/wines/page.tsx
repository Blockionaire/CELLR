import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MASTER_FLAGS,
  WINE_VISUAL_SCOPES,
  parseMasterFlags,
  parseMasterPage,
  parseMasterScope,
  type MasterFlag,
  type WineVisualScope,
} from "@cellr/domain";
import { adminWineMaster, getAdminSession } from "@/server/admin/service";
import { cn } from "@/ui/cn";
import { Kpi, Kpis, Notice, PageTitle, Table, num } from "../_ui";

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<WineVisualScope, string> = {
  all: "All wines",
  catalogue: "Canonical (catalogue)",
  household: "Household wines",
};
const FLAG_LABEL: Record<MasterFlag, string> = {
  art: "Has published 2D",
  no_art: "Missing published 2D",
  pending: "Pending photos",
  corrections: "Open corrections",
  linked: "Linked to catalogue",
  unlinked: "Household, not linked",
};

/**
 * The Wine Master Database: every wine in CELLR (the catalogue's and every household's own) in one list, searched,
 * filtered and paged in the database in a fixed order (producer, wine, id), so it stays quick at 100k+ wines.
 * The old "Wine visuals" links (?scope=…&filter=…) keep working.
 */
export default async function AdminWinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const scope = parseMasterScope(params.scope);
  const flags = parseMasterFlags(params.f, params.filter);
  const page = parseMasterPage(params.page);
  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const data = await adminWineMaster(session, scope, flags, q, page);
  const href = (next: { scope?: string; flags?: MasterFlag[]; page?: number }) => {
    const s = new URLSearchParams({ scope: next.scope ?? scope });
    const f = next.flags ?? flags;
    if (f.length) s.set("f", f.join(","));
    if (q) s.set("q", q);
    if ((next.page ?? 1) > 1) s.set("page", String(next.page));
    return `/admin/wines?${s.toString()}`;
  };
  const toggle = (f: MasterFlag) =>
    flags.includes(f) ? flags.filter((x) => x !== f) : [...flags, f];
  if (!data.ready)
    return (
      <>
        <PageTitle title="Wine Master Database" />
        <Notice>
          {data.reason === "missing"
            ? "Not available yet: run 20261107000030_wine_master.sql."
            : "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read."}
        </Notice>
      </>
    );
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  const c = data.counts;
  return (
    <>
      <PageTitle
        title="Wine Master Database"
        note="Every wine: the shared catalogue and each household's own. A catalogue wine's details and pictures are shared with everyone who has it; a household wine belongs to that household only."
      >
        <Link href="/admin/bottle-photos" prefetch={false} className="text-small text-accent-ink">
          Bottle photos →
        </Link>
      </PageTitle>
      <Kpis>
        <Kpi label="All wines" value={num(c.all)} />
        <Kpi label="Catalogue" value={num(c.catalogue)} />
        <Kpi label="Household" value={num(c.household)} />
        <Kpi label="Published 2D" value={num(c.published)} />
        <Kpi label="With pending photos" value={num(c.pending)} />
        <Kpi label="With open corrections" value={num(c.corrections)} />
        <Kpi label="Verified links" value={num(c.linked)} />
      </Kpis>
      <form className="mb-3 mt-6 flex flex-wrap items-end gap-2 text-small" action="/admin/wines">
        <input type="hidden" name="scope" value={scope} />
        {flags.length > 0 && <input type="hidden" name="f" value={flags.join(",")} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Producer, wine, alias, country, region or wine id"
          aria-label="Search wines"
          className="w-96 max-w-full rounded-[10px] bg-surface px-3 py-2 ring-1 ring-hairline"
        />
        <button type="submit" className="rounded-full bg-ink px-4 py-2 text-canvas">
          Search
        </button>
      </form>
      <nav aria-label="Scope" className="mb-2 flex flex-wrap gap-2 text-small">
        {WINE_VISUAL_SCOPES.map((v) => (
          <Link
            key={v}
            href={href({ scope: v })}
            prefetch={false}
            aria-current={v === scope ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 ring-1 ring-hairline",
              v === scope ? "bg-raised text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {SCOPE_LABEL[v]}
          </Link>
        ))}
      </nav>
      <nav aria-label="Filters" className="mb-4 flex flex-wrap gap-3 text-caption text-ink-2">
        {MASTER_FLAGS.map((f) => (
          <Link
            key={f}
            href={href({ flags: toggle(f) })}
            prefetch={false}
            aria-pressed={flags.includes(f)}
            className={flags.includes(f) ? "text-ink underline" : "hover:text-ink"}
          >
            {flags.includes(f) ? "✓ " : ""}
            {FLAG_LABEL[f]}
          </Link>
        ))}
      </nav>
      <p className="mb-2 text-caption text-ink-2" data-testid="master-total">
        {num(data.total)} {data.total === 1 ? "wine" : "wines"} · page {page} of {pages}
      </p>
      <Table
        head={[
          { label: "Wine" },
          { label: "Type" },
          { label: "Origin" },
          { label: "Status" },
          { label: "Vintages", numeric: true },
          { label: "2D art" },
          { label: "Pending photos", numeric: true },
          { label: "Corrections", numeric: true },
          { label: "Catalogue link" },
        ]}
        rows={data.rows.map((r) => ({
          key: r.id,
          cells: [
            <Link
              key="w"
              href={`/admin/wines/${r.id}`}
              prefetch={false}
              className="text-accent-ink"
            >
              {r.producer} — {r.name}
            </Link>,
            r.type,
            [r.country, r.region].filter(Boolean).join(" · ") || "—",
            r.status === "canonical"
              ? "Catalogue"
              : `Household: ${r.household ?? r.householdId ?? "—"}`,
            num(r.vintages),
            r.published ? "Published" : "—",
            num(r.pending),
            r.status === "canonical" ? num(r.openCorrections) : "—",
            r.status === "canonical"
              ? r.linkedFrom > 0
                ? `${num(r.linkedFrom)} household ${r.linkedFrom === 1 ? "wine" : "wines"}`
                : "—"
              : r.linkedTo
                ? `→ ${r.linkedName ?? r.linkedTo}`
                : "Not linked",
          ],
        }))}
        empty="No wines here."
      />
      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex gap-3 text-small">
          {page > 1 && (
            <Link href={href({ page: page - 1 })} prefetch={false} className="text-accent-ink">
              ← Previous
            </Link>
          )}
          {page < pages && (
            <Link href={href({ page: page + 1 })} prefetch={false} className="text-accent-ink">
              Next →
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
