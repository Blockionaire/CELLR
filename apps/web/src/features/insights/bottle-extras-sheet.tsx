"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { BottleExtrasSchema, ERROR_MESSAGES, type BottleExtrasView } from "@cellr/domain";
import { checkMessage, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { draftToInput, EMPTY_DRAFT, ExtrasFields, type ExtrasDraft } from "./extras-fields";
import { useSaveExtras } from "./hooks";

const toDraft = (e: BottleExtrasView | undefined): ExtrasDraft =>
  e
    ? {
        acquiredHow: e.acquiredHow ?? "",
        giftFrom: e.giftFrom ?? "",
        occasionTitle: e.occasionTitle ?? "",
        occasionOn: e.occasionOn ?? "",
      }
    : EMPTY_DRAFT;

/** What you know about this one bottle: where it came from, and what it is being kept for. */
export function BottleExtrasSheet({
  open,
  onClose,
  vintageId,
  bottleId,
  title,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  vintageId: string;
  bottleId: string;
  title: string;
  existing: BottleExtrasView | undefined;
}) {
  const t = useTranslations("bottleExtras");
  const tc = useTranslations("common");
  const te = useTranslations();
  const toast = useToast();
  const save = useSaveExtras(vintageId);
  const [draft, setDraft] = useState<ExtrasDraft>(() => toDraft(existing));
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = BottleExtrasSchema.safeParse(draftToInput(draft));
    if (!parsed.success) return setError(checkMessage(parsed.error.issues, te));
    try {
      await save.mutateAsync({ bottleId, extras: parsed.data });
      toast.show(tc("saved"));
      onClose();
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("title")}
      description={title}
      closeLabel={tc("close")}
    >
      {open && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-6">
          <ExtrasFields value={draft} onChange={setDraft} error={error} />
          <Button type="submit" size="lg" block loading={save.isPending}>
            {tc("save")}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
