"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatVintage, type ScanResult } from "@cellr/domain";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { CheckIcon } from "@/ui/icons";

/** How many photos are read at the same time; the rest wait their turn. */
const AT_ONCE = 2;

export type SeriesStatus = "waiting" | "reading" | "ready" | "failed" | "done";

export interface SeriesItem {
  id: string;
  file: File;
  /** A local preview of the photo, for the tray. */
  preview: string;
  status: SeriesStatus;
  result: ScanResult | null;
  error: string | null;
  /** What became of it once handled: "Château Margaux 2015 · 2 bottles", or that it went on the wish list. */
  outcome: string | null;
}

/**
 * Several bottles in a row: every photo goes into a queue and is read in the background (two at a time) while
 * the person takes the next one. Each read photo is then handled on its own, like a single scan.
 */
export function useScanSeries(
  read: (file: File) => Promise<ScanResult>,
  describe: (error: unknown) => string,
) {
  const [items, setItems] = useState<SeriesItem[]>([]);
  const waiting = useRef<Array<{ id: string; file: File }>>([]);
  const busy = useRef(0);
  const previews = useRef(new Set<string>());

  const update = useCallback((id: string, patch: Partial<SeriesItem>) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const pump = useCallback(() => {
    const run = (job: { id: string; file: File }) => {
      busy.current += 1;
      update(job.id, { status: "reading", error: null });
      read(job.file)
        .then((result) => update(job.id, { status: "ready", result }))
        .catch((e: unknown) => update(job.id, { status: "failed", error: describe(e) }))
        .finally(() => {
          busy.current -= 1;
          const next = waiting.current.shift();
          if (next) run(next);
        });
    };
    while (busy.current < AT_ONCE && waiting.current.length > 0) run(waiting.current.shift()!);
  }, [read, describe, update]);

  const add = useCallback(
    (file: File) => {
      const id = crypto.randomUUID();
      const preview = URL.createObjectURL(file);
      previews.current.add(preview);
      setItems((all) => [
        ...all,
        { id, file, preview, status: "waiting", result: null, error: null, outcome: null },
      ]);
      waiting.current.push({ id, file });
      pump();
    },
    [pump],
  );

  const retry = useCallback(
    (item: SeriesItem) => {
      update(item.id, { status: "waiting", error: null });
      waiting.current.push({ id: item.id, file: item.file });
      pump();
    },
    [pump, update],
  );

  const remove = useCallback((item: SeriesItem) => {
    waiting.current = waiting.current.filter((j) => j.id !== item.id);
    URL.revokeObjectURL(item.preview);
    previews.current.delete(item.preview);
    setItems((all) => all.filter((i) => i.id !== item.id));
  }, []);

  const finish = useCallback(
    (id: string, outcome: string) => update(id, { status: "done", outcome }),
    [update],
  );

  // The previews go when the screen does.
  useEffect(() => {
    const all = previews.current;
    return () => all.forEach((p) => URL.revokeObjectURL(p));
  }, []);

  return { items, add, retry, remove, finish };
}

/** The photos taken so far, each with how far it got and what can be done with it. */
export function SeriesTray({
  items,
  onOpen,
  onRetry,
  onRemove,
}: {
  items: SeriesItem[];
  onOpen: (item: SeriesItem) => void;
  onRetry: (item: SeriesItem) => void;
  onRemove: (item: SeriesItem) => void;
}) {
  const t = useTranslations("scan.series");
  if (items.length === 0) return null;
  const done = items.filter((i) => i.status === "done").length;

  return (
    <section aria-labelledby="series-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="series-title" className="font-display text-headline">
          {t("title")}
        </h2>
        <p className="text-small text-ink-2 tnum" aria-live="polite">
          {t("count", { done, total: items.length })}
        </p>
      </div>
      <ul className="flex flex-col gap-2" data-testid="series">
        {items.map((item) => (
          <li
            key={item.id}
            data-status={item.status}
            className={cn(
              "flex items-center gap-3 rounded-card bg-surface p-2 pr-3 ring-1 ring-hairline",
              item.status === "done" && "opacity-70",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of a photo just taken */}
            <img
              src={item.preview}
              alt=""
              className={cn(
                "size-14 shrink-0 rounded-[12px] object-cover",
                (item.status === "waiting" || item.status === "reading") &&
                  "motion-safe:animate-pulse",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-body font-medium text-ink">{headline(item, t)}</p>
              <p
                className={cn("line-clamp-2 text-small", item.error ? "text-danger" : "text-ink-2")}
              >
                {detail(item, t)}
              </p>
            </div>
            {item.status === "ready" && (
              <Button size="sm" onClick={() => onOpen(item)}>
                {t("open")}
              </Button>
            )}
            {item.status === "failed" && (
              <Button size="sm" variant="secondary" onClick={() => onRetry(item)}>
                {t("retry")}
              </Button>
            )}
            {item.status === "done" && (
              <span className="grid size-8 place-items-center rounded-full bg-accent text-accent-ink">
                <CheckIcon size={16} />
                <span className="sr-only">{t("done")}</span>
              </span>
            )}
            {item.status !== "done" && item.status !== "reading" && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("remove")}
                onClick={() => onRemove(item)}
                className="px-2"
              >
                ×
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

type T = ReturnType<typeof useTranslations<"scan.series">>;

function headline(item: SeriesItem, t: T): string {
  if (item.status === "done") return item.outcome ?? t("done");
  const r = item.result;
  if (!r) return item.status === "failed" ? t("failed") : t("reading");
  const facts = r.facts;
  const wine = r.matches[0]?.wine;
  if (r.outcome === "found" && wine) return `${wine.producer} ${wine.name}`;
  if (facts && (facts.producer || facts.name))
    return [facts.producer, facts.name].filter(Boolean).join(" ");
  return t("unread");
}

function detail(item: SeriesItem, t: T): string {
  if (item.error) return item.error;
  if (item.status === "waiting") return t("waiting");
  if (item.status === "reading") return t("readingHint");
  if (item.status === "done") return t("done");
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
