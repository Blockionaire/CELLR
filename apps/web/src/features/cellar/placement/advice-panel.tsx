"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ERROR_MESSAGES,
  sameSpot,
  type AdviceCaveat,
  type AdviceIntent,
  type AdviceReason,
  type AdviceSpot,
  type SmartSpot,
} from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { cn } from "@/ui/cn";
import { Skeleton } from "@/ui/skeleton";
import { useAdvice } from "./placement-hooks";
import { tempText } from "./zone-legend";

/**
 * WHERE IT FITS BEST (Smart Cellar 3D, sprint 5; ADR-009): the advice for one bottle, inside the placement panel.
 * Read-only. "Show" selects the spot in the picker below and rings it in 3D; "Place here" confirms THAT spot through
 * the Sprint 4 move (the same request as the panel's own confirm). Nothing is chosen or moved on its own, and the
 * picker stays: any free spot can be chosen by hand.
 *
 * Every sentence comes from a reason or caveat code with its evidence (storage-advice.ts); none is written here.
 */
export interface AdvicePanelProps {
  bottleId: string;
  intent: AdviceIntent;
  onIntent: (intent: AdviceIntent) => void;
  /** Where a spot is, in words (the panel's own wording). */
  spotText: (spot: SmartSpot) => string;
  /** The spot chosen in the panel now, if any. */
  chosen: SmartSpot | null;
  onShow: (spot: SmartSpot) => void;
  onPlace: (spot: SmartSpot) => void;
  /** Whether this deployment may place (the Sprint 4 gate); advice itself is read-only. */
  canPlace: boolean;
  busy: boolean;
  /** The Rack Builder, where it is open (for "no places yet"). */
  builderHref: string | null;
}

export function AdvicePanel({
  bottleId,
  intent,
  onIntent,
  spotText,
  chosen,
  onShow,
  onPlace,
  canPlace,
  busy,
  builderHref,
}: AdvicePanelProps) {
  const t = useTranslations("advice");
  const te = useTranslations();
  const query = useAdvice(bottleId, intent, true);
  const data = query.data;
  /**
   * How current the cards on screen are. React Query keeps the last answer when a refresh fails (and while one is on
   * its way), so data alone proves nothing:
   *   fresh     the last request for this advice answered, and none is on its way: the only state that may act
   *   updating  an answer is on its way; the cards are the previous one
   *   stale     the last refresh failed (network, a lost household, a refused bottle): the cards are an older answer
   * "Place here" works only when fresh. "Show" (which only selects a spot) and the picker stay usable throughout; the
   * picker's own confirm is checked by the server as always.
   */
  const freshness: "none" | "fresh" | "updating" | "stale" = !data
    ? "none"
    : query.isError
      ? "stale"
      : query.isFetching
        ? "updating"
        : "fresh";
  const actionable = freshness === "fresh";
  const sayReason = useReasonText();
  const sayCaveat = useCaveatText();

  const card = (s: AdviceSpot, primary: boolean) => {
    const shown = sameSpot(chosen, s.spot);
    const caveats = s.caveats.map(sayCaveat).filter((x): x is string => x !== null);
    return (
      <li
        key={`${s.spot.locationId}:${s.spot.row}:${s.spot.col}:${s.spot.index}`}
        className={cn(
          "flex flex-col gap-2 rounded-card bg-raised p-3 ring-1 ring-hairline",
          shown && "ring-2 ring-accent",
        )}
        data-testid="advice-option"
        data-rank={s.rank}
        data-spot={`${s.spot.locationId}:${s.spot.row}:${s.spot.col}:${s.spot.index}`}
        data-suitability={s.suitability}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="font-medium text-ink">
            {primary && (
              <span className="mr-2 text-caption tnum text-ink-2">
                <span aria-hidden="true">{s.rank}</span>
                <span className="sr-only">{t("rank", { rank: s.rank })}: </span>
              </span>
            )}
            {spotText(s.spot)}
          </p>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-caption",
              s.suitability === "strong" && "bg-[#e9dccb] text-[#2a2420]",
              s.suitability === "reasonable" && "bg-[#e6ebf0] text-[#2a2420]",
              s.suitability === "limited" && "bg-surface text-ink-2 ring-1 ring-hairline",
            )}
            data-testid="advice-suitability"
          >
            {t(`suit.${s.suitability}`)}
          </span>
        </div>
        <ul className="flex flex-col gap-0.5 text-small text-ink" data-testid="advice-reasons">
          {s.reasons.map((r, i) => {
            // "free now" is true of every recommendation: kept in the data, not repeated on screen
            const text = r.code === "free_now" ? null : sayReason(r);
            return text ? <li key={i}>{text}</li> : null;
          })}
        </ul>
        {caveats.length > 0 && (
          <ul
            className="flex flex-col gap-0.5 text-caption text-ink-2"
            data-testid="advice-caveats"
          >
            {caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
        {s.equivalent > 0 && (
          <p className="text-caption text-ink-2" data-testid="advice-equivalent">
            {t("equivalent", { count: s.equivalent })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onShow(s.spot)}
            aria-pressed={shown}
            data-testid="advice-show"
          >
            {shown ? t("shown") : t("show")}
          </Button>
          {canPlace && (
            <Button
              size="sm"
              onClick={() => actionable && onPlace(s.spot)}
              disabled={busy || !actionable}
              data-testid="advice-place"
            >
              {t("placeHere")}
            </Button>
          )}
        </div>
      </li>
    );
  };

  return (
    <section
      aria-labelledby="advice-title"
      className="flex flex-col gap-3"
      data-testid="advice-panel"
      data-intent={intent}
      data-status={data?.status ?? (query.isError ? "failed" : "loading")}
      data-fresh={freshness}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="advice-title" className="font-display text-body font-medium text-ink">
          {t("title")}
        </h3>
        <div
          role="group"
          aria-label={t("intentLabel")}
          className="flex gap-2"
          data-testid="advice-intent"
        >
          {(["store", "serve"] as const).map((i) => (
            <Chip key={i} selected={intent === i} onClick={() => onIntent(i)} data-intent={i}>
              {t(`intent.${i}`)}
            </Chip>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite" data-testid="advice-announce">
        {query.isPending
          ? t("loading")
          : freshness === "stale"
            ? t("stale")
            : query.isError
              ? t("failed")
              : freshness === "updating"
                ? t("updating")
                : data
                  ? t("announce", { count: data.recommendations.length })
                  : ""}
      </p>
      <div className="flex flex-col gap-3">
        {query.isPending && (
          <div className="flex flex-col gap-2" aria-busy="true">
            <span className="sr-only">{t("loading")}</span>
            <Skeleton className="h-24" />
          </div>
        )}
        {freshness === "stale" && (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-card bg-raised p-3 ring-1 ring-hairline"
            data-testid="advice-stale"
          >
            <p className="text-small text-ink">
              {t("stale")} {errorMessage(query.error, (k) => te(k), ERROR_MESSAGES)}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              {t("retry")}
            </Button>
          </div>
        )}
        {!data && query.isError && !query.isFetching && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2"
            data-testid="advice-failed"
          >
            <p className="text-small text-ink-2">
              {t("failed")} {errorMessage(query.error, (k) => te(k), ERROR_MESSAGES)}
            </p>
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
              {t("retry")}
            </Button>
          </div>
        )}
        {data && data.status === "no_places" && (
          <div className="flex flex-wrap items-center gap-2" data-testid="advice-none">
            <p className="text-small text-ink-2">{t("noPlaces")}</p>
            {builderHref && (
              <Link href={builderHref} className="text-small underline underline-offset-2">
                {t("openBuilder")}
              </Link>
            )}
          </div>
        )}
        {data && data.status === "not_in_cellar" && (
          <p className="text-small text-ink-2" data-testid="advice-none">
            {t("notInCellar")}
          </p>
        )}
        {data && data.status === "no_eligible" && (
          <div className="flex flex-col gap-1" data-testid="advice-none">
            <p className="text-small text-ink">{t("noEligible")}</p>
            {data.excluded.depthOff > 0 && (
              <p className="text-caption text-ink-2">
                {t("excludedDepth", { count: data.excluded.depthOff })}
              </p>
            )}
            {data.excluded.behind > 0 && (
              <p className="text-caption text-ink-2">
                {t("excludedBehind", { count: data.excluded.behind })}
              </p>
            )}
            {data.excluded.unknownPlaces > 0 && (
              <p className="text-caption text-ink-2">
                {t("excludedUnknown", { count: data.excluded.unknownPlaces })}
              </p>
            )}
          </div>
        )}
        {data && data.status === "ok" && (
          <div
            className={cn("flex flex-col gap-3", !actionable && "opacity-60")}
            aria-busy={freshness === "updating"}
            data-testid="advice-results"
          >
            {data.stay && (
              <p
                className="rounded-card bg-[#e9dccb] px-3 py-2 text-small text-[#2a2420]"
                data-testid="advice-stay"
              >
                {data.stayKind === "suitable" ? t("stay") : t("stayNothingBetter")}
              </p>
            )}
            {data.recommendations.length > 0 && (
              <ol className="flex flex-col gap-2" data-testid="advice-recommendations">
                {data.recommendations.map((s) => card(s, true))}
              </ol>
            )}
            {data.alternatives.length > 0 && (
              <details className="group" data-testid="advice-alternatives">
                <summary className="cursor-pointer text-small text-ink-2 underline-offset-2 hover:underline">
                  {t("more")}
                </summary>
                <ol className="mt-2 flex flex-col gap-2">
                  {data.alternatives.map((s) => card(s, false))}
                </ol>
              </details>
            )}
            {data.caveats.length > 0 && (
              <ul
                className="flex flex-col gap-0.5 text-caption text-ink-2"
                data-testid="advice-general"
              >
                {data.caveats.map((c, i) => {
                  const text = sayCaveat(c);
                  return text ? <li key={i}>{text}</li> : null;
                })}
              </ul>
            )}
          </div>
        )}
      </div>
      <p className="text-caption text-ink-2">{canPlace ? t("advisory") : t("readOnly")}</p>
    </section>
  );
}

/** A reason in words, from its code and evidence only (null: not shown as a sentence). */
function useReasonText() {
  const t = useTranslations("advice.reason");
  const tw = useTranslations("wineTypes");
  const locale = useLocale();
  return (r: AdviceReason): string | null => {
    switch (r.code) {
      case "purpose_match":
        return r.purpose === "storage"
          ? t("purposeStorage", { zone: r.zone })
          : t("purposeServing", { zone: r.zone });
      case "group": {
        const where = t(`where.${r.proximity}`);
        if (r.tier === "type")
          return t("type", { count: r.count, where, type: tw(r.type ?? "red") });
        return t(r.tier, { count: r.count, where });
      }
      case "front_reachable":
        return t("frontReachable");
      case "zone_target":
        return t("zoneTarget", { zone: r.zone, temp: tempText(locale, r.targetTempC) });
      case "free_now":
        return t("freeNow");
      case "current_spot":
        return t("currentSpot");
    }
  };
}

/** A caveat in words (null: carried by another sentence, such as "not measured" by the zone's own). */
function useCaveatText() {
  const t = useTranslations("advice.caveat");
  const tr = useTranslations("advice.reason");
  const locale = useLocale();
  return (c: AdviceCaveat): string | null => {
    switch (c.code) {
      case "purpose_mismatch":
        return c.purpose === "storage"
          ? t("mismatchStorage", { zone: c.zone })
          : t("mismatchServing", { zone: c.zone });
      case "temperature_not_measured":
        return null;
      case "zone_target":
        return tr("zoneTarget", { zone: c.zone, temp: tempText(locale, c.targetTempC) });
      case "zone_no_target":
        return t("zoneNoTarget", { zone: c.zone });
      case "no_zone":
        return t("noZone");
      case "compartment_counter":
        return t("compartmentCounter");
      case "no_grouping_evidence":
        return t("noGrouping");
      case "no_matching_zone":
        return c.purpose === "storage" ? t("noMatchingStorage") : t("noMatchingServing");
      case "estimated_window_not_used":
        return t("windowNotUsed");
      case "vintage_unknown":
        return t("vintageUnknown");
    }
  };
}
