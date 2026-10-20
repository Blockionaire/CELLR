"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  ERROR_MESSAGES,
  formatStars,
  formatVintage,
  type HistoryItem,
  type HistoryView,
} from "@cellr/domain";
import { useRefreshCellar } from "@/features/cellar/hooks";
import { errorMessage, api } from "@/lib/api";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { ChevronRightIcon } from "@/ui/icons";
import { useToast } from "@/ui/toast";
import { StageThumb } from "@/features/wishlist/stage-thumb";

const historyKey = ["history"] as const;

/**
 * Everything that has left the cellar: what you opened, gave away or removed, newest first, each with a way
 * back in. Putting a bottle back never loses its photo, its price or what you said about it.
 */
export function HistoryScreen({ initial }: { initial: HistoryView }) {
  const t = useTranslations("history");
  const tTypes = useTranslations("wineTypes");
  const te = useTranslations();
  const toast = useToast();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const refreshCellar = useRefreshCellar();
  const { data } = useQuery({
    queryKey: historyKey,
    queryFn: () => api.get<HistoryView>("/cellar/history"),
    initialData: initial,
  });
  const putBack = useMutation({
    mutationFn: (bottleId: string) => api.patch(`/bottles/${bottleId}`, { action: "restore" }),
    onSuccess: async () => {
      toast.show(t("restored"));
      await Promise.all([queryClient.invalidateQueries({ queryKey: historyKey }), refreshCellar()]);
    },
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });

  // One stray tap must not move a bottle: the first tap asks, the second (within a few seconds) puts it back.
  const [asking, setAsking] = useState<string | null>(null);
  useEffect(() => {
    if (!asking) return;
    const timer = window.setTimeout(() => setAsking(null), 4000);
    return () => window.clearTimeout(timer);
  }, [asking]);

  const month = (iso: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(iso),
    );
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(iso),
    );

  const groups = new Map<string, HistoryItem[]>();
  for (const item of data.items) {
    const key = month(item.at);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return (
    <div className="mx-auto w-full max-w-3xl pt-10 lg:pt-14">
      <Link
        href="/cellar"
        className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-control px-2 text-small font-medium text-ink-2 hover:text-ink"
      >
        <ChevronRightIcon size={18} className="rotate-180" />
        {t("back")}
      </Link>
      <h1 className="mt-2 font-display text-display">{t("title")}</h1>
      <p className="mt-2 text-body text-ink-2">{t("subtitle")}</p>

      {data.items.length === 0 ? (
        <EmptyState className="mt-6" title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {[...groups.entries()].map(([label, items]) => (
            <section key={label} aria-label={label}>
              <h2 className="mb-3 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
                {label}
              </h2>
              <ul className="flex flex-col divide-y divide-hairline">
                {items.map((item) => (
                  <li
                    key={item.bottleId}
                    className="grid grid-cols-[3.5rem_1fr] gap-x-4 py-4 first:pt-1"
                    data-testid="history-item"
                  >
                    <StageThumb
                      type={item.type}
                      producer={item.producer}
                      wineName={item.wineName}
                      className="row-span-2 h-20 w-14"
                    />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
                        {item.producer}
                      </p>
                      <p className="font-display text-title leading-snug text-ink">
                        {item.status === "opened" ? (
                          <Link href={`/cellar/${item.vintageId}`}>{item.wineName}</Link>
                        ) : (
                          item.wineName
                        )}
                      </p>
                      <p className="text-small text-ink-2">
                        <span className="tnum">{formatVintage(item.year)}</span> ·{" "}
                        {tTypes(item.type)} · {t(`status.${item.status}`, { day: day(item.at) })}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      {item.myScore !== null ? (
                        <span className="inline-flex items-center rounded-full bg-peak-bg px-3 py-1 text-caption font-semibold text-peak-ink">
                          {t("rated", { stars: formatStars(item.myScore) })}
                        </span>
                      ) : (
                        <span />
                      )}
                      {asking === item.bottleId ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={putBack.isPending && putBack.variables === item.bottleId}
                          aria-label={t("putBackConfirmLabel", { wine: item.wineName })}
                          onClick={() => {
                            setAsking(null);
                            putBack.mutate(item.bottleId);
                          }}
                        >
                          {t("putBackConfirm")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="-mr-3"
                          loading={putBack.isPending && putBack.variables === item.bottleId}
                          aria-label={t("putBackLabel", { wine: item.wineName })}
                          onClick={() => setAsking(item.bottleId)}
                        >
                          {t("putBack")}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
