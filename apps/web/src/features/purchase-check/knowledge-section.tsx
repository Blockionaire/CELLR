"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatVintage, safeHttpUrl, type AddedFact, type PurchaseKnowledge } from "@cellr/domain";
import { countryName } from "@/features/cellar/wine-visuals";
import { SourceIdentity, useWineSources } from "@/features/sources/sources-section";

/**
 * What CELLR already knew about the wine in the shop, beyond what the person confirmed (the `purchase_intel`
 * feature), and where each part came from. Two kinds, never blurred: facts of the curated catalogue, and CELLR's
 * own AI estimate (always named as an estimate, with its date). A profile of another vintage never shows a
 * drinking window here: the server does not send one.
 */
export function KnowledgeSection({
  knowledge,
  vintageKnown,
  sourcesPanel = false,
}: {
  knowledge: PurchaseKnowledge;
  /** The person gave a vintage (or said the wine has none): without one there is no vintage profile to expect. */
  vintageKnown: boolean;
  /** The `sources_panel` feature: also say what the catalogue's own facts rest on. */
  sourcesPanel?: boolean | undefined;
}) {
  const t = useTranslations("purchaseCheck.knowledge");
  const tCheck = useTranslations("purchaseCheck");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
  const { added, profile, status } = knowledge;
  const tSources = useTranslations("sources");
  const sources = useWineSources(knowledge.catalogWineId, sourcesPanel);

  const years = (list: Array<number | null>) =>
    new Intl.ListFormat(locale, { type: "conjunction" }).format(list.map((y) => formatVintage(y)));
  const valueOf = (fact: AddedFact) =>
    fact.field === "type"
      ? tTypes(fact.value as Parameters<typeof tTypes>[0])
      : fact.field === "countryCode"
        ? (countryName(fact.value, locale) ?? fact.value)
        : fact.value;
  const labelOf = (fact: AddedFact) =>
    fact.field === "type"
      ? tCheck("type")
      : fact.field === "countryCode"
        ? tCheck("country")
        : tCheck(fact.field);
  const originOf = (fact: AddedFact) =>
    fact.origin === "cellr_catalog"
      ? t("origin.catalog")
      : fact.level === "vintage"
        ? t("origin.estimateVintage")
        : t("origin.estimateWine", { years: years(fact.fromYears ?? []) });

  return (
    <section
      aria-labelledby="pc-knowledge"
      className="flex flex-col gap-3"
      data-testid="pc-knowledge"
      data-status={status}
    >
      <h2 id="pc-knowledge" className="font-display text-title text-ink">
        {t("title")}
      </h2>

      {profile && (
        <div
          className="flex flex-col gap-2 rounded-card bg-surface p-4 ring-1 ring-hairline"
          data-testid="pc-profile"
        >
          <p className="text-caption font-medium uppercase tracking-[0.12em] text-bronze">
            {t("profileLabel", {
              vintage: formatVintage(profile.year),
              date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                new Date(profile.generatedAt),
              ),
            })}
          </p>
          {profile.style && <p className="text-body font-medium text-ink">{profile.style}</p>}
          {profile.summary && <p className="text-body text-ink">{profile.summary}</p>}
          {profile.drinkWindow && (
            <p className="text-small text-ink-2" data-testid="pc-window">
              {t("window", { from: profile.drinkWindow.from, until: profile.drinkWindow.until })}
            </p>
          )}
          <p className="text-caption text-ink-3">
            {t("profileCaveat", { count: profile.sources })}
          </p>
        </div>
      )}

      {added.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-small text-ink-2">{t("addedIntro")}</p>
          <ul className="flex flex-col gap-1.5 text-small text-ink">
            {added.map((fact) => (
              <li
                key={fact.field}
                data-testid="pc-added"
                data-field={fact.field}
                data-origin={fact.origin}
              >
                <span className="font-medium">{labelOf(fact)}:</span> {valueOf(fact)}{" "}
                <span className="text-ink-2">({originOf(fact)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sourcesPanel && sources.data?.catalog && (
        <details className="group/pcsrc" data-testid="pc-sources">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-small font-medium text-accent-fg [&::-webkit-details-marker]:hidden">
            {tSources("catalogTitle")}
          </summary>
          <div className="pb-1">
            <SourceIdentity
              identity={{
                origin: "cellr_catalog",
                catalogSources: sources.data.catalogSources.map((c) => ({
                  ...c,
                  url: safeHttpUrl(c.url),
                })),
                external: sources.data.external.filter((n) => n.scope === "public"),
              }}
            />
          </div>
        </details>
      )}

      {!profile && (
        <p className="text-caption text-ink-3" data-testid="pc-knowledge-note">
          {status === "stable_facts"
            ? vintageKnown
              ? t("noteOtherVintage")
              : t("noteNoVintage")
            : t("noteCatalogOnly")}
        </p>
      )}
    </section>
  );
}
