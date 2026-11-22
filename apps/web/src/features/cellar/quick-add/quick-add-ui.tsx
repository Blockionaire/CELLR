"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import {
  placementMeaning,
  type SmartPlacementView,
  type SmartStorageUnitView,
} from "@cellr/domain";
import { Button, buttonStyles } from "@/ui/button";
import { cn } from "@/ui/cn";
import { ChevronRightIcon } from "@/ui/icons";
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

/**
 * The instruction over the picture while spots are on offer: what to do, in one line, and the way out, at the top of
 * the 3D card, so nobody has to scroll to learn what a tap now does (sprint 7.2).
 */
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
  const bar = useRef<HTMLDivElement>(null);
  // Adding starts here: the instruction goes to the top of the screen, so the picture under it is seen as a whole
  // (on a small phone the bottom bar would otherwise cover most of it). At once, not smoothly: it is a change of
  // mode, and a moving page would move the spots under a finger about to tap one.
  useEffect(() => {
    bar.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, []);
  return (
    <div
      ref={bar}
      className="flex scroll-mt-3 flex-col gap-2 rounded-card bg-surface px-3 py-2.5 shadow-raised ring-1 ring-accent/40 sm:flex-row sm:items-center sm:justify-between"
      data-testid="quick-placing"
      data-free={free}
    >
      <div className="min-w-0" aria-live="polite">
        <p className="text-small font-medium text-ink" data-testid="quick-instruction">
          {listForced ? t("listOnly") : t("placingTitle")}
        </p>
        {!listForced && (
          <p className="text-caption text-ink-2 tnum">
            {t("placingBody", { count: free, unit: unit.label })}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
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

/** One choice of the sheet: a whole-width row that wraps (never cut off on a narrow phone), a hint under it. */
const OPTION =
  "h-auto min-h-14 w-full justify-start whitespace-normal py-3 text-left [&>span]:w-full";

function OptionBody({ label, hint }: { label: string; hint?: string | undefined }) {
  return (
    <span className="flex w-full items-center justify-between gap-3">
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {hint && <span className="text-small font-normal text-ink-2">{hint}</span>}
      </span>
      <ChevronRightIcon size={18} aria-hidden className="shrink-0 opacity-60" />
    </span>
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
  onCancel,
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
  /** Back to choosing a spot. */
  onOtherSpot: () => void;
  /** Out of adding altogether: the cellar as it was. */
  onCancel: () => void;
  /** The sheet itself closed (Escape, its close button, a tap beside it). */
  onClose: () => void;
}) {
  const t = useTranslations("quickAdd");
  return (
    <Sheet open={open} onClose={onClose} title={t("sheetTitle")} description={where}>
      <div className="flex flex-col gap-2" data-testid="quick-sheet">
        <Button
          variant="secondary"
          size="lg"
          className={OPTION}
          disabled={unplacedCount === 0}
          onClick={() => onChoose("unplaced")}
          data-testid="quick-unplaced"
        >
          <OptionBody label={t("unplaced")} hint={t("unplacedCount", { count: unplacedCount })} />
        </Button>
        <Button
          variant="secondary"
          size="lg"
          className={OPTION}
          disabled={placedCount === 0}
          onClick={() => onChoose("move")}
          data-testid="quick-move"
        >
          <OptionBody label={t("move")} />
        </Button>
        <Link
          href={scanHref}
          className={cn(buttonStyles({ variant: "secondary", size: "lg" }), OPTION)}
          onClick={() => onChoose("scan")}
          data-testid="quick-scan"
        >
          <OptionBody label={t("scan")} />
        </Link>
        <Link
          href={manualHref}
          className={cn(buttonStyles({ variant: "secondary", size: "lg" }), OPTION)}
          onClick={() => onChoose("manual")}
          data-testid="quick-manual"
        >
          <OptionBody label={t("manual")} />
        </Link>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={onOtherSpot} data-testid="quick-other-spot">
            {t("otherSpot")}
          </Button>
          <Button variant="ghost" onClick={onCancel} data-testid="quick-cancel">
            {t("cancel")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
