"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";

interface ConfirmSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
}

/** Calm confirmation for things that cannot be undone (leave, remove). Cancel is the easy path. */
export function ConfirmSheet({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  onConfirm,
  loading,
}: ConfirmSheetProps) {
  const t = useTranslations("common");
  return (
    <Sheet open={open} onClose={onClose} title={title} closeLabel={t("close")}>
      <p className="text-body text-ink-2">{body}</p>
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="secondary" size="lg" block onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button variant="danger" size="lg" block onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
