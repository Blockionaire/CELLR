"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useDeferredValue, useMemo, useState } from "react";
import {
  filterJournal,
  formatStars,
  formatVintage,
  journalEditHref,
  journalWineHref,
  journalTypes,
  topRated,
  type JournalEntry,
  type JournalSort,
  type JournalView,
  type WineType,
} from "@cellr/domain";
import { buttonStyles } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/empty-state";
import { Field } from "@/ui/field";
import { SearchIcon, StarIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { Segmented } from "@/ui/segmented";
import { Stars } from "@/ui/stars";
import { useDay } from "@/features/cellar/bottle-bits";
import { WinePicture } from "@/features/cellar/wine-picture";
import { useJournal } from "./hooks";

/** How many entries are drawn at first; more on request (the journal itself is already bounded). */
const PAGE = 30;

/** My tasting journal: what I wrote about the wines I opened, newest first, with a quiet summary on top. */
export function RatingsScreen({ initial }: { initial: JournalView }) {
  const t = useTranslations("ratings");
  const { data } = useJournal(initial);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<JournalSort>("recent");
  const [type, setType] = useState<WineType | null>(null);
  const [shown, setShown] = useState(PAGE);
  const deferred = useDeferredValue(query);

  const list = useMemo(
    () => filterJournal(data.entries, { query: deferred, type, sort }),
    [data.entries, deferred, type, sort],
  );
  const types = useMemo(() => journalTypes(data.entries), [data.entries]);

  if (!data.ready || data.entries.length === 0)
    return (
      <>
        <PageHeader title={t("title")} />
        {data.ready ? (
          <EmptyState
            title={t("emptyTitle")}
            body={t("emptyBody")}
            action={
              <Link href="/cellar" className={buttonStyles({ variant: "primary", size: "lg" })}>
                {t("emptyAction")}
              </Link>
            }
          />
        ) : (
          <EmptyState title={t("notReady")} />
        )}
      </>
    );

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Summary view={data} />

      <div className="sticky-bar sticky top-0 z-10 -mx-5 mt-6 flex flex-col gap-2 px-5 py-2 sm:mx-0 sm:px-0">
        <div className="relative">
          <SearchIcon
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <Field
            label={t("searchLabel")}
            hideLabel
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={t("searchPlaceholder")}
            inputClassName="h-11 rounded-full pl-10"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label={t("sortLabel")}
            value={sort}
            onChange={(v) => {
              setSort(v);
              setShown(PAGE);
            }}
            options={[
              { value: "recent", label: t("sort.recent") },
              { value: "best", label: t("sort.best") },
              { value: "worst", label: t("sort.worst") },
            ]}
          />
          {types.length > 1 && <TypeFilter types={types} value={type} onChange={setType} />}
        </div>
      </div>

      <p className="mt-3 text-caption text-ink-2" aria-live="polite">
        {t("showing", { count: list.length })}
      </p>
      {list.length === 0 ? (
        <p className="mt-6 text-body text-ink-2">{t("noMatch")}</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-3" aria-label={t("listLabel")}>
          {list.slice(0, shown).map((e) => (
            <li key={e.tastingId}>
              <JournalCard entry={e} />
            </li>
          ))}
        </ol>
      )}
      {list.length > shown && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE)}
            className={buttonStyles({ variant: "secondary", size: "md" })}
          >
            {t("more", { count: Math.min(PAGE, list.length - shown) })}
          </button>
        </div>
      )}
      {data.truncated && <p className="mt-4 text-caption text-ink-3">{t("truncated")}</p>}
    </>
  );
}

function TypeFilter({
  types,
  value,
  onChange,
}: {
  types: WineType[];
  value: WineType | null;
  onChange: (t: WineType | null) => void;
}) {
  const t = useTranslations("ratings");
  const tTypes = useTranslations("wineTypes");
  return (
    <div role="group" aria-label={t("typeLabel")} className="flex flex-wrap gap-1.5">
      <Chip selected={value === null} aria-pressed={value === null} onClick={() => onChange(null)}>
        {t("allTypes")}
      </Chip>
      {types.map((ty) => (
        <Chip
          key={ty}
          selected={value === ty}
          aria-pressed={value === ty}
          onClick={() => onChange(value === ty ? null : ty)}
        >
          {tTypes(ty)}
        </Chip>
      ))}
    </div>
  );
}

/** The numbers over every tasting, the best wines, and how the stars fall. Only what is really there. */
function Summary({ view }: { view: JournalView }) {
  const t = useTranslations("ratings");
  const tTasting = useTranslations("tasting");
  const s = view.summary;
  const best = topRated(view.entries, 3);
  const max = Math.max(1, ...s.distribution);
  return (
    <section aria-labelledby="journal-summary" className="flex flex-col gap-4">
      <h2 id="journal-summary" className="sr-only">
        {t("summaryTitle")}
      </h2>
      <div className="grid grid-cols-3 gap-2 rounded-[22px] bg-surface p-4 shadow-raised">
        <Figure label={t("entries")} value={String(s.entries)} />
        <Figure label={t("winesTasted")} value={String(s.wines)} />
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="font-display text-display tnum text-ink">
            {s.average === null ? "—" : s.average}
          </span>
          {s.average !== null && (
            <Stars
              score={Math.round(s.average * 2)}
              label={tTasting("rated", { stars: s.average })}
              size={13}
            />
          )}
          <span className="text-caption text-ink-2">
            {s.average === null ? t("noStarsYet") : t("averageOf", { count: s.scored })}
          </span>
        </div>
      </div>

      {s.scored > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {best.length > 0 && (
            <div className="rounded-[22px] bg-surface p-4 shadow-raised">
              <h3 className="text-small font-semibold text-ink">
                {view.truncated ? t("bestRecent", { count: view.entries.length }) : t("best")}
              </h3>
              <ol className="mt-3 flex flex-col gap-2">
                {best.map((e) => (
                  <li key={e.tastingId}>
                    <MaybeLink
                      href={journalWineHref(e)}
                      className="flex min-h-11 items-center gap-3 rounded-[14px] px-1 transition-colors duration-150 hover:bg-raised motion-reduce:transition-none"
                    >
                      <WinePicture wine={e} className="h-12 w-9 shrink-0 rounded-[8px]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-small font-medium text-ink">
                          {e.producer}
                        </span>
                        <span className="block truncate text-caption text-ink-2">
                          {e.wineName} {formatVintage(e.year)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-small font-medium text-ink tnum">
                        <StarIcon size={14} fill="currentColor" className="text-accent-fg" />
                        {formatStars(e.score!)}
                      </span>
                    </MaybeLink>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="rounded-[22px] bg-surface p-4 shadow-raised">
            <h3 className="text-small font-semibold text-ink">{t("distribution")}</h3>
            <ul className="mt-3 flex flex-col gap-1" aria-label={t("distribution")}>
              {[...s.distribution.keys()].reverse().map((i) => {
                const n = s.distribution[i]!;
                return (
                  <li key={i} className="flex items-center gap-2 text-caption text-ink-2 tnum">
                    <span className="w-8 text-right">{formatStars(i + 1)}</span>
                    <span
                      className="h-2 flex-1 overflow-hidden rounded-full bg-raised"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${(n / max) * 100}%` }}
                      />
                    </span>
                    <span className="w-6">{n}</span>
                    <span className="sr-only">
                      {t("distributionRow", { stars: formatStars(i + 1), count: n })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="font-display text-display tnum text-ink">{value}</span>
      <span className="text-caption text-ink-2">{label}</span>
    </div>
  );
}

/** One page of the journal: the wine, my stars, my words and my note, and the way back to the wine. */
function JournalCard({ entry: e }: { entry: JournalEntry }) {
  const t = useTranslations("ratings");
  const tTasting = useTranslations("tasting");
  const day = useDay();
  const title = `${e.producer} ${e.wineName} ${formatVintage(e.year)}`.trim();
  const wineHref = journalWineHref(e);
  const action = journalEditHref(e);
  return (
    <article className="flex gap-4 rounded-[22px] bg-surface p-4 shadow-raised">
      <MaybeLink
        href={wineHref}
        aria-label={wineHref ? t("openWine", { wine: title }) : undefined}
        className="shrink-0"
      >
        <WinePicture wine={e} className="h-24 w-16 rounded-[12px]" />
      </MaybeLink>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <header>
          <h3 className="truncate text-body font-semibold text-ink">
            <MaybeLink href={wineHref} className="hover:underline underline-offset-2">
              {e.producer}
            </MaybeLink>
          </h3>
          <p className="truncate text-small text-ink-2">
            {e.wineName} {formatVintage(e.year)}
          </p>
        </header>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-2 tnum">
          {e.score !== null ? (
            <span className="flex items-center gap-1.5">
              <Stars
                score={e.score}
                label={tTasting("rated", { stars: formatStars(e.score) })}
                size={15}
              />
              <span className="font-medium text-ink">{formatStars(e.score)}</span>
            </span>
          ) : (
            <span>{t("unrated")}</span>
          )}
          <span aria-hidden="true">·</span>
          <time dateTime={e.tastedAt}>{day(e.tastedAt)}</time>
        </p>
        {e.descriptors.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={tTasting("wordsTitle")}>
            {e.descriptors.map((d) => (
              <li
                key={d}
                className="rounded-full border border-hairline px-2.5 py-0.5 text-caption text-ink-2"
              >
                {tTasting(`descriptors.${d}`)}
              </li>
            ))}
          </ul>
        )}
        {e.note && <p className="line-clamp-4 whitespace-pre-line text-small text-ink">{e.note}</p>}
        {action ? (
          <div className="mt-1 flex gap-3">
            <Link
              href={action}
              className={cn(
                "inline-flex min-h-11 items-center text-small font-medium text-accent-fg",
                "underline-offset-2 hover:underline",
              )}
              data-testid="journal-edit"
            >
              {e.editable ? t("edit") : t("openWineShort")}
            </Link>
          </div>
        ) : (
          <p className="mt-1 text-caption text-ink-3" data-testid="journal-archived">
            {t("archived")}
          </p>
        )}
      </div>
    </article>
  );
}

/** A link when there is somewhere to go; otherwise the same content, plainly (never a link to a dead page). */
function MaybeLink({
  href,
  className,
  children,
  ...rest
}: {
  href: string | null;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string | undefined;
}) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <Link href={href} className={className} aria-label={rest["aria-label"]}>
      {children}
    </Link>
  );
}
