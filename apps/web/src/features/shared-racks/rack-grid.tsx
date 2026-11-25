"use client";

import { useTranslations } from "next-intl";
import type { ResolvedStorage, SharedRackBottleView } from "@cellr/domain";
import type { FreeSpot } from "@/features/cellar/quick-add/spots";
import { cn } from "@/ui/cn";
import { bottleName } from "./logic";

/** The colour of the wine, as a dot next to words (never the only sign of anything). */
const DOT: Record<string, string> = {
  red: "bg-[#7d2234]",
  white: "bg-[#d9c873]",
  rose: "bg-[#e7a0a8]",
  sparkling: "bg-[#e3d9a6]",
  orange: "bg-[#d98a3d]",
  dessert: "bg-[#c79a2e]",
  fortified: "bg-[#5a2a1c]",
};

const initials = (name: string | null) =>
  (name ?? "?")
    .replace(/^@/, "")
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

/**
 * THE RACK, FLAT: every shelf and every spot as a button, for a device without 3D, a lost 3D picture, a keyboard or a
 * screen reader, and for anyone who prefers it. It does everything the 3D picture does: a bottle is chosen by its
 * button (its panel is under the grid), and while a spot is being chosen the free spots are the buttons.
 *
 * Each button says in words what it is (shelf, spot, the wine and whose it is, or "free"). A bottle the owner filter
 * leaves out is dimmed and says so; it stays where it is and still takes its spot.
 */
export function RackGrid({
  resolved,
  bottles,
  shown,
  selectedId,
  onSelect,
  free,
  onSpot,
  label,
}: {
  resolved: ResolvedStorage;
  /** Every bottle in the rack. */
  bottles: readonly SharedRackBottleView[];
  /** The placement ids the owner filter shows. */
  shown: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (placementId: string | null) => void;
  /** The free spots on offer (a spot is being chosen), or null. */
  free: readonly FreeSpot[] | null;
  onSpot: (spot: FreeSpot) => void;
  label: string;
}) {
  const t = useTranslations("sharedRacks");
  const { rows, cols } = resolved.structure;
  const at = new Map(bottles.filter((b) => b.index === 1).map((b) => [`${b.row}:${b.col}`, b]));
  const offered = new Map((free ?? []).map((s) => [`${s.row}:${s.col}`, s]));
  const cell =
    "grid size-11 shrink-0 place-items-center rounded-control text-caption font-medium transition-colors";
  return (
    <div
      role="group"
      aria-label={label}
      data-testid="shared-rack-grid"
      className="overflow-x-auto rounded-card bg-raised p-3"
    >
      <div className="flex w-max flex-col gap-1">
        {Array.from({ length: rows }, (_, r) => (
          <div
            key={r}
            className="flex items-center gap-1"
            role="group"
            aria-label={t("shelf", { row: r + 1 })}
          >
            <span
              className="w-6 shrink-0 text-center text-caption text-ink-3 tnum"
              aria-hidden="true"
            >
              {r + 1}
            </span>
            {Array.from({ length: cols }, (_, c) => {
              const key = `${r + 1}:${c + 1}`;
              const bottle = at.get(key);
              const spot = offered.get(key);
              if (bottle) {
                const dimmed = !shown.has(bottle.placementId);
                const selected = bottle.placementId === selectedId;
                return (
                  <button
                    key={key}
                    type="button"
                    data-testid="shared-rack-cell"
                    data-spot={key}
                    data-placement={bottle.placementId}
                    data-dimmed={dimmed ? "true" : "false"}
                    aria-pressed={selected}
                    // while a spot is being chosen, a bottle is not what is being chosen
                    disabled={free !== null}
                    aria-label={t(dimmed ? "cellBottleHidden" : "cellBottle", {
                      row: r + 1,
                      col: c + 1,
                      wine: bottleName(bottle),
                      owner: bottle.mine ? t("you") : (bottle.owner.name ?? t("someone")),
                    })}
                    onClick={() => onSelect(selected ? null : bottle.placementId)}
                    className={cn(
                      cell,
                      "relative border bg-surface text-ink",
                      selected ? "border-accent-fg ring-2 ring-accent-fg/40" : "border-hairline",
                      dimmed && "opacity-35",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute left-1 top-1 size-2 rounded-full",
                        DOT[bottle.type] ?? "bg-ink-3",
                      )}
                      aria-hidden="true"
                    />
                    <span aria-hidden="true">
                      {bottle.mine ? t("youShort") : initials(bottle.owner.name)}
                    </span>
                  </button>
                );
              }
              return spot ? (
                <button
                  key={key}
                  type="button"
                  data-testid="shared-rack-free"
                  data-spot={key}
                  aria-label={t("cellFreeChoose", { row: r + 1, col: c + 1 })}
                  onClick={() => onSpot(spot)}
                  className={cn(
                    cell,
                    "border border-dashed border-accent-fg text-accent-fg hover:bg-surface",
                  )}
                >
                  <span aria-hidden="true">+</span>
                </button>
              ) : (
                <span
                  key={key}
                  data-spot={key}
                  role="img"
                  aria-label={t("cellFree", { row: r + 1, col: c + 1 })}
                  className={cn(cell, "border border-dashed border-hairline text-ink-3")}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
