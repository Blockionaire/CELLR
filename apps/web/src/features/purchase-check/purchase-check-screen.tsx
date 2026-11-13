"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import {
  ERROR_MESSAGES,
  formatVintage,
  parseMoneyToCents,
  PurchaseWineSchema,
  WINE_COUNTRIES,
  WINE_TYPES,
  type CatalogSearchHit,
  type PurchaseCheckResult,
  type PurchaseRecognition,
  type PurchaseWine,
  type SimilarWine,
  type SommelierBottle,
  type TasteSignal,
  type VerdictReason,
  type WineSummary,
  type WineType,
} from "@cellr/domain";
import { useWines } from "@/features/cellar/hooks";
import { countryName, placeLine } from "@/features/cellar/wine-visuals";
import { WinePicture } from "@/features/cellar/wine-picture";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { FileButton } from "@/ui/file-button";
import { ChevronRightIcon, CloseIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { Skeleton } from "@/ui/skeleton";
import { useComparePurchase, useRecognizeBottle } from "./hooks";
import { KnowledgeSection } from "./knowledge-section";

/** The wine search is loaded only when the typed path starts with it (the `wine_search` feature). */
const WineSearch = dynamic(
  () => import("@/features/wine-search/wine-search").then((m) => m.WineSearch),
  {
    // Not in the server's HTML: a search field that is on screen before it works loses what is typed into it.
    // The skeleton stands in until the field can answer, and then it takes the focus.
    ssr: false,
    loading: () => (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-14 rounded-full" />
        <Skeleton className="h-[5.25rem] rounded-card" />
      </div>
    ),
  },
);

/** The form as typed: plain strings, checked (by the same schema as the server) only when sent. */
interface Draft {
  producer: string;
  name: string;
  year: string;
  nonVintage: boolean;
  type: WineType | null;
  countryCode: string;
  region: string;
  appellation: string;
  grapes: string;
  price: string;
}

const EMPTY: Draft = {
  producer: "",
  name: "",
  year: "",
  nonVintage: false,
  type: null,
  countryCode: "",
  region: "",
  appellation: "",
  grapes: "",
  price: "",
};

const draftOf = (wine: PurchaseWine, price = ""): Draft => ({
  producer: wine.producer,
  name: wine.name ?? "",
  year: wine.year === null ? "" : String(wine.year),
  nonVintage: wine.nonVintage,
  type: wine.type,
  countryCode: wine.countryCode ?? "",
  region: wine.region ?? "",
  appellation: wine.appellation ?? "",
  grapes: wine.grapes.join(", "),
  price,
});

type Step =
  | { kind: "photo" }
  | { kind: "search" }
  | { kind: "confirm"; recognition: PurchaseRecognition | null }
  | { kind: "result"; result: PurchaseCheckResult };

/**
 * Where the wine on the confirm step came from when it was chosen from the search: the person's own wines, the
 * CELLR catalogue, or an external source (never a CELLR wine). Only said to the person; the comparison itself only
 * ever uses the facts they confirmed.
 */
interface Chosen {
  source: "owned" | "household" | "catalog" | "provider";
  provider: string | null;
}

const knownCountry = (code: string | null | undefined) =>
  (WINE_COUNTRIES as readonly string[]).includes(code ?? "") ? (code as string) : "";

/** A chosen wine as the form's starting point. The vintage is never filled in: the bottle in the shop decides. */
const draftOfChoice = (c: {
  producer: string;
  name: string;
  type: WineType | null;
  countryCode: string | null;
  region: string | null;
}): Draft => ({
  ...EMPTY,
  producer: c.producer,
  name: c.name,
  type: c.type,
  countryCode: knownCountry(c.countryCode),
  region: c.region ?? "",
});

/**
 * KOOPCHECK. Standing in a shop: photograph the bottle, check what was read, and see whether it is worth buying
 * given the cellar and your own ratings. The photo is only read (never kept), the wine is never added anywhere, and
 * a correction is compared again without reading the photo again.
 */
export function PurchaseCheckScreen({
  catalogSearch = false,
  sourcesPanel = false,
}: {
  /** The `wine_search` feature: typing a wine starts with the database search ("Handmatig zoeken"). */
  catalogSearch?: boolean | undefined;
  /** The `sources_panel` feature: the result also says what the catalogue's facts rest on. */
  sourcesPanel?: boolean | undefined;
}) {
  const t = useTranslations("purchaseCheck");
  const te = useTranslations();
  const failed = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);
  const [step, setStep] = useState<Step>({ kind: "photo" });
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // Kept here, so "search again" and "edit" come back to what was typed and chosen.
  const [searchText, setSearchText] = useState("");
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const recognize = useRecognizeBottle();
  const compare = useComparePurchase();

  const restart = () => {
    recognize.reset();
    compare.reset();
    setDraft(EMPTY);
    setSearchText("");
    setChosen(null);
    setStep({ kind: "photo" });
  };

  return (
    <div className="mx-auto w-full max-w-2xl pb-24 lg:pb-0">
      <Link
        href="/sommelier"
        className="mt-4 inline-flex text-small font-medium text-accent-fg underline-offset-4 hover:underline"
      >
        {t("back")}
      </Link>
      <PageHeader className="pt-4 lg:pt-8" title={t("title")} subtitle={t("subtitle")} />

      {step.kind === "photo" && (
        <PhotoStep
          search={catalogSearch}
          reading={recognize.isPending}
          error={recognize.error ? failed(recognize.error) : null}
          onRead={async (file) => {
            try {
              const recognition = await recognize.mutateAsync(file);
              setDraft(recognition.wine ? draftOf(recognition.wine) : EMPTY);
              setStep({ kind: "confirm", recognition });
            } catch {
              // shown by the step; the person can try again or type the wine in
            }
          }}
          onManual={() => {
            setDraft(EMPTY);
            setChosen(null);
            setStep(catalogSearch ? { kind: "search" } : { kind: "confirm", recognition: null });
          }}
        />
      )}

      {step.kind === "search" && (
        <SearchStep
          text={searchText}
          onText={setSearchText}
          onWine={(wine, hit) => {
            setDraft(draftOfChoice(wine));
            setChosen({
              // chosen from the list shown before anything was typed (no search hit): what the wine itself says
              source: hit
                ? hit.source === "catalog"
                  ? "catalog"
                  : hit.source === "owned"
                    ? "owned"
                    : "household"
                : wine.catalog
                  ? "catalog"
                  : "household",
              provider: null,
            });
            compare.reset();
            setStep({ kind: "confirm", recognition: null });
          }}
          onRecord={(hit) => {
            setDraft(draftOfChoice(hit));
            setChosen({ source: "provider", provider: hit.provider?.name ?? "" });
            compare.reset();
            setStep({ kind: "confirm", recognition: null });
          }}
          onType={() => {
            // what was typed is kept as the start of the form, for the person to split into producer and name
            setDraft({ ...EMPTY, producer: searchText.trim().slice(0, 120) });
            setChosen(null);
            compare.reset();
            setStep({ kind: "confirm", recognition: null });
          }}
          onRestart={restart}
        />
      )}

      {step.kind === "confirm" && (
        <ConfirmStep
          recognition={step.recognition}
          chosen={chosen}
          onSearchAgain={
            catalogSearch && step.recognition === null
              ? () => setStep({ kind: "search" })
              : undefined
          }
          draft={draft}
          onChange={setDraft}
          comparing={compare.isPending}
          error={compare.error ? failed(compare.error) : null}
          onCompare={async (wine, priceCents) => {
            try {
              const result = await compare.mutateAsync({ wine, priceCents });
              setStep({ kind: "result", result });
              window.scrollTo({ top: 0 });
            } catch {
              // shown by the step
            }
          }}
          onRestart={restart}
        />
      )}

      {step.kind === "result" && (
        <ResultStep
          result={step.result}
          sourcesPanel={sourcesPanel}
          onEdit={() => setStep({ kind: "confirm", recognition: null })}
          onRestart={restart}
        />
      )}
    </div>
  );
}

// ---- Step A: the photo --------------------------------------------------------------------------------------

function PhotoStep({
  search,
  reading,
  error,
  onRead,
  onManual,
}: {
  /** The typed path starts with the wine search ("Handmatig zoeken") instead of an empty form. */
  search: boolean;
  reading: boolean;
  error: string | null;
  onRead: (file: File) => void;
  onManual: () => void;
}) {
  const t = useTranslations("purchaseCheck");
  const [chosen, setChosen] = useState<{ file: File; url: string } | null>(null);
  // The preview's address is let go when the photo changes or the step closes.
  useEffect(() => (chosen ? () => URL.revokeObjectURL(chosen.url) : undefined), [chosen]);
  const setFile = (file: File | null) =>
    setChosen(file ? { file, url: URL.createObjectURL(file) } : null);
  const file = chosen?.file ?? null;
  const preview = chosen?.url ?? null;

  return (
    <section aria-labelledby="pc-photo" className="flex flex-col gap-4" data-testid="pc-photo">
      <StepTitle id="pc-photo">{t("stepPhoto")}</StepTitle>
      <p className="text-small text-ink-2">{t("photoHint")}</p>
      {file && preview ? (
        <div className="flex flex-col gap-4">
          <div className="relative self-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
            <img
              src={preview}
              alt={t("previewAlt")}
              className="max-h-80 rounded-card object-contain shadow-raised ring-1 ring-hairline"
            />
            {!reading && (
              <button
                type="button"
                onClick={() => setFile(null)}
                aria-label={t("removePhoto")}
                className="absolute right-2 top-2 grid size-10 place-items-center rounded-full bg-surface/90 text-ink shadow-raised ring-1 ring-hairline"
              >
                <CloseIcon size={18} />
              </button>
            )}
          </div>
          {reading ? (
            <div
              role="status"
              className="rounded-card bg-surface p-4 text-center ring-1 ring-hairline"
            >
              <p className="font-display text-title text-ink">{t("reading")}</p>
              <p className="mt-1 text-small text-ink-2">{t("readingHint")}</p>
            </div>
          ) : (
            <Button size="lg" block onClick={() => onRead(file)}>
              {t("readPhoto")}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FileButton variant="primary" size="lg" block capture="environment" onFile={setFile}>
            {t("takePhoto")}
          </FileButton>
          <FileButton size="lg" block onFile={setFile}>
            {t("choosePhoto")}
          </FileButton>
        </div>
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      {!reading && (
        <Button variant="ghost" className="self-start" onClick={onManual} data-testid="pc-manual">
          {t(search ? "searchInstead" : "typeInstead")}
        </Button>
      )}
    </section>
  );
}

// ---- Step B: confirm or correct -----------------------------------------------------------------------------

// ---- Step A2: find the wine by typing ("Handmatig zoeken") -----------------------------------------------------

function SearchStep({
  text,
  onText,
  onWine,
  onRecord,
  onType,
  onRestart,
}: {
  text: string;
  onText: (value: string) => void;
  onWine: (wine: WineSummary, hit: CatalogSearchHit | null) => void;
  onRecord: (hit: CatalogSearchHit) => void;
  onType: () => void;
  onRestart: () => void;
}) {
  const t = useTranslations("purchaseCheck");
  const wines = useWines();
  return (
    <section aria-labelledby="pc-search" className="flex flex-col gap-4" data-testid="pc-search">
      <StepTitle id="pc-search">{t("stepSearch")}</StepTitle>
      <p className="text-small text-ink-2">{t("searchHint")}</p>
      <WineSearch
        value={text}
        onValue={onText}
        label={t("searchLabel")}
        placeholder={t("searchPlaceholder")}
        autoFocus
        // "Your wines": the household's own, never the whole shared catalogue (that is what the search is for)
        localWines={wines.data?.filter((w) => !w.catalog)}
        idleTitle={t("searchIdle")}
        onWine={onWine}
        onRecord={onRecord}
      />
      <Button variant="secondary" size="lg" block onClick={onType} data-testid="pc-type">
        {t("typeWithoutResult")}
      </Button>
      <Button variant="ghost" className="self-start" onClick={onRestart}>
        {t("another")}
      </Button>
    </section>
  );
}

function ConfirmStep({
  recognition,
  chosen,
  onSearchAgain,
  draft,
  onChange,
  comparing,
  error,
  onCompare,
  onRestart,
}: {
  recognition: PurchaseRecognition | null;
  /** The wine was chosen from the search: where from. */
  chosen: Chosen | null;
  /** Back to the search with what was typed (only on the typed path). */
  onSearchAgain?: (() => void) | undefined;
  draft: Draft;
  onChange: (d: Draft) => void;
  comparing: boolean;
  error: string | null;
  onCompare: (wine: PurchaseWine, priceCents: number | null) => void;
  onRestart: () => void;
}) {
  const t = useTranslations("purchaseCheck");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
  const countryId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange({ ...draft, [key]: value });
  const unsure = (level: "low" | "medium" | "high" | undefined) =>
    level === "low" ? t("unsure") : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.producer.trim()) return setProblem(t("producerRequired"));
    const year = draft.year.trim() === "" ? null : Number(draft.year.trim());
    if (year !== null && !Number.isInteger(year)) return setProblem(t("vintageInvalid"));
    const price = parseMoneyToCents(draft.price);
    if (price === undefined) return setProblem(t("priceInvalid"));
    const parsed = PurchaseWineSchema.safeParse({
      producer: draft.producer,
      name: draft.name,
      year: draft.nonVintage ? null : year,
      nonVintage: draft.nonVintage,
      type: draft.type,
      countryCode: draft.countryCode || null,
      region: draft.region,
      appellation: draft.appellation,
      grapes: draft.grapes.split(",").slice(0, 6),
    });
    if (!parsed.success) return setProblem(t("vintageInvalid"));
    setProblem(null);
    onCompare(parsed.data, price);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="pc-confirm"
      className="flex flex-col gap-5"
      data-testid="pc-confirm"
    >
      <StepTitle id="pc-confirm">{t("stepConfirm")}</StepTitle>
      {recognition?.reason ? (
        <Note tone="warn">{t(`reason.${recognition.reason}`)}</Note>
      ) : recognition?.source === "text" ? (
        <Note>{t("fromText")}</Note>
      ) : recognition?.catalog ? (
        <Note>{t("fromCatalog")}</Note>
      ) : chosen ? (
        <Note tone={chosen.source === "provider" ? "warn" : undefined}>
          <span data-testid="pc-chosen" data-source={chosen.source}>
            {t(`chosen.${chosen.source}`, { provider: chosen.provider ?? "" })}
          </span>
        </Note>
      ) : null}
      <p className="text-small text-ink-2">{t("confirmHint")}</p>

      <Field
        label={t("producer")}
        placeholder={t("producerPlaceholder")}
        autoComplete="off"
        autoCapitalize="words"
        value={draft.producer}
        hint={unsure(recognition?.confidence?.producer)}
        onChange={(e) => set("producer", e.target.value)}
        maxLength={120}
      />
      <Field
        label={t("name")}
        placeholder={t("namePlaceholder")}
        autoComplete="off"
        autoCapitalize="words"
        value={draft.name}
        hint={unsure(recognition?.confidence?.name)}
        onChange={(e) => set("name", e.target.value)}
        maxLength={160}
      />
      <div className="grid grid-cols-[1fr_auto] items-end gap-4">
        <Field
          label={t("vintage")}
          placeholder={t("vintagePlaceholder")}
          inputMode="numeric"
          autoComplete="off"
          value={draft.nonVintage ? "" : draft.year}
          disabled={draft.nonVintage}
          hint={unsure(recognition?.confidence?.year)}
          onChange={(e) => set("year", e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
        />
        <label className="mb-3 flex items-center gap-2 text-small text-ink">
          <input
            type="checkbox"
            checked={draft.nonVintage}
            onChange={(e) => set("nonVintage", e.target.checked)}
            className="size-5 accent-[var(--color-accent-fg)]"
          />
          {t("nonVintage")}
        </label>
      </div>

      <div>
        <p className="mb-2 text-small font-medium text-ink-2">{t("type")}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("type")}>
          {[null, ...WINE_TYPES].map((value) => {
            const on = draft.type === value;
            return (
              <button
                key={value ?? "unknown"}
                type="button"
                aria-pressed={on}
                onClick={() => set("type", value)}
                className={cn(
                  "h-11 rounded-full px-4 text-small text-ink ring-1 transition-colors duration-150 ease-cellr",
                  on
                    ? "bg-accent/10 font-semibold ring-2 ring-accent-fg"
                    : "bg-surface font-medium ring-hairline",
                )}
              >
                {value ? tTypes(value) : t("typeUnknown")}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={countryId} className="text-small font-medium text-ink-2">
            {t("country")}
          </label>
          <select
            id={countryId}
            value={draft.countryCode}
            onChange={(e) => set("countryCode", e.target.value)}
            className="h-12 w-full rounded-control border border-hairline bg-surface px-3 text-body text-ink focus-visible:border-accent-fg focus-visible:outline-none"
          >
            <option value="">{t("countryNone")}</option>
            {WINE_COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {countryName(code, locale)}
              </option>
            ))}
          </select>
        </div>
        <Field
          label={t("region")}
          autoComplete="off"
          value={draft.region}
          onChange={(e) => set("region", e.target.value)}
          maxLength={120}
        />
        <Field
          label={t("appellation")}
          autoComplete="off"
          value={draft.appellation}
          onChange={(e) => set("appellation", e.target.value)}
          maxLength={160}
        />
        <Field
          label={t("grapes")}
          hint={t("grapesHint")}
          autoComplete="off"
          value={draft.grapes}
          onChange={(e) => set("grapes", e.target.value)}
          maxLength={260}
        />
      </div>
      <Field
        label={t("price")}
        hint={t("priceHint")}
        inputMode="decimal"
        autoComplete="off"
        placeholder="€"
        value={draft.price}
        onChange={(e) => set("price", e.target.value)}
        maxLength={12}
      />

      {(problem ?? error) && (
        <p role="alert" className="text-small text-danger">
          {problem ?? error}
        </p>
      )}
      {comparing && (
        <p role="status" className="text-small text-ink-2">
          {t("comparing")}
        </p>
      )}
      <Button type="submit" size="lg" block loading={comparing}>
        {t("compare")}
      </Button>
      {onSearchAgain && (
        <Button type="button" variant="ghost" className="self-start" onClick={onSearchAgain}>
          {t("searchAgain")}
        </Button>
      )}
      <Button type="button" variant="ghost" className="self-start" onClick={onRestart}>
        {t("another")}
      </Button>
    </form>
  );
}

// ---- Step C: the result -------------------------------------------------------------------------------------

const VERDICT_TONE: Record<PurchaseCheckResult["verdict"], string> = {
  consider: "bg-ok/12 text-ok ring-ok/30",
  depends: "bg-accent/10 text-accent-fg ring-accent-fg/30",
  skip: "bg-danger/10 text-danger ring-danger/30",
};

function ResultStep({
  result,
  sourcesPanel,
  onEdit,
  onRestart,
}: {
  result: PurchaseCheckResult;
  sourcesPanel: boolean;
  onEdit: () => void;
  onRestart: () => void;
}) {
  const t = useTranslations("purchaseCheck");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
  const { wine, ownership, similar, taste } = result;
  const where = placeLine(wine.appellation ?? wine.region, wine.countryCode, locale);
  const price =
    result.priceCents === null
      ? null
      : new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(
          result.priceCents / 100,
        );
  const detailed =
    wine.type !== null && Boolean(wine.region || wine.appellation || wine.grapes.length);

  return (
    <div className="flex flex-col gap-6" data-testid="pc-result">
      <StepTitle id="pc-result">{t("stepResult")}</StepTitle>
      <header className="rounded-card bg-surface p-4 ring-1 ring-hairline">
        <p className="text-caption font-medium uppercase tracking-[0.12em] text-bronze">
          {wine.producer}
        </p>
        <p className="font-display text-title text-ink">{wine.name ?? wine.producer}</p>
        <p className="text-small text-ink-2">
          {[
            wine.nonVintage ? formatVintage(null) : wine.year ? String(wine.year) : null,
            wine.type ? tTypes(wine.type) : null,
            where,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {price && (
          <p className="mt-1 text-small text-ink-2" data-testid="pc-price">
            {t("price_shown", { price })}
          </p>
        )}
      </header>

      <section
        aria-labelledby="pc-verdict"
        data-testid="pc-verdict"
        data-verdict={result.verdict}
        className="rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline"
      >
        <h2
          id="pc-verdict"
          className="text-caption font-medium uppercase tracking-[0.14em] text-bronze"
        >
          {t("verdictTitle")}
        </h2>
        <p
          className={cn(
            "mt-3 inline-flex rounded-full px-3.5 py-1.5 font-display text-title ring-1",
            VERDICT_TONE[result.verdict],
          )}
        >
          {t(`verdict.${result.verdict}`)}
        </p>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-body text-ink">
          {result.reasons.map((r) => (
            <li key={r.code}>{t(`why.${r.code}`, reasonValues(r))}</li>
          ))}
        </ul>
        <p className="mt-3 text-caption text-ink-3">{t("disclaimer")}</p>
      </section>

      <Section id="pc-owned" title={t("ownedTitle")}>
        <p className="text-body text-ink" data-testid="pc-owned" data-kind={ownership.kind}>
          {t(`owned.${ownership.kind}`)}
        </p>
        {ownership.exact.map((b) => (
          <BottleCard key={b.vintageId} bottle={b} />
        ))}
        {ownership.otherVintages.length > 0 && (
          <>
            {ownership.exact.length > 0 && (
              <p className="text-small font-medium text-ink-2">{t("otherVintages")}</p>
            )}
            {ownership.otherVintages.map((b) => (
              <BottleCard key={b.vintageId} bottle={b} />
            ))}
          </>
        )}
        {ownership.possible.map((b) => (
          <BottleCard key={b.vintageId} bottle={b} note={t("maybe")} />
        ))}
      </Section>

      <Section id="pc-similar" title={t("similarTitle")}>
        {similar.length === 0 ? (
          <p className="text-body text-ink-2">{detailed ? t("similarNone") : t("similarFew")}</p>
        ) : (
          similar.map((s) => <SimilarCard key={s.bottle.vintageId} similar={s} />)
        )}
      </Section>

      <Section id="pc-taste" title={t("tasteTitle")}>
        <p className="text-body text-ink" data-testid="pc-taste" data-fit={taste.fit}>
          {t(`tasteFit.${taste.fit}`)}
        </p>
        {taste.signals.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-small text-ink-2">
            {taste.signals.map((s) => (
              <li key={s.code} className="flex gap-2">
                <SignalMark direction={s.direction} />
                <span>
                  {signalText(t as (k: string, v?: Record<string, string | number>) => string, s)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-caption text-ink-3">
          {t("tasteRated", { count: taste.ratedWines })}{" "}
          <Link
            href="/taste-profile"
            className="font-medium text-accent-fg underline-offset-4 hover:underline"
          >
            {t("tasteProfile")}
          </Link>
        </p>
      </Section>

      {result.knowledge && (
        <KnowledgeSection
          knowledge={result.knowledge}
          vintageKnown={wine.year !== null || wine.nonVintage}
          sourcesPanel={sourcesPanel}
        />
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" block onClick={onRestart}>
          {t("another")}
        </Button>
        <Button size="lg" block variant="secondary" onClick={onEdit}>
          {t("edit")}
        </Button>
      </div>
    </div>
  );
}

/** The numbers a reason's sentence uses (each reason only carries its own). */
const reasonValues = (r: VerdictReason): Record<string, number> => ({
  bottles: "bottles" in r ? r.bottles : 0,
  vintages: "vintages" in r ? r.vintages : 0,
  wines: "wines" in r ? r.wines : 0,
});

function signalText(
  t: (key: string, values?: Record<string, string | number>) => string,
  s: TasteSignal,
) {
  if (s.code === "said_focus")
    return t(s.key === "red" ? "tasteSignal.said_focus_red" : "tasteSignal.said_focus_white_rose");
  return t(`tasteSignal.${s.code}`, {
    wines: s.wines ?? 0,
    average: s.average ?? 0,
    key: s.key ?? "",
  });
}

function SignalMark({ direction }: { direction: TasteSignal["direction"] }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-1.5 size-2 shrink-0 rounded-full",
        direction === "for" ? "bg-ok" : direction === "against" ? "bg-danger" : "bg-ink-3",
      )}
    />
  );
}

function SimilarCard({ similar }: { similar: SimilarWine }) {
  const t = useTranslations("purchaseCheck");
  return (
    <BottleCard
      bottle={similar.bottle}
      count={t("similarCount", { bottles: similar.bottles, vintages: similar.vintages })}
      note={similar.reasons
        .map((r) => t(`similarWhy.${r.code}`, { value: r.value ?? "" }))
        .join(" · ")}
    />
  );
}

/** A wine in the cellar, as everywhere in CELLR: its picture, name, vintage and bottles; it opens its own page. */
function BottleCard({
  bottle,
  note,
  count,
}: {
  bottle: SommelierBottle;
  note?: string;
  count?: string;
}) {
  const t = useTranslations("purchaseCheck");
  const locale = useLocale();
  const where = placeLine(bottle.region, bottle.countryCode, locale);
  return (
    <article
      className="relative flex gap-4 rounded-card bg-surface p-3 pr-4 shadow-raised ring-1 ring-hairline"
      data-testid="pc-bottle"
      data-vintage={bottle.vintageId}
    >
      <WinePicture
        wine={{ ...bottle, image: bottle.image ?? null }}
        className="h-24 w-16 shrink-0 rounded-[12px]"
        bottleClassName="h-[84%]"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-caption font-medium uppercase tracking-[0.12em] text-bronze">
          {bottle.producer}
        </p>
        <h3 className="font-display text-title leading-snug text-ink">
          <Link href={`/cellar/${bottle.vintageId}`} className="after:absolute after:inset-0">
            {bottle.wineName}
          </Link>
        </h3>
        <p className="text-small text-ink-2">
          <span className="tnum">{formatVintage(bottle.year)}</span>
          {where && <span> · {where}</span>}
        </p>
        <p className="mt-1 text-small font-medium text-ink" data-testid="pc-count">
          {count ?? t("bottles", { count: bottle.count })}
        </p>
        {note && <p className="mt-1 text-caption text-ink-2">{note}</p>}
      </div>
      <ChevronRightIcon size={18} className="self-center text-ink-3" />
    </article>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-display text-title text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function StepTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-caption font-medium uppercase tracking-[0.14em] text-bronze">
      {children}
    </h2>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: "warn" | undefined }) {
  return (
    <p
      role={tone === "warn" ? "status" : undefined}
      className={cn(
        "rounded-card px-4 py-3 text-small ring-1",
        tone === "warn"
          ? "bg-accent/10 text-ink ring-accent-fg/30"
          : "bg-surface text-ink-2 ring-hairline",
      )}
    >
      {children}
    </p>
  );
}
