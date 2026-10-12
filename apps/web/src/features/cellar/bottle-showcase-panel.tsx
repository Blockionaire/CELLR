"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import {
  formatVintage,
  historyEvents,
  summarizePlaces,
  type PlacedBottle,
  type VintageDetail,
} from "@cellr/domain";
import { Button, buttonStyles } from "@/ui/button";
import { cn } from "@/ui/cn";
import { CloseIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { useDay, useMoney } from "./bottle-bits";
import { DrinkLabel } from "./drink-bits";
import { FavoriteButton } from "./favorite-button";
import type { ShowcaseLayout } from "./three/layout";
import { placeLine } from "./wine-visuals";

interface PanelProps {
  /** The bottle on display (kept after it is put back, so the panel can slide out with its content). */
  bottle: PlacedBottle;
  unitLabel: string | null;
  detail: VintageDetail | undefined;
  open: boolean;
  layout: ShowcaseLayout;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onOpen: () => void;
  onMove: () => void;
}

/**
 * Everything about the bottle that has been taken out of the rack: which it is, where it sits, what it
 * cost, what is known about the wine and its history, and what to do with it. Beside the picture on a
 * wide screen, under it on a phone.
 */
export function BottleShowcasePanel({
  bottle,
  unitLabel,
  detail,
  open,
  layout,
  busy,
  error,
  onClose,
  onOpen,
  onMove,
}: PanelProps) {
  const t = useTranslations("showcase");
  const tv = useTranslations("vintage");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
  const money = useMoney(detail?.currency ?? "EUR");
  const day = useDay();
  const panel = useRef<HTMLElement>(null);

  // Keyboard and screen-reader users land in the panel when it opens.
  useEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true });
  }, [open]);

  const wine = detail?.wine;
  const places = detail ? summarizePlaces(detail.bottles) : [];
  const history = detail ? historyEvents([...detail.bottles, ...detail.opened]) : [];
  const latestPurchase = detail?.bottles
    .flatMap((b) => (b.purchasedAt ? [b.purchasedAt] : []))
    .sort()
    .at(-1);
  const where = placeLine(bottle.region, bottle.countryCode, locale);
  const spot =
    bottle.row !== null && bottle.col !== null
      ? `${unitLabel ?? ""} · ${tv("spot", { row: bottle.row, col: bottle.col })}`
      : tv("notPlaced");

  return (
    <aside
      ref={panel}
      role="dialog"
      aria-label={t("label", {
        wine: `${bottle.producer} ${bottle.wineName}`,
        year: formatVintage(bottle.year),
      })}
      tabIndex={-1}
      inert={!open}
      data-testid="bottle-showcase"
      data-open={open}
      className={cn(
        "absolute z-10 flex flex-col overflow-hidden border border-hairline bg-surface/95 shadow-raised outline-none backdrop-blur-md",
        "transition-[transform,opacity] duration-500 ease-cellr motion-reduce:transition-none",
        layout === "side"
          ? "inset-y-3 right-3 w-[min(26rem,46%)] rounded-card"
          : "inset-x-0 bottom-0 h-[54%] rounded-t-sheet border-x-0 border-b-0",
        open
          ? "translate-x-0 translate-y-0 opacity-100 delay-300 motion-reduce:delay-0"
          : layout === "side"
            ? "translate-x-8 opacity-0"
            : "translate-y-12 opacity-0",
      )}
    >
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <p className="pt-1 text-caption font-medium uppercase tracking-[0.14em] text-ink-3">
            {bottle.producer}
          </p>
          <div className="-mr-2 -mt-1 flex shrink-0 items-center">
            {detail && (
              <FavoriteButton
                wineId={detail.wine.id}
                wine={`${bottle.producer} ${bottle.wineName}`}
                favorite={detail.wine.favorite}
              />
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("putBack")}
              className="grid size-11 shrink-0 place-items-center rounded-control text-ink-2 transition-colors hover:text-ink"
            >
              <CloseIcon size={22} />
            </button>
          </div>
        </div>
        <h2 className="-mt-1 font-display text-display text-balance">{bottle.wineName}</h2>
        <p className="mt-1 text-title text-ink-2">
          <span className="tnum">{formatVintage(bottle.year)}</span>
          {where && <span> · {where}</span>}
        </p>
        <p className="mt-3 inline-flex items-center gap-2 text-small text-ink-2">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ background: `var(--wine-${bottle.type})` }}
          />
          {tTypes(bottle.type)}
        </p>

        <Block title={t("thisBottle")}>
          <p className="text-body text-ink">{spot}</p>
          {detail && <DrinkLabel drink={detail.drink} className="mt-1 text-small" />}
          {detail && (
            <p className="mt-1 text-small text-ink-2">
              {t("ofThisVintage", { count: detail.bottles.length })}
              {places.length > 1 && (
                <>
                  {" · "}
                  {places.map((p, i) => (
                    <span key={p.label ?? "none"}>
                      {i > 0 && " · "}
                      {p.label ?? tv("notPlaced")} <span className="tnum">×{p.count}</span>
                    </span>
                  ))}
                </>
              )}
            </p>
          )}
        </Block>

        {detail === undefined ? (
          <div className="mt-5 flex flex-col gap-3" aria-label={t("loading")}>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <>
            <Block title={tv("purchase")}>
              <Facts
                rows={[
                  [
                    tv("averagePrice"),
                    detail.averagePriceCents === null
                      ? tv("notRecorded")
                      : money(detail.averagePriceCents),
                  ],
                  [tv("latestPurchase"), latestPurchase ? day(latestPurchase) : tv("notRecorded")],
                ]}
              />
            </Block>
            <Block title={tv("about")}>
              <Facts
                rows={[
                  [tv("style"), tTypes(detail.wine.type)],
                  ...(wine?.region ? [[tv("region"), wine.region] as const] : []),
                  ...(wine?.appellation ? [[tv("appellation"), wine.appellation] as const] : []),
                  ...(wine?.countryCode
                    ? [[tv("country"), placeLine(null, wine.countryCode, locale)] as const]
                    : []),
                ]}
              />
            </Block>
            {history.length > 0 && (
              <Block title={tv("history")}>
                <ol className="flex flex-col gap-2">
                  {history.map((e) => (
                    <li
                      key={`${e.kind}-${e.day}`}
                      className="flex items-baseline justify-between gap-4"
                    >
                      <span className="text-body text-ink">
                        {e.kind === "added"
                          ? tv("historyAdded", { count: e.count })
                          : tv("historyOpened", { count: e.count })}
                      </span>
                      <span className="text-small text-ink-3 tnum">{day(e.day)}</span>
                    </li>
                  ))}
                </ol>
              </Block>
            )}
          </>
        )}
      </div>

      <div className="border-t border-hairline bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {error && (
          <p role="alert" className="mb-2 text-small text-danger">
            {error}
          </p>
        )}
        <div
          className={cn(
            "grid gap-3",
            layout === "side" ? "grid-cols-2" : "grid-cols-[1.7fr_1fr_1.1fr]",
          )}
        >
          <Button
            size="lg"
            className={layout === "side" ? "col-span-2" : ""}
            loading={busy}
            onClick={onOpen}
          >
            {t("open")}
          </Button>
          <Button size="lg" variant="secondary" onClick={onMove} disabled={detail === undefined}>
            {t("move")}
          </Button>
          <Link
            href={`/cellar/${bottle.vintageId}`}
            className={buttonStyles({ variant: "secondary", size: "lg" })}
          >
            {t("details")}
          </Link>
        </div>
      </div>
    </aside>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-hairline pt-4">
      <h3 className="mb-2 text-caption font-medium uppercase tracking-[0.18em] text-ink-2">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  return (
    <dl className="flex flex-col gap-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-small text-ink-2">{label}</dt>
          <dd className="text-right text-body text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
