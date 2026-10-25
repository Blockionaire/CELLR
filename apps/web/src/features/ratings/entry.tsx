"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRightIcon } from "@/ui/icons";

/** In Profile: the way to my tasting journal. */
export function RatingsEntry() {
  const t = useTranslations("ratings");
  return (
    <Link
      href="/ratings"
      data-testid="ratings-entry"
      className="flex items-center justify-between gap-3 rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline transition-transform duration-150 ease-cellr active:scale-[0.99] motion-reduce:transition-none md:p-6"
    >
      <span className="min-w-0">
        <span className="block font-display text-title">{t("title")}</span>
        <span className="mt-1 block truncate text-small text-ink-2">{t("entryBody")}</span>
      </span>
      <ChevronRightIcon size={20} className="shrink-0 text-ink-3" />
    </Link>
  );
}
