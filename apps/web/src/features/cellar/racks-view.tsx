"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { formatVintage, type PlacedBottle, type RackUnit } from "@cellr/domain";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
import { ChevronRightIcon, PlusIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { useRacks } from "./hooks";
import { KindGlyph, NewPlaceSheet } from "./new-place-sheet";
import { RackGrid } from "./rack-grid";
import { BottlePeekSheet, ManagePlaceSheet, PlaceHereSheet } from "./rack-sheets";
import { useBottleActions } from "./use-bottle-actions";

/**
 * Your racks, fridges and cabinets as they stand: every bottle in its spot, every free spot a tap away.
 * Tap a bottle for its options; choose Move and tap any free spot; or tap a free spot and pick a bottle
 * that has no place yet. Anything done here can be undone from the toast.
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
          <span className="text-small font-medium">
            {t("moving", { wine: `${moving.wineName} ${formatVintage(moving.year)}` })}
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
                  onBottle={(b) => {
                    if (moving) {
                      if (b.bottleId === moving.bottleId) setMoving(null);
                      return;
                    }
                    setError(null);
                    setPeek(b);
                  }}
                  onEmpty={(row, col) => {
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

      <BottlePeekSheet
        bottle={peek}
        unitLabel={peek ? (unitOf(peek)?.label ?? null) : null}
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
