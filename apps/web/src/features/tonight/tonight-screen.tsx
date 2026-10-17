"use client";

import Link from "next/link";
import { ReservedNote } from "@/features/cellar/reserved-note";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  DISH_GROUPS,
  DISHES,
  ERROR_MESSAGES,
  formatVintage,
  matchesDish,
  OCCASIONS,
  type DishId,
  type Occasion,
  type TonightPickView,
  type TonightView,
} from "@cellr/domain";
import { useBottleActions } from "@/features/cellar/use-bottle-actions";
import { labelMark, placeLine, shapeFor } from "@/features/cellar/wine-visuals";
import { errorMessage } from "@/lib/api";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { Button, buttonStyles } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/empty-state";
import { Field } from "@/ui/field";
import { SearchIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { useTonight } from "./hooks";
import { PhasePill, WineStage } from "./pick-bits";

type DishChoice = DishId | null | undefined; // undefined = not chosen yet, null = "nothing in particular"

export function TonightScreen({ hasBottles }: { hasBottles: boolean }) {
  const t = useTranslations("tonight");
  const te = useTranslations();
  const [dish, setDish] = useState<DishChoice>(undefined);
  const [occasion, setOccasion] = useState<Occasion>("anything");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TonightView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ask = useTonight();

  if (!hasBottles)
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

  if (result)
    return (
      <Results
        result={result}
        onChange={() => {
          setResult(null);
          setError(null);
        }}
      />
    );

  const find = () =>
    ask.mutate(
      { dish: dish ?? null, occasion },
      {
        onSuccess: (data) => {
          setError(null);
          setResult(data);
        },
        onError: (e) => setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES)),
      },
    );

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("intro")} />

      <div className="max-w-2xl">
        <div className="flex flex-col gap-4 pb-28">
          <section
            aria-labelledby="eating"
            className="rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline"
          >
            <h2 id="eating" className="mb-4 font-display text-headline">
              {t("eating")}
            </h2>
            <div className="relative">
              <SearchIcon
                size={20}
                className="pointer-events-none absolute left-4 top-3.5 text-ink-3"
              />
              <Field
                label={t("findDish")}
                hideLabel
                type="search"
                enterKeyHint="search"
                autoComplete="off"
                placeholder={t("findDish")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                inputClassName="rounded-full bg-canvas pl-11"
              />
            </div>
            <div className="mt-5 flex flex-col gap-5">
              {query === "" && (
                <div className="flex flex-wrap gap-2">
                  <Chip selected={dish === null} onClick={() => setDish(null)}>
                    {t("nothingParticular")}
                  </Chip>
                </div>
              )}
              {DISH_GROUPS.map((group) => {
                const dishes = DISHES.filter(
                  (d) => d.group === group && matchesDish(d, query, t(`dishes.${d.id}`)),
                );
                if (dishes.length === 0) return null;
                return (
                  <div key={group}>
                    <h3 className="mb-2.5 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
                      {t(`groups.${group}`)}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {dishes.map((d) => (
                        <Chip key={d.id} selected={dish === d.id} onClick={() => setDish(d.id)}>
                          {t(`dishes.${d.id}`)}
                        </Chip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {dish !== undefined && dish !== null && (
              <p
                className="mt-5 rounded-[16px] bg-raised px-4 py-3 text-small text-ink-2"
                data-testid="dish-tip"
              >
                <span className="font-medium text-ink">{t("tipTitle")}: </span>
                {t(`tips.${dish}`)}
              </p>
            )}
          </section>

          <section
            aria-labelledby="occasion"
            className="rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline"
          >
            <h2 id="occasion" className="mb-4 font-display text-headline">
              {t("occasion")}
            </h2>
            <div className="flex flex-wrap gap-2">
              {OCCASIONS.map((o) => (
                <Chip key={o} selected={occasion === o} onClick={() => setOccasion(o)}>
                  {t(`occasions.${o}`)}
                </Chip>
              ))}
            </div>
            <p className="mt-4 text-small text-ink-2">{t(`occasionHints.${occasion}`)}</p>
          </section>

          {error && (
            <p role="alert" className="px-1 text-small text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="sticky bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom)+0.75rem)] z-10 -mt-20 lg:bottom-6">
          <Button
            size="lg"
            block
            loading={ask.isPending}
            disabled={dish === undefined}
            onClick={find}
          >
            {t("find")}
          </Button>
        </div>
      </div>
    </>
  );
}

function Results({ result, onChange }: { result: TonightView; onChange: () => void }) {
  const t = useTranslations("tonight");
  const dishName = result.dish ? t(`dishes.${result.dish}`).toLowerCase() : "";
  return (
    <>
      <PageHeader
        title={t("picks")}
        subtitle={
          result.dish
            ? `${t(`dishes.${result.dish}`)} · ${t(`occasions.${result.occasion}`)}`
            : t(`occasions.${result.occasion}`)
        }
        actions={
          <Button variant="secondary" onClick={onChange}>
            {t("change")}
          </Button>
        }
      />
      {result.picks.length === 0 ? (
        <EmptyState title={t("nothingFound")} illustration={false} />
      ) : (
        // The first card's bottle stands a little above its edge: leave it room.
        <ul className="flex max-w-2xl flex-col gap-5 pt-6" data-testid="tonight-picks">
          {result.picks.map((pick) => (
            <li key={pick.vintageId}>
              <PickCard pick={pick} dishName={dishName} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 max-w-2xl text-center text-caption text-ink-2">
        {t("considered", { count: result.considered })}
      </p>
    </>
  );
}

/** Opening the bottle: the call, what went wrong, and whether it has been done. */
function usePickActions(pick: TonightPickView) {
  const actions = useBottleActions();
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setError(null);
    const failure = await actions.open(pick.bottleId, pick.count - 1);
    if (failure) setError(failure);
    else setOpened(true);
  };
  return { opened, error, open, pending: actions.pending };
}

function PickCard({ pick, dishName }: { pick: TonightPickView; dishName: string }) {
  const t = useTranslations("tonight");
  const tv = useTranslations("vintage");
  const locale = useLocale();
  const state = usePickActions(pick);
  const where = placeLine(pick.region, pick.countryCode, locale);
  const name = `${pick.wineName} ${formatVintage(pick.year)}`;
  const hero = pick.slot === "best";

  const reasons = pick.reasons.length > 0 && (
    <ul className={cn("flex flex-wrap gap-2", hero ? "mt-5" : "mt-4")}>
      {pick.reasons.map((r) => (
        <li
          key={r}
          className={cn(
            "rounded-[18px] px-3.5 py-1.5 text-small",
            hero ? "bg-hero-ink/10 text-hero-ink" : "bg-raised text-ink-2",
          )}
        >
          {t(`reasons.${r}`, { dish: dishName, region: pick.region ?? "" })}
        </li>
      ))}
    </ul>
  );

  const place = (
    <div
      className={cn(
        "mt-4 rounded-[16px] px-4 py-3",
        hero ? "bg-hero-ink/10 text-hero-ink" : "bg-raised text-ink",
      )}
    >
      <p
        className={cn(
          "text-caption font-medium uppercase tracking-[0.14em]",
          hero ? "text-hero-gold" : "text-bronze",
        )}
      >
        {t("where")}
      </p>
      <p className="mt-0.5 text-small">
        {pick.place
          ? `${pick.place.label} · ${tv("spot", { row: pick.place.row, col: pick.place.col })}`
          : t("notPlaced")}
        <span className={hero ? "text-hero-ink/75" : "text-ink-2"}>
          {" "}
          · {t("bottlesLeft", { count: pick.count })}
        </span>
      </p>
    </div>
  );

  const reserved = (
    <ReservedNote
      reserved={pick.reserved}
      count={pick.count}
      className={cn("mt-4", hero && "text-hero-gold")}
    />
  );

  const actions = state.opened ? (
    <div
      role="status"
      className={cn("mt-5 rounded-[16px] p-4", hero ? "bg-hero-ink/10" : "bg-raised")}
    >
      <p className="font-display text-title">{t("enjoy", { wine: pick.wineName })}</p>
      <p className={cn("mt-1 text-small", hero ? "text-hero-ink/80" : "text-ink-2")}>
        {t("enjoyBody")}
      </p>
      <Link
        href={`/cellar/${pick.vintageId}?rate=${pick.bottleId}`}
        className={cn(
          "mt-2 inline-flex min-h-11 items-center text-small font-medium",
          hero ? "text-hero-gold underline underline-offset-4" : "text-accent-fg",
        )}
      >
        {t("howWasIt")}
      </Link>
    </div>
  ) : (
    <>
      {state.error && (
        <p
          role="alert"
          className={cn("mt-4 text-small", hero ? "font-medium text-hero-ink" : "text-danger")}
        >
          {state.error}
        </p>
      )}
      <div className={cn("flex flex-wrap", hero ? "mt-5 gap-3" : "mt-4 gap-2")}>
        {hero ? (
          <Button
            size="lg"
            className="grow basis-44 bg-hero-gold text-[#3a1119]"
            loading={state.pending}
            onClick={() => void state.open()}
          >
            {t("open")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="grow basis-40"
            loading={state.pending}
            onClick={() => void state.open()}
          >
            {t("open")}
          </Button>
        )}
        <Link
          href={`/cellar/${pick.vintageId}`}
          className={cn(
            buttonStyles({ variant: "ghost", size: hero ? "lg" : "md" }),
            "grow basis-24 px-5 ring-1 ring-inset",
            hero
              ? "text-hero-ink ring-hero-ink/35 hover:bg-hero-ink/10 hover:text-hero-ink"
              : "ring-hairline",
          )}
        >
          {t("details")}
        </Link>
      </div>
    </>
  );

  if (hero)
    return (
      <article
        className="relative rounded-[28px] bg-hero p-6 text-hero-ink shadow-raised md:p-8"
        aria-label={`${t(`slots.${pick.slot}`)}: ${name}`}
      >
        {/* The bottle stands on the card and leans out over its top edge, like the one on Home. */}
        <div aria-hidden="true" className="pointer-events-none absolute -top-6 right-8 md:right-12">
          <span className="absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/4 rounded-full bg-hero-ink/[0.08] md:size-36" />
          <BottleGlyph
            shape={shapeFor(pick.type)}
            tint={pick.type}
            mark={labelMark(pick.producer, pick.wineName)}
            year={formatVintage(pick.year)}
            className="relative w-16 rotate-[8deg] origin-bottom md:w-20"
          />
        </div>

        <div className="min-h-[10.25rem] pr-24 md:min-h-[12.5rem] md:pr-36">
          <p className="text-caption font-medium uppercase tracking-[0.18em] text-hero-gold">
            {t(`slots.${pick.slot}`)}
          </p>
          <p className="mt-3 truncate text-caption font-medium uppercase tracking-[0.12em] text-hero-ink/70">
            {pick.producer}
          </p>
          <h3 className="font-display text-headline text-balance">{pick.wineName}</h3>
          <p className="mt-1 text-small text-hero-ink/80">
            <span className="tnum">{formatVintage(pick.year)}</span>
            {where && <span> · {where}</span>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <PhasePill phase={pick.drinkPhase} />
            <span className="inline-flex items-center rounded-full px-3 py-1 text-caption font-semibold text-hero-ink ring-1 ring-inset ring-hero-ink/35">
              {t(`match.${pick.match}`)}
            </span>
          </div>
        </div>

        {reasons}
        {reserved}
        {place}
        {actions}
      </article>
    );

  return (
    <article
      className="rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline"
      aria-label={`${t(`slots.${pick.slot}`)}: ${name}`}
    >
      <div className="flex gap-4">
        <WineStage
          type={pick.type}
          producer={pick.producer}
          wineName={pick.wineName}
          year={pick.year}
          className="h-36 w-24 shrink-0"
          bottleClassName="w-10"
        />
        <div className="min-w-0 flex-1">
          <p className="text-caption font-medium uppercase tracking-[0.14em] text-bronze">
            {t(`slots.${pick.slot}`)}
          </p>
          <p className="mt-1 truncate text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
            {pick.producer}
          </p>
          <h3 className="font-display text-title text-ink">{pick.wineName}</h3>
          <p className="text-small text-ink-2">
            <span className="tnum">{formatVintage(pick.year)}</span>
            {where && <span> · {where}</span>}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <PhasePill phase={pick.drinkPhase} />
            <span className="inline-flex items-center rounded-full px-3 py-1 text-caption font-semibold text-ink-2 ring-1 ring-inset ring-hairline">
              {t(`match.${pick.match}`)}
            </span>
          </div>
        </div>
      </div>
      {reasons}
      {reserved}
      {place}
      {actions}
    </article>
  );
}
