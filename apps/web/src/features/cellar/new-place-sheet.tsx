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
import { checkMessage, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { CheckIcon } from "@/ui/icons";
import { Sheet } from "@/ui/sheet";
import { Stepper } from "@/ui/stepper";
import { useCreateStorage, useStorage } from "./hooks";

/** Sensible starting grids, so most people just tap "Create". */
const DEFAULT_GRID: Record<StorageKind, { rows: number; cols: number }> = {
  fridge: { rows: 5, cols: 4 },
  rack: { rows: 5, cols: 8 },
  cabinet: { rows: 4, cols: 6 },
  shelving: { rows: 4, cols: 6 },
  wall: { rows: 6, cols: 6 },
  other: { rows: 4, cols: 6 },
};

/** "Wine fridge" if free, else "Wine fridge 2", "Wine fridge 3"… */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** A small line drawing of each kind of place (no emoji): what it looks like from the front. */
export function KindGlyph({
  kind,
  size = 22,
  className,
}: {
  kind: StorageKind;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {kind === "fridge" && (
        <>
          <rect x="6" y="3" width="12" height="18" rx="2.5" />
          <path d="M6 10h12M9.5 6v1.5M9.5 13v3" />
        </>
      )}
      {kind === "rack" && (
        <>
          <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
          <circle cx="8" cy="9" r="1.4" />
          <circle cx="12" cy="9" r="1.4" />
          <circle cx="16" cy="9" r="1.4" />
          <circle cx="8" cy="15" r="1.4" />
          <circle cx="12" cy="15" r="1.4" />
          <circle cx="16" cy="15" r="1.4" />
        </>
      )}
      {kind === "cabinet" && (
        <>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M12 3v18M10 12h.01M14 12h.01" />
        </>
      )}
      {kind === "shelving" && <path d="M4 3v18M20 3v18M4 7.5h16M4 12.5h16M4 17.5h16" />}
      {kind === "wall" && <path d="m12 3 8 9-8 9-8-9zM4 12h16M12 3v18" />}
      {kind === "other" && (
        <>
          <rect x="4" y="4" width="7" height="7" rx="2" />
          <rect x="13" y="4" width="7" height="7" rx="2" />
          <rect x="4" y="13" width="7" height="7" rx="2" />
          <rect x="13" y="13" width="7" height="7" rx="2" />
        </>
      )}
    </svg>
  );
}

/** Which kind of place: selectable pill-cards with a drawing, the name and a check. */
export function KindPicker({
  value,
  onChange,
  label,
}: {
  value: StorageKind;
  onChange: (kind: StorageKind) => void;
  label: string;
}) {
  const tKinds = useTranslations("storageKinds");
  return (
    <div>
      <p className="mb-2 text-small font-medium text-ink-2">{label}</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={label}>
        {STORAGE_KINDS.map((k) => {
          const selected = value === k;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(k)}
              className={cn(
                "flex min-h-12 items-center gap-2.5 rounded-[20px] px-3.5 text-left text-small font-medium transition-[transform,background-color,box-shadow] duration-150 ease-cellr active:scale-[0.98]",
                selected
                  ? "bg-raised text-ink ring-2 ring-accent-fg"
                  : "bg-surface text-ink-2 ring-1 ring-hairline hover:text-ink",
              )}
            >
              <KindGlyph kind={k} size={20} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{tKinds(k)}</span>
              {selected && <CheckIcon size={16} className="shrink-0 text-accent-fg" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Shelves / positions: a label and a stepper on a soft row. */
export function StepRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-card bg-raised/60 py-2 pl-4 pr-2">
      <span className="text-body text-ink">{label}</span>
      <Stepper label={label} value={value} onChange={onChange} min={1} max={30} />
    </div>
  );
}

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
  const existing = useStorage().data;

  const [kind, setKind] = useState<StorageKind>("fridge");
  const [name, setName] = useState<string | null>(null); // null = still the kind's default name
  const [rows, setRows] = useState(DEFAULT_GRID.fridge.rows);
  const [cols, setCols] = useState(DEFAULT_GRID.fridge.cols);
  const [error, setError] = useState<string | null>(null);

  // A second fridge is not "Wine fridge" again (names are unique): it becomes "Wine fridge 2", then 3, …
  const taken = new Set((existing ?? []).map((u) => u.label.trim().toLowerCase()));
  const label = name ?? uniqueName(tKinds(kind), taken);

  function pickKind(next: StorageKind) {
    setKind(next);
    setRows(DEFAULT_GRID[next].rows);
    setCols(DEFAULT_GRID[next].cols);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = CreateStorageSchema.safeParse({ label, kind, rows, cols });
    if (!parsed.success) return setError(checkMessage(parsed.error.issues, te));
    if (taken.has(label.trim().toLowerCase()))
      return setError(t("nameTaken", { name: label.trim() }));
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
        <KindPicker value={kind} onChange={pickKind} label={t("kindLabel")} />

        <Field
          label={t("nameLabel")}
          placeholder={t("namePlaceholder")}
          autoComplete="off"
          value={label}
          onChange={(e) => setName(e.target.value)}
        />

        <StepRow label={t("shelvesLabel")} value={rows} onChange={setRows} />
        <StepRow label={t("positionsLabel")} value={cols} onChange={setCols} />

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
