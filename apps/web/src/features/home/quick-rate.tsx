"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { formatStars } from "@cellr/domain";
import { useDeleteTasting, useSaveTasting } from "@/features/cellar/hooks";
import { StarsInput } from "@/ui/stars";

/** How long a burst of arrow-key presses may run before its last value is saved (one write, not one per press). */
const KEY_SETTLE_MS = 500;

/**
 * Per bottle, for the life of the tab: what the server holds as far as we know (undefined: unsure, after a failed
 * write) and the writes still in flight. Kept outside the component so a remount (Home refreshing after the save)
 * neither forgets a saved rating nor lets a later write overtake an earlier one.
 */
const ledger = new Map<string, { saved: number | null | undefined; queue: Promise<unknown> }>();

/** Queues `next` for the bottle behind any write still in flight; nothing to do when it is already what's held. */
function record(
  bottleId: string,
  next: number | null,
  run: (next: number | null) => Promise<unknown>,
) {
  const entry = ledger.get(bottleId) ?? { saved: null, queue: Promise.resolve() };
  ledger.set(bottleId, entry);
  if (next === entry.saved) return;
  entry.saved = next;
  entry.queue = entry.queue
    .then(() => run(next))
    .catch(() => {
      entry.saved = undefined; // unsure now: the next commit writes again, whatever its value
    });
}

/**
 * Tap or slide across the stars: the rating is saved when you let go. (Words and a note live one tap further.)
 *
 * Reliable by construction: a release or tap is written at once; only arrow-key bursts wait briefly, and that wait
 * is cut short (written straight away) when the screen goes away or the page is hidden, so navigating off right
 * after rating never loses it. Writes go out one after another, so a quick rate-then-clear can never arrive in the
 * wrong order. Clearing (tap the same value again, or Delete) removes the rating this widget saved: Home only asks
 * about bottles you have not rated yet, so that tasting holds nothing but these stars.
 */
export function QuickRate({ bottleId }: { bottleId: string }) {
  const t = useTranslations("tasting");
  const save = useSaveTasting();
  const remove = useDeleteTasting();
  const [score, setScore] = useState<number | null>(() => ledger.get(bottleId)?.saved ?? null);

  const writers = useRef({ save: save.mutateAsync, remove: remove.mutateAsync });
  useEffect(() => {
    writers.current = { save: save.mutateAsync, remove: remove.mutateAsync };
  });
  const waiting = useRef<{ timer: ReturnType<typeof setTimeout>; value: number | null } | null>(
    null,
  );

  const write = (next: number | null) =>
    record(bottleId, next, (value) => {
      const { save: put, remove: drop } = writers.current;
      return value === null
        ? drop(bottleId)
        : put({ bottleId, tasting: { score: value, descriptors: [], note: null } });
    });
  const flush = () => {
    const w = waiting.current;
    if (!w) return;
    clearTimeout(w.timer);
    waiting.current = null;
    write(w.value);
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  // Leaving the screen, or the app going to the background, writes whatever is still waiting.
  useEffect(() => {
    const now = () => flushRef.current();
    const hidden = () => document.visibilityState === "hidden" && now();
    window.addEventListener("pagehide", now);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", now);
      document.removeEventListener("visibilitychange", hidden);
      now();
    };
  }, []);

  return (
    <StarsInput
      value={score}
      label={t("ratingLabel")}
      emptyLabel={t("notRated")}
      optionLabel={(s) => t("star", { stars: Number(formatStars(s)) })}
      onChange={setScore}
      onCommit={(next, via) => {
        if (waiting.current) clearTimeout(waiting.current.timer);
        if (via === "pointer") {
          waiting.current = null;
          write(next);
          return;
        }
        waiting.current = { value: next, timer: setTimeout(flush, KEY_SETTLE_MS) };
      }}
    />
  );
}
