"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { formatVintage, type WishlistItem, type WishlistView } from "@cellr/domain";
import { useMoney } from "@/features/cellar/bottle-bits";
import { placeLine } from "@/features/cellar/wine-visuals";
import { Button, buttonStyles } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { PlusIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { EditWishSheet } from "./edit-wish-sheet";
import { StageThumb } from "./stage-thumb";
import { useRemoveWish, useWishlist } from "./hooks";

/** Wines you would like to buy: what, which vintage, up to what price, and whether you already have some. */
export function WishlistScreen({ initial }: { initial: WishlistView }) {
  const t = useTranslations("wishlist");
  const { data } = useWishlist(initial);
  const remove = useRemoveWish();
  const [editing, setEditing] = useState<WishlistItem | null>(null);
  const money = useMoney(data.currency);

  const addButton = (
    <Link href="/wishlist/add" className={buttonStyles({ variant: "primary", size: "md" })}>
      <PlusIcon size={20} />
      {t("add")}
    </Link>
  );

  if (!data.ready)
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState title={t("notReadyTitle")} body={t("notReadyBody")} />
      </>
    );

  if (data.items.length === 0)
    return (
      <>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <EmptyState
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <Link href="/wishlist/add" className={buttonStyles({ variant: "primary", size: "lg" })}>
              {t("add")}
            </Link>
          }
        />
      </>
    );

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} actions={addButton} />
      <ul aria-label={t("listLabel")} className="mx-auto flex max-w-2xl flex-col gap-3">
        {data.items.map((item) => (
          <li key={item.id}>
            <WishCard
              item={item}
              price={item.maxPriceCents === null ? null : money(item.maxPriceCents)}
              busy={remove.isPending && remove.variables?.id === item.id}
              onEdit={() => setEditing(item)}
              onRemove={() => remove.mutate(item)}
            />
          </li>
        ))}
      </ul>
      <EditWishSheet item={editing} currency={data.currency} onClose={() => setEditing(null)} />
    </>
  );
}

function WishCard({
  item,
  price,
  busy,
  onEdit,
  onRemove,
}: {
  item: WishlistItem;
  price: string | null;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("wishlist");
  const locale = useLocale();
  const where = placeLine(item.region, item.countryCode, locale);
  const buy = `/cellar/add?wine=${item.wineId}${item.year === null ? "" : `&year=${item.year}`}&wish=${item.id}`;
  return (
    <article className="rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline">
      <div className="flex gap-4">
        <StageThumb
          type={item.type}
          producer={item.producer}
          wineName={item.wineName}
          className="h-28 w-[4.5rem]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-medium uppercase tracking-[0.14em] text-bronze">
            {item.producer}
          </p>
          <h3 className="font-display text-title text-ink">{item.wineName}</h3>
          <p className="mt-1 text-small text-ink-2">
            <span className="tnum">
              {item.year === null ? t("anyVintage") : formatVintage(item.year)}
            </span>
            {where && <span> · {where}</span>}
          </p>
          {(price || item.inCellar > 0) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {price && (
                <span className="inline-flex items-center rounded-full bg-raised px-3 py-1 text-caption font-semibold text-ink tnum">
                  {t("upTo", { price })}
                </span>
              )}
              {item.inCellar > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-ready-bg px-3 py-1 text-caption font-semibold text-ready-ink">
                  <span className="size-2 rounded-full bg-ready" aria-hidden="true" />
                  {t("inCellar", { count: item.inCellar })}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {item.note && (
        <p className="mt-3 whitespace-pre-wrap rounded-[16px] bg-raised px-4 py-3 text-body text-ink">
          {item.note}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={buy} className={buttonStyles({ variant: "primary", size: "sm" })}>
          {t("bought")}
        </Link>
        <Button variant="secondary" size="sm" onClick={onEdit} disabled={busy}>
          {t("edit")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove} loading={busy}>
          {t("remove")}
        </Button>
      </div>
    </article>
  );
}
