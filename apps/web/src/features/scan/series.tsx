"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatVintage, type ScanResult } from "@cellr/domain";
import { LabelImage } from "@/features/cellar/label-image";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { CheckIcon } from "@/ui/icons";
import {
  bucketOf,
  canReadAgain,
  needsAttention,
  sameWineAs,
  ScanQueue,
  summarize,
  type QueueItem,
} from "./queue";

export type SeriesItem = QueueItem;

/**
 * A batch of different wines: every photo goes into the queue (queue.ts) and is read in the background, two at a
 * time, while the person takes the next. Each read photo is then reviewed and added on its own, like a single
 * scan; nothing is added without the person confirming it.
 */
export function useScanSeries(
  read: (file: File) => Promise<ScanResult>,
  describe: (error: unknown) => string,
) {
  const [queue] = useState(() => new ScanQueue({ read, describe }));
  useEffect(() => queue.setDeps({ read, describe }), [queue, read, describe]);
  // The previews go when the screen does.
  useEffect(() => () => queue.dispose(), [queue]);
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  return { queue, items, summary: summarize(items), paused: queue.paused };
}

/** The batch workspace: how far it got, and each photo with what it is and what can be done with it. */
export function SeriesTray({
  items,
  paused,
  onOpen,
  onRetry,
  onRemove,
  onSkip,
  onReadAnyway,
  onResume,
  onNewBatch,
}: {
  items: readonly SeriesItem[];
  paused: boolean;
  onOpen: (item: SeriesItem) => void;
  onRetry: (item: SeriesItem) => void;
  onRemove: (item: SeriesItem) => void;
  onSkip: (item: SeriesItem) => void;
  onReadAnyway: (item: SeriesItem) => void;
  onResume: () => void;
  onNewBatch: () => void;
}) {
  const t = useTranslations("scan.series");
  if (items.length === 0) return null;
  const s = summarize(items);
  const unsent = items.filter((i) => i.status === "paused").length;
  const counts = (
    [
      ["processing", s.processing],
      ["ready", s.ready],
      ["attention", s.attention],
      ["added", s.added],
      ["skipped", s.skipped],
    ] as const
  ).filter(([, n]) => n > 0);

  return (
    <section aria-labelledby="series-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="series-title" className="font-display text-headline">
          {t("title")}
        </h2>
        <p className="text-small text-ink-2 tnum">{t("photos", { count: s.total })}</p>
      </div>
      <div
        role="progressbar"
        aria-label={t("progress")}
        aria-valuemin={0}
        aria-valuemax={s.total}
        aria-valuenow={Math.round(s.progress * s.total)}
        className="h-1.5 overflow-hidden rounded-full bg-raised"
      >
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-300 ease-cellr motion-reduce:transition-none"
          style={{ width: `${Math.round(s.progress * 100)}%` }}
        />
      </div>
      <p className="flex flex-wrap gap-1.5" aria-live="polite" data-testid="series-counts">
        {counts.map(([bucket, n]) => (
          <span
            key={bucket}
            className="rounded-full bg-raised px-2.5 py-1 text-caption font-medium text-ink-2 tnum"
          >
            {t(`bucket.${bucket}`, { count: n })}
          </span>
        ))}
      </p>

      {paused && unsent > 0 && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-card bg-raised p-3 ring-1 ring-hairline"
        >
          <p className="text-small text-ink">{t("paused", { count: unsent })}</p>
          <Button size="sm" variant="secondary" onClick={onResume} className="self-start">
            {t("resume", { count: unsent })}
          </Button>
        </div>
      )}

      <ul className="flex flex-col gap-2" data-testid="series">
        {items.map((item) => (
          <Row
            key={item.id}
            item={item}
            same={sameWineAs(items, item)}
            onOpen={onOpen}
            onRetry={onRetry}
            onRemove={onRemove}
            onSkip={onSkip}
            onReadAnyway={onReadAnyway}
          />
        ))}
      </ul>

      {s.finished && (
        <div
          role="status"
          data-testid="series-summary"
          className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline"
        >
          <h3 className="font-display text-title text-ink">{t("summaryTitle")}</h3>
          <p className="text-small text-ink-2">
            {t("summary", { added: s.added, skipped: s.skipped - s.failed, failed: s.failed })}
          </p>
          <Button size="sm" variant="secondary" onClick={onNewBatch} className="self-start">
            {t("newBatch")}
          </Button>
        </div>
      )}
    </section>
  );
}

function Row({
  item,
  same,
  onOpen,
  onRetry,
  onRemove,
  onSkip,
  onReadAnyway,
}: {
  item: SeriesItem;
  same: number | null;
  onOpen: (item: SeriesItem) => void;
  onRetry: (item: SeriesItem) => void;
  onRemove: (item: SeriesItem) => void;
  onSkip: (item: SeriesItem) => void;
  onReadAnyway: (item: SeriesItem) => void;
}) {
  const t = useTranslations("scan.series");
  const label = t("photoN", { n: item.n });
  const bucket = bucketOf(item);
  const attention = needsAttention(item);
  const busy = item.status === "waiting" || item.status === "reading";
  const handled = item.status === "done" || item.status === "skipped";
  return (
    <li
      data-status={item.status}
      aria-label={`${label}: ${headline(item, t)}`}
      className={cn(
        "flex flex-col gap-2 rounded-card bg-surface p-2 pr-3 ring-1",
        attention ? "ring-accent-fg/60" : "ring-hairline",
        handled && "opacity-70",
      )}
    >
      <div className="flex items-center gap-3">
        <Thumb item={item} />
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
            {label} · <span data-testid="state">{t(`state.${stateKey(item)}`)}</span>
          </p>
          <p className="line-clamp-2 text-body font-medium text-ink">{headline(item, t)}</p>
          <p className={cn("line-clamp-2 text-small", item.error ? "text-danger" : "text-ink-2")}>
            {detail(item, t)}
          </p>
        </div>
        {item.status === "done" && (
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
            <CheckIcon size={16} />
          </span>
        )}
        {!handled && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("remove", { n: item.n })}
            onClick={() => onRemove(item)}
            className="shrink-0 self-start px-2"
          >
            ×
          </Button>
        )}
      </div>
      {item.duplicateOf !== null && item.status === "held" && (
        <p className="text-small text-ink">{t("duplicatePhoto", { n: item.duplicateOf })}</p>
      )}
      {same !== null && item.status === "ready" && (
        <p className="text-small text-ink">{t("sameWine", { n: same })}</p>
      )}
      {!handled && !busy && (
        <div className="flex flex-wrap gap-2 pl-[4.25rem]">
          {item.status === "ready" && (
            <Button size="sm" onClick={() => onOpen(item)}>
              {bucket === "attention" ? t("review") : t("open")}
            </Button>
          )}
          {item.status === "failed" && (
            <Button size="sm" variant="secondary" onClick={() => onRetry(item)}>
              {t("retry")}
            </Button>
          )}
          {item.status === "ready" && canReadAgain(item) && (
            <Button size="sm" variant="secondary" onClick={() => onRetry(item)}>
              {t("readAgain")}
            </Button>
          )}
          {item.status === "held" && (
            <Button size="sm" variant="secondary" onClick={() => onReadAnyway(item)}>
              {t("readAnyway")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onSkip(item)}>
            {t("skip")}
          </Button>
        </div>
      )}
    </li>
  );
}

function Thumb({ item }: { item: SeriesItem }) {
  const busy = item.status === "waiting" || item.status === "reading";
  const className = cn(
    "size-14 shrink-0 rounded-[12px] object-cover",
    busy && "motion-safe:animate-pulse",
  );
  if (item.preview)
    // eslint-disable-next-line @next/next/no-img-element -- a local preview of a photo just taken
    return <img src={item.preview} alt="" className={className} />;
  if (item.result)
    return <LabelImage image={item.result.image} size="thumb" className={className} />;
  return <span aria-hidden="true" className={cn(className, "bg-raised")} />;
}

type T = ReturnType<typeof useTranslations<"scan.series">>;

const stateKey = (item: SeriesItem) =>
  item.status === "ready" ? (needsAttention(item) ? "attention" : "ready") : item.status;

function headline(item: SeriesItem, t: T): string {
  if (item.status === "done") return item.outcome ?? t("state.done");
  const r = item.result;
  if (!r || item.status === "waiting" || item.status === "reading")
    return item.status === "failed"
      ? t("failed")
      : item.status === "paused"
        ? t("notSent")
        : item.status === "held"
          ? t("notRead")
          : t("reading");
  const wine = r.matches[0]?.wine;
  if (r.outcome === "found" && wine) return `${wine.producer} ${wine.name}`;
  const facts = r.facts;
  if (facts && (facts.producer || facts.name))
    return [facts.producer, facts.name].filter(Boolean).join(" ");
  return t("unread");
}

function detail(item: SeriesItem, t: T): string {
  if (item.error) return item.error;
  if (item.status === "waiting") return t("waiting");
  if (item.status === "reading") return t("readingHint");
  if (item.status === "paused") return t("pausedHint");
  if (item.status === "held") return t("heldHint");
  if (item.status === "done") return t("state.done");
  if (item.status === "skipped") return t("skippedHint");
  const r = item.result!;
  const year = r.facts?.nonVintage ? "NV" : r.facts?.year ? formatVintage(r.facts.year) : null;
  const kind =
    r.outcome === "found"
      ? t("found")
      : r.outcome === "choose"
        ? t("choose")
        : r.outcome === "new"
          ? t("new")
          : t("fillIn");
  return [year, kind].filter(Boolean).join(" · ");
}
