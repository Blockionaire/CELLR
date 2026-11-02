import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PHOTO_STAGES,
  parseBottlePhotoFilter,
  parsePhotoStage,
  type BottlePhotoStatus,
  type PhotoStage,
} from "@cellr/domain";
import { adminBottlePhotos, getAdminSession } from "@/server/admin/service";
import { cn } from "@/ui/cn";
import {
  FilterChip,
  Notice,
  PageTitle,
  Pager,
  Pill,
  Tab,
  Table,
  button,
  date,
  input,
  link,
  quiet,
  small,
} from "../_ui";
import {
  LIBRARY_MISSING,
  STAGE_LABEL,
  STAGE_SHORT,
  STAGE_TONE,
  STATUS_LABEL,
  artHref,
  artWine,
  vintage,
} from "./labels";

export const dynamic = "force-dynamic";

type Filter = { stage: PhotoStage | "all" | null; status: BottlePhotoStatus | null; q: string };

const qs = (f: Filter, page = 1) => {
  const s = new URLSearchParams();
  if (f.stage) s.set("stage", f.stage);
  if (f.status) s.set("status", f.status);
  if (f.q) s.set("q", f.q);
  if (page > 1) s.set("page", String(page));
  return s.toString();
};
const at = (f: Filter, page = 1) => {
  const s = qs(f, page);
  return `/admin/bottle-photos${s ? `?${s}` : ""}`;
};

/**
 * Bottle photos people sent for the 2D bottle library, by where they are in the workflow: pending review → approved,
 * artwork needed → artwork uploaded as a draft → published (or rejected). The stage is derived in the database from the
 * review status and the wine's artwork. Internal: the photos are never shown in the app, only the finished pictures
 * made from them. The old ?status= links keep working.
 */
export default async function AdminBottlePhotosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const page = Math.min(100_000, Math.max(1, Number.parseInt(one(params.page) ?? "", 10) || 1));
  const q = (one(params.q) ?? "").trim().slice(0, 80);
  // ?stage= is the workflow; an older ?status= link is the review status (pending and rejected are the same thing)
  const stage = parsePhotoStage(one(params.stage));
  const legacy =
    one(params.status) === undefined ? null : parseBottlePhotoFilter(one(params.status));
  const filter: Filter =
    stage !== null
      ? { stage, status: null, q }
      : legacy === "pending" || legacy === "rejected"
        ? { stage: legacy, status: null, q }
        : legacy === "all"
          ? { stage: "all", status: null, q }
          : legacy
            ? { stage: null, status: legacy, q }
            : { stage: "pending", status: null, q };
  const data = await adminBottlePhotos(
    session,
    { status: filter.status, stage: filter.stage, query: q },
    page,
  );
  if (!data.ready)
    return (
      <>
        <PageTitle title="Bottle photos" crumbs={[{ label: "Bottle photos" }]} />
        <Notice tone="warn">
          {data.reason === "missing"
            ? `${LIBRARY_MISSING} (Sprint U also needs 20261111000034_admin_portal_workflow.sql.)`
            : "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read."}
        </Notice>
      </>
    );
  const back = qs(filter, page);
  const everything = Object.values(data.stages).reduce((n, x) => n + x, 0);
  return (
    <>
      <PageTitle
        title="Bottle photos"
        crumbs={[{ label: "Bottle photos" }]}
        note="Photos of whole bottles people sent, with their consent, so a finished 2D bottle picture can be made for the wine. Review a photo, then create the artwork yourself and upload and publish it on the wine."
      >
        <Link href="/admin/wines" prefetch={false} className={quiet}>
          Wine Master Database →
        </Link>
      </PageTitle>

      <ol
        aria-label="Workflow"
        className="mb-4 flex flex-wrap items-center gap-2 text-caption text-ink-2"
      >
        {(["pending", "artwork_needed", "draft", "published"] as const).map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden="true">→</span>}
            <span>
              {i + 1}. {STAGE_LABEL[s]}
            </span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span aria-hidden="true">·</span>
          <span>or {STAGE_LABEL.rejected.toLowerCase()}</span>
        </li>
      </ol>

      <nav aria-label="Stage" className="mb-3 flex flex-wrap gap-2">
        {PHOTO_STAGES.map((s) => (
          <Tab
            key={s}
            href={at({ stage: s, status: null, q })}
            current={filter.stage === s}
            count={data.stages[s] ?? 0}
          >
            {STAGE_LABEL[s]}
          </Tab>
        ))}
        <Tab
          href={at({ stage: "all", status: null, q })}
          current={filter.stage === "all"}
          count={everything}
        >
          Everything
        </Tab>
      </nav>

      <form
        action="/admin/bottle-photos"
        className="mb-3 flex flex-wrap items-center gap-2"
        aria-label="Search bottle photos"
      >
        {filter.stage && <input type="hidden" name="stage" value={filter.stage} />}
        {filter.status && <input type="hidden" name="status" value={filter.status} />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Producer or wine, as sent"
          aria-label="Search photos"
          className={cn(input, "w-80 max-w-full")}
        />
        <button type="submit" className={button}>
          Search
        </button>
        <p className="ml-1 text-small text-ink-2" data-testid="photo-total" aria-live="polite">
          {data.total} {data.total === 1 ? "photo" : "photos"}
        </p>
        {filter.status && (
          <FilterChip
            label={`Review status: ${STATUS_LABEL[filter.status]}`}
            remove={at({ stage: "all", status: null, q })}
          />
        )}
        {q && <FilterChip label={`“${q}”`} remove={at({ ...filter, q: "" })} />}
      </form>

      <Table
        caption="Bottle photos"
        head={[
          { label: "Photo" },
          { label: "Wine" },
          { label: "Vintage" },
          { label: "Sent" },
          { label: "From" },
          { label: "Wine scope" },
          { label: "Stage" },
          { label: "Next step" },
        ]}
        rows={data.rows.map((r) => {
          const wine = artWine(r);
          return {
            key: r.id,
            href: `/admin/bottle-photos/${r.id}${back ? `?back=${encodeURIComponent(back)}` : ""}`,
            linkCell: 1,
            testId: "photo-row",
            cells: [
              // eslint-disable-next-line @next/next/no-img-element -- a private, admin-only photo
              <img
                key="p"
                src={`/admin/bottle-photos/${r.id}/photo`}
                alt=""
                loading="lazy"
                className="h-16 w-12 rounded-[6px] bg-raised object-cover ring-1 ring-hairline"
              />,
              `${r.producer} — ${r.wine}`,
              vintage(r.year),
              date(r.createdAt),
              <Link
                key="u"
                href={`/admin/users/${r.userId}`}
                prefetch={false}
                className={cn(link, "font-normal")}
              >
                {r.submitter ?? `${r.userId.slice(0, 8)}…`}
              </Link>,
              r.sourceWineId === null ? (
                <span className="text-ink-3">Wine removed</span>
              ) : r.sourceCanonical ? (
                <Pill>Catalogue</Pill>
              ) : (
                <span className="whitespace-nowrap">Household: {r.household ?? "—"}</span>
              ),
              <Pill key="s" tone={STAGE_TONE[r.stage]}>
                {STAGE_SHORT[r.stage]}
              </Pill>,
              (r.stage === "artwork_needed" || r.stage === "draft") && wine ? (
                <Link key="n" href={artHref(wine, r.id)} prefetch={false} className={small}>
                  {r.stage === "draft" ? "Publish artwork →" : "Create artwork →"}
                </Link>
              ) : r.stage === "pending" ? (
                <span className="text-ink-2">Review</span>
              ) : (
                <span className="text-ink-3">—</span>
              ),
            ],
          };
        })}
        empty={
          <div className="rounded-[14px] border border-dashed border-hairline p-8 text-center">
            <p className="text-body font-medium text-ink">No photos here.</p>
            <p className="mt-1 text-small text-ink-2">
              {filter.stage === "pending"
                ? "Nothing is waiting for review."
                : filter.stage === "artwork_needed"
                  ? "No approved contribution is waiting for artwork."
                  : "Try another stage, or Everything."}
            </p>
          </div>
        }
      />
      <Pager page={page} pages={data.pages} href={(p) => at(filter, p)} />
    </>
  );
}
