"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { formatVintage, matchesSearch, type CellarView } from "@cellr/domain";
import { buttonStyles } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Field } from "@/ui/field";
import { PlusIcon, SearchIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { Segmented } from "@/ui/segmented";
import { useCellar } from "./hooks";
import { CELLAR_VIEW_COOKIE, type CellarViewMode } from "./view-mode";
import { WineCard, WineRow } from "./wine-card";
import { countryName } from "./wine-visuals";

const rememberView = (view: CellarViewMode) => {
  document.cookie = `${CELLAR_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
};

/**
 * The cellar: a premium grid or a compact list, with search that filters as you type.
 * The server renders the first paint with real data; changes elsewhere refresh it in the background.
 */
export function CellarScreen({
  initial,
  initialView,
}: {
  initial: CellarView;
  initialView: CellarViewMode;
}) {
  const t = useTranslations("cellar");
  const locale = useLocale();
  const { data } = useCellar(initial);
  const [view, setView] = useState<CellarViewMode>(initialView);
  const [query, setQuery] = useState("");

  const items = useMemo(
    () =>
      data.items.filter((item) =>
        matchesSearch(
          [
            item.producer,
            item.wineName,
            formatVintage(item.year),
            item.region ?? "",
            countryName(item.countryCode, locale) ?? "",
            ...item.places,
          ],
          query,
        ),
      ),
    [data.items, query, locale],
  );

  const addButton = (
    <Link href="/cellar/add" className={buttonStyles({ variant: "primary", size: "md" })}>
      <PlusIcon size={20} />
      {t("add")}
    </Link>
  );

  if (data.items.length === 0) {
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <Link href="/cellar/add" className={buttonStyles({ variant: "primary", size: "lg" })}>
              {t("emptyAction")}
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("summary", { bottles: data.bottleCount, wines: data.items.length })}
        actions={addButton}
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon
            size={20}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <Field
            label={t("searchLabel")}
            hideLabel
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={t("searchPlaceholder")}
            inputClassName="pl-11"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Segmented
          label={t("viewLabel")}
          value={view}
          onChange={(next) => {
            setView(next);
            rememberView(next);
          }}
          options={[
            { value: "grid", label: t("viewGrid") },
            { value: "list", label: t("viewList") },
          ]}
          className="self-end sm:self-auto"
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          illustration={false}
          title={t("noMatchTitle")}
          body={t("noMatchBody")}
          action={
            <button
              type="button"
              className={buttonStyles({ variant: "secondary", size: "md" })}
              onClick={() => setQuery("")}
            >
              {t("clearSearch")}
            </button>
          }
        />
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => (
            <li key={item.vintageId}>
              <WineCard item={item} locale={locale} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface px-4">
          {items.map((item) => (
            <li key={item.vintageId}>
              <WineRow item={item} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
