import Link from "next/link";
import { notFound } from "next/navigation";
import {
  WINE_VISUAL_FILTERS,
  WINE_VISUAL_SCOPES,
  parseWineVisualFilter,
  parseWineVisualScope,
  type WineVisualFilter,
  type WineVisualScope,
} from "@cellr/domain";
import { adminWineVisuals, getAdminSession } from "@/server/admin/service";
import { cn } from "@/ui/cn";
import { Notice, PageTitle, Table, num } from "../_ui";
import { LIBRARY_MISSING } from "../bottle-photos/labels";

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<WineVisualScope, string> = {
  all: "All wines",
  catalogue: "Catalogue wines",
  household: "Household wines",
};
const FILTER_LABEL: Record<WineVisualFilter, string> = {
  all: "Any picture state",
  wanted: "Wanted (photos, no picture yet)",
  published: "With a published picture",
};

/**
 * Every wine in CELLR and its 2D bottle picture: the catalogue's and every household's own, the ones people sent
 * photos of first.
 */
export default async function AdminWinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const scope = parseWineVisualScope(params.scope);
  const filter = parseWineVisualFilter(params.filter);
  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const data = await adminWineVisuals(session, scope, filter, q);
  const href = (next: { scope?: string; filter?: string }) =>
    `/admin/wines?scope=${next.scope ?? scope}&filter=${next.filter ?? filter}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  if (!data.ready)
    return (
      <>
        <PageTitle title="Wine visuals" />
        <Notice>
          {data.reason === "missing"
            ? LIBRARY_MISSING
            : "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read."}
        </Notice>
      </>
    );
  return (
    <>
      <PageTitle
        title="Wine visuals"
        note="Each wine's 2D bottle picture. Once published it is the wine's default picture in the app: a catalogue wine's for everyone who has it, a household wine's for that household only. Without one the app keeps its own picture."
      >
        <Link href="/admin/bottle-photos" prefetch={false} className="text-small text-accent-ink">
          Bottle photos →
        </Link>
      </PageTitle>
      <form className="mb-3 flex flex-wrap items-end gap-2 text-small" action="/admin/wines">
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="filter" value={filter} />
        <input
          name="q"
          defaultValue={q}
          placeholder="Producer or wine"
          aria-label="Search wines"
          className="rounded-[10px] bg-surface px-3 py-2 ring-1 ring-hairline"
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
      <nav aria-label="Picture state" className="mb-4 flex flex-wrap gap-3 text-caption text-ink-2">
        {WINE_VISUAL_FILTERS.map((f) => (
          <Link
            key={f}
            href={href({ filter: f })}
            prefetch={false}
            aria-current={f === filter ? "true" : undefined}
            className={f === filter ? "text-ink underline" : "hover:text-ink"}
          >
            {FILTER_LABEL[f]}
          </Link>
        ))}
      </nav>
      <Table
        head={[
          { label: "Wine" },
          { label: "Type" },
          { label: "Kind" },
          { label: "Picture" },
          { label: "Drafts", numeric: true },
          { label: "Pending photos", numeric: true },
          { label: "All photos", numeric: true },
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
            [r.type, r.country].filter(Boolean).join(" · "),
            r.status === "canonical"
              ? "Catalogue"
              : `Household: ${r.household ?? r.householdId ?? "—"}`,
            r.published ? "Published" : "—",
            num(r.drafts),
            num(r.pending),
            num(r.photos),
          ],
        }))}
        empty="No wines here."
      />
    </>
  );
}
