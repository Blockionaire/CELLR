"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ERROR_MESSAGES, formatVintage, type BottleView, type VintageDetail } from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { BottleSpot, useMoney } from "./bottle-bits";
import { useBottleAction } from "./hooks";

interface OpenBottleSheetProps {
  open: boolean;
  onClose: () => void;
  detail: VintageDetail;
}

/**
 * OPEN A BOTTLE. With several bottles it asks which one (the easiest to reach is already selected),
 * then the count drops everywhere at once and an Undo stays on screen for a few seconds.
 */
export function OpenBottleSheet({ open, onClose, detail }: OpenBottleSheetProps) {
  const t = useTranslations("openBottle");
  const te = useTranslations();
  const toast = useToast();
  const action = useBottleAction();
  const money = useMoney(detail.currency);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bottles = detail.bottles;
  const selected = bottles.find((b) => b.id === chosen) ?? bottles[0];
  const title = `${detail.wine.name} ${formatVintage(detail.year)}`;

  function undo(
    bottleId: string,
    previous: { locationId: string | null; row: number | null; col: number | null },
  ) {
    action
      .mutateAsync({ bottleId, action: { action: "restore", to: previous } })
      .then(() => toast.show(t("restored")))
      .catch((e) =>
        toast.show(
          errorMessage(e, (k) => te(k), ERROR_MESSAGES),
          { tone: "error" },
        ),
      );
  }

  async function run(kind: "open" | "remove") {
    if (!selected) return;
    setError(null);
    try {
      const { previous } = await action.mutateAsync({
        bottleId: selected.id,
        action: { action: kind },
      });
      setChosen(null);
      onClose();
      toast.show(kind === "open" ? t("done", { count: bottles.length - 1 }) : t("removed"), {
        action: { label: t("undo"), onClick: () => undo(selected.id, previous) },
      });
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("title")} description={title}>
      <div className="flex flex-col gap-6">
        {bottles.length > 1 && (
          <div>
            <p id="open-which" className="mb-2 text-small font-medium text-ink-2">
              {t("which")}
            </p>
            <div role="radiogroup" aria-labelledby="open-which" className="flex flex-col gap-2">
              {bottles.map((b, i) => (
                <BottleOption
                  key={b.id}
                  bottle={b}
                  selected={b.id === selected?.id}
                  hint={i === 0 ? t("easiest") : null}
                  price={b.priceCents === null ? null : money(b.priceCents)}
                  onSelect={() => setChosen(b.id)}
                />
              ))}
            </div>
          </div>
        )}
        {bottles.length === 1 && selected && (
          <p className="rounded-card bg-raised px-4 py-3 text-body text-ink">
            <BottleSpot bottle={selected} />
          </p>
        )}
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        <Button size="lg" block loading={action.isPending} onClick={() => run("open")}>
          {t("submit")}
        </Button>
        <div className="text-center">
          <button
            type="button"
            onClick={() => run("remove")}
            disabled={action.isPending}
            className="min-h-11 px-3 text-small font-medium text-danger disabled:opacity-45"
          >
            {t("remove")}
          </button>
          <p className="text-caption text-ink-2">{t("removeHint")}</p>
        </div>
      </div>
    </Sheet>
  );
}

function BottleOption({
  bottle,
  selected,
  hint,
  price,
  onSelect,
}: {
  bottle: BottleView;
  selected: boolean;
  hint: string | null;
  price: string | null;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-14 items-center justify-between gap-3 rounded-card border px-4 py-2 text-left transition-colors active:scale-[0.99]",
        selected ? "border-accent-fg bg-raised" : "border-hairline bg-surface hover:bg-raised",
      )}
    >
      <span>
        <span className="block text-body text-ink">
          <BottleSpot bottle={bottle} />
        </span>
        {hint && <span className="block text-caption text-ink-2">{hint}</span>}
      </span>
      {price && <span className="text-small text-ink-2 tnum">{price}</span>}
    </button>
  );
}
