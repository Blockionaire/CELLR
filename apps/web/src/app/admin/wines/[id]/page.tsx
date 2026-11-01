import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { adminWineMasterRecord, getAdminSession } from "@/server/admin/service";
import { Notice, PageTitle } from "../../_ui";
import {
  ArtSection,
  CorrectionsSection,
  DetailsSection,
  HistorySection,
  LabelsSection,
  LinksSection,
  OverviewSection,
  VintagesSection,
} from "./_sections";

export const dynamic = "force-dynamic";

const SECTIONS = [
  ["overview", "Overview"],
  ["details", "Wine details"],
  ["vintages", "Vintages"],
  ["labels", "Labels"],
  ["art", "2D Bottle Artwork"],
  ["corrections", "Corrections"],
  ["links", "Catalogue links"],
  ["history", "History"],
] as const;

/**
 * One wine's master record: a catalogue wine or a household's own. Every section shows what a change reaches (the
 * shared catalogue, or that household only). The 2D artwork is the bottle library's (Sprint P), the corrections the
 * catalogue's signals (Sprint Q): both kept as they were, now in one place.
 */
export default async function AdminWinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sp = await searchParams;
  const message = typeof sp.msg === "string" ? sp.msg.slice(0, 300) : null;
  const query = typeof sp.link_q === "string" ? sp.link_q.slice(0, 80) : "";
  const compare = z.uuid().safeParse(sp.compare);
  const data = await adminWineMasterRecord(session, id.data, {
    query,
    compare: compare.success ? compare.data : null,
  });
  if (data === "missing" || data === null)
    return (
      <>
        <PageTitle title="Wine Master Database" />
        <Notice>
          Not available: run 20261107000030_wine_master.sql (and set the service role).
        </Notice>
      </>
    );
  if (data === "none") notFound();
  const { record: w } = data;

  return (
    <>
      <PageTitle
        title={`${w.producer.name} — ${w.name}`}
        note={[
          w.type,
          w.country,
          w.region,
          w.appellation,
          w.status === "canonical"
            ? "catalogue wine"
            : `household wine of ${w.household ?? w.householdId}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <Link href="/admin/wines" prefetch={false} className="text-small text-accent-ink">
          ← Wine Master Database
        </Link>
      </PageTitle>
      {message && <Notice>{message}</Notice>}
      <nav aria-label="Sections" className="mb-6 flex flex-wrap gap-3 text-caption text-ink-2">
        {SECTIONS.map(([anchor, label]) => (
          <a key={anchor} href={`#${anchor}`} className="hover:text-ink">
            {label}
          </a>
        ))}
      </nav>
      <OverviewSection record={w} visual={data.visual} />
      <DetailsSection record={w} />
      <VintagesSection record={w} />
      <LabelsSection record={w} />
      <ArtSection record={w} visual={data.visual} />
      <CorrectionsSection record={w} correction={data.correction} />
      <LinksSection record={w} candidates={data.candidates} compare={data.compare} query={query} />
      <HistorySection record={w} />
    </>
  );
}
