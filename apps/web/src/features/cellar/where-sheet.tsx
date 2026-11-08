"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import type { RackUnit, WhereSummary } from "@cellr/domain";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { useRacks, vintageKey } from "./hooks";
import { RackGrid } from "./rack-grid";

const key = (locationId: string | null, row: number | null, col: number | null) =>
  `${locationId}:${row}:${col}`;

/**
 * "Where is it?" from the wine's page: every place holding this vintage, drawn as the real rack (the same 2D grid
 * as the Racks view), with this wine's bottles ringed. Read only: nothing here can be tapped to move, swap, open or
 * remove a bottle. The racks are read when the sheet opens, so a bottle moved in the meantime is shown where it is
 * now, and the page catches up.
 */
export function WhereSheet({
  open,
  onClose,
  vintageId,
  where,
}: {
  open: boolean;
  onClose: () => void;
  vintageId: string;
  /** What the page knew when the sheet was opened (by stable place id), to notice when the racks say otherwise. */
  where: WhereSummary;
}) {
  const t = useTranslations("vintage");
  const racks = useRacks(open);
  const queryClient = useQueryClient();

  // This vintage, as the racks have it now: its places (by id), the bottles in them, and the ones without a place.
  const fresh = useMemo(() => {
    if (!racks.data) return null;
    const units: Array<{ unit: RackUnit; mine: RackUnit["bottles"] }> = [];
    for (const unit of racks.data.units) {
      const mine = unit.bottles.filter((b) => b.vintageId === vintageId);
      if (mine.length > 0) units.push({ unit, mine });
    }
    // The page's order (by place name), then any place the page did not know about yet.
    const order = new Map(where.units.map((u, i) => [u.id, i]));
    units.sort(
      (a, b) =>
        (order.get(a.unit.id) ?? Infinity) - (order.get(b.unit.id) ?? Infinity) ||
        a.unit.label.localeCompare(b.unit.label),
    );
    const unplaced = racks.data.unplaced.filter((b) => b.vintageId === vintageId).length;
    const keys = new Set(
      units.flatMap(({ unit, mine }) => mine.map((b) => key(unit.id, b.row, b.col))),
    );
    return { units, unplaced, keys };
  }, [racks.data, vintageId, where.units]);

  // A bottle moved since the page loaded (here, or on another phone): show it where it is, and refresh the page.
  const known = useMemo(() => {
    const exact = where.spots.filter((s) => s.row !== null && s.col !== null);
    return {
      keys: new Set(exact.map((s) => key(s.locationId, s.row, s.col))),
      // the racks list a bottle without an exact spot among the unplaced
      unplaced: where.unplaced + where.spots.length - exact.length,
    };
  }, [where.spots, where.unplaced]);
  const stale =
    fresh !== null &&
    (fresh.keys.size !== known.keys.size ||
      [...fresh.keys].some((k) => !known.keys.has(k)) ||
      fresh.unplaced !== known.unplaced);
  useEffect(() => {
    if (open && stale) void queryClient.invalidateQueries({ queryKey: vintageKey(vintageId) });
  }, [open, stale, queryClient, vintageId]);

  return (
    <Sheet open={open} onClose={onClose} title={t("whereTitle")} description={t("whereReadOnly")}>
      {/* Drawn only while open: a closed sheet holds no copy of the racks. */}
      {open && (
        <div data-testid="where-sheet" className="flex flex-col gap-6 pb-2">
          {racks.isPending ? (
            <p role="status" className="py-6 text-center text-small text-ink-2">
              {t("whereLoading")}
            </p>
          ) : racks.isError || !fresh ? (
            <div role="alert" className="flex flex-col items-start gap-3 py-4">
              <p className="text-small text-danger">{t("whereFailed")}</p>
              <Button size="sm" variant="secondary" onClick={() => void racks.refetch()}>
                {t("whereRetry")}
              </Button>
            </div>
          ) : (
            <>
              {stale && (
                <p role="status" className="rounded-card bg-raised px-4 py-3 text-small text-ink-2">
                  {t("whereUpdated")}
                </p>
              )}
              {fresh.units.length === 0 && (
                <p className="text-small text-ink-2">{t("whereNone")}</p>
              )}
              {fresh.units.map(({ unit, mine }) => {
                const spots = [...mine].sort(
                  (a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0),
                );
                return (
                  <section
                    key={unit.id}
                    aria-label={unit.label}
                    data-testid="where-unit"
                    data-location-id={unit.id}
                    className="flex flex-col gap-3"
                  >
                    <header className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5">
                      <h3 className="min-w-0 break-words font-display text-title text-ink">
                        {unit.label}
                      </h3>
                      <span className="shrink-0 text-caption text-ink-3 tnum">
                        {t("whereThisWine", { count: mine.length })}
                      </span>
                    </header>
                    <RackGrid
                      rows={unit.rows}
                      cols={unit.cols}
                      bottles={unit.bottles}
                      highlight={new Set(mine.map((b) => b.bottleId))}
                      label={unit.label}
                      fill
                      className="-mx-1 max-w-full"
                    />
                    <ul
                      className="flex flex-col gap-1 text-body text-ink"
                      data-testid="where-spots"
                    >
                      {spots.map((b) => (
                        <li key={b.bottleId} className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="size-2.5 shrink-0 rounded-full ring-2 ring-accent-fg"
                          />
                          <span className="tnum">{t("spot", { row: b.row!, col: b.col! })}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {fresh.unplaced > 0 && (
                <p className="text-small text-ink-2" data-testid="where-unplaced">
                  {t("whereUnplaced", { count: fresh.unplaced })}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
