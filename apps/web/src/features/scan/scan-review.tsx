"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import {
  draftOrigins,
  ERROR_MESSAGES,
  existingWineOrigins,
  formatVintage,
  RESOLVE_REASONS,
  suggestWine,
  vintageOrigin,
  WINE_FIELDS,
  type FieldOrigin,
  type FieldSource,
  type WineField,
  type AddBottlesResult,
  type BottleArtRef,
  type ResolveReason,
  type ScanResult,
  type WineSummary,
} from "@cellr/domain";
import type { PreferredSpot } from "@/features/cellar/add-spot";
import { BottleDetails } from "@/features/cellar/bottle-details";
import { ChooseWine } from "@/features/cellar/choose-wine";
import { winesKey } from "@/features/cellar/hooks";
import { LabelImage } from "@/features/cellar/label-image";
import {
  checkWineFields,
  draftOfRecord,
  fieldsOfDraft,
  WineFields,
  type WineFieldsValue,
} from "@/features/cellar/new-wine-form";
import { useOwnedCounts, WineChoice } from "@/features/cellar/wine-stage";
import { countryName, placeLine } from "@/features/cellar/wine-visuals";
import { useAddWish } from "@/features/wishlist/hooks";
import { track } from "@/lib/analytics";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { CheckIcon, SearchIcon } from "@/ui/icons";
import { RecordSuggestions } from "./record-suggestions";
import type { ScanMode } from "./modes";

/**
 * Which wine the bottles are of: one of the person's (or the catalogue's) wines, a new one from the fields, or not
 * chosen yet (several candidates and none picked: never guessed for them, two cuvées of a producer look alike).
 */
type Pick = { kind: "wine"; wine: WineSummary } | { kind: "new" } | null;

/** How the person settled the wine, for the scan's conversion (a word, never the wine). */
type Choice = "match" | "candidate" | "other_wine" | "new_wine";

/**
 * The review of a scan, on one screen (Sprint "Unified Scan"): the label photo, the wine we found (or the fields for
 * a new one), and everything about the bottles — vintage, how many, where, what they cost — with one button that adds
 * them. The wine can be corrected here without leaving the screen: another candidate, one of the person's own wines,
 * a record of an external source (a suggestion to check, never a fact), or a new wine; what is typed about the bottles
 * stays as it is meanwhile. A wine that exists is never edited from here (a household's own wine and a catalogue wine
 * are changed on their own pages, under their own rules): a different wine is a different choice.
 */
export function ScanReview({
  result,
  wines,
  catalogSearch,
  currency,
  mode,
  inBatch,
  preferredPlaceId,
  spot,
  onSpotChange,
  labels,
  onDone,
  onWished,
  onAgain,
  batch,
}: {
  result: ScanResult;
  wines: WineSummary[];
  catalogSearch: boolean;
  currency: string;
  mode: ScanMode;
  /** The photo is one of a batch (several bottles in a row). */
  inBatch: boolean;
  preferredPlaceId: string | null | undefined;
  spot: PreferredSpot | null;
  onSpotChange: (spot: PreferredSpot | null) => void;
  /** The front label and the optional back label, under the wine. */
  labels?: ReactNode;
  onDone: (result: AddBottlesResult, placeId: string | null) => void;
  /** Saved to the wishlist instead: nothing was added. */
  onWished: (wine: WineSummary) => void;
  onAgain: () => void;
  /** A photo of a batch: back to the batch, or leave this photo out (nothing is added). */
  batch?: { onBack: () => void; onSkip: () => void } | undefined;
}) {
  const t = useTranslations("scan");
  const tAdd = useTranslations("addBottle");
  const tWish = useTranslations("wishlist");
  const te = useTranslations();
  const owned = useOwnedCounts();
  const queryClient = useQueryClient();
  const addWish = useAddWish();
  const { outcome, facts, matches } = result;
  const match = outcome === "found" ? (matches[0]?.wine ?? null) : null;
  const path = { remembered: result.remembered, fromText: result.fromText };
  // The match is filled in for the person only when the label does not contradict who it is (producer, name, kind):
  // a label that names another cuvée is never added to this wine by default. Otherwise it is offered, to tap.
  const reliable =
    !!match &&
    !(["producer", "name", "type"] as const).some(
      (f) => existingWineOrigins(match, facts, path)[f].conflict !== undefined,
    );
  const offered =
    outcome === "choose" ? matches.map((m) => m.wine) : match && !reliable ? [match] : [];

  const [pick, setPick] = useState<Pick>(() =>
    reliable && match ? { kind: "wine", wine: match } : offered.length > 0 ? null : { kind: "new" },
  );
  const [choice, setChoice] = useState<Choice>(reliable ? "match" : "new_wine");
  // A wrong guess is corrected by finding the right wine among your own, not by typing it in again (a duplicate).
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState(facts?.producer ?? facts?.name ?? "");
  // What the person has in the new-wine fields: kept while another wine is tried, so nothing typed is lost.
  const [fields, setFields] = useState<WineFieldsValue>(() =>
    fieldsOfDraft(facts ? suggestWine(facts) : undefined),
  );
  // What the fields were started from (the label's reading, or a record): a field still as started says so.
  const [start, setStart] = useState<{ value: WineFieldsValue; from: "label" | "record" | "none" }>(
    () => ({
      value: fieldsOfDraft(facts ? suggestWine(facts) : undefined),
      from: facts && outcome !== "unread" ? "label" : "none",
    }),
  );
  // A record of an external source chosen to start the fields: named above them, and sent along (R-27 provenance).
  const [fromRecord, setFromRecord] = useState<{
    recordId: string | null;
    provider: string;
  } | null>(null);
  const [wineError, setWineError] = useState<string | null>(null);
  // The vintage as typed below, shown with the wine at once (also for a new wine).
  const [year, setYear] = useState<number | null | undefined>(
    facts?.nonVintage ? null : (facts?.year ?? undefined),
  );
  // The new wine made (or being made) for these fields: an "Add" that then failed (a spot taken, no connection), or
  // "Add" and "Save to wishlist" tapped in one go, never create it a second time.
  const created = useRef<{ key: string; wine: Promise<WineSummary> } | null>(null);
  const wishing = useRef(false);
  const wineSection = useRef<HTMLElement>(null);

  const producers = [...new Set(wines.map((w) => w.producer))];
  const unsure = facts ? Object.values(facts.confidence).includes("low") : false;
  const yearText = year === undefined ? null : formatVintage(year);
  const canSearch = wines.length > 0 || catalogSearch;

  /** Why the resolver offers this wine (WI-03), in words: what tells the candidates apart. */
  const whyOf = (wineId: string): string | undefined => {
    const reasons = result.resolution?.reasons[wineId];
    if (!reasons) return undefined;
    return reasons
      .filter((r): r is ResolveReason => (RESOLVE_REASONS as readonly string[]).includes(r))
      .map((r) => t(`why.${r}`))
      .join(" · ");
  };

  function choose(next: Pick, how: Choice) {
    setPick(next);
    setChoice(how);
    setWineError(null);
    setSearching(false);
  }

  function takeRecord(hit: Parameters<typeof draftOfRecord>[0]) {
    const value = fieldsOfDraft(draftOfRecord(hit));
    setFields(value);
    setStart({ value, from: "record" });
    setFromRecord({ recordId: hit.recordId, provider: hit.provider?.name ?? "" });
    choose({ kind: "new" }, "new_wine");
  }

  /** Not ready: say why beside the wine, and take the person there. */
  function notReady(message: string): null {
    setWineError(message);
    wineSection.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    wineSection.current?.focus({ preventScroll: true });
    return null;
  }

  /** The wine the bottles go to: the one chosen, or the new one (created once, on the first "Add"). */
  async function resolveWine(): Promise<WineSummary | null> {
    setWineError(null);
    if (searching && pick?.kind !== "wine") return notReady(t("review.pickFirst"));
    if (!pick) return notReady(t("review.pickFirst"));
    if (pick.kind === "wine") return pick.wine;
    const checked = checkWineFields(fields, fromRecord?.recordId, tAdd, te);
    if (!checked.ok) return notReady(checked.error);
    const key = JSON.stringify(checked.input);
    if (created.current?.key === key) return created.current.wine;
    // The server keeps one wine per identity: the same producer, name and kind already in the household is reused.
    const wine = api.post<WineSummary>("/wines", checked.input);
    created.current = { key, wine };
    try {
      await wine;
    } catch (e) {
      // not made: the next tap tries again
      if (created.current?.wine === wine) created.current = null;
      throw e;
    }
    // the list catches up in the background: the bottles do not wait for it
    void queryClient.invalidateQueries({ queryKey: winesKey });
    return wine;
  }

  const report = (action: "added" | "wished") =>
    track("scan_review_completed", {
      outcome,
      choice,
      action,
      mode: inBatch ? "batch" : mode,
      vintage: year === undefined ? "none" : year === null ? "nv" : "dated",
    });

  async function wish() {
    if (wishing.current) return;
    wishing.current = true;
    try {
      let wine: WineSummary | null;
      try {
        wine = await resolveWine();
      } catch (e) {
        // the new wine could not be made (no connection…): said beside the wine, nothing was listed
        notReady(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
        return;
      }
      if (!wine) return;
      await addWish.mutateAsync({
        wineId: wine.id,
        year: year ?? null,
        note: null,
        maxPriceCents: null,
      });
      report("wished");
      onWished(wine);
    } catch {
      // The wishlist (or the new wine) has said what went wrong, for instance that it is on the list already.
    } finally {
      wishing.current = false;
    }
  }

  /** A quiet line per field of a new wine: where it comes from, and only when that says something. */
  const draftSources = (origins: Record<WineField, FieldOrigin>) =>
    Object.fromEntries(
      WINE_FIELDS.map((f) => [f, <SourceTag key={f} field={f} source={origins[f].source} />]),
    ) as Record<WineField, ReactNode>;

  const status =
    outcome === "unread"
      ? { title: t("unreadTitle"), body: t(`unread.${result.reason ?? "ai-down"}`) }
      : outcome === "found" && match && reliable
        ? {
            title: t("foundTitle"),
            body: t(
              result.remembered
                ? "rememberedBody"
                : result.fromText
                  ? facts?.year === null
                    ? "fromTextNoYearBody"
                    : "fromTextBody"
                  : "foundBody",
            ),
          }
        : outcome === "found" && match
          ? { title: t("review.checkTitle"), body: t("review.checkBody") }
          : outcome === "choose"
            ? { title: t("chooseTitle"), body: t("chooseBody") }
            : { title: t("newTitle"), body: t("newBody") };

  return (
    <div className="flex flex-col gap-5" data-testid="scan-review">
      <div className="rounded-[28px] bg-hero p-3 shadow-raised">
        <LabelImage
          image={result.image}
          size="photo"
          alt={t("photoAlt")}
          className="h-40 w-full rounded-[16px] object-contain md:h-52"
        />
      </div>

      <div role={outcome === "unread" ? "status" : undefined} className="flex items-start gap-3">
        {outcome === "found" && match && reliable && (
          <span
            aria-hidden="true"
            className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-accent text-accent-ink"
          >
            <CheckIcon size={16} />
          </span>
        )}
        <div>
          <h2 className="font-display text-headline">{status.title}</h2>
          <p className="mt-1 text-body text-ink-2">{status.body}</p>
          {unsure && outcome !== "unread" && (
            <p className="mt-2 text-small text-ink">{t("hardToRead")}</p>
          )}
        </div>
      </div>

      <section
        ref={wineSection}
        tabIndex={-1}
        aria-labelledby="scan-review-wine"
        data-testid="scan-review-wine"
        className="flex scroll-mt-24 flex-col gap-4 rounded-card bg-surface p-4 shadow-raised outline-none ring-1 ring-hairline"
      >
        <h3
          id="scan-review-wine"
          className="text-caption font-medium uppercase tracking-[0.14em] text-ink-2"
        >
          {t("review.wineTitle")}
        </h3>

        {searching ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="font-display text-title">{t("searchTitle")}</p>
              <p className="mt-1 text-small text-ink-2">{t("searchBody")}</p>
            </div>
            <ChooseWine
              wines={wines}
              query={query}
              onQuery={setQuery}
              selectedId={pick?.kind === "wine" ? pick.wine.id : undefined}
              onPick={(wine) => choose({ kind: "wine", wine }, "other_wine")}
              onNew={() => {
                setFromRecord(null);
                choose({ kind: "new" }, "new_wine");
              }}
              catalog={catalogSearch ? { surface: "scan", onRecord: takeRecord } : undefined}
            />
            <Button variant="ghost" block onClick={() => setSearching(false)}>
              {t("review.closeSearch")}
            </Button>
          </div>
        ) : (
          <>
            {offered.length > 0 && (
              <ul className="flex flex-col gap-3" aria-label={status.title}>
                {offered.map((w) => (
                  <li key={w.id}>
                    <Candidate
                      wine={w}
                      year={yearText}
                      owned={owned.get(w.id)}
                      selected={pick?.kind === "wine" && pick.wine.id === w.id}
                      onPick={() => choose({ kind: "wine", wine: w }, "candidate")}
                      why={whyOf(w.id)}
                      art={match && w.id === match.id ? result.art : undefined}
                    />
                  </li>
                ))}
              </ul>
            )}

            {pick?.kind === "wine" && !offered.some((w) => w.id === pick.wine.id) && (
              <Candidate
                wine={pick.wine}
                year={yearText}
                owned={owned.get(pick.wine.id)}
                art={match && pick.wine.id === match.id ? result.art : undefined}
                why={whyOf(pick.wine.id)}
              />
            )}

            {pick?.kind === "wine" && (
              <WineSources origins={existingWineOrigins(pick.wine, facts, path)} />
            )}
            {pick?.kind !== "wine" && match && !reliable && (
              <WineSources origins={existingWineOrigins(match, facts, path)} conflictsOnly />
            )}

            {pick?.kind === "new" && (
              <div className="flex flex-col gap-5" data-testid="scan-review-new">
                {outcome !== "new" && outcome !== "unread" && (
                  <p className="font-display text-title">{t("newTitle")}</p>
                )}
                {fromRecord && (
                  <p
                    role="status"
                    data-testid="new-wine-notice"
                    className="rounded-card bg-accent/10 px-4 py-3 text-small text-ink ring-1 ring-accent-fg/30"
                  >
                    {tAdd("recordNotice", { provider: fromRecord.provider })}
                  </p>
                )}
                {facts && facts.type === null && !fromRecord && (
                  <p className="text-small text-ink">{t("typeUnclear")}</p>
                )}
                <WineFields
                  value={fields}
                  onChange={(next) => {
                    setFields(next);
                    setWineError(null);
                  }}
                  producers={producers}
                  preview={false}
                  sources={draftSources(draftOrigins(fields, start.value, start.from))}
                />
              </div>
            )}

            {/* Sprint 004C: a wine nobody in CELLR has added yet may be known to a source shown to people. */}
            {!fromRecord && outcome !== "unread" && outcome !== "found" && (
              <RecordSuggestions
                level={3}
                records={result.resolution?.records}
                onUse={(s) => takeRecord(s.hit)}
              />
            )}

            {wineError && (
              <p role="alert" className="text-small text-danger" data-testid="scan-review-error">
                {wineError}
              </p>
            )}

            <div className="flex flex-col gap-2">
              {match && reliable && pick?.kind !== "wine" && (
                <Button
                  variant="secondary"
                  block
                  onClick={() => choose({ kind: "wine", wine: match }, "match")}
                >
                  {t("review.useMatch", { wine: `${match.producer} ${match.name}` })}
                </Button>
              )}
              {pick?.kind !== "new" && (
                <Button
                  variant={outcome === "choose" ? "secondary" : "ghost"}
                  block
                  onClick={() => {
                    setFromRecord(null);
                    choose({ kind: "new" }, "new_wine");
                  }}
                >
                  {outcome === "choose" ? t("noneOfThese") : t("notThisOne")}
                </Button>
              )}
              {canSearch && (
                <Button variant="ghost" block onClick={() => setSearching(true)}>
                  <SearchIcon size={18} />
                  {t("searchMine")}
                </Button>
              )}
            </div>
          </>
        )}
      </section>

      <BottleDetails
        wine={pick?.kind === "wine" ? pick.wine : null}
        currency={currency}
        preferredPlaceId={preferredPlaceId}
        spot={spot}
        onSpotChange={onSpotChange}
        initialQuantity={mode === "same" && !inBatch ? 2 : 1}
        quantityHint={mode === "same" && !inBatch ? t("modes.sameQuantity") : undefined}
        initialYear={facts?.nonVintage ? null : (facts?.year ?? undefined)}
        imageId={result.image.id}
        labels={labels}
        autoFocusYear={false}
        yearSource={<VintageSource origin={vintageOrigin(facts, path)} />}
        resolveWine={resolveWine}
        onYearChange={setYear}
        footer={
          <Button
            type="button"
            variant="ghost"
            size="lg"
            block
            loading={addWish.isPending}
            onClick={() => void wish()}
          >
            {tWish("saveFromScan")}
          </Button>
        }
        onDone={(added, placeId) => {
          report("added");
          onDone(added, placeId);
        }}
      />

      {batch ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" size="lg" block onClick={batch.onBack}>
            {t("series.back")}
          </Button>
          <Button variant="ghost" size="lg" block onClick={batch.onSkip}>
            {t("series.skipPhoto")}
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="lg" block onClick={onAgain}>
          {t("tryAnother")}
        </Button>
      )}
    </div>
  );
}

function Candidate({
  wine,
  year,
  owned,
  selected = false,
  onPick,
  art,
  why,
}: {
  wine: WineSummary;
  /** The vintage as it stands in the form below (null: none given yet). */
  year: string | null;
  owned?: number | undefined;
  selected?: boolean;
  onPick?: () => void;
  art?: BottleArtRef | null | undefined;
  /** Why this wine is offered (the resolver's reasons, in words). With it, the colour is shown too. */
  why?: string | undefined;
}) {
  const locale = useLocale();
  const tTypes = useTranslations("wineTypes");
  const detail = [
    year,
    // what tells two candidates apart: with the resolver's reasons the colour is said as well
    why !== undefined ? tTypes(wine.type) : null,
    placeLine(wine.region, wine.countryCode, locale),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="scan-candidate"
      data-wine={wine.id}
      data-selected={onPick ? String(selected) : undefined}
    >
      <WineChoice
        wine={wine}
        detail={detail}
        owned={owned}
        selected={selected}
        onPick={onPick}
        size={onPick ? "thumb" : "card"}
        art={art}
      />
      {why && (
        <p className="px-1 text-caption text-ink-2" data-testid="scan-why">
          {why}
        </p>
      )}
    </div>
  );
}

/** Under a field of a new wine: where its value comes from. Nothing for what the person typed themselves. */
function SourceTag({ field, source }: { field: WineField; source: FieldSource }) {
  const t = useTranslations("scan.source");
  if (source === "typed") return null;
  return (
    <span data-testid="field-source" data-field={field} data-source={source}>
      {t(source)}
    </span>
  );
}

/**
 * Under the wine chosen: where each part of it comes from, grouped ("From the label: producer, name, kind · CELLR
 * database: region"), and what the label says that differs from it. Quiet, in the caption's size: the wine is the
 * point, this says how much of it the label confirmed.
 */
function WineSources({
  origins,
  conflictsOnly = false,
}: {
  origins: Record<WineField, FieldOrigin>;
  conflictsOnly?: boolean;
}) {
  const t = useTranslations("scan.source");
  const tf = useTranslations("scan.field");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
  const groups = new Map<FieldSource, WineField[]>();
  for (const f of WINE_FIELDS) {
    const { source } = origins[f];
    groups.set(source, [...(groups.get(source) ?? []), f]);
  }
  const said = (f: WineField, value: string) =>
    f === "type"
      ? tTypes(value as WineSummary["type"])
      : f === "countryCode"
        ? (countryName(value, locale) ?? value)
        : value;
  const conflicts = WINE_FIELDS.filter((f) => origins[f].conflict !== undefined);
  return (
    <div className="flex flex-col gap-1.5 px-1" data-testid="wine-sources">
      {!conflictsOnly && (
        <p className="text-caption text-ink-3">
          {[...groups.entries()].map(([source, fields], i) => (
            <span
              key={source}
              data-testid="wine-source"
              data-source={source}
              data-fields={fields.join(" ")}
            >
              {i > 0 && " · "}
              {t("group", {
                source: t(source),
                fields: fields.map((f) => tf(f)).join(", "),
              })}
            </span>
          ))}
        </p>
      )}
      {conflicts.map((f) => (
        <p key={f} className="text-small text-ink" data-testid="wine-conflict" data-field={f}>
          {t("conflict", { field: tf(f), value: said(f, origins[f].conflict!) })}
        </p>
      ))}
    </div>
  );
}

/** Under the vintage: where the year it starts with comes from (never from the vintages a wine has). */
function VintageSource({
  origin,
}: {
  origin: { source: "label" | "remembered" | "unknown"; check: boolean };
}) {
  const t = useTranslations("scan.vintageSource");
  return (
    <span data-testid="vintage-source" data-source={origin.source}>
      {t(origin.source === "label" && origin.check ? "labelCheck" : origin.source)}
    </span>
  );
}
