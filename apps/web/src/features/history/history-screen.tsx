"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ERROR_MESSAGES,
  formatStars,
  formatVintage,
  type HistoryItem,
  type HistoryView,
} from "@cellr/domain";
import { useRefreshCellar } from "@/features/cellar/hooks";
import { errorMessage, api } from "@/lib/api";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { Button } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { ChevronRightIcon } from "@/ui/icons";
import { useToast } from "@/ui/toast";
import { shapeFor } from "@/features/cellar/wine-visuals";

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
              <h2 className="mb-3 text-caption font-medium uppercase tracking-[0.18em] text-ink-3">
                {label}
              </h2>
              <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface px-4">
                {items.map((item) => (
                  <li
                    key={item.bottleId}
                    className="flex items-center gap-4 py-3"
                    data-testid="history-item"
                  >
                    <BottleGlyph
                      shape={shapeFor(item.type)}
                      tint={item.type}
                      className="w-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-title text-ink">
                        {item.status === "opened" ? (
                          <Link href={`/cellar/${item.vintageId}`}>{item.wineName}</Link>
                        ) : (
                          item.wineName
                        )}
                      </p>
                      <p className="truncate text-small text-ink-2">
                        {item.producer} · <span className="tnum">{formatVintage(item.year)}</span> ·{" "}
                        {tTypes(item.type)}
                      </p>
                      <p className="text-small text-ink-2">
                        {t(`status.${item.status}`, { day: day(item.at) })}
                        {item.myScore !== null &&
                          ` · ${t("rated", { stars: formatStars(item.myScore) })}`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={putBack.isPending && putBack.variables === item.bottleId}
                      aria-label={t("putBackLabel", { wine: item.wineName })}
                      onClick={() => putBack.mutate(item.bottleId)}
                    >
                      {t("putBack")}
                    </Button>
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
