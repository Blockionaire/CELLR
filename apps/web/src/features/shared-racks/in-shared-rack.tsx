"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";
import type { MySharedRackBottleView } from "@cellr/domain";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { useMySharedBottles } from "./hooks";
import { PeopleIcon } from "./icons";

/**
 * A BOTTLE OF MINE THAT STANDS IN A SHARED RACK HAS NO PLACE IN MY OWN CELLAR, so every list of "bottles without a
 * place" contains it. Offering it there as if it stood nowhere would be untrue, and choosing it for a spot at home
 * silently ends its stay in the shared rack (the database follows the bottle). These are the three parts a screen
 * that lists or offers such bottles needs: the facts, the words next to the bottle, and the question before it moves.
 *
 * The facts come from `GET /shared-racks/bottles` (my own bottles only; the rack and the spot only while I am a
 * member of that rack).
 */
export function useSharedPlaces(enabled = true) {
  const mine = useMySharedBottles(enabled);
  const byBottle = useMemo(
    () => new Map((mine.data?.bottles ?? []).map((b) => [b.bottleId, b])),
    [mine.data],
  );
  return useMemo(
    () => ({
      /** Where this bottle of mine stands in a shared rack, or null: it stands in none (or it is not known yet). */
      of: (bottleId: string): MySharedRackBottleView | null => byBottle.get(bottleId) ?? null,
      /**
       * False until the answer is in: a screen that must ask before moving waits for it. An answer that could not be
       * had counts as in: my own cellar is not held up by it (the database follows the bottle either way).
       */
      known: !enabled || mine.isSuccess || mine.isError,
      count: byBottle.size,
    }),
    [byBottle, enabled, mine.isSuccess, mine.isError],
  );
}

/** Next to a bottle in a list: "In shared rack Cellar club · shelf 2, spot 3". Nothing for a bottle that is in none. */
export function SharedPlaceBadge({
  place,
  className,
}: {
  place: MySharedRackBottleView | null;
  className?: string | undefined;
}) {
  const t = useTranslations("sharedRacks");
  if (!place) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-caption text-ink-2", className)}
      data-testid="shared-place-badge"
      data-bottle={place.bottleId}
    >
      <PeopleIcon size={14} className="shrink-0" />
      {place.hasAccess && place.spot
        ? t("inRack.badge", {
            rack: place.rackName ?? "",
            row: place.spot.row,
            col: place.spot.col,
          })
        : t("inRack.badgeNoAccess")}
    </span>
  );
}

/**
 * The question before a bottle that stands in a shared rack is given a place at home. Nothing is recorded by this
 * component: on "yes" the caller does what it would have done (the placement at home), and the shared rack follows.
 */
export function SharedPlaceConfirm({
  place,
  wine,
  pending = false,
  onConfirm,
  onCancel,
}: {
  place: MySharedRackBottleView;
  wine: string;
  pending?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("sharedRacks");
  const tc = useTranslations("common");
  return (
    <div
      role="alertdialog"
      aria-labelledby="shared-place-confirm-h"
      aria-describedby="shared-place-confirm-d"
      className="flex flex-col gap-3 rounded-card bg-raised p-4 ring-1 ring-hairline"
      data-testid="shared-place-confirm"
    >
      <h3 id="shared-place-confirm-h" className="text-small font-medium text-ink">
        {t("inRack.confirmTitle")}
      </h3>
      <p id="shared-place-confirm-d" className="text-small text-ink-2">
        {place.hasAccess && place.spot
          ? t("inRack.confirmWhat", {
              wine,
              rack: place.rackName ?? "",
              row: place.spot.row,
              col: place.spot.col,
            })
          : t("inRack.confirmWhatNoAccess", { wine })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="md"
          loading={pending}
          onClick={onConfirm}
          data-testid="shared-place-confirm-yes"
        >
          {t("inRack.confirm")}
        </Button>
        <Button size="md" variant="ghost" onClick={onCancel} data-testid="shared-place-confirm-no">
          {tc("cancel")}
        </Button>
      </div>
    </div>
  );
}

/** The badge for a screen that only knows the bottle's id (it asks for the facts itself, once for the whole page). */
export function SharedPlaceBadgeFor({
  bottleId,
  className,
}: {
  bottleId: string;
  className?: string | undefined;
}) {
  return <SharedPlaceBadge place={useSharedPlaces().of(bottleId)} className={className} />;
}

/**
 * FOR A SCREEN THAT IS ABOUT TO GIVE A BOTTLE A PLACE AT HOME: render this instead of doing it. A bottle that stands in
 * no shared rack goes through at once (`onConfirm` is called, nothing is shown); one that does is asked about first.
 */
export function SharedPlaceAsk({
  bottleId,
  wine,
  pending,
  onConfirm,
  onCancel,
}: {
  bottleId: string;
  wine: string;
  pending?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const places = useSharedPlaces();
  const place = places.of(bottleId);
  const passed = useRef<string | null>(null);
  useEffect(() => {
    if (!places.known || place || passed.current === bottleId) return;
    passed.current = bottleId;
    onConfirm();
  }, [places.known, place, bottleId, onConfirm]);
  if (!place) return null;
  return (
    <SharedPlaceConfirm
      place={place}
      wine={wine}
      pending={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/**
 * The same question as a sheet of its own, for a screen that has no room of its own for it (or asks from inside
 * another sheet). A bottle that stands in no shared rack goes through at once and nothing is shown.
 */
export function SharedPlaceAskSheet({
  bottleId,
  wine,
  pending,
  onConfirm,
  onCancel,
}: {
  bottleId: string;
  wine: string;
  pending?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("sharedRacks");
  const tc = useTranslations("common");
  const places = useSharedPlaces();
  const place = places.of(bottleId);
  const passed = useRef<string | null>(null);
  useEffect(() => {
    if (!places.known || place || passed.current === bottleId) return;
    passed.current = bottleId;
    onConfirm();
  }, [places.known, place, bottleId, onConfirm]);
  return (
    <Sheet open={place !== null} onClose={onCancel} title={t("inRack.confirmTitle")}>
      {place && (
        <div className="flex flex-col gap-4" data-testid="shared-place-confirm">
          <p className="text-body text-ink-2">
            {place.hasAccess && place.spot
              ? t("inRack.confirmWhat", {
                  wine,
                  rack: place.rackName ?? "",
                  row: place.spot.row,
                  col: place.spot.col,
                })
              : t("inRack.confirmWhatNoAccess", { wine })}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              block
              loading={pending}
              onClick={onConfirm}
              data-testid="shared-place-confirm-yes"
            >
              {t("inRack.confirm")}
            </Button>
            <Button
              size="lg"
              block
              variant="ghost"
              onClick={onCancel}
              data-testid="shared-place-confirm-no"
            >
              {tc("cancel")}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Under a count of "bottles without a place": how many of them stand in a shared rack. Nothing when none does. */
export function SharedPlaceCount({ className }: { className?: string | undefined }) {
  const t = useTranslations("sharedRacks");
  const { count } = useSharedPlaces();
  if (count === 0) return null;
  return (
    <p
      className={cn("flex items-start gap-1 text-caption text-ink-2", className)}
      data-testid="shared-place-count"
    >
      <PeopleIcon size={14} className="mt-0.5 shrink-0" />
      {t("inRack.countNote", { count })}
    </p>
  );
}
