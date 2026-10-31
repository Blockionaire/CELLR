import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BOTTLE_PHOTO_STATUSES,
  parseBottlePhotoFilter,
  type BottlePhotoStatus,
} from "@cellr/domain";
import { adminBottlePhotos, getAdminSession } from "@/server/admin/service";
import { cn } from "@/ui/cn";
import { Kpi, Kpis, Notice, PageTitle, Table, date, num } from "../_ui";
import { LIBRARY_MISSING, STATUS_LABEL, vintage } from "./labels";

export const dynamic = "force-dynamic";

const FILTERS: Array<BottlePhotoStatus | "all"> = [...BOTTLE_PHOTO_STATUSES, "all"];

/**
 * Bottle photos people sent for the 2D bottle library, pending first. Internal: the photos are never shown in the
 * app, only the finished pictures made from them.
 */
export default async function AdminBottlePhotosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const params = await searchParams;
  const status = parseBottlePhotoFilter(params.status);
  const page = Math.max(1, Number(params.page) || 1);
  const data = await adminBottlePhotos(session, status, page);
  if (!data.ready)
    return (
      <>
        <PageTitle title="Bottle photos" />
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
        title="Bottle photos"
        note="Photos of whole bottles people sent, with their consent, so a 2D bottle picture can be made for the wine. Approve the useful ones, make the picture, then publish it on the wine (Wine visuals)."
      >
        <Link href="/admin/wines" prefetch={false} className="text-small text-accent-ink">
          Wine visuals →
        </Link>
      </PageTitle>
      <Kpis>
        {BOTTLE_PHOTO_STATUSES.map((s) => (
          <Kpi key={s} label={STATUS_LABEL[s]} value={num(data.counts[s] ?? 0)} />
        ))}
      </Kpis>
      <nav aria-label="Status" className="my-4 flex flex-wrap gap-2 text-small">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/admin/bottle-photos?status=${f}`}
            prefetch={false}
            aria-current={f === status ? "page" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 ring-1 ring-hairline",
              f === status ? "bg-raised text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {f === "all" ? "Everything" : STATUS_LABEL[f]}
          </Link>
        ))}
      </nav>
      <Table
        head={[
          { label: "Photo" },
          { label: "Sent" },
          { label: "Wine" },
          { label: "Vintage" },
          { label: "From" },
          { label: "Consent" },
          { label: "Reward" },
          { label: "Status" },
        ]}
        rows={data.rows.map((r) => ({
          key: r.id,
          cells: [
            <Link key="p" href={`/admin/bottle-photos/${r.id}`} prefetch={false}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a private, admin-only photo */}
              <img
                src={`/admin/bottle-photos/${r.id}/photo`}
                alt={`Bottle photo of ${r.producer} ${r.wine}`}
                loading="lazy"
                className="h-16 w-12 rounded-[6px] bg-raised object-cover"
              />
            </Link>,
            date(r.createdAt),
            <Link
              key="w"
              href={`/admin/bottle-photos/${r.id}`}
              prefetch={false}
              className="text-accent-ink"
            >
              {r.producer} — {r.wine}
            </Link>,
            vintage(r.year),
            <Link
              key="u"
              href={`/admin/users/${r.userId}`}
              prefetch={false}
              className="text-ink-2 hover:text-ink"
            >
              {r.submitter ?? `${r.userId.slice(0, 8)}…`}
            </Link>,
            r.consentAt ? `Yes · ${date(r.consentAt)}` : "No",
            r.rewardPoints ? `+${r.rewardPoints}` : "—",
            STATUS_LABEL[r.status],
          ],
        }))}
        empty="No photos here."
      />
      <nav aria-label="Pages" className="mt-4 flex gap-3 text-small">
        {page > 1 && (
          <Link
            href={`/admin/bottle-photos?status=${status}&page=${page - 1}`}
            prefetch={false}
            className="text-accent-ink"
          >
            ← Newer
          </Link>
        )}
        {data.rows.length === data.size && (
          <Link
            href={`/admin/bottle-photos?status=${status}&page=${page + 1}`}
            prefetch={false}
            className="text-accent-ink"
          >
            Older →
          </Link>
        )}
      </nav>
    </>
  );
}
