"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  noEndorsement,
  RECORD_REASONS,
  safeHttpUrl,
  type RecordReason,
  type RecordSuggestion,
} from "@cellr/domain";
import { Button } from "@/ui/button";
import { countryName } from "@/features/cellar/wine-visuals";

/**
 * "MOGELIJK DEZE WIJN" (Sprint 004C): records of external sources that may be the wine on the label, when no CELLR
 * wine is the exact match. Only what the server already offered this person (sources in the "public" scope: none
 * today) — the list is empty otherwise and nothing is rendered. A record is never a CELLR wine and never verified:
 * choosing one only fills in the new-wine form below, which the person checks and confirms; the bottle's year stays
 * the one read off the label. Each card names its source and licence in one plain line, never as an endorsement.
 */
export function RecordSuggestions({
  records,
  onUse,
  level = 2,
}: {
  records: readonly RecordSuggestion[] | undefined;
  onUse: (suggestion: RecordSuggestion) => void;
  /** The heading's level: 3 where it sits under another section's heading ("is it one of these?"). */
  level?: 2 | 3;
}) {
  const t = useTranslations("scan.records");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
  const list = (records ?? []).filter((s) => s.hit.kind === "record" && s.hit.provider !== null);
  if (list.length === 0) return null;
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section
      className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline"
      aria-labelledby="record-suggestions-title"
      data-testid="record-suggestions"
    >
      <div>
        <Heading id="record-suggestions-title" className="font-display text-title">
          {t("title")}
        </Heading>
        <p className="mt-1 text-small text-ink-2">{t("body")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {list.map((s) => {
          const hit = s.hit;
          const where = [
            hit.type ? tTypes(hit.type) : null,
            hit.countryCode ? countryName(hit.countryCode, locale) : null,
            hit.region,
          ]
            .filter(Boolean)
            .join(" · ");
          const licenseUrl = safeHttpUrl(hit.provider!.licenseUrl);
          const reasons = s.reasons
            .filter((r): r is RecordReason => (RECORD_REASONS as readonly string[]).includes(r))
            .map((r) => t(`reason.${r}`))
            .join(" · ");
          return (
            <li
              key={hit.recordId}
              className="flex flex-col gap-2 rounded-[16px] bg-canvas p-3 ring-1 ring-hairline"
              data-testid="record-suggestion"
              data-record={hit.recordId ?? ""}
            >
              <div>
                <p className="text-body font-medium text-ink" id={`record-${hit.recordId}`}>
                  {hit.producer} — {hit.name}
                </p>
                {where && <p className="text-small text-ink-2">{where}</p>}
                {reasons && <p className="text-small text-ink-2">{reasons}</p>}
                {/* the credit the licence asks for, on the card itself: the source's own attribution, the licence
                    (linked), whether CELLR changed the record, and that the source neither verified nor endorses
                    CELLR (review of Sprint 004C: the Sources panel is not always on) */}
                <p className="mt-1 text-caption text-ink-2" data-testid="record-suggestion-credit">
                  {t("credit", {
                    provider: hit.provider!.attribution || hit.provider!.name,
                    license: hit.provider!.license || "—",
                    modified: hit.provider!.modified ? "yes" : "no",
                  })}
                </p>
                {licenseUrl && (
                  <p className="text-caption text-ink-2">
                    <a
                      href={licenseUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="font-medium text-accent-fg underline underline-offset-4"
                      data-testid="record-suggestion-license"
                    >
                      {t("licenseLink", { license: hit.provider!.license })}
                    </a>
                  </p>
                )}
                <p className="text-caption text-ink-2" data-testid="record-suggestion-endorsement">
                  {noEndorsement(hit.provider!.name, locale === "nl" ? "nl" : "en")}
                </p>
              </div>
              <Button
                variant="secondary"
                size="md"
                block
                aria-describedby={`record-${hit.recordId}`}
                onClick={() => onUse(s)}
              >
                {t("use")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
