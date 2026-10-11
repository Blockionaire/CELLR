"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import {
  CreateStorageSchema,
  ERROR_MESSAGES,
  STORAGE_KINDS,
  type StorageKind,
  type StorageUnitView,
} from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Field } from "@/ui/field";
import { Sheet } from "@/ui/sheet";
import { Stepper } from "@/ui/stepper";
import { useCreateStorage } from "./hooks";

/** Sensible starting grids, so most people just tap "Create". */
const DEFAULT_GRID: Record<StorageKind, { rows: number; cols: number }> = {
  fridge: { rows: 5, cols: 4 },
  rack: { rows: 5, cols: 8 },
  cabinet: { rows: 4, cols: 6 },
  shelving: { rows: 4, cols: 6 },
  wall: { rows: 6, cols: 6 },
  other: { rows: 4, cols: 6 },
};

interface NewPlaceSheetProps {
  open: boolean;
  onClose: () => void;
  onCreated: (unit: StorageUnitView) => void;
}

/** Create a fridge, rack or cabinet in under ten seconds: a name, a kind, and its shelves. */
export function NewPlaceSheet({ open, onClose, onCreated }: NewPlaceSheetProps) {
  const t = useTranslations("newPlace");
  const tKinds = useTranslations("storageKinds");
  const te = useTranslations();
  const create = useCreateStorage();

  const [kind, setKind] = useState<StorageKind>("fridge");
  const [name, setName] = useState<string | null>(null); // null = still the kind's default name
  const [rows, setRows] = useState(DEFAULT_GRID.fridge.rows);
  const [cols, setCols] = useState(DEFAULT_GRID.fridge.cols);
  const [error, setError] = useState<string | null>(null);

  const label = name ?? tKinds(kind);

  function pickKind(next: StorageKind) {
    setKind(next);
    setRows(DEFAULT_GRID[next].rows);
    setCols(DEFAULT_GRID[next].cols);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = CreateStorageSchema.safeParse({ label, kind, rows, cols });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
    try {
      const unit = await create.mutateAsync(parsed.data);
      onCreated(unit);
      onClose();
      setName(null);
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("title")} description={t("body")}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <div>
          <p className="mb-2 text-small font-medium text-ink-2">{t("kindLabel")}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("kindLabel")}>
            {STORAGE_KINDS.map((k) => (
              <Chip key={k} selected={kind === k} onClick={() => pickKind(k)}>
                {tKinds(k)}
              </Chip>
            ))}
          </div>
        </div>

        <Field
          label={t("nameLabel")}
          placeholder={t("namePlaceholder")}
          autoComplete="off"
          value={label}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="flex items-center justify-between gap-4">
          <span className="text-body text-ink">{t("shelvesLabel")}</span>
          <Stepper label={t("shelvesLabel")} value={rows} onChange={setRows} min={1} max={30} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-body text-ink">{t("positionsLabel")}</span>
          <Stepper label={t("positionsLabel")} value={cols} onChange={setCols} min={1} max={30} />
        </div>

        <p className="text-center text-small text-ink-2">{t("capacity", { count: rows * cols })}</p>
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" block loading={create.isPending}>
          {t("create")}
        </Button>
      </form>
    </Sheet>
  );
}
