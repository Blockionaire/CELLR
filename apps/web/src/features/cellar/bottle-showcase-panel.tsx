"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, type ReactNode } from "react";
import {
  formatVintage,
  historyEvents,
  summarizePlaces,
  type PlacedBottle,
  type VintageDetail,
} from "@cellr/domain";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { CloseIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { PhasePill } from "@/features/tonight/pick-bits";
import { BarButton, MoveIcon, PageIcon } from "./action-bar";
import { useDay, useMoney } from "./bottle-bits";
import { nameSize, SlotMap } from "./bottle-portrait";
import { FavoriteButton } from "./favorite-button";
import { PANEL, type ShowcaseLayout } from "./three/layout";
import { placeLine } from "./wine-visuals";

interface PanelProps {
  /** The bottle on display (kept after it is put back, so the panel can slide out with its content). */
  bottle: PlacedBottle;
  unitLabel: string | null;
  /** The place's size, to draw where in it the bottle lies. */
  grid?: { rows: number; cols: number } | undefined;
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
 *
 * Its heading (producer, name, vintage) never scrolls: only what is under it does, and that starts at the top for
 * every bottle shown, so a name is never half hidden by where the last one was read to.
 */
export function BottleShowcasePanel({
  bottle,
  unitLabel,
  grid,
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
  const body = useRef<HTMLDivElement>(null);

  // Keyboard and screen-reader users land in the panel when it opens; the details start from the top.
  useEffect(() => {
    if (!open) return;
    if (body.current) body.current.scrollTop = 0;
    panel.current?.focus({ preventScroll: true });
  }, [open, bottle.bottleId]);

  const wine = detail?.wine;
  const places = detail ? summarizePlaces(detail.bottles) : [];
  const history = detail ? historyEvents([...detail.bottles, ...detail.opened]) : [];
  const latestPurchase = detail?.bottles
    .flatMap((b) => (b.purchasedAt ? [b.purchasedAt] : []))
    .sort()
    .at(-1);
  const where = placeLine(bottle.region, bottle.countryCode, locale);
  const placed = bottle.row !== null && bottle.col !== null;
  const facts = detail
    ? [
        wine?.appellation,
        detail.averagePriceCents === null
          ? null
          : t("pricePerBottle", { price: money(detail.averagePriceCents) }),
        latestPurchase ? t("boughtOn", { day: day(latestPurchase) }) : null,
      ].filter(Boolean)
    : [];

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
      // On a phone the panel has a fixed height (the bottle above it is sized to the space it leaves: showcaseFrame).
      style={layout === "top" ? { height: `${PANEL.topShare * 100}%` } : undefined}
      className={cn(
        "absolute z-10 flex flex-col overflow-hidden bg-surface/90 outline-none backdrop-blur-xl",
        "transition-[transform,opacity] duration-500 ease-cellr motion-reduce:transition-none",
        layout === "side"
          ? "inset-y-3 right-3 w-[min(26rem,46%)] rounded-card shadow-raised ring-1 ring-hairline"
          : "inset-x-0 bottom-0 rounded-t-sheet shadow-[0_-1px_0_var(--hairline),0_-24px_48px_-24px_rgb(0_0_0/0.35)]",
        open
          ? "translate-x-0 translate-y-0 opacity-100 delay-300 motion-reduce:delay-0"
          : layout === "side"
            ? "translate-x-8 opacity-0"
            : "translate-y-12 opacity-0",
      )}
    >
      <header className="shrink-0 px-5 pb-3 pt-4" data-testid="showcase-heading">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-caption font-medium uppercase tracking-[0.14em] text-bronze">
            {bottle.producer}
          </p>
          <div className="-my-2 -mr-2 flex shrink-0 items-center">
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
              className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink"
            >
              <CloseIcon size={22} />
            </button>
          </div>
        </div>
        <h2
          className={cn(
            "mt-0.5 break-words font-display text-ink text-balance",
            nameSize(bottle.wineName),
          )}
        >
          {bottle.wineName}
        </h2>
        <p className="mt-1.5 flex min-w-0 items-baseline gap-2 text-small text-ink-2">
          <span className="shrink-0 font-display text-title leading-none text-accent-fg tnum">
            {formatVintage(bottle.year)}
          </span>
          {where && (
            <span className="line-clamp-2 min-w-0">
              <span className="sr-only"> · </span>
              {where}
            </span>
          )}
        </p>
      </header>

      <div
        ref={body}
        // Scrolls on its own, so it can be reached and scrolled with the keyboard too.
        tabIndex={0}
        role="region"
        aria-label={t("more")}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-hairline px-5 pb-4 pt-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-fg"
      >
        <div className="flex flex-wrap items-center gap-2">
          {detail && <PhasePill phase={detail.drink.phase} />}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-caption font-semibold text-ink-2">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ background: `var(--wine-${bottle.type})` }}
            />
            {tTypes(bottle.type)}
          </span>
        </div>

        <Block title={t("thisBottle")} first>
          <div className="flex items-center gap-3">
            {placed && grid && (
              <SlotMap rows={grid.rows} cols={grid.cols} row={bottle.row!} col={bottle.col!} />
            )}
            <p className="min-w-0 text-body font-medium text-ink">
              {placed
                ? `${unitLabel ?? ""} · ${tv("spot", { row: bottle.row!, col: bottle.col! })}`
                : tv("notPlaced")}
            </p>
          </div>
          {detail && (
            <p className="mt-1.5 text-small text-ink-2">
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
          </div>
        ) : (
          <>
            {/* What there is to know at a glance; the full page has the rest. */}
            <p className="mt-3 text-small text-ink-2" data-testid="showcase-facts">
              {facts.join(" · ")}
            </p>
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

      <div className="shrink-0 border-t border-hairline px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {error && (
          <p role="alert" className="mb-2 text-small text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button loading={busy} onClick={onOpen} className="min-w-0 flex-1">
            {t("open")}
          </Button>
          <BarButton label={t("move")} onClick={onMove} disabled={detail === undefined}>
            <MoveIcon />
          </BarButton>
          <BarButton label={t("details")} href={`/cellar/${bottle.vintageId}`}>
            <PageIcon />
          </BarButton>
        </div>
      </div>
    </aside>
  );
}

function Block({
  title,
  first = false,
  children,
}: {
  title: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("mt-4", !first && "border-t border-hairline pt-4")}>
      <h3 className="mb-2 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
        {title}
      </h3>
      {children}
    </section>
  );
}
