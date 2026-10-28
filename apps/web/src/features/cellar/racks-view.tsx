"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type Ref } from "react";
import { formatVintage, type PlacedBottle, type RackUnit } from "@cellr/domain";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/empty-state";
import { ChevronRightIcon, PlusIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { useRacks } from "./hooks";
import { KindGlyph, NewPlaceSheet } from "./new-place-sheet";
import { RackGrid, SwapGlyph } from "./rack-grid";
import { BottlePeekSheet, ManagePlaceSheet, PlaceHereSheet } from "./rack-sheets";
import { useBottleActions } from "./use-bottle-actions";
import { GHOST_LIFT_PX, useRackDrag, type DropTarget } from "./use-rack-drag";
import { STAGE } from "./wine-card";
import { shapeFor } from "./wine-visuals";

/**
 * Your racks, fridges and cabinets as they stand: every bottle in its spot, every free spot a tap away.
 * Tap a bottle for its options; choose Move and tap any free spot (or another bottle, to trade places); press and
 * hold a bottle to drag it to a spot or onto another bottle; or tap a free spot and pick a bottle that has no place
 * yet. Anything done here can be undone from the toast.
 */
/** Used / capacity as a ring with the count of bottles in the middle. */
function FillRing({ unit, label }: { unit: RackUnit; label: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const share = unit.capacity > 0 ? Math.min(1, unit.used / unit.capacity) : 0;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 56 56"
      className="size-14 shrink-0 text-accent-fg"
    >
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--hairline)" strokeWidth="5" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${share * c} ${c}`}
        transform="rotate(-90 28 28)"
      />
      <text
        x="28"
        y="28"
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--ink)"
        className="font-display tnum"
        style={{ fontSize: 20 }}
      >
        {unit.used}
      </text>
    </svg>
  );
}

/** Every slot as a tiny dot: filled ones in their wine's colour, free ones as an outline. */
function SlotPreview({ unit }: { unit: RackUnit }) {
  const filled = new Map<string, string>();
  for (const b of unit.bottles)
    if (b.row !== null && b.col !== null) filled.set(`${b.row}:${b.col}`, b.type);
  const step = 9;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${unit.cols * step} ${unit.rows * step}`}
      style={{ width: Math.min(unit.cols * step, 144) }}
      className="h-auto max-w-full text-ink-3"
    >
      {Array.from({ length: unit.rows * unit.cols }, (_, i) => {
        const row = Math.floor(i / unit.cols) + 1;
        const col = (i % unit.cols) + 1;
        const type = filled.get(`${row}:${col}`);
        return (
          <circle
            key={i}
            cx={(col - 1) * step + step / 2}
            cy={(row - 1) * step + step / 2}
            r={3}
            fill={type ? `var(--wine-${type})` : "none"}
            stroke={type ? "none" : "currentColor"}
            strokeOpacity={0.55}
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
}

/**
 * Which places are open, kept for the life of this browser tab (like the cellar's search and view), so coming
 * back from a bottle finds them as you left them. Null until the person opens or closes one: then the default
 * applies (one place: open; several: all closed, a compact overview).
 */
const places: { open: Set<string> | null } = { open: null };

export function RacksView() {
  const t = useTranslations("racks");
  const tv = useTranslations("vintage");
  const tKinds = useTranslations("storageKinds");
  const racks = useRacks();
  const actions = useBottleActions();

  const [moving, setMoving] = useState<PlacedBottle | null>(null);
  const [peek, setPeek] = useState<PlacedBottle | null>(null);
  const [placeAt, setPlaceAt] = useState<{ unit: RackUnit; row: number; col: number } | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);
  const [newPlace, setNewPlace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A dropped bottle while its move or swap is saved: both spots stay marked until the racks refresh.
  const [committing, setCommitting] = useState<{
    sourceId: string;
    slotKey: string;
    key: string;
  } | null>(null);
  const {
    drag: lifted,
    begin: beginDrag,
    ghostRef,
    consumeClick,
  } = useRackDrag({
    disabled: actions.pending || committing !== null,
    onDrop: (bottle, target) => void drop(bottle, target),
  });
  const [open, setOpen] = useState<Set<string> | null>(() => places.open);
  useEffect(() => {
    places.open = open;
  }, [open]);
  const toggle = (id: string, all: readonly string[]) => {
    const next = new Set(open ?? (all.length === 1 ? all : []));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  const data = racks.data;
  if (data === undefined)
    return (
      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    );

  const unitOf = (b: PlacedBottle) =>
    data.units.find((u) => u.bottles.some((x) => x.bottleId === b.bottleId));
  const everyBottle = [...data.units.flatMap((u) => u.bottles), ...data.unplaced];
  const remainingAfterOpening = (b: PlacedBottle) =>
    everyBottle.filter((x) => x.vintageId === b.vintageId).length - 1;
  const managed = data.units.find((u) => u.id === manageId) ?? null;

  async function moveTo(bottle: PlacedBottle, unit: RackUnit, row: number, col: number) {
    setError(null);
    const failure = await actions.move(
      bottle.bottleId,
      { locationId: unit.id, row, col },
      `${unit.label} · ${tv("spot", { row, col })}`,
    );
    if (failure) return setError(failure);
    setMoving(null);
    setPlaceAt(null);
    setPeek(null);
  }

  const wineOf = (b: PlacedBottle) => `${b.wineName} ${formatVintage(b.year)}`;
  const spotOf = (b: PlacedBottle) => {
    const unit = unitOf(b);
    return unit && b.row !== null && b.col !== null
      ? { locationId: unit.id, row: b.row, col: b.col }
      : null;
  };

  /** Two placed bottles trade places (both at once, on the server). A bottle without a place never swaps. */
  async function swap(bottle: PlacedBottle, other: PlacedBottle) {
    setError(null);
    const from = spotOf(bottle);
    const to = spotOf(other);
    if (!from || !to) return setError(t("unplacedNoSwap"));
    const failure = await actions.swap(
      { bottleId: bottle.bottleId, spot: from, name: wineOf(bottle) },
      { bottleId: other.bottleId, spot: to, name: wineOf(other) },
    );
    if (failure) return setError(failure);
    setMoving(null);
    setPeek(null);
  }

  /** A dragged bottle let go over a spot: a free one is a move, a taken one a swap. */
  async function drop(bottle: PlacedBottle, target: DropTarget) {
    const unit = data?.units.find((u) => u.id === target.slotKey);
    if (!unit) return;
    setCommitting({
      sourceId: bottle.bottleId,
      slotKey: unit.id,
      key: `${target.row}:${target.col}`,
    });
    try {
      if (target.bottleId === null) await moveTo(bottle, unit, target.row, target.col);
      else {
        const other = unit.bottles.find((b) => b.bottleId === target.bottleId);
        if (other) await swap(bottle, other);
      }
    } finally {
      setCommitting(null);
    }
  }

  async function openPeeked(bottle: PlacedBottle) {
    setError(null);
    const failure = await actions.open(bottle.bottleId, remainingAfterOpening(bottle));
    if (failure) return setError(failure);
    setPeek(null);
  }

  if (data.units.length === 0)
    return (
      <>
        <EmptyState
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <Button size="lg" onClick={() => setNewPlace(true)}>
              <PlusIcon size={20} />
              {t("newPlace")}
            </Button>
          }
        />
        <NewPlaceSheet
          open={newPlace}
          onClose={() => setNewPlace(false)}
          onCreated={() => undefined}
        />
      </>
    );

  return (
    <div className="flex flex-col gap-6">
      {moving && (
        <div
          role="status"
          className="sticky top-3 z-20 flex items-center justify-between gap-3 rounded-[24px] bg-accent py-2 pl-5 pr-3 text-accent-ink glow shadow-raised"
        >
          <span className="min-w-0">
            <span className="block text-small font-medium">
              {t("moving", { wine: `${moving.wineName} ${formatVintage(moving.year)}` })}
            </span>
            {moving.row !== null && (
              <span className="block text-caption opacity-80">{t("movingSwap")}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              setMoving(null);
              setError(null);
            }}
            className="min-h-11 shrink-0 rounded-full bg-accent-ink/15 px-4 text-small font-medium transition-transform duration-150 ease-cellr active:scale-[0.97]"
          >
            {t("cancel")}
          </button>
        </div>
      )}
      {error && !peek && !placeAt && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      {!moving && data.units.some((u) => u.bottles.length > 0) && (
        <p className="-mt-3 text-small text-ink-3">{t("dragHint")}</p>
      )}

      {data.unplaced.length > 0 && (
        <section
          className="rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline"
          aria-labelledby="unplaced-h"
        >
          <h2 id="unplaced-h" className="font-display text-title">
            {t("unplacedTitle")} <span className="text-ink-2 tnum">· {data.unplaced.length}</span>
          </h2>
          <p className="mt-1 text-small text-ink-2">{t("unplacedHint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.unplaced.map((b) => (
              <Chip
                key={b.bottleId}
                selected={moving?.bottleId === b.bottleId}
                onClick={() => setMoving(moving?.bottleId === b.bottleId ? null : b)}
              >
                {b.wineName} {formatVintage(b.year)}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {data.units.map((unit) => {
        const all = data.units.map((u) => u.id);
        const expanded = (open ?? new Set(all.length === 1 ? all : [])).has(unit.id);
        return (
          <section
            key={unit.id}
            aria-labelledby={`unit-${unit.id}`}
            data-testid="place"
            className="rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline sm:p-5"
          >
            <header className="relative flex items-center gap-3">
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-raised text-bronze"
              >
                <KindGlyph kind={unit.kind} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-title">
                  {/* The whole header is the button (the ::after covers it): a big, easy target. */}
                  <button
                    type="button"
                    id={`unit-${unit.id}`}
                    aria-expanded={expanded}
                    aria-controls={`unit-body-${unit.id}`}
                    onClick={() => toggle(unit.id, all)}
                    className="max-w-full truncate text-left after:absolute after:inset-0 after:rounded-[16px] after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-accent-fg"
                  >
                    {unit.label}
                  </button>
                </h2>
                <p className="text-small text-ink-2 tnum">
                  {unit.label === tKinds(unit.kind) ? "" : `${tKinds(unit.kind)} · `}
                  {t("unitMeta", { used: unit.used, capacity: unit.capacity, free: unit.free })}
                </p>
              </div>
              <FillRing
                unit={unit}
                label={t("unitMeta", { used: unit.used, capacity: unit.capacity, free: unit.free })}
              />
              <ChevronRightIcon
                size={20}
                aria-hidden="true"
                className={`shrink-0 text-ink-2 transition-transform duration-200 ease-cellr ${expanded ? "rotate-90" : ""}`}
              />
            </header>
            <div id={`unit-body-${unit.id}`} hidden={!expanded}>
              <div className="mt-3 flex items-center justify-between gap-3">
                <SlotPreview unit={unit} />
                <Button variant="secondary" size="sm" onClick={() => setManageId(unit.id)}>
                  {t("manage")}
                </Button>
              </div>
              <div className="mt-4 rounded-[16px] bg-raised/60 p-2">
                <RackGrid
                  rows={unit.rows}
                  cols={unit.cols}
                  bottles={unit.bottles}
                  activeBottleId={moving?.bottleId}
                  slotKey={unit.id}
                  // tapped Move: the other bottles are places to swap with (a bottle without a place only goes
                  // to a free spot)
                  swapTargets={moving !== null && moving.row !== null}
                  onBottlePointerDown={moving ? undefined : beginDrag}
                  drag={
                    lifted
                      ? {
                          sourceId: lifted.bottle.bottleId,
                          overKey:
                            lifted.over?.slotKey === unit.id
                              ? `${lifted.over.row}:${lifted.over.col}`
                              : null,
                        }
                      : committing
                        ? {
                            sourceId: committing.sourceId,
                            overKey: committing.slotKey === unit.id ? committing.key : null,
                            saving: true,
                          }
                        : undefined
                  }
                  onBottle={(b) => {
                    if (consumeClick()) return; // the end of a drag, not a tap
                    if (moving) {
                      if (b.bottleId === moving.bottleId) setMoving(null);
                      else if (moving.row === null) setError(t("unplacedNoSwap"));
                      else void swap(moving, b);
                      return;
                    }
                    setError(null);
                    setPeek(b);
                  }}
                  onEmpty={(row, col) => {
                    if (consumeClick()) return;
                    setError(null);
                    if (moving) void moveTo(moving, unit, row, col);
                    else setPlaceAt({ unit, row, col });
                  }}
                />
              </div>
            </div>
          </section>
        );
      })}

      <button
        type="button"
        onClick={() => setNewPlace(true)}
        className="flex min-h-16 w-full items-center justify-center gap-2 rounded-card border border-dashed border-ink-3/50 text-body font-medium text-ink-2 transition-[transform,color,background-color] duration-150 ease-cellr hover:bg-surface hover:text-ink active:scale-[0.99]"
      >
        <PlusIcon size={20} />
        {t("newPlace")}
      </button>

      {lifted && (
        <DragGhost
          ref={ghostRef}
          bottle={lifted.bottle}
          swap={lifted.over?.bottleId != null}
          label={(() => {
            const over = lifted.over;
            const unit = over && data.units.find((u) => u.id === over.slotKey);
            if (!over || !unit) return t("dropCancel");
            if (over.bottleId === null)
              return t("dropMove", {
                spot: `${unit.label} · ${tv("spot", { row: over.row, col: over.col })}`,
              });
            const other = unit.bottles.find((b) => b.bottleId === over.bottleId);
            return t("dropSwap", { wine: other ? wineOf(other) : "" });
          })()}
        />
      )}

      <BottlePeekSheet
        bottle={peek}
        unitLabel={peek ? (unitOf(peek)?.label ?? null) : null}
        grid={peek ? (unitOf(peek) ?? null) : null}
        busy={actions.pending}
        error={error}
        onClose={() => {
          setPeek(null);
          setError(null);
        }}
        onMove={() => {
          setMoving(peek);
          setPeek(null);
        }}
        onOpen={() => peek && void openPeeked(peek)}
      />
      <PlaceHereSheet
        target={placeAt}
        unplaced={data.unplaced}
        busy={actions.pending}
        error={error}
        onClose={() => {
          setPlaceAt(null);
          setError(null);
        }}
        onPlace={(b) => placeAt && void moveTo(b, placeAt.unit, placeAt.row, placeAt.col)}
      />
      <ManagePlaceSheet unit={managed} onClose={() => setManageId(null)} />
      <NewPlaceSheet
        open={newPlace}
        onClose={() => setNewPlace(false)}
        onCreated={() => undefined}
      />
    </div>
  );
}

/**
 * The bottle in your hand while dragging: lifted a little (scale and a soft shadow), hanging just above the finger so
 * it stays in sight, with one line saying what letting go will do. Moved by `useRackDrag` directly, without
 * re-rendering, and never in the way of the spot under the finger (it takes no pointer events).
 */
function DragGhost({
  ref,
  bottle,
  label,
  swap,
}: {
  ref: Ref<HTMLDivElement>;
  bottle: PlacedBottle;
  label: string;
  swap: boolean;
}) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="drag-ghost"
      className="pointer-events-none fixed left-0 top-0 z-50 will-change-transform"
      style={{ transform: "translate3d(-200px, -200px, 0)" }}
    >
      <div
        className="flex flex-col items-center gap-2"
        style={{ transform: `translate(-50%, calc(-100% - ${GHOST_LIFT_PX - 28}px))` }}
      >
        <span className="inline-flex max-w-[min(18rem,80vw)] items-center gap-1.5 rounded-full bg-surface/95 px-3 py-1 text-caption font-medium text-ink shadow-raised ring-1 ring-hairline backdrop-blur-md">
          {swap && (
            <span className="text-accent-fg">
              <SwapGlyph size={12} />
            </span>
          )}
          <span className="truncate">{label}</span>
        </span>
        <span
          className={cn(
            "bottle-lift grid size-14 scale-110 place-items-center rounded-full shadow-[0_14px_30px_-6px_rgb(0_0_0/0.45)] ring-2 ring-accent-fg",
            STAGE[bottle.type],
          )}
        >
          <BottleGlyph shape={shapeFor(bottle.type)} tint={bottle.type} className="h-11 w-auto" />
        </span>
      </div>
    </div>
  );
}
