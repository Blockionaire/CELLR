import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { adminNextPhoto, adminWineMasterRecord, getAdminSession } from "@/server/admin/service";
import { Message, Notice, PageTitle, Pill } from "../../_ui";
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
  ["art", "2D Bottle Artwork"],
  ["details", "Wine details"],
  ["vintages", "Vintages"],
  ["labels", "Labels"],
  ["links", "Catalogue links"],
  ["corrections", "Corrections"],
  ["history", "History"],
] as const;
type Anchor = (typeof SECTIONS)[number][0];
const isAnchor = (v: unknown): v is Anchor => SECTIONS.some(([a]) => a === v);

/** The list's own query string, handed over when a row was opened (only ever used for the list's link). */
const backTo = (v: unknown) =>
  typeof v === "string" && v.length <= 600 && /^[\w%.+\-=&]*$/.test(v)
    ? `/admin/wines${v ? `?${v}` : ""}`
    : "/admin/wines";

/**
 * One wine's master record: a catalogue wine or a household's own. Every section shows what a change reaches (the
 * shared catalogue, or that household only), whether it only shows things or changes them, and the result of its last
 * change. The 2D artwork is the bottle library's (Sprint P), the corrections the catalogue's signals (Sprint Q): both
 * kept as they were, now in one place, the artwork first.
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
  const at = isAnchor(sp.at) ? sp.at : null;
  const query = typeof sp.link_q === "string" ? sp.link_q.slice(0, 80) : "";
  const compare = z.uuid().safeParse(sp.compare);
  const from = z.uuid().safeParse(sp.from);
  const list = backTo(sp.back);
  const data = await adminWineMasterRecord(session, id.data, {
    query,
    compare: compare.success ? compare.data : null,
    from: from.success ? from.data : null,
  });
  if (data === "missing" || data === null)
    return (
      <>
        <PageTitle
          title="Wine Master Database"
          crumbs={[{ label: "Wine Master Database", href: list }]}
        />
        <Notice tone="warn">
          Not available: run 20261107000030_wine_master.sql (and set the service role).
        </Notice>
      </>
    );
  if (data === "none") notFound();
  const { record: w, visual } = data;
  const published = visual?.art.some((a) => a.publishedAt !== null) ?? false;
  const draft = visual?.art.some((a) => a.publishedAt === null) ?? false;
  const justPublished = sp.done === "published" && at === "art";
  const next = justPublished ? await adminNextPhoto(session, "artwork_needed") : null;
  const msg = { at, message };
  const title = `${w.producer.name} — ${w.name}`;

  return (
    <>
      <PageTitle
        title={title}
        crumbs={[{ label: "Wine Master Database", href: list }, { label: title }]}
        note={[w.type, w.country, w.region, w.appellation].filter(Boolean).join(" · ")}
      >
        {w.status === "canonical" ? (
          <Pill tone="warn">Catalogue wine · shared</Pill>
        ) : (
          <Pill>Household wine · {w.household ?? w.householdId}</Pill>
        )}
        {data.from && (
          <Link
            href={`/admin/bottle-photos/${data.from.id}`}
            prefetch={false}
            className="text-small font-medium text-accent-fg underline-offset-4 hover:underline"
          >
            ← Back to the contribution
          </Link>
        )}
      </PageTitle>
      {/* a message without a section of its own (or from an older link) is shown here */}
      {!at && <Message text={message} />}
      <nav
        aria-label="Sections"
        className="sticky top-0 z-10 -mx-4 mb-6 flex gap-1.5 overflow-x-auto border-b border-hairline bg-canvas/95 px-4 py-2 backdrop-blur md:-mx-8 md:px-8"
      >
        {SECTIONS.map(([anchor, label]) => (
          <a
            key={anchor}
            href={`#${anchor}`}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-small font-medium text-ink-2 ring-1 ring-ink-3/40 hover:bg-raised hover:text-ink"
          >
            {label}
            {anchor === "art" && (
              <span className="text-caption text-ink-3">
                {draft ? "· draft" : published ? "· published" : "· none"}
              </span>
            )}
            {anchor === "corrections" && data.correction && w.status === "canonical" && (
              <span className="text-caption text-ink-3">
                ·{" "}
                {
                  data.correction.signals.filter(
                    (s) => s.signal !== "accepted" && (s.status ?? "open") === "open",
                  ).length
                }
              </span>
            )}
          </a>
        ))}
      </nav>
      <OverviewSection record={w} visual={visual} />
      <ArtSection
        record={w}
        visual={visual}
        msg={msg}
        from={data.from}
        published={justPublished}
        next={next && next.id !== data.from?.id ? next : null}
      />
      <DetailsSection record={w} msg={msg} />
      <VintagesSection record={w} msg={msg} />
      <LabelsSection record={w} msg={msg} />
      <LinksSection
        record={w}
        candidates={data.candidates}
        compare={data.compare}
        query={query}
        msg={msg}
      />
      <CorrectionsSection record={w} correction={data.correction} />
      <HistorySection record={w} />
    </>
  );
}
