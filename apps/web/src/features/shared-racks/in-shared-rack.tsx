"use client";

import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { MySharedRackBottleView } from "@cellr/domain";
import { cn } from "@/ui/cn";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { useRacks } from "@/features/cellar/hooks";
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

type Translate = ReturnType<typeof useTranslations<"sharedRacks">>;

/** "In shared rack Cellar club · shelf 2, spot 3", or "In a shared rack" when I may not see which. */
const placeText = (t: Translate, place: MySharedRackBottleView) =>
  place.hasAccess && place.spot
    ? t("inRack.badge", { rack: place.rackName ?? "", row: place.spot.row, col: place.spot.col })
    : t("inRack.badgeNoAccess");

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
      {placeText(t, place)}
    </span>
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
 * The bottles of one wine that have no place in my own cellar, as my own cellar's racks list them (asked for only
 * where a screen knows the wine but not its bottles: a wine card). Undefined: the screen gave the bottles itself.
 */
function useUnplacedOf(vintageId: string | undefined): readonly string[] | undefined {
  const racks = useRacks(vintageId !== undefined);
  return useMemo(
    () =>
      vintageId === undefined
        ? undefined
        : (racks.data?.unplaced ?? [])
            .filter((b) => b.vintageId === vintageId)
            .map((b) => b.bottleId),
    [racks.data, vintageId],
  );
}

/**
 * WHERE A SCREEN SAYS "NOT PLACED" for bottles without a place in my own cellar: what is true instead. One bottle in a
 * shared rack: "In shared rack Cellar club · shelf 2, spot 3". Several, all in one: "2 in a shared rack". Some of
 * them: the screen's own words, then " · 1 in a shared rack". None (or not known yet): the screen's own words, as
 * they were.
 */
export function SharedPlaceLine({
  bottleIds,
  vintageId,
  fallback,
}: {
  /** The bottles the words are about (all of them without a place in my own cellar). */
  bottleIds?: readonly string[] | undefined;
  /** Or: every bottle of this wine without a place in my own cellar. */
  vintageId?: string | undefined;
  /** What the screen says without shared racks. */
  fallback: ReactNode;
}) {
  const t = useTranslations("sharedRacks");
  const places = useSharedPlaces();
  const ids = useUnplacedOf(vintageId) ?? bottleIds ?? [];
  const inRack = ids.flatMap((id) => places.of(id) ?? []);
  if (inRack.length === 0) return <>{fallback}</>;
  const text =
    ids.length === 1 ? placeText(t, inRack[0]!) : t("inRack.several", { count: inRack.length });
  return (
    <span data-testid="shared-place-line">
      {inRack.length < ids.length && (
        <>
          {fallback}
          {" · "}
        </>
      )}
      {text}
    </span>
  );
}

/**
 * The same words as plain text, for a screen that can only take a string (an option of a select): told to
 * `onChange` as bottle id → words, for the bottles that stand in a shared rack. Draws nothing.
 */
export function SharedPlaceTexts({
  bottleIds,
  onChange,
}: {
  bottleIds: readonly string[];
  onChange: (texts: ReadonlyMap<string, string>) => void;
}) {
  const t = useTranslations("sharedRacks");
  const places = useSharedPlaces();
  const entries = bottleIds.flatMap((id) => {
    const place = places.of(id);
    return place ? [[id, placeText(t, place)] as const] : [];
  });
  const said = JSON.stringify(entries);
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (told.current === said) return;
    told.current = said;
    onChange(new Map(JSON.parse(said) as Array<[string, string]>));
  }, [said, onChange]);
  return null;
}

/**
 * Which of these bottles stand in a shared rack, and when nothing needs asking: `onConfirm` is called once (for this
 * set of bottles) as soon as it is known that none of them does. Until it is known, nothing happens: a screen that
 * must ask before it moves waits for the answer.
 */
function useInRack(bottleIds: readonly string[], onConfirm: () => void) {
  const places = useSharedPlaces();
  const inRack = bottleIds.flatMap((id) => places.of(id) ?? []);
  const key = bottleIds.join(",");
  const passed = useRef<string | null>(null);
  const none = inRack.length === 0;
  useEffect(() => {
    if (!places.known || !none || passed.current === key) return;
    passed.current = key;
    onConfirm();
  }, [places.known, none, key, onConfirm]);
  return inRack;
}

/** What giving these bottles a place at home does to their stay in a shared rack. */
function askText(t: Translate, inRack: readonly MySharedRackBottleView[], wine: string) {
  if (inRack.length > 1) return t("inRack.confirmWhatSeveral", { count: inRack.length });
  const place = inRack[0]!;
  return place.hasAccess && place.spot
    ? t("inRack.confirmWhat", {
        wine,
        rack: place.rackName ?? "",
        row: place.spot.row,
        col: place.spot.col,
      })
    : t("inRack.confirmWhatNoAccess", { wine });
}

interface AskProps {
  /** The bottle about to get a place at home. */
  bottleId?: string | undefined;
  /** Or: the bottles about to get one (several at once); asked once, for all of them. */
  bottleIds?: readonly string[] | undefined;
  wine: string;
  pending?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

const idsOf = ({ bottleId, bottleIds }: Pick<AskProps, "bottleId" | "bottleIds">) =>
  bottleIds ?? (bottleId === undefined ? [] : [bottleId]);

/**
 * FOR A SCREEN THAT IS ABOUT TO GIVE A BOTTLE A PLACE AT HOME: render this instead of doing it. A bottle that stands in
 * no shared rack goes through at once (`onConfirm` is called, nothing is shown); one that does is asked about first.
 */
export function SharedPlaceAsk({ pending, onConfirm, onCancel, wine, ...which }: AskProps) {
  const t = useTranslations("sharedRacks");
  const tc = useTranslations("common");
  const inRack = useInRack(idsOf(which), onConfirm);
  if (inRack.length === 0) return null;
  // Nothing is recorded here: on "yes" the caller does what it would have done, and the shared rack follows.
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
        {askText(t, inRack, wine)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="md"
          loading={pending}
          onClick={onConfirm}
          data-testid="shared-place-confirm-yes"
        >
          {t(inRack.length > 1 ? "inRack.confirmSeveral" : "inRack.confirm")}
        </Button>
        <Button size="md" variant="ghost" onClick={onCancel} data-testid="shared-place-confirm-no">
          {tc("cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The same question as a sheet of its own, for a screen that has no room of its own for it (or asks from inside
 * another sheet). A bottle that stands in no shared rack goes through at once and nothing is shown.
 */
export function SharedPlaceAskSheet({ pending, onConfirm, onCancel, wine, ...which }: AskProps) {
  const t = useTranslations("sharedRacks");
  const tc = useTranslations("common");
  const inRack = useInRack(idsOf(which), onConfirm);
  const several = inRack.length > 1;
  const asking = inRack.length > 0;
  // The screen that asks takes the question away (yes or no) instead of letting the sheet close itself, so the
  // browser does not hand the focus back: it goes back here to what had it when the question came up.
  const before = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (asking && !before.current && document.activeElement instanceof HTMLElement)
      before.current = document.activeElement;
  }, [asking]);
  useEffect(
    () => () => {
      const el = before.current;
      const lost = !document.activeElement || document.activeElement === document.body;
      if (el?.isConnected && lost) el.focus({ preventScroll: true });
    },
    [],
  );
  return (
    <Sheet open={inRack.length > 0} onClose={onCancel} title={t("inRack.confirmTitle")}>
      {inRack.length > 0 && (
        <div className="flex flex-col gap-4" data-testid="shared-place-confirm">
          <p className="text-body text-ink-2">{askText(t, inRack, wine)}</p>
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              block
              loading={pending}
              onClick={onConfirm}
              data-testid="shared-place-confirm-yes"
            >
              {t(several ? "inRack.confirmSeveral" : "inRack.confirm")}
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
export function SharedPlaceCount({
  bottleIds,
  className,
}: {
  /** Only these bottles (left out: every bottle of mine without a place). */
  bottleIds?: readonly string[] | undefined;
  className?: string | undefined;
}) {
  const t = useTranslations("sharedRacks");
  const places = useSharedPlaces();
  const count = bottleIds ? bottleIds.filter((id) => places.of(id) !== null).length : places.count;
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
