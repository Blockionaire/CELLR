"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ERROR_MESSAGES, nextFreeSlots, type BottleView, type VintageDetail } from "@cellr/domain";
import { ConfirmSheet } from "@/features/account/confirm-sheet";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { useBottleAction, useRacks } from "./hooks";

type Place = { locationId: string | null; row: number | null; col: number | null };

/**
 * Several bottles of one wine at once: move them to a place (they take the next free spots), give them away,
 * or take them out. Each is its own action underneath, so a single Undo puts every one of them back.
 */
export function BulkBar({
  detail,
  selected,
  onDone,
}: {
  detail: VintageDetail;
  selected: readonly string[];
  onDone: () => void;
}) {
  const t = useTranslations("bulk");
  const tc = useTranslations("common");
  const tOpen = useTranslations("openBottle");
  const te = useTranslations();
  const toast = useToast();
  const action = useBottleAction();
  const racks = useRacks();
  const [confirm, setConfirm] = useState<"removed" | "gifted" | null>(null);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

  const chosen = detail.bottles.filter((b) => selected.includes(b.id));
  const count = chosen.length;

  /** Puts every bottle back where it was, in one go. */
  const undoAll = (previous: Array<{ id: string; previous: Place }>) => ({
    label: tOpen("undo"),
    onClick: () => {
      void Promise.all(
        previous.map((p) =>
          action.mutateAsync({ bottleId: p.id, action: { action: "restore", to: p.previous } }),
        ),
      )
        .then(() => toast.show(tOpen("restored")))
        .catch((e) => toast.show(fail(e), { tone: "error" }));
    },
  });

  async function leave(reason: "removed" | "gifted") {
    setBusy(true);
    const done: Array<{ id: string; previous: Place }> = [];
    try {
      for (const b of chosen) {
        const { previous } = await action.mutateAsync({
          bottleId: b.id,
          action: { action: "remove", reason },
        });
        done.push({ id: b.id, previous });
      }
      toast.show(t(reason === "gifted" ? "gifted" : "removed", { count: done.length }), {
        action: undoAll(done),
      });
      setConfirm(null);
      onDone();
    } catch (e) {
      setConfirm(null);
      toast.show(fail(e), { tone: "error" });
      if (done.length > 0) onDone();
    } finally {
      setBusy(false);
    }
  }

  async function moveTo(unitId: string) {
    const unit = racks.data?.units.find((u) => u.id === unitId);
    if (!unit) return;
    setBusy(true);
    const toMove = chosen.filter((b) => b.locationId !== unitId);
    const slots = nextFreeSlots(
      { rows: unit.rows, cols: unit.cols },
      unit.bottles.flatMap((b) =>
        b.row !== null && b.col !== null ? [{ row: b.row, col: b.col }] : [],
      ),
      toMove.length,
    );
    const moved: Array<{ bottle: BottleView; slot: { row: number; col: number } }> = [];
    try {
      for (const [i, slot] of slots.entries()) {
        const bottle = toMove[i]!;
        await action.mutateAsync({
          bottleId: bottle.id,
          action: { action: "move", to: { locationId: unit.id, row: slot.row, col: slot.col } },
        });
        moved.push({ bottle, slot });
      }
      const rest = toMove.length - moved.length;
      toast.show(
        rest > 0
          ? t("movedSome", { moved: moved.length, place: unit.label, rest })
          : t("moved", { count: moved.length, place: unit.label }),
        {
          action: {
            label: tOpen("undo"),
            onClick: () => {
              void Promise.all(
                moved.map(({ bottle }) =>
                  action.mutateAsync({
                    bottleId: bottle.id,
                    action: {
                      action: "move",
                      to: { locationId: bottle.locationId, row: bottle.row, col: bottle.col },
                    },
                  }),
                ),
              ).catch((e) => toast.show(fail(e), { tone: "error" }));
            },
          },
        },
      );
      setMoving(false);
      onDone();
    } catch (e) {
      toast.show(fail(e), { tone: "error" });
      if (moved.length > 0) onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        role="toolbar"
        aria-label={t("toolbar")}
        className="mt-4 flex flex-wrap items-center gap-2 rounded-control bg-raised p-3"
      >
        <p className="mr-auto text-small font-medium text-ink" aria-live="polite">
          {t("selected", { count })}
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={count === 0 || busy}
          onClick={() => setMoving(true)}
        >
          {t("moveTo")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={count === 0 || busy}
          onClick={() => setConfirm("gifted")}
        >
          {t("gaveAway")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={count === 0 || busy}
          onClick={() => setConfirm("removed")}
        >
          {t("remove")}
        </Button>
      </div>

      <ConfirmSheet
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t(confirm === "gifted" ? "gaveAwayTitle" : "removeTitle", { count })}
        body={t(confirm === "gifted" ? "gaveAwayBody" : "removeBody")}
        confirmLabel={confirm === "gifted" ? t("gaveAway") : t("remove")}
        onConfirm={() => confirm && void leave(confirm)}
        loading={busy}
      />

      <Sheet
        open={moving}
        onClose={() => setMoving(false)}
        title={t("moveTitle", { count })}
        closeLabel={tc("close")}
      >
        {moving && (
          <ul className="flex flex-col gap-2">
            {racks.data?.units.length === 0 && (
              <li className="text-body text-ink-2">{t("noPlaces")}</li>
            )}
            {racks.data?.units.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  disabled={busy || u.free === 0}
                  onClick={() => void moveTo(u.id)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-control border border-hairline bg-surface px-4 text-left disabled:opacity-45"
                >
                  <span className="text-body text-ink">{u.label}</span>
                  <span className="text-small text-ink-2 tnum">{t("free", { free: u.free })}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}
