"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { useRacks } from "./hooks";
import { RackGrid } from "./rack-grid";

/** "Which spot?" for a new bottle: the place's rack, its free spots tappable, as when moving a bottle. */
export function SpotPickerSheet({
  open,
  placeId,
  placeLabel,
  onClose,
  onPick,
  onAuto,
}: {
  open: boolean;
  placeId: string;
  placeLabel: string;
  onClose: () => void;
  onPick: (row: number, col: number) => void;
  /** Let CELLR take the first free spot instead (as without a chosen spot). */
  onAuto: () => void;
}) {
  const t = useTranslations("addBottle");
  return (
    <Sheet open={open} onClose={onClose} title={t("spotPickTitle")} description={placeLabel}>
      {open && <PickerBody placeId={placeId} onPick={onPick} onAuto={onAuto} />}
    </Sheet>
  );
}

/** Mounted only while open, and always fresh: a spot taken a moment ago shows as taken. */
function PickerBody({
  placeId,
  onPick,
  onAuto,
}: {
  placeId: string;
  onPick: (row: number, col: number) => void;
  onAuto: () => void;
}) {
  const t = useTranslations("addBottle");
  const racks = useRacks();
  const { refetch } = racks;
  useEffect(() => {
    void refetch();
  }, [refetch]);
  const unit = racks.data?.units.find((u) => u.id === placeId);
  return (
    <div className="flex flex-col gap-4">
      {unit ? (
        <>
          <p className="text-body text-ink-2">{t("spotPickBody")}</p>
          <div className="rounded-[16px] bg-raised/60 p-2">
            <RackGrid
              rows={unit.rows}
              cols={unit.cols}
              bottles={unit.bottles}
              fill
              onEmpty={onPick}
            />
          </div>
        </>
      ) : (
        <Skeleton className="h-40" />
      )}
      <Button variant="ghost" onClick={onAuto} className="self-center">
        {t("spotAuto")}
      </Button>
    </div>
  );
}
