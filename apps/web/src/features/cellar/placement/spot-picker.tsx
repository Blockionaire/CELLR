"use client";

import { useDepthOpen } from "../depth";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  cellChoices,
  reachable,
  type CellChoice,
  type ResolvedStorage,
  type SlotAddress,
  type SpotChoice,
} from "@cellr/domain";
import { cn } from "@/ui/cn";

/**
 * THE SPOT PICKER (Smart Cellar 3D, sprint 4): every spot of one place, flat, to choose where a bottle goes. The
 * same on every device and without WebGL, and the way a keyboard or a screen reader chooses a spot: nobody has to
 * turn the 3D picture to reach one. What each spot is comes from the domain (`cellChoices`): free, taken, the bottle
 * being moved, behind a taken front, past index 1 while depth is off, or (an unknown arrangement) not offered.
 *
 * A compartment of counters (bins) is one button with how full it is: it has no spots to point at. A spot behind
 * another is drawn as a small mark beside its front, never as a place of its own in front of anything.
 */
export type PickerChoice =
  { kind: "move"; address: SlotAddress } | { kind: "swap"; address: SlotAddress; bottleId: string };

export interface SpotPickerProps {
  resolved: ResolvedStorage;
  occupants: ReadonlyArray<{ bottleId: string; row: number; col: number; index: number }>;
  /** The bottle being moved, if it is in this place. */
  movingId: string | null;
  /** Whether a taken spot may be chosen to swap with (the bottle being moved has a place). */
  swapAllowed: boolean;
  /** What is chosen now. */
  chosen: PickerChoice | null;
  onChoose: (choice: PickerChoice) => void;
  /** A bottle's name, for what a taken spot says. */
  nameOf: (bottleId: string) => string;
  label: string;
}

type Target = {
  key: string;
  row: number;
  col: number;
  index: number;
  choice: PickerChoice | null;
  label: string;
  state: SpotChoice["state"] | "compartment" | "full";
};

export function SpotPicker({
  resolved,
  occupants,
  movingId,
  swapAllowed,
  chosen,
  onChoose,
  nameOf,
  label,
}: SpotPickerProps) {
  const t = useTranslations("placement");
  // depth is decided by the server (sprint 9); closed, every spot past index 1 stays "not switched on yet"
  const depth = useDepthOpen();
  const cells = useMemo(
    () => cellChoices(resolved, occupants, { movingId, depthEnabled: depth }),
    [resolved, occupants, movingId, depth],
  );
  const { rows, cols } = resolved.structure;
  const byCell = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));

  const targetsOf = (cell: CellChoice): Target[] => {
    if (cell.meaning === "ordinal") {
      // full, or (while depth is off) holding a bottle already and so unable to take one at index 2: not the same
      const full = cell.used >= cell.capacity;
      const state = full ? "full" : cell.next ? "compartment" : "depth_off";
      return [
        {
          key: `${cell.row}:${cell.col}`,
          row: cell.row,
          col: cell.col,
          index: cell.next?.index ?? 1,
          choice: cell.next ? { kind: "move", address: cell.next } : null,
          state,
          label: t(
            full
              ? "spot.compartmentFull"
              : cell.next
                ? "spot.compartment"
                : "spot.compartmentDepthOff",
            {
              row: cell.row,
              col: cell.col,
              used: cell.used,
              capacity: cell.capacity,
            },
          ),
        },
      ];
    }
    return cell.spots.map((s) => {
      const where = { row: s.address.row, col: s.address.col, index: s.address.index };
      // "place n from the front" only where the index IS a position (never for an arrangement that is not known)
      const deep = cell.capacity > 1 && cell.meaning === "depth";
      type SpotKey =
        | "free"
        | "taken"
        | "takenSwap"
        | "takenBehind"
        | "current"
        | "behind"
        | "depthOff"
        | "unknown";
      const say = (key: SpotKey, extra: Record<string, string | number> = {}) =>
        deep
          ? t(`spot.deep.${key}`, { ...where, ...extra })
          : t(`spot.${key}`, { ...where, ...extra });
      let choice: PickerChoice | null = null;
      let text: string;
      switch (s.state) {
        case "free":
          choice = { kind: "move", address: s.address };
          text = say("free");
          break;
        case "taken":
          // a bottle behind another one is reached by moving the front one first: not a swap partner (ADR-011 §4.2)
          if (
            deep &&
            swapAllowed &&
            !reachable(resolved, occupants, s.address, movingId ? [movingId] : [])
          ) {
            text = say("takenBehind", { wine: nameOf(s.bottleId ?? "") });
            break;
          }
          if (swapAllowed && s.bottleId)
            choice = { kind: "swap", address: s.address, bottleId: s.bottleId };
          text = say(swapAllowed ? "takenSwap" : "taken", { wine: nameOf(s.bottleId ?? "") });
          break;
        case "current":
          text = say("current");
          break;
        case "behind":
          text = say("behind");
          break;
        case "depth_off":
          text = say("depthOff");
          break;
        default:
          text = say("unknown");
      }
      return {
        key: `${s.address.row}:${s.address.col}:${s.address.index}`,
        ...where,
        choice,
        state: s.state,
        label: text,
      };
    });
  };

  // one focusable button at a time; arrow keys move between cells, Enter or Space chooses
  const all = useMemo(() => {
    const out: Target[] = [];
    for (let r = 1; r <= rows; r++)
      for (let c = 1; c <= cols; c++) {
        const cell = byCell.get(`${r}:${c}`);
        if (cell) out.push(...targetsOf(cell));
      }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed with the cells and the words
  }, [cells, swapAllowed, rows, cols, t]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const isChosen = (target: Target) =>
    chosen !== null &&
    chosen.address.row === target.row &&
    chosen.address.col === target.col &&
    (target.state === "compartment" || chosen.address.index === target.index);
  const current =
    focusKey && all.some((x) => x.key === focusKey)
      ? focusKey
      : (all.find(isChosen)?.key ?? all.find((x) => x.choice)?.key ?? all[0]?.key ?? null);

  const move = (event: KeyboardEvent, target: Target) => {
    const step: Record<string, [number, number]> = {
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
    };
    const d = step[event.key];
    if (!d) return;
    event.preventDefault();
    // left and right step through a cell's own spots (front to back) before going to the next cell
    if (d[1] !== 0) {
      const within = all.find(
        (x) => x.row === target.row && x.col === target.col && x.index === target.index + d[1],
      );
      if (within && within.key !== target.key) {
        setFocusKey(within.key);
        refs.current.get(within.key)?.focus();
        return;
      }
    }
    const row = Math.min(rows, Math.max(1, target.row + d[0]));
    const col = Math.min(cols, Math.max(1, target.col + d[1]));
    const next =
      all.find((x) => x.row === row && x.col === col && x.index === target.index) ??
      all.find((x) => x.row === row && x.col === col);
    if (next) {
      setFocusKey(next.key);
      refs.current.get(next.key)?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={label}
        data-testid="spot-picker"
        className="-mx-1 overflow-x-auto px-1 pb-1"
      >
        <div className="inline-flex min-w-full flex-col gap-1 sm:gap-1.5">
          {Array.from({ length: rows }, (_, i) => i + 1).map((row) => {
            const zone = byCell.get(`${row}:1`)?.zone ?? null;
            return (
              <div key={row} className="flex items-stretch gap-1 sm:gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex w-5 shrink-0 items-center justify-center rounded-md text-caption tnum text-ink-2 sm:w-7",
                    // light tints carry their own dark text: the theme's ink is light in dark mode
                    zone?.purpose === "serving" && "bg-[#e7d3c0] text-[#2a2420]",
                    zone?.purpose === "storage" && "bg-[#d9dfe6] text-[#2a2420]",
                  )}
                  title={zone ? t(`zone.${zone.purpose}`) : undefined}
                  data-zone={zone ? zone.purpose : ""}
                >
                  {row}
                </span>
                {Array.from({ length: cols }, (_, j) => j + 1).map((col) => {
                  const cell = byCell.get(`${row}:${col}`);
                  if (!cell) return <span key={col} className="size-11 shrink-0" />;
                  const targets = targetsOf(cell);
                  return (
                    <div
                      key={col}
                      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-raised p-0.5"
                    >
                      {targets.map((target, k) => (
                        <button
                          key={target.key}
                          ref={(el) => {
                            if (el) refs.current.set(target.key, el);
                            else refs.current.delete(target.key);
                          }}
                          type="button"
                          tabIndex={target.key === current ? 0 : -1}
                          aria-label={target.label}
                          aria-pressed={isChosen(target)}
                          aria-disabled={target.choice === null}
                          data-spot={target.key}
                          data-state={target.state}
                          onClick={() => target.choice && onChoose(target.choice)}
                          onKeyDown={(e) => move(e, target)}
                          onFocus={() => setFocusKey(target.key)}
                          className={cn(
                            "grid place-items-center rounded-md text-caption font-medium transition-colors duration-150",
                            // the front (or only) spot is a full target; spots behind are small marks beside it
                            cell.meaning === "ordinal"
                              ? "h-10 w-14"
                              : k === 0
                                ? "size-10"
                                : "h-10 w-4",
                            target.state === "free" &&
                              "bg-surface text-ink-2 ring-1 ring-hairline hover:ring-accent",
                            target.state === "compartment" &&
                              "bg-surface text-ink-2 ring-1 ring-hairline hover:ring-accent",
                            target.state === "full" && "bg-hairline/60 text-ink-2",
                            target.state === "taken" &&
                              (target.choice
                                ? "bg-[#6b2a35] text-white hover:brightness-110"
                                : "bg-[#6b2a35]/70 text-white"),
                            target.state === "current" &&
                              "bg-[#d9a441] text-[#2a2420] ring-2 ring-[#d9a441] ring-offset-1 ring-offset-raised",
                            (target.state === "behind" ||
                              target.state === "depth_off" ||
                              target.state === "unknown") &&
                              "bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,var(--hairline)_3px,var(--hairline)_5px)] text-ink-3",
                            target.choice === null && "cursor-not-allowed",
                            isChosen(target) &&
                              "ring-[3px] ring-accent ring-offset-2 ring-offset-raised",
                          )}
                        >
                          {cell.meaning === "ordinal"
                            ? `${cell.used}/${cell.capacity}`
                            : k === 0
                              ? col
                              : ""}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2" aria-hidden="true">
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-surface ring-1 ring-hairline" />
          {t("legend.free")}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-[#6b2a35]" />
          {t("legend.taken")}
        </li>
        {movingId && (
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-[#d9a441]" />
            {t("legend.current")}
          </li>
        )}
        {cells.some(
          (c) =>
            (c.meaning === "ordinal" && c.next === null && c.used < c.capacity) ||
            (c.meaning !== "ordinal" &&
              c.spots.some(
                (s) => s.state !== "free" && s.state !== "taken" && s.state !== "current",
              )),
        ) && (
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,var(--hairline)_2px,var(--hairline)_4px)] ring-1 ring-hairline" />
            {t("legend.unavailable")}
          </li>
        )}
      </ul>
    </div>
  );
}
