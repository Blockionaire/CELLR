import Link from "next/link";
import { notFound } from "next/navigation";
import { WINE_VISUAL_FILTERS, parseWineVisualFilter, type WineVisualFilter } from "@cellr/domain";
import { adminWineVisuals, getAdminSession } from "@/server/admin/service";
import { cn } from "@/ui/cn";
import { Notice, PageTitle, Table, num } from "../_ui";
import { LIBRARY_MISSING } from "../bottle-photos/labels";

export const dynamic = "force-dynamic";

const FILTER_LABEL: Record<WineVisualFilter, string> = {
  wanted: "Wanted (photos, no picture yet)",
  published: "With a published picture",
  all: "All catalogue wines",
};

/** The canonical wines and their 2D bottle pictures: the ones people sent photos of first. */
export default async function AdminWinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const filter = parseWineVisualFilter(params.filter);
  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const data = await adminWineVisuals(session, filter, q);
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
        note="Each catalogue wine's 2D bottle picture. Once one is published it is the wine's default picture in the app, for everyone who owns it; without one the app keeps the drawn bottle."
      >
        <Link href="/admin/bottle-photos" prefetch={false} className="text-small text-accent-ink">
          Bottle photos →
        </Link>
      </PageTitle>
      <form className="mb-3 flex flex-wrap items-end gap-2 text-small" action="/admin/wines">
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
      <nav aria-label="Filter" className="mb-4 flex flex-wrap gap-2 text-small">
        {WINE_VISUAL_FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/wines?filter=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            prefetch={false}
            aria-current={f === filter ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 ring-1 ring-hairline",
              f === filter ? "bg-raised text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {FILTER_LABEL[f]}
          </Link>
        ))}
      </nav>
      <Table
        head={[
          { label: "Wine" },
          { label: "Type · country" },
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
