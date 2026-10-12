"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { type BottleView, type RackView, type VintageDetail } from "@cellr/domain";
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
}

export function MoveBottleSheet({ open, onClose, detail, onNewPlace }: MoveBottleSheetProps) {
  const t = useTranslations("moveBottle");
  return (
    <Sheet open={open} onClose={onClose} title={t("title")} description={detail.wine.name}>
      {open && <MoveBody detail={detail} onClose={onClose} onNewPlace={onNewPlace} />}
    </Sheet>
  );
}

/** Mounted only while the sheet is open, so the racks load when someone actually wants to move something. */
function MoveBody({
  detail,
  onClose,
  onNewPlace,
}: {
  detail: VintageDetail;
  onClose: () => void;
  onNewPlace: () => void;
}) {
  const t = useTranslations("moveBottle");
  const tv = useTranslations("vintage");
  const racks = useRacks();
  const actions = useBottleActions();
  const [bottleId, setBottleId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bottles = detail.bottles;
  const bottle = bottles.find((b) => b.id === bottleId) ?? bottles[0];
  const data: RackView | undefined = racks.data;
  const unit =
    data?.units.find((u) => u.id === (unitId ?? bottle?.locationId)) ?? data?.units[0] ?? null;

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

  if (!bottle) return null;
  return (
    <div className="flex flex-col gap-6">
      {bottles.length > 1 && (
        <div>
          <p className="mb-2 text-small font-medium text-ink-2">{t("which")}</p>
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
        <p className="mb-2 text-small font-medium text-ink-2">{t("whereTo")}</p>
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
                <RackGrid
                  rows={unit.rows}
                  cols={unit.cols}
                  bottles={unit.bottles}
                  activeBottleId={bottle.id}
                  onEmpty={(row, col) =>
                    move(
                      { locationId: unit.id, row, col },
                      `${unit.label} · ${tv("spot", { row, col })}`,
                    )
                  }
                />
                <p className="mt-2 text-small text-ink-3">{t("pickSpot")}</p>
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
