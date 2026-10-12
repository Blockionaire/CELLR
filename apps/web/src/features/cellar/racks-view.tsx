"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatVintage, type PlacedBottle, type RackUnit } from "@cellr/domain";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { EmptyState } from "@/ui/empty-state";
import { PlusIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { useRacks } from "./hooks";
import { NewPlaceSheet } from "./new-place-sheet";
import { RackGrid } from "./rack-grid";
import { BottlePeekSheet, ManagePlaceSheet, PlaceHereSheet } from "./rack-sheets";
import { useBottleActions } from "./use-bottle-actions";

/**
 * Your racks, fridges and cabinets as they stand: every bottle in its spot, every free spot a tap away.
 * Tap a bottle for its options; choose Move and tap any free spot; or tap a free spot and pick a bottle
 * that has no place yet. Anything done here can be undone from the toast.
 */
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
          className="sticky top-3 z-20 flex items-center justify-between gap-3 rounded-card bg-accent px-4 py-3 text-accent-ink shadow-raised"
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
            className="-my-2 -mr-2 min-h-11 rounded-control px-3 text-small font-medium underline underline-offset-4"
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
          className="rounded-card border border-hairline bg-surface p-4"
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

      {data.units.map((unit) => (
        <section
          key={unit.id}
          aria-labelledby={`unit-${unit.id}`}
          className="rounded-card border border-hairline bg-surface p-4 sm:p-5"
        >
          <header className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={`unit-${unit.id}`} className="truncate font-display text-title">
                {unit.label}
              </h2>
              <p className="text-small text-ink-2">
                {unit.label === tKinds(unit.kind) ? "" : `${tKinds(unit.kind)} · `}
                {t("unitMeta", { used: unit.used, capacity: unit.capacity, free: unit.free })}
              </p>
              <div
                className="mt-2 h-1 w-40 overflow-hidden rounded-full bg-raised"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.min(100, (unit.used / unit.capacity) * 100)}%` }}
                />
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setManageId(unit.id)}>
              {t("manage")}
            </Button>
          </header>
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
        </section>
      ))}

      <div>
        <Button variant="secondary" onClick={() => setNewPlace(true)}>
          <PlusIcon size={20} />
          {t("newPlace")}
        </Button>
      </div>

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
