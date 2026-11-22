"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  placementMeaning,
  type SmartPlacementView,
  type SmartStorageUnitView,
} from "@cellr/domain";
import { Button, buttonStyles } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { SpotPicker } from "../placement/spot-picker";
import { resolvedFromView } from "../storage3d/from-api";
import type { QuickAction } from "./machine";
import type { FreeSpot } from "./spots";

/**
 * 3D QUICK ADD, WHAT IS SEEN AROUND THE PICTURE (Smart Cellar 3D, sprint 7): the bar that says spots are on offer,
 * the accessible list of the same free spots (for the keyboard, a screen reader, a place the picture cannot point
 * into, or no 3D at all), and the sheet of what can go on a chosen spot. All of it is existing CELLR UI: the Sprint 4
 * spot picker, the sheet, the buttons. Nothing here writes.
 */

/** The bar under the picture while spots are on offer. */
export function QuickPlacingBar({
  unit,
  free,
  listShown,
  listForced,
  onToggleList,
  onClose,
}: {
  unit: SmartStorageUnitView;
  free: number;
  listShown: boolean;
  /** The picture cannot point at this place's spots (or there is no 3D): the list is the way. */
  listForced: boolean;
  onToggleList: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("quickAdd");
  return (
    <div
      className="flex flex-col gap-2 rounded-card bg-surface p-3 shadow-raised ring-1 ring-hairline"
      data-testid="quick-placing"
      data-free={free}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0" aria-live="polite">
          <p className="font-medium text-ink">{t("placingTitle")}</p>
          <p className="text-small text-ink-2">
            {listForced ? t("listOnly") : t("placingBody", { count: free, unit: unit.label })}
          </p>
        </div>
        <div className="flex gap-2">
          {!listForced && free > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onToggleList}
              aria-expanded={listShown}
              data-testid="quick-list-toggle"
            >
              {listShown ? t("hideList") : t("showList")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="quick-close">
            {t("close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The free spots of a place as the Sprint 4 picker shows them (only free spots can be chosen here: no swap, no bottle
 * being moved). The same spots as the markers in the picture: both come from the domain's eligibility.
 */
export function QuickSpotList({
  unit,
  placements,
  chosen,
  onSpot,
}: {
  unit: SmartStorageUnitView;
  placements: readonly SmartPlacementView[] | undefined;
  chosen: FreeSpot | null;
  onSpot: (spot: FreeSpot) => void;
}) {
  const t = useTranslations("quickAdd");
  const tp = useTranslations("placement");
  const resolved = useMemo(() => resolvedFromView(unit), [unit]);
  const occupants = useMemo(
    () =>
      (placements ?? []).map((p) => ({
        bottleId: p.bottleId,
        row: p.row,
        col: p.col,
        index: p.index,
      })),
    [placements],
  );
  if (!placements) return <Skeleton className="h-40" />;
  if (placementMeaning(resolved) === "unknown")
    return (
      <p className="rounded-card bg-raised p-3 text-small text-ink" data-testid="quick-unknown">
        {tp("unknownPlace")}
      </p>
    );
  return (
    <div data-testid="quick-spot-list">
      <SpotPicker
        resolved={resolved}
        occupants={occupants}
        movingId={null}
        swapAllowed={false}
        chosen={chosen ? { kind: "move", address: chosen } : null}
        onChoose={(c) => {
          if (c.kind === "move" && c.address.index === 1)
            onSpot({ row: c.address.row, col: c.address.col, index: 1 });
        }}
        nameOf={() => ""}
        label={t("listLabel", { unit: unit.label })}
      />
    </div>
  );
}

/** What can go on the chosen spot. */
export function QuickAddSheet({
  open,
  where,
  unplacedCount,
  placedCount,
  scanHref,
  manualHref,
  onChoose,
  onOtherSpot,
  onClose,
}: {
  open: boolean;
  /** "Oak rack · shelf 2 · spot 3" (and its zone, when it has one). */
  where: string;
  unplacedCount: number;
  placedCount: number;
  scanHref: string;
  manualHref: string;
  onChoose: (action: QuickAction) => void;
  onOtherSpot: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("quickAdd");
  const option = "flex min-h-14 w-full items-center justify-between gap-3 text-left";
  return (
    <Sheet open={open} onClose={onClose} title={t("sheetTitle")} description={where}>
      <div className="flex flex-col gap-2" data-testid="quick-sheet">
        <Button
          variant="secondary"
          size="lg"
          block
          className={option}
          disabled={unplacedCount === 0}
          onClick={() => onChoose("unplaced")}
          data-testid="quick-unplaced"
        >
          <span>{t("unplaced")}</span>
          <span className="text-small text-ink-2 tnum">
            {t("unplacedCount", { count: unplacedCount })}
          </span>
        </Button>
        <Button
          variant="secondary"
          size="lg"
          block
          className={option}
          disabled={placedCount === 0}
          onClick={() => onChoose("move")}
          data-testid="quick-move"
        >
          {t("move")}
        </Button>
        <Link
          href={scanHref}
          className={buttonStyles({ size: "lg", block: true })}
          onClick={() => onChoose("scan")}
          data-testid="quick-scan"
        >
          {t("scan")}
        </Link>
        <Link
          href={manualHref}
          className={buttonStyles({ variant: "secondary", size: "lg", block: true })}
          onClick={() => onChoose("manual")}
          data-testid="quick-manual"
        >
          {t("manual")}
        </Link>
        <Button variant="ghost" onClick={onOtherSpot} data-testid="quick-other-spot">
          {t("otherSpot")}
        </Button>
      </div>
    </Sheet>
  );
}
