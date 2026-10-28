"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  formatVintage,
  type BottleView,
  type PlacedBottle,
  type RackView,
  type VintageDetail,
} from "@cellr/domain";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Sheet } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { BottleSpot } from "./bottle-bits";
import { useRacks } from "./hooks";
import { useBottleActions } from "./use-bottle-actions";
import { RackGrid } from "./rack-grid";

interface MoveBottleSheetProps {
  open: boolean;
  onClose: () => void;
  detail: VintageDetail;
  onNewPlace: () => void;
  /** Start with this bottle chosen (when the person has already pointed at one). */
  bottleId?: string | undefined;
}

export function MoveBottleSheet({
  open,
  onClose,
  detail,
  onNewPlace,
  bottleId,
}: MoveBottleSheetProps) {
  const t = useTranslations("moveBottle");
  return (
    <Sheet open={open} onClose={onClose} title={t("title")} description={detail.wine.name}>
      {open && (
        <MoveBody
          detail={detail}
          onClose={onClose}
          onNewPlace={onNewPlace}
          initialBottleId={bottleId}
        />
      )}
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so the racks load when someone actually wants to move something. */
function MoveBody({
  detail,
  onClose,
  onNewPlace,
  initialBottleId,
}: {
  detail: VintageDetail;
  onClose: () => void;
  onNewPlace: () => void;
  initialBottleId: string | undefined;
}) {
  const t = useTranslations("moveBottle");
  const tv = useTranslations("vintage");
  const racks = useRacks();
  const actions = useBottleActions();
  const [bottleId, setBottleId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bottles = detail.bottles;
  const bottle =
    bottles.find((b) => b.id === bottleId) ??
    bottles.find((b) => b.id === initialBottleId) ??
    bottles[0];
  const data: RackView | undefined = racks.data;
  const unit =
    data?.units.find((u) => u.id === (unitId ?? bottle?.locationId)) ?? data?.units[0] ?? null;

  // only a bottle with a place can trade it for another bottle's
  const placed = bottle?.locationId != null;

  async function move(
    to: { locationId: string | null; row: number | null; col: number | null },
    where: string,
  ) {
    if (!bottle) return;
    setError(null);
    const failure = await actions.move(bottle.id, to, where);
    if (failure) return setError(failure);
    onClose();
  }

  /** Onto a taken spot: the two trade places, both at once. Only a bottle that has a place can trade it. */
  async function swap(other: PlacedBottle) {
    if (
      !bottle ||
      !unit ||
      bottle.locationId === null ||
      bottle.row === null ||
      bottle.col === null
    )
      return;
    if (other.row === null || other.col === null || other.bottleId === bottle.id) return;
    setError(null);
    const failure = await actions.swap(
      {
        bottleId: bottle.id,
        spot: { locationId: bottle.locationId, row: bottle.row, col: bottle.col },
        name: `${detail.wine.name} ${formatVintage(detail.year)}`,
      },
      {
        bottleId: other.bottleId,
        spot: { locationId: unit.id, row: other.row, col: other.col },
        name: `${other.wineName} ${formatVintage(other.year)}`,
      },
    );
    if (failure) return setError(failure);
    onClose();
  }

  if (!bottle) return null;
  return (
    <div className="flex flex-col gap-6">
      {bottles.length > 1 && (
        <div>
          <p className="mb-2 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
            {t("which")}
          </p>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            {bottles.map((b) => (
              <BottleChip
                key={b.id}
                bottle={b}
                selected={b.id === bottle.id}
                onSelect={() => setBottleId(b.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
          {t("whereTo")}
        </p>
        {data === undefined ? (
          <Skeleton className="h-40" />
        ) : data.units.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-body text-ink-2">{t("noPlaces")}</p>
            <Button variant="secondary" onClick={onNewPlace}>
              {t("createPlace")}
            </Button>
          </div>
        ) : (
          <>
            <div className="-mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-1">
              {data.units.map((u) => (
                <Chip key={u.id} selected={u.id === unit?.id} onClick={() => setUnitId(u.id)}>
                  {u.label}
                </Chip>
              ))}
            </div>
            {unit && (
              <>
                <div className="rounded-[16px] bg-raised/60 p-2">
                  <RackGrid
                    rows={unit.rows}
                    cols={unit.cols}
                    bottles={unit.bottles}
                    activeBottleId={bottle.id}
                    swapTargets={placed}
                    onBottle={placed ? (b) => void swap(b) : undefined}
                    onEmpty={(row, col) =>
                      move(
                        { locationId: unit.id, row, col },
                        `${unit.label} · ${tv("spot", { row, col })}`,
                      )
                    }
                  />
                </div>
                <p className="mt-3 text-center text-small text-ink-2">
                  {placed ? t("pickSpotOrSwap") : t("pickSpot")}
                </p>
              </>
            )}
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      {bottle.locationId !== null && (
        <Button
          variant="ghost"
          loading={actions.pending}
          onClick={() => move({ locationId: null, row: null, col: null }, "")}
          className="self-center"
        >
          {t("takeOut")}
        </Button>
      )}
    </div>
  );
}

function BottleChip({
  bottle,
  selected,
  onSelect,
}: {
  bottle: BottleView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Chip selected={selected} onClick={onSelect} className="h-11">
      <BottleSpot bottle={bottle} />
    </Chip>
  );
}
