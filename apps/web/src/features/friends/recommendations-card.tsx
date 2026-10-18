"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { formatVintage, type RecommendationsView } from "@cellr/domain";
import { EYEBROW } from "@/features/cellar/vintage-bits";
import { placeLine } from "@/features/cellar/wine-visuals";
import { StageThumb } from "@/features/wishlist/stage-thumb";
import { Button } from "@/ui/button";
import { CheckIcon } from "@/ui/icons";
import { useRecommendationAction, useRecommendations } from "./hooks";
import { Card, personName, PersonAvatar } from "./person";

const DAY = 86_400_000;

/** Wines friends recommended to me: who, what, why, and one tap to put it on my wishlist. */
export function RecommendationsCard({ initial }: { initial: RecommendationsView }) {
  const t = useTranslations("friends");
  const locale = useLocale();
  const view = useRecommendations(initial).data ?? initial;
  const act = useRecommendationAction();
  const marked = useRef(false);
  const [now] = useState(() => Date.now());

  // Looking at the list is what makes them "seen": the badge on Home goes away after this visit.
  useEffect(() => {
    if (view.unseen > 0 && !marked.current) {
      marked.current = true;
      act.mutate({ action: "seen" });
    }
  }, [view.unseen, act]);

  if (!view.ready || view.items.length === 0) return null;

  const ago = (iso: string) => {
    const days = Math.round((now - Date.parse(iso)) / DAY);
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
  };
  const busy = (id: string) =>
    act.isPending && "id" in (act.variables ?? {}) && (act.variables as { id: string }).id === id;

  return (
    <div id="recommendations" className="scroll-mt-24">
      <Card title={t("recommendationsTitle")} testId="recommendations">
        <ul className="flex flex-col gap-5">
          {view.items.map((r) => {
            const where = placeLine(r.region, r.countryCode, locale);
            return (
              <li key={r.id} className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-small text-ink-2">
                  <PersonAvatar person={r.from} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-ink">{personName(r.from)}</span>{" "}
                    {t("recommendsYou")}
                    <span className="block text-caption text-ink-3">{ago(r.createdAt)}</span>
                  </span>
                  {r.seenAt === null && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-caption font-semibold text-accent-ink">
                      {t("new")}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 rounded-[16px] bg-raised p-3">
                  <StageThumb
                    type={r.type}
                    producer={r.producer}
                    wineName={r.wine}
                    className="h-20 w-14"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate ${EYEBROW}`}>{r.producer}</p>
                    <p className="font-display text-title text-ink">
                      {r.wine} <span className="text-ink-2 tnum">{formatVintage(r.year)}</span>
                    </p>
                    {where && <p className="text-caption text-ink-3">{where}</p>}
                    {r.note && (
                      <p className="mt-2 whitespace-pre-wrap text-body text-ink">“{r.note}”</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {r.savedAt ? (
                    <Link
                      href="/wishlist"
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ready-bg px-4 text-small font-semibold text-ready-ink"
                    >
                      <CheckIcon size={16} />
                      {t("onWishlist")}
                    </Link>
                  ) : (
                    <Button
                      size="sm"
                      loading={busy(r.id) && act.variables?.action === "save"}
                      disabled={busy(r.id)}
                      onClick={() => act.mutate({ id: r.id, action: "save" })}
                    >
                      {t("addToWishlist")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy(r.id)}
                    onClick={() => act.mutate({ id: r.id, action: "dismiss" })}
                  >
                    {t("dismiss")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
