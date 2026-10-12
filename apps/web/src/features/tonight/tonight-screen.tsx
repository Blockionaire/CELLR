"use client";

import Link from "next/link";
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
import { placeLine, shapeFor } from "@/features/cellar/wine-visuals";
import { errorMessage } from "@/lib/api";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { Button, buttonStyles } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/empty-state";
import { Field } from "@/ui/field";
import { PageHeader } from "@/ui/page-header";
import { useTonight } from "./hooks";

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

      <div className="flex flex-col gap-8 pb-28">
        <section aria-labelledby="eating">
          <h2 id="eating" className="mb-3 font-display text-headline">
            {t("eating")}
          </h2>
          <Field
            label={t("findDish")}
            hideLabel
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={t("findDish")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mt-4 flex flex-col gap-5">
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
                  <h3 className="mb-2 text-small font-medium text-ink-2">{t(`groups.${group}`)}</h3>
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
              className="mt-4 rounded-card bg-raised px-4 py-3 text-small text-ink-2"
              data-testid="dish-tip"
            >
              <span className="font-medium text-ink">{t("tipTitle")}: </span>
              {t(`tips.${dish}`)}
            </p>
          )}
        </section>

        <section aria-labelledby="occasion">
          <h2 id="occasion" className="mb-3 font-display text-headline">
            {t("occasion")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {OCCASIONS.map((o) => (
              <Chip key={o} selected={occasion === o} onClick={() => setOccasion(o)}>
                {t(`occasions.${o}`)}
              </Chip>
            ))}
          </div>
          <p className="mt-3 text-small text-ink-2">{t(`occasionHints.${occasion}`)}</p>
        </section>

        {error && (
          <p role="alert" className="text-small text-danger">
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
        <ul className="flex flex-col gap-4" data-testid="tonight-picks">
          {result.picks.map((pick) => (
            <li key={pick.vintageId}>
              <PickCard pick={pick} dishName={dishName} />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-center text-caption text-ink-2">
        {t("considered", { count: result.considered })}
      </p>
    </>
  );
}

function PickCard({ pick, dishName }: { pick: TonightPickView; dishName: string }) {
  const t = useTranslations("tonight");
  const tv = useTranslations("vintage");
  const locale = useLocale();
  const actions = useBottleActions();
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const where = placeLine(pick.region, pick.countryCode, locale);
  const name = `${pick.wineName} ${formatVintage(pick.year)}`;

  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-card border border-hairline bg-surface p-5",
        pick.slot === "best" && "shadow-raised",
      )}
      aria-label={`${t(`slots.${pick.slot}`)}: ${name}`}
    >
      <header className="flex items-start gap-4">
        <div className="grid h-24 w-16 shrink-0 place-items-center rounded-control bg-raised">
          <BottleGlyph shape={shapeFor(pick.type)} tint={pick.type} className="h-[4.5rem] w-auto" />
        </div>
        <div className="min-w-0">
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
          <p className="mt-1 text-small font-medium text-ink">{t(`match.${pick.match}`)}</p>
        </div>
      </header>

      <ul className="flex flex-col gap-1.5 text-body text-ink-2">
        {pick.reasons.map((r) => (
          <li key={r} className="flex gap-2">
            <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent" />
            {t(`reasons.${r}`, { dish: dishName, region: pick.region ?? "" })}
          </li>
        ))}
      </ul>

      <p className="rounded-control bg-raised px-4 py-3 text-small text-ink">
        {pick.place
          ? `${pick.place.label} · ${tv("spot", { row: pick.place.row, col: pick.place.col })}`
          : t("notPlaced")}
        <span className="text-ink-2"> · {t("bottlesLeft", { count: pick.count })}</span>
      </p>

      {opened ? (
        <div role="status" className="rounded-control bg-raised px-4 py-4">
          <p className="font-display text-title">{t("enjoy", { wine: pick.wineName })}</p>
          <p className="mt-1 text-small text-ink-2">{t("enjoyBody")}</p>
          <Link
            href={`/cellar/${pick.vintageId}?rate=${pick.bottleId}`}
            className="mt-2 inline-flex min-h-11 items-center text-small font-medium text-accent-fg"
          >
            {t("howWasIt")}
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="col-span-2"
              loading={actions.pending}
              onClick={async () => {
                setError(null);
                const failure = await actions.open(pick.bottleId, pick.count - 1);
                if (failure) setError(failure);
                else setOpened(true);
              }}
            >
              {t("open")}
            </Button>
            <Link
              href={`/cellar/${pick.vintageId}`}
              className={buttonStyles({
                variant: "secondary",
                size: "lg",
                className: "col-span-2",
              })}
            >
              {t("details")}
            </Link>
          </div>
        </>
      )}
    </article>
  );
}
