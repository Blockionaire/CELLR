import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  ART_FILTERS,
  LINK_FILTERS,
  VINTAGE_COUNTS,
  WINE_TYPES,
  WINE_VISUAL_SCOPES,
  masterFiltered,
  masterSearch,
  parseMasterQuery,
  sameSearch,
  type ArtFilter,
  type LinkFilter,
  type MasterQuery,
  type MasterSort,
  type VintageCount,
  type WineMasterRow,
  type WineVisualScope,
} from "@cellr/domain";
import { adminWineMaster, getAdminSession } from "@/server/admin/service";
import { cn } from "@/ui/cn";
import {
  FilterChip,
  Notice,
  PageTitle,
  Pager,
  Pill,
  Table,
  button,
  input,
  link,
  num,
  quiet,
  type SortState,
} from "../_ui";

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<WineVisualScope, string> = {
  all: "All wines",
  catalogue: "Canonical (catalogue)",
  household: "Household wines",
};
const ART_LABEL: Record<ArtFilter, string> = {
  published: "2D artwork published",
  missing: "2D artwork missing",
  draft: "2D draft awaiting publication",
};
const LINK_LABEL: Record<LinkFilter, string> = {
  linked: "Verified catalogue link",
  unlinked: "Household, not linked",
};
const VINTAGE_LABEL: Record<VintageCount, string> = {
  none: "No vintages",
  one: "1 vintage",
  many: "2 or more vintages",
};
const TYPE_LABEL: Record<(typeof WINE_TYPES)[number], string> = {
  red: "Red",
  white: "White",
  rose: "Rosé",
  sparkling: "Sparkling",
  dessert: "Dessert",
  fortified: "Fortified",
  orange: "Orange",
};
/** A first click sorts the way an admin usually wants: names A→Z, counts most first. */
const FIRST_DIR: Record<MasterSort, boolean> = {
  name: false,
  type: false,
  country: false,
  vintages: true,
  pending: true,
};

const label = (text: string, control: ReactNode) => (
  <label className="flex min-w-36 flex-col gap-1 text-caption font-medium text-ink-2">
    {text}
    {control}
  </label>
);

/**
 * The Wine Master Database: every wine in CELLR (the catalogue's and every household's own) in one list, searched,
 * filtered, sorted and paged in the database (20261111000034) in a stable order, so it stays quick at 100k+ wines.
 * The whole state is in the URL, in one canonical form: paging, opening a wine and coming back keep it. Older links
 * (?f=…, ?filter=…, ?scope=all) are sent to the same list in that form.
 */
export default async function AdminWinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const query = parseMasterQuery(params);
  const canonical = masterSearch(query);
  const given = new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v]] : Array.isArray(v) ? v.map((x) => [k, x]) : [],
    ),
  ).toString();
  if (!sameSearch(given, canonical)) redirect(`/admin/wines${canonical ? `?${canonical}` : ""}`);

  const data = await adminWineMaster(session, query);
  const href = (next: Partial<MasterQuery>) => {
    const s = masterSearch({ ...query, page: 1, ...next });
    return `/admin/wines${s ? `?${s}` : ""}`;
  };
  const sort = (key: MasterSort): SortState => ({
    href: href({
      sort: key,
      desc: query.sort === key ? !query.desc : FIRST_DIR[key],
    }),
    dir: query.sort === key ? (query.desc ? "desc" : "asc") : null,
  });
  if (!data.ready)
    return (
      <>
        <PageTitle title="Wine Master Database" crumbs={[{ label: "Wine Master Database" }]} />
        <Notice tone="warn">
          {data.reason === "missing"
            ? "Not available yet: run 20261107000030_wine_master.sql and 20261111000034_admin_portal_workflow.sql."
            : "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read."}
        </Notice>
      </>
    );
  const c = data.counts;
  const filtered = masterFiltered(query);
  const here = masterSearch(query);
  const open = (id: string) =>
    `/admin/wines/${id}${here ? `?back=${encodeURIComponent(here)}` : ""}`;

  const chips: Array<{ label: string; remove: string }> = [
    query.q && { label: `“${query.q}”`, remove: href({ q: "" }) },
    query.scope !== "all" && { label: SCOPE_LABEL[query.scope], remove: href({ scope: "all" }) },
    query.type && { label: TYPE_LABEL[query.type], remove: href({ type: null }) },
    query.country && { label: `Country: ${query.country}`, remove: href({ country: null }) },
    query.household && {
      label: `Household: ${data.household ?? query.household.slice(0, 8)}`,
      remove: href({ household: null }),
    },
    query.vintages && { label: VINTAGE_LABEL[query.vintages], remove: href({ vintages: null }) },
    query.art && { label: ART_LABEL[query.art], remove: href({ art: null }) },
    query.link && { label: LINK_LABEL[query.link], remove: href({ link: null }) },
    query.pending && { label: "Pending photos", remove: href({ pending: false }) },
    query.approved && { label: "Approved photos", remove: href({ approved: false }) },
    query.corrections && { label: "Open corrections", remove: href({ corrections: false }) },
  ].filter((x): x is { label: string; remove: string } => Boolean(x));

  const stats: Array<{ label: string; value: number; href: string; current: boolean }> = [
    { label: "All wines", value: c.all, href: "/admin/wines", current: !filtered },
    {
      label: "Catalogue",
      value: c.catalogue,
      href: "/admin/wines?scope=catalogue",
      current: canonical === "scope=catalogue",
    },
    {
      label: "Household",
      value: c.household,
      href: "/admin/wines?scope=household",
      current: canonical === "scope=household",
    },
    {
      label: "Published 2D",
      value: c.published,
      href: "/admin/wines?art=published",
      current: canonical === "art=published",
    },
    {
      label: "Pending photos",
      value: c.pending,
      href: "/admin/wines?pending=1",
      current: canonical === "pending=1",
    },
    {
      label: "Open corrections",
      value: c.corrections,
      href: "/admin/wines?corrections=1",
      current: canonical === "corrections=1",
    },
    {
      label: "Verified links",
      value: c.linked,
      href: "/admin/wines?link=linked",
      current: canonical === "link=linked",
    },
  ];

  return (
    <>
      <PageTitle
        title="Wine Master Database"
        crumbs={[{ label: "Wine Master Database" }]}
        note="Every wine: the shared catalogue and each household's own. A catalogue wine's details and pictures are shared with everyone who has it; a household wine belongs to that household only."
      >
        <Link href="/admin/bottle-photos" prefetch={false} className={quiet}>
          Bottle photos →
        </Link>
      </PageTitle>

      <nav
        aria-label="Quick views"
        className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7"
      >
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            prefetch={false}
            aria-current={s.current ? "page" : undefined}
            className={cn(
              "rounded-[14px] border bg-surface px-3 py-2.5 transition-colors hover:border-ink-3",
              s.current ? "border-accent-fg" : "border-hairline",
            )}
          >
            <span className="block text-caption text-ink-2">{s.label}</span>
            <span className="block font-display text-title tnum text-ink">{num(s.value)}</span>
          </Link>
        ))}
      </nav>

      <form
        action="/admin/wines"
        className="rounded-t-[14px] border border-b-0 border-hairline bg-surface p-3"
        aria-label="Search and filter wines"
      >
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            placeholder="Producer, wine, alias, country, region or wine id"
            aria-label="Search wines"
            className={cn(input, "w-[26rem] max-w-full")}
          />
          <button type="submit" className={button}>
            Search
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {label(
            "Scope",
            <select name="scope" defaultValue={query.scope} className={input}>
              {WINE_VISUAL_SCOPES.map((v) => (
                <option key={v} value={v}>
                  {SCOPE_LABEL[v]}
                </option>
              ))}
            </select>,
          )}
          {label(
            "Type",
            <select name="type" defaultValue={query.type ?? ""} className={input}>
              <option value="">Any type</option>
              {WINE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>,
          )}
          {label(
            "Country",
            <select name="country" defaultValue={query.country ?? ""} className={input}>
              <option value="">Any country</option>
              {data.countries.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.code} ({num(x.n)})
                </option>
              ))}
            </select>,
          )}
          {label(
            "Vintages",
            <select name="vintages" defaultValue={query.vintages ?? ""} className={input}>
              <option value="">Any number</option>
              {VINTAGE_COUNTS.map((v) => (
                <option key={v} value={v}>
                  {VINTAGE_LABEL[v]}
                </option>
              ))}
            </select>,
          )}
          {label(
            "2D artwork",
            <select name="art" defaultValue={query.art ?? ""} className={input}>
              <option value="">Any</option>
              {ART_FILTERS.map((v) => (
                <option key={v} value={v}>
                  {ART_LABEL[v]}
                </option>
              ))}
            </select>,
          )}
          {label(
            "Catalogue link",
            <select name="link" defaultValue={query.link ?? ""} className={input}>
              <option value="">Any</option>
              {LINK_FILTERS.map((v) => (
                <option key={v} value={v}>
                  {LINK_LABEL[v]}
                </option>
              ))}
            </select>,
          )}
          <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2 text-small text-ink">
            <legend className="sr-only">Work to do</legend>
            {(
              [
                ["pending", "Pending photos", query.pending],
                ["approved", "Approved photos", query.approved],
                ["corrections", "Open corrections", query.corrections],
              ] as const
            ).map(([name, text, on]) => (
              <label key={name} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={name}
                  value="1"
                  defaultChecked={on}
                  className="size-4 accent-[var(--accent-fg)]"
                />
                {text}
              </label>
            ))}
          </fieldset>
          {query.household && <input type="hidden" name="household" value={query.household} />}
          {query.sort !== "name" && <input type="hidden" name="sort" value={query.sort} />}
          {query.desc && <input type="hidden" name="dir" value="desc" />}
          <button type="submit" className={quiet}>
            Apply filters
          </button>
        </div>
      </form>
      <div
        className="flex flex-wrap items-center gap-2 border border-hairline bg-raised/60 px-3 py-2"
        aria-live="polite"
      >
        <p className="text-small font-medium text-ink" data-testid="master-total">
          {num(data.total)} {data.total === 1 ? "wine" : "wines"}
          <span className="font-normal text-ink-2">
            {" "}
            · page {num(query.page)} of {num(data.pages)} · sorted by{" "}
            {
              {
                name: "name",
                type: "type",
                country: "country",
                vintages: "vintages",
                pending: "pending photos",
              }[query.sort]
            }
            {query.desc ? " (descending)" : ""}
          </span>
        </p>
        {chips.length > 0 && (
          <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
            {chips.map((x) => (
              <li key={x.label}>
                <FilterChip label={x.label} remove={x.remove} />
              </li>
            ))}
          </ul>
        )}
        {filtered && (
          <Link href="/admin/wines" prefetch={false} className={cn(link, "ml-auto text-small")}>
            Clear filters
          </Link>
        )}
      </div>

      <Table
        caption="Wines"
        className="rounded-t-none"
        head={[
          { label: "Wine", sort: sort("name") },
          { label: "Type", sort: sort("type") },
          { label: "Origin", sort: sort("country") },
          { label: "Scope" },
          { label: "Vintages", numeric: true, sort: sort("vintages") },
          { label: "2D art" },
          { label: "Pending photos", numeric: true, sort: sort("pending") },
          { label: "Corrections", numeric: true },
          { label: "Catalogue link" },
        ]}
        rows={data.rows.map((r) => ({
          key: r.id,
          href: open(r.id),
          testId: "master-row",
          cells: [
            `${r.producer} — ${r.name}`,
            TYPE_LABEL[r.type],
            [r.country, r.region].filter(Boolean).join(" · ") || "—",
            <Scope key="s" row={r} filter={href({ household: r.householdId })} />,
            num(r.vintages),
            r.published ? (
              <Pill tone="ok">Published</Pill>
            ) : r.draft ? (
              <Pill tone="warn">Draft</Pill>
            ) : r.approved > 0 ? (
              <Pill tone="info">Needed</Pill>
            ) : (
              <span className="text-ink-3">—</span>
            ),
            r.pending > 0 ? <Pill tone="info">{num(r.pending)}</Pill> : "0",
            r.status === "canonical" ? (
              r.openCorrections > 0 ? (
                <Pill tone="warn">{num(r.openCorrections)}</Pill>
              ) : (
                "0"
              )
            ) : (
              <span className="text-ink-3">—</span>
            ),
            r.status === "canonical" ? (
              r.linkedFrom > 0 ? (
                `${num(r.linkedFrom)} household ${r.linkedFrom === 1 ? "wine" : "wines"}`
              ) : (
                <span className="text-ink-3">—</span>
              )
            ) : r.linkedTo ? (
              <Link href={`/admin/wines/${r.linkedTo}`} prefetch={false} className={link}>
                → {r.linkedName ?? r.linkedTo}
              </Link>
            ) : (
              <span className="text-ink-2">Not linked</span>
            ),
          ],
        }))}
        empty={
          <div className="rounded-b-[14px] border border-t-0 border-hairline bg-surface p-8 text-center">
            <p className="text-body font-medium text-ink">No wines here.</p>
            <p className="mt-1 text-small text-ink-2">
              {filtered
                ? "Nothing matches this search and these filters. Remove a filter above, or start again."
                : "There are no wines in CELLR yet."}
            </p>
            {filtered && (
              <Link href="/admin/wines" prefetch={false} className={cn(quiet, "mt-4")}>
                Clear filters
              </Link>
            )}
          </div>
        }
      />
      <Pager
        page={query.page}
        pages={data.pages}
        href={(p) => {
          const s = masterSearch({ ...query, page: p });
          return `/admin/wines${s ? `?${s}` : ""}`;
        }}
      />
    </>
  );
}

function Scope({ row, filter }: { row: WineMasterRow; filter: string }) {
  if (row.status === "canonical") return <Pill tone="neutral">Catalogue</Pill>;
  return (
    <span className="whitespace-nowrap">
      Household:{" "}
      <Link
        href={filter}
        prefetch={false}
        className={link}
        title="Show only this household's wines"
      >
        {row.household ?? row.householdId?.slice(0, 8) ?? "—"}
      </Link>
    </span>
  );
}
