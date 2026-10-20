"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import {
  ERROR_MESSAGES,
  formatVintage,
  UpdateStorageSchema,
  type PlacedBottle,
  type RackUnit,
  type StorageKind,
} from "@cellr/domain";
import { checkMessage, errorMessage } from "@/lib/api";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { Button, buttonStyles } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { useDeleteStorage, useUpdateStorage } from "./hooks";
import { KindPicker, StepRow } from "./new-place-sheet";
import { STAGE } from "./wine-card";
import { shapeFor } from "./wine-visuals";

const wineLine = (b: PlacedBottle) => `${b.producer} · ${b.wineName} ${formatVintage(b.year)}`;

// ---- Tap a bottle in a rack ----------------------------------------------------------------------------

interface PeekProps {
  bottle: PlacedBottle | null;
  unitLabel: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  /** Omit where moving is not offered (the 3D view). */
  onMove?: (() => void) | undefined;
  onOpen: () => void;
}

/** A bottle in a rack: what it is, where it is, and the three things you may want to do. */
export function BottlePeekSheet({
  bottle,
  unitLabel,
  busy,
  error,
  onClose,
  onMove,
  onOpen,
}: PeekProps) {
  const t = useTranslations("racks");
  const tv = useTranslations("vintage");
  return (
    <Sheet
      open={bottle !== null}
      onClose={onClose}
      title={bottle?.wineName ?? ""}
      description={bottle?.producer}
    >
      {bottle && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-4 rounded-card bg-surface p-2 pr-4 shadow-raised ring-1 ring-hairline">
            <div
              className={cn(
                "relative grid h-24 w-20 shrink-0 place-items-end justify-items-center overflow-hidden rounded-[16px]",
                STAGE[bottle.type],
              )}
            >
              <span
                aria-hidden="true"
                className="absolute -bottom-6 left-1/2 size-20 -translate-x-1/2 rounded-full bg-surface/45"
              />
              <BottleGlyph
                shape={shapeFor(bottle.type)}
                tint={bottle.type}
                className="relative mb-1 h-20 w-auto"
              />
            </div>
            <div className="min-w-0">
              <p className="font-display text-headline tnum">{formatVintage(bottle.year)}</p>
              <p className="text-small text-ink-2">
                {bottle.row !== null && bottle.col !== null
                  ? `${unitLabel ?? ""} · ${tv("spot", { row: bottle.row, col: bottle.col })}`
                  : tv("notPlaced")}
              </p>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" className="col-span-2" loading={busy} onClick={onOpen}>
              {t("peekOpen")}
            </Button>
            {onMove && (
              <Button size="lg" variant="secondary" onClick={onMove}>
                {t("peekMove")}
              </Button>
            )}
            <Link
              href={`/cellar/${bottle.vintageId}`}
              className={buttonStyles({
                variant: "secondary",
                size: "lg",
                className: onMove ? "" : "col-span-2",
              })}
            >
              {t("peekDetails")}
            </Link>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ---- Tap a free spot with nothing selected -------------------------------------------------------------

interface PlaceHereProps {
  target: { unit: RackUnit; row: number; col: number } | null;
  unplaced: PlacedBottle[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onPlace: (bottle: PlacedBottle) => void;
}

/** "Which bottle goes here?" — the bottles without a place, one tap each. */
export function PlaceHereSheet({
  target,
  unplaced,
  busy,
  error,
  onClose,
  onPlace,
}: PlaceHereProps) {
  const t = useTranslations("racks");
  const tv = useTranslations("vintage");
  const spot = target
    ? `${target.unit.label} · ${tv("spot", { row: target.row, col: target.col })}`
    : "";
  return (
    <Sheet open={target !== null} onClose={onClose} title={t("placeTitle")} description={spot}>
      <div className="flex flex-col gap-4">
        {unplaced.length === 0 ? (
          <>
            <p className="text-body text-ink-2">{t("placeNone")}</p>
            <Link
              href="/cellar/add"
              className={buttonStyles({ variant: "primary", size: "lg", block: true })}
            >
              {t("addBottle")}
            </Link>
          </>
        ) : (
          <>
            <p className="text-body text-ink-2">{t("placeBody", { spot })}</p>
            <ul className="flex flex-col gap-2">
              {unplaced.map((b) => (
                <li key={b.bottleId}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPlace(b)}
                    className="flex min-h-16 w-full items-center gap-3 rounded-[20px] bg-surface p-2 pr-4 text-left ring-1 ring-hairline transition-[transform,background-color] duration-150 ease-cellr hover:bg-raised active:scale-[0.98] disabled:opacity-45"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-12 shrink-0 place-items-center overflow-hidden rounded-full",
                        STAGE[b.type],
                      )}
                    >
                      <BottleGlyph shape={shapeFor(b.type)} tint={b.type} className="h-10 w-auto" />
                    </span>
                    <span className="min-w-0 text-body text-ink">{wineLine(b)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

// ---- Rename, resize or delete a place ---------------------------------------------------------------------

export function ManagePlaceSheet({
  unit,
  onClose,
}: {
  unit: RackUnit | null;
  onClose: () => void;
}) {
  const t = useTranslations("racks");
  return (
    <Sheet
      open={unit !== null}
      onClose={onClose}
      title={t("manageTitle")}
      description={unit?.label}
    >
      {/* Remounted for each place, so the fields start from what is saved. */}
      {unit && <ManageForm key={unit.id} unit={unit} onClose={onClose} />}
    </Sheet>
  );
}

function ManageForm({ unit, onClose }: { unit: RackUnit; onClose: () => void }) {
  const t = useTranslations("racks");
  const tn = useTranslations("newPlace");
  const te = useTranslations();
  const toast = useToast();
  const update = useUpdateStorage();
  const remove = useDeleteStorage();

  const [label, setLabel] = useState(unit.label);
  const [kind, setKind] = useState<StorageKind>(unit.kind);
  const [rows, setRows] = useState(unit.rows);
  const [cols, setCols] = useState(unit.cols);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const patch: Record<string, unknown> = {};
    if (label.trim() !== unit.label) patch.label = label;
    if (kind !== unit.kind) patch.kind = kind;
    if (rows !== unit.rows) patch.rows = rows;
    if (cols !== unit.cols) patch.cols = cols;
    if (Object.keys(patch).length === 0) return onClose();
    const parsed = UpdateStorageSchema.safeParse(patch);
    if (!parsed.success) return setError(checkMessage(parsed.error.issues, te));
    try {
      await update.mutateAsync({ id: unit.id, patch: parsed.data });
      onClose();
      toast.show(t("saved"));
    } catch (e) {
      fail(e);
    }
  }

  async function destroy() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setError(null);
    try {
      await remove.mutateAsync(unit.id);
      onClose();
      toast.show(t("deleted"));
    } catch (e) {
      setConfirming(false);
      fail(e);
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-6">
      <Field
        label={tn("nameLabel")}
        autoComplete="off"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <KindPicker value={kind} onChange={setKind} label={tn("kindLabel")} />
      <StepRow label={tn("shelvesLabel")} value={rows} onChange={setRows} />
      <StepRow label={tn("positionsLabel")} value={cols} onChange={setCols} />
      <p className="text-center text-small text-ink-2">{tn("capacity", { count: rows * cols })}</p>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" block loading={update.isPending}>
        {t("save")}
      </Button>
      <Button
        variant="danger"
        size="lg"
        block
        loading={remove.isPending}
        onClick={destroy}
        className={confirming ? "bg-raised" : ""}
      >
        {confirming ? t("deleteConfirm") : t("delete")}
      </Button>
    </form>
  );
}
