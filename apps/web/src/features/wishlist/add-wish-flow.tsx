"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { formatVintage, type WineSummary, type WishlistItem } from "@cellr/domain";
import { ChooseWine } from "@/features/cellar/choose-wine";
import { useWines } from "@/features/cellar/hooks";
import { NewWineForm } from "@/features/cellar/new-wine-form";
import { Button, buttonStyles } from "@/ui/button";
import { CheckIcon, ChevronRightIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { useAddWish } from "./hooks";
import { useWishFields } from "./wish-fields";

type Step = "choose" | "new" | "details" | "done";

/** Pick (or add) the wine, say what you want of it, done. The same first steps as adding a bottle. */
export function AddWishFlow({ currency }: { currency: string }) {
  const t = useTranslations("wishlist");
  const tAdd = useTranslations("addBottle");
  const wines = useWines();
  const [step, setStep] = useState<Step>("choose");
  const [query, setQuery] = useState("");
  const [wine, setWine] = useState<WineSummary | null>(null);
  const [saved, setSaved] = useState<WishlistItem | null>(null);

  const title =
    step === "choose"
      ? t("addTitle")
      : step === "new"
        ? tAdd("newTitle")
        : step === "details"
          ? t("detailsTitle")
          : t("savedTitle");
  const back = step === "new" || step === "details" ? () => setStep("choose") : null;

  return (
    <>
      <PageHeader
        eyebrow={t("title")}
        title={title}
        actions={
          back && (
            <Button variant="ghost" size="sm" onClick={back}>
              <ChevronRightIcon size={18} className="rotate-180" />
              {t("back")}
            </Button>
          )
        }
      />
      <div className="mx-auto w-full max-w-xl">
        {step === "choose" && (
          <ChooseWine
            wines={wines.data}
            query={query}
            onQuery={setQuery}
            onPick={(w) => {
              setWine(w);
              setStep("details");
            }}
            onNew={() => setStep("new")}
          />
        )}
        {step === "new" && (
          <NewWineForm
            initialName={query.trim()}
            producers={[...new Set((wines.data ?? []).map((w) => w.producer))]}
            onCreated={(w) => {
              setWine(w);
              setStep("details");
            }}
          />
        )}
        {step === "details" && wine && (
          <Details
            wine={wine}
            currency={currency}
            onSaved={(item) => {
              setSaved(item);
              setStep("done");
            }}
          />
        )}
        {step === "done" && saved && (
          <div className="flex flex-col items-center gap-6 py-6 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-accent text-accent-ink">
              <CheckIcon size={32} />
            </span>
            <p className="font-display text-headline">
              {saved.producer} {saved.wineName}{" "}
              {saved.year === null ? "" : formatVintage(saved.year)}
            </p>
            <div className="flex w-full flex-col gap-3">
              <Button
                size="lg"
                block
                onClick={() => {
                  setWine(null);
                  setSaved(null);
                  setQuery("");
                  setStep("choose");
                }}
              >
                {t("addAnother")}
              </Button>
              <Link
                href="/wishlist"
                className={buttonStyles({ variant: "secondary", size: "lg", block: true })}
              >
                {t("seeWishlist")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Details({
  wine,
  currency,
  onSaved,
}: {
  wine: WineSummary;
  currency: string;
  onSaved: (item: WishlistItem) => void;
}) {
  const t = useTranslations("wishlist");
  const add = useAddWish();
  const { fields, values, valid, markSubmitted } = useWishFields(currency, {
    year: null,
    note: null,
    maxPriceCents: null,
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    markSubmitted();
    if (!valid) return;
    try {
      onSaved(
        await add.mutateAsync({
          wineId: wine.id,
          year: values.year ?? null,
          note: values.note,
          maxPriceCents: values.maxPriceCents ?? null,
        }),
      );
    } catch {
      // The hook has already said what went wrong (for instance, that it is on the list already).
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      <div className="rounded-card border border-hairline bg-surface p-4">
        <p className="truncate text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
          {wine.producer}
        </p>
        <p className="font-display text-title text-ink">{wine.name}</p>
      </div>
      {fields}
      <Button type="submit" size="lg" block loading={add.isPending}>
        {t("save")}
      </Button>
    </form>
  );
}
