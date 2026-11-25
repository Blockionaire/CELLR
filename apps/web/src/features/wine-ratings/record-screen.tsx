"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CatalogRecordPage } from "@cellr/domain";
import { buttonStyles } from "@/ui/button";
import { PageHeader } from "@/ui/page-header";
import { RatingsPanel } from "./ratings-panel";

/** A provider record's catalogue page: identity, ratings, reviews, and a way into the cellar. */
export function RecordScreen({
  record,
  community,
}: {
  record: CatalogRecordPage;
  community: boolean;
}) {
  const t = useTranslations("catalogRecord");
  const tTypes = useTranslations("wineTypes");
  const place = [record.region, record.countryCode].filter(Boolean).join(" · ");
  const vintages = [...record.vintages].sort((a, b) => b - a);
  return (
    <div className="mx-auto max-w-2xl px-4 pb-24">
      <PageHeader
        eyebrow={t("from")}
        title={`${record.producer} ${record.name}`}
        {...(place ? { subtitle: place } : {})}
      />
      <div className="flex flex-wrap items-center gap-2 pb-6 text-small text-ink-2">
        {record.wineType && (
          <span className="rounded-full bg-raised px-3 py-1">
            {tTypes(record.wineType as "red")}
          </span>
        )}
        {record.appellation && (
          <span className="rounded-full bg-raised px-3 py-1">{record.appellation}</span>
        )}
        {record.modified && <span className="text-[0.75rem] text-ink-3">{t("modified")}</span>}
      </div>
      {vintages.length > 0 && (
        <p className="pb-6 text-small text-ink-2">
          <span className="font-medium text-ink">{t("vintages")}:</span>{" "}
          {vintages.slice(0, 24).join(", ")}
          {vintages.length > 24 ? " …" : ""}
          {record.nonVintage ? " · NV" : ""}
        </p>
      )}
      <Link
        href={`/cellar/add?record=${record.recordId}`}
        className={buttonStyles({ block: true })}
        data-testid="add-from-record"
      >
        {t("addToCellar")}
      </Link>
      <RatingsPanel
        subject={{ kind: "record", id: record.recordId }}
        enabled
        communityEnabled={community}
      />
    </div>
  );
}
