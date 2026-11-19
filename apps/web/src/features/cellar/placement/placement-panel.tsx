"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ERROR_MESSAGES,
  formatVintage,
  placementMeaning,
  zoneOfRow,
  type SmartMoveResult,
  type SmartSpot,
  type SmartStorageUnitView,
  type SmartSwapResult,
} from "@cellr/domain";
import { ApiError, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Skeleton } from "@/ui/skeleton";
import { useSmartPlacements } from "../smart-cellar-hooks";
import { resolvedFromView } from "../storage3d/from-api";
import { uncertain, useSmartMove, useSmartSwap, useWhereIsBottle } from "./placement-hooks";
import { SpotPicker, type PickerChoice } from "./spot-picker";
import { tempText } from "./zone-legend";

/** A bottle that can be put somewhere, as the panel needs it. */
export interface MovableBottle {
  bottleId: string;
  /** "Château Margaux Pavillon Rouge 2015". */
  name: string;
  /** Where it is now (whole), or null: no place yet. */
  from: SmartSpot | null;
}

/**
 * What was done. `undoable: false` when the outcome was only established by reading afterwards (the answer was
 * lost): the bottle is where it was asked to go, but this screen can't know that its own request put it there, so it
 * offers no Undo that could overwrite someone else's move.
 */
export type PlacementDone =
  | {
      kind: "moved";
      bottle: MovableBottle;
      result: SmartMoveResult;
      where: string;
      undoable?: boolean;
    }
  | {
      kind: "swapped";
      bottle: MovableBottle;
      other: MovableBottle;
      result: SmartSwapResult;
      undoable?: boolean;
    };

export interface PlacementPanelProps {
  /** The bottle to move, or null: choose a spot first, then which bottle without a place goes there. */
  bottle: MovableBottle | null;
  units: readonly SmartStorageUnitView[];
  /** The place whose spots are shown (the 3D picture shows the same place). */
  unitId: string;
  onUnit: (unitId: string) => void;
  /** Bottles without a place, for choosing one after a spot (destination first). */
  unplaced: readonly MovableBottle[];
  /** Where the chosen spot is, for the ring in the 3D picture (null: none). */
  onTarget: (target: { unitId: string; row: number; col: number; index: number } | null) => void;
  onDone: (done: PlacementDone) => void;
  onCancel: () => void;
  /** Whether this deployment writes (otherwise the panel shows and explains, and does not confirm). */
  canWrite: boolean;
}

/**
 * PLACING A BOTTLE (Smart Cellar 3D, sprint 4): choose a place and a spot, see what will happen, confirm. Nothing
 * moves on screen until the server has said it moved: the 3D picture only rings the chosen spot. One request does
 * the whole move (or swap); a refusal is said as what it is; a lost answer is checked against a fresh read before
 * anything else is offered.
 */
export function PlacementPanel({
  bottle,
  units,
  unitId,
  onUnit,
  unplaced,
  onTarget,
  onDone,
  onCancel,
  canWrite,
}: PlacementPanelProps) {
  const t = useTranslations("placement");
  const tz = useTranslations("placement.zone");
  const locale = useLocale();
  const te = useTranslations();
  const move = useSmartMove();
  const swap = useSmartSwap();
  const whereIs = useWhereIsBottle();
  const query = useSmartPlacements(unitId);
  const unit = query.data?.unit ?? units.find((u) => u.id === unitId) ?? null;
  const placements = query.data?.placements;
  const resolved = useMemo(() => (unit ? resolvedFromView(unit) : null), [unit]);
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
  const names = useMemo(
    () =>
      new Map(
        (placements ?? []).map((p) => [
          p.bottleId,
          `${p.producer} ${p.wineName} ${formatVintage(p.year)}`,
        ]),
      ),
    [placements],
  );
  const [choice, setChoice] = useState<PickerChoice | null>(null);
  const [who, setWho] = useState<MovableBottle | null>(bottle);
  // opened from a spot (no bottle yet): the list of bottles stays, so the choice can still be changed
  const [spotFirst] = useState(bottle === null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // focus goes to the panel when it opens (keyboard and screen-reader users land where the work is)
  useEffect(() => heading.current?.focus(), []);
  // a new place: nothing is chosen there yet
  const [shownUnit, setShownUnit] = useState(unitId);
  if (shownUnit !== unitId) {
    setShownUnit(unitId);
    setChoice(null);
    setProblem(null);
  }
  useEffect(() => {
    onTarget(choice ? { unitId, ...choice.address } : null);
  }, [choice, unitId, onTarget]);
  useEffect(() => () => onTarget(null), [onTarget]);

  const meaning = resolved ? placementMeaning(resolved) : null;
  const movingHere = who?.from?.locationId === unitId ? who.bottleId : null;
  const describe = (u: SmartStorageUnitView, row: number, col: number, index: number) => {
    const m = placementMeaning(resolvedFromView(u));
    const base =
      m === "ordinal"
        ? t("where.compartment", { unit: u.label, row, col })
        : m === "depth" && u.cellCapacity > 1
          ? t("where.deep", { unit: u.label, row, col, index })
          : t("where.spot", { unit: u.label, row, col });
    const zone = zoneOfRow(u.zones, row);
    if (!zone) return base;
    return `${base} · ${
      zone.targetTempC === null
        ? tz(zone.purpose)
        : t("zoneSet", { zone: tz(zone.purpose), temp: tempText(locale, zone.targetTempC) })
    }`;
  };
  const fromText = who?.from
    ? (() => {
        const u = units.find((x) => x.id === who.from!.locationId);
        return u ? describe(u, who.from.row, who.from.col, who.from.index) : t("where.elsewhere");
      })()
    : t("where.none");
  const targetText =
    unit && choice
      ? describe(unit, choice.address.row, choice.address.col, choice.address.index)
      : null;

  async function confirm() {
    if (!choice || !unit || !who) return;
    setBusy(true);
    setProblem(null);
    const to: SmartSpot = { locationId: unit.id, ...choice.address };
    try {
      if (choice.kind === "swap" && who.from) {
        const other: MovableBottle = {
          bottleId: choice.bottleId,
          name: names.get(choice.bottleId) ?? "",
          from: to,
        };
        const result = await swap.mutateAsync({
          bottleId: who.bottleId,
          swap: { with: choice.bottleId, expected: { self: who.from, other: to } },
        });
        onDone({ kind: "swapped", bottle: who, other, result });
      } else {
        const result = await move.mutateAsync({
          bottleId: who.bottleId,
          move: { from: who.from, to },
        });
        onDone({ kind: "moved", bottle: who, result, where: targetText ?? "" });
      }
    } catch (e) {
      if (uncertain(e) && choice.kind === "swap" && who.from) {
        // the answer was lost: a swap is reported only if BOTH bottles are now on each other's spot
        const from = who.from;
        const places = [unit.id, from.locationId];
        const [self, other] = await Promise.all([
          whereIs(who.bottleId, places),
          whereIs(choice.bottleId, places),
        ]);
        const on = (w: typeof self, spot: SmartSpot) =>
          w.kind === "at" &&
          w.spot.locationId === spot.locationId &&
          w.spot.row === spot.row &&
          w.spot.col === spot.col &&
          w.spot.index === spot.index;
        if (on(self, to) && on(other, from)) {
          onDone({
            kind: "swapped",
            bottle: who,
            other: { bottleId: choice.bottleId, name: names.get(choice.bottleId) ?? "", from: to },
            result: {
              self: { bottleId: who.bottleId, spot: to },
              other: { bottleId: choice.bottleId, spot: from },
            },
            undoable: false,
          });
          return;
        }
        setProblem(
          self.kind === "unknown" || other.kind === "unknown"
            ? t("uncertain")
            : t("notMoved", { reason: errorMessage(e, (k) => te(k), ERROR_MESSAGES) }),
        );
      } else if (uncertain(e) && choice.kind === "move") {
        // the answer was lost: look before saying anything, and never claim a move that did not happen
        const now = await whereIs(who.bottleId, [unit.id, who.from?.locationId ?? null]);
        // a compartment's counter is the server's choice; anywhere else the whole spot must be the one asked for
        const counters = resolved !== null && placementMeaning(resolved) === "ordinal";
        if (
          now.kind === "at" &&
          now.spot.locationId === to.locationId &&
          now.spot.row === to.row &&
          now.spot.col === to.col &&
          (counters || now.spot.index === to.index)
        ) {
          onDone({
            kind: "moved",
            bottle: who,
            result: { bottleId: who.bottleId, outcome: "moved", from: who.from, to: now.spot },
            where: targetText ?? "",
            undoable: false,
          });
          return;
        }
        setProblem(
          now.kind === "unknown"
            ? t("uncertain")
            : t("notMoved", { reason: errorMessage(e, (k) => te(k), ERROR_MESSAGES) }),
        );
      } else {
        setProblem(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
        if (e instanceof ApiError && e.code === "CONFLICT") await catchUp();
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * After a conflict (moved by someone else, a spot just taken): where the bottle is now, read fresh, becomes its
   * source, and the choice is cleared, so a second try is not stale again and nothing taken stays chosen.
   */
  async function catchUp() {
    if (!who) return;
    setChoice(null);
    const now = await whereIs(
      who.bottleId,
      units.map((u) => u.id),
    );
    if (now.kind === "at") setWho({ ...who, from: now.spot });
  }

  async function takeOff() {
    if (!who?.from) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await move.mutateAsync({
        bottleId: who.bottleId,
        move: { from: who.from, to: null },
      });
      onDone({ kind: "moved", bottle: who, result, where: t("where.none") });
    } catch (e) {
      setProblem(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="placement-title"
      className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline"
      data-testid="placement-panel"
      data-unit={unitId}
      data-choice={
        choice
          ? `${choice.kind}:${choice.address.row}:${choice.address.col}:${choice.address.index}`
          : ""
      }
    >
      <div className="flex flex-col gap-1">
        <h2
          id="placement-title"
          ref={heading}
          tabIndex={-1}
          className="font-display text-title text-ink outline-none"
        >
          {who ? t("titleMove", { wine: who.name }) : t("titlePlace")}
        </h2>
        {who && (
          <p className="text-small text-ink-2" data-testid="placement-from">
            {t("now", { where: fromText })}
          </p>
        )}
      </div>

      {units.length > 1 && (
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
          role="group"
          aria-label={t("places")}
          data-testid="placement-units"
        >
          {units.map((u) => {
            const unknown = !u.arrangementKnown;
            return (
              <Chip
                key={u.id}
                selected={u.id === unitId}
                disabled={unknown}
                title={unknown ? t("unknownPlace") : undefined}
                onClick={() => onUnit(u.id)}
              >
                {u.label}
              </Chip>
            );
          })}
        </div>
      )}

      {!unit || !resolved || !placements ? (
        <Skeleton className="h-40" />
      ) : meaning === "unknown" ? (
        <p
          className="rounded-card bg-raised p-3 text-small text-ink"
          data-testid="placement-unknown"
        >
          {t("unknownPlace")}
        </p>
      ) : (
        <SpotPicker
          resolved={resolved}
          occupants={occupants}
          movingId={movingHere}
          swapAllowed={who?.from !== null && who !== null}
          chosen={choice}
          onChoose={(c) => {
            setChoice(c);
            setProblem(null);
          }}
          nameOf={(id) => names.get(id) ?? ""}
          label={t("pickerLabel", { unit: unit.label })}
        />
      )}

      {unit && unit.zones.length > 0 && (
        <p className="text-caption text-ink-2" data-testid="placement-zones-note">
          {t("zonesNote")}
        </p>
      )}

      <div aria-live="polite" className="flex flex-col gap-1" data-testid="placement-summary">
        {targetText && choice?.kind === "move" && (
          <p className="text-small text-ink">{t("willMove", { where: targetText })}</p>
        )}
        {targetText && choice?.kind === "swap" && (
          <p className="text-small text-ink" data-testid="placement-swap">
            {t("willSwap", { wine: names.get(choice.bottleId) ?? "", where: targetText })}
          </p>
        )}
      </div>

      {spotFirst && choice?.kind === "move" && (
        <fieldset className="flex flex-col gap-2" data-testid="placement-which">
          <legend className="text-small font-medium text-ink">{t("whichBottle")}</legend>
          {unplaced.length === 0 ? (
            <p className="text-small text-ink-2">{t("noneUnplaced")}</p>
          ) : (
            unplaced.map((b) => (
              <label
                key={b.bottleId}
                className="flex min-h-11 items-center gap-3 text-small text-ink"
              >
                <input
                  type="radio"
                  name="placement-which"
                  checked={who?.bottleId === b.bottleId}
                  className="size-5 accent-[var(--color-accent)]"
                  onChange={() => setWho(b)}
                />
                {b.name}
              </label>
            ))
          )}
        </fieldset>
      )}

      {problem && (
        <p role="alert" className="text-small text-danger" data-testid="placement-problem">
          {problem}
        </p>
      )}
      {!canWrite && (
        <p role="note" className="text-small text-ink-2" data-testid="placement-read-only">
          {t("readOnly")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canWrite && (
          <Button
            onClick={() => void confirm()}
            disabled={!choice || !who || busy}
            loading={busy}
            data-testid="placement-confirm"
          >
            {choice?.kind === "swap"
              ? t("confirmSwap")
              : who?.from
                ? t("confirmMove")
                : t("confirmPlace")}
          </Button>
        )}
        {canWrite && who?.from && (
          <Button
            variant="secondary"
            onClick={() => void takeOff()}
            disabled={busy}
            data-testid="placement-take-off"
          >
            {t("takeOff")}
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={busy} data-testid="placement-cancel">
          {t("cancel")}
        </Button>
      </div>
    </section>
  );
}
