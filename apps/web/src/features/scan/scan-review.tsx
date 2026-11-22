"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import {
  ERROR_MESSAGES,
  formatVintage,
  RESOLVE_REASONS,
  suggestWine,
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
import { placeLine } from "@/features/cellar/wine-visuals";
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

  const [pick, setPick] = useState<Pick>(() =>
    match ? { kind: "wine", wine: match } : outcome === "choose" ? null : { kind: "new" },
  );
  const [choice, setChoice] = useState<Choice>(match ? "match" : "new_wine");
  // A wrong guess is corrected by finding the right wine among your own, not by typing it in again (a duplicate).
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState(facts?.producer ?? facts?.name ?? "");
  // What the person has in the new-wine fields: kept while another wine is tried, so nothing typed is lost.
  const [fields, setFields] = useState<WineFieldsValue>(() =>
    fieldsOfDraft(facts ? suggestWine(facts) : undefined),
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
    setFields(fieldsOfDraft(draftOfRecord(hit)));
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

  const status =
    outcome === "unread"
      ? { title: t("unreadTitle"), body: t(`unread.${result.reason ?? "ai-down"}`) }
      : outcome === "found" && match
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
        {outcome === "found" && match && (
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
            {outcome === "choose" && (
              <ul className="flex flex-col gap-3" aria-label={t("chooseTitle")}>
                {matches.map((m) => (
                  <li key={m.wine.id}>
                    <Candidate
                      wine={m.wine}
                      year={yearText}
                      owned={owned.get(m.wine.id)}
                      selected={pick?.kind === "wine" && pick.wine.id === m.wine.id}
                      onPick={() => choose({ kind: "wine", wine: m.wine }, "candidate")}
                      why={whyOf(m.wine.id)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {pick?.kind === "wine" &&
              !(outcome === "choose" && matches.some((m) => m.wine.id === pick.wine.id)) && (
                <Candidate
                  wine={pick.wine}
                  year={yearText}
                  owned={owned.get(pick.wine.id)}
                  art={match && pick.wine.id === match.id ? result.art : undefined}
                  why={whyOf(pick.wine.id)}
                />
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
              {match && pick?.kind !== "wine" && (
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
