"use client";

import { useTranslations } from "next-intl";
import type { FormEvent } from "react";
import type { WishlistItem } from "@cellr/domain";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { useUpdateWish } from "./hooks";
import { useWishFields } from "./wish-fields";

export function EditWishSheet({
  item,
  currency,
  onClose,
}: {
  item: WishlistItem | null;
  currency: string;
  onClose: () => void;
}) {
  const t = useTranslations("wishlist");
  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title={t("editTitle")}
      description={item ? `${item.producer} ${item.wineName}` : undefined}
    >
      {/* Remounted for each wish, so the fields start from what is saved. */}
      {item && <EditForm key={item.id} item={item} currency={currency} onClose={onClose} />}
    </Sheet>
  );
}

function EditForm({
  item,
  currency,
  onClose,
}: {
  item: WishlistItem;
  currency: string;
  onClose: () => void;
}) {
  const tc = useTranslations("common");
  const update = useUpdateWish();
  const { fields, values, valid, markSubmitted } = useWishFields(currency, item);

  async function submit(event: FormEvent) {
    event.preventDefault();
    markSubmitted();
    if (!valid) return;
    try {
      await update.mutateAsync({
        id: item.id,
        patch: {
          year: values.year ?? null,
          note: values.note,
          maxPriceCents: values.maxPriceCents ?? null,
        },
      });
      onClose();
    } catch {
      // The toast from the hook has said what went wrong; the sheet stays open for another try.
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {fields}
      <Button type="submit" size="lg" block loading={update.isPending}>
        {tc("save")}
      </Button>
    </form>
  );
}
