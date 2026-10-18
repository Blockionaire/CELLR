"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  formatVintage,
  tasteHeadline,
  type FriendCellarWine,
  type FriendRack,
  type FriendRating,
  type FriendTaste,
  type FriendView,
  type ShareItem,
} from "@cellr/domain";
import { ConfirmSheet } from "@/features/account/confirm-sheet";
import { RackGrid } from "@/features/cellar/rack-grid";
import { EYEBROW } from "@/features/cellar/vintage-bits";
import { placeLine } from "@/features/cellar/wine-visuals";
import { BarList, Donut, wineFill } from "@/features/stats/charts";
import { StageThumb } from "@/features/wishlist/stage-thumb";
import { Button } from "@/ui/button";
import { ChevronRightIcon } from "@/ui/icons";
import { Field } from "@/ui/field";
import { Segmented } from "@/ui/segmented";
import { Stars } from "@/ui/stars";
import { useFriend, useRemoveFriend } from "./hooks";
import { Card, personName, PersonAvatar } from "./person";

const SCALES = ["body", "tannin", "sweetness", "acidity"] as const;
const TAB_LABEL = { taste: "tabTaste", ratings: "tabRatings", cellar: "tabCellar" } as const;

/** A friend's page: their taste, their ratings and their cellar, as far as they share each with me. */
export function FriendScreen({ initial }: { initial: FriendView }) {
  const t = useTranslations("friends");
  const locale = useLocale();
  const router = useRouter();
  const { data } = useFriend(initial.person.userId, initial);
  const remove = useRemoveFriend();
  const [confirming, setConfirming] = useState(false);
  const firstShared = (["taste", "ratings", "cellar"] as const).find((i) => data.access[i]);
  const [tab, setTab] = useState<ShareItem>(firstShared ?? "taste");
  const name = personName(data.person);
  const since = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(data.since),
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-6">
      <header className="relative flex flex-col items-center gap-3 pb-2 pt-8 text-center lg:pt-14">
        <Link
          href="/friends"
          aria-label={t("back")}
          className="absolute left-0 top-6 grid size-11 place-items-center rounded-full bg-surface text-ink shadow-raised ring-1 ring-hairline transition-transform duration-150 ease-cellr active:scale-[0.96] lg:top-12"
        >
          <ChevronRightIcon size={20} className="rotate-180" />
        </Link>
        <PersonAvatar person={data.person} size="lg" />
        <div>
          <h1 className="font-display text-[2.25rem] leading-[2.5rem] text-balance">{name}</h1>
          <p className="mt-1 text-small text-ink-2">
            {data.person.handle && name !== `@${data.person.handle}` && (
              <span>@{data.person.handle} · </span>
            )}
            {t("friendsSince", { date: since })}
          </p>
        </div>
        {firstShared && (
          <TasteLine
            taste={data.taste}
            ratings={data.ratings}
            cellar={data.cellar?.wines ?? null}
          />
        )}
      </header>

      <Segmented
        label={t("sectionsLabel")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "taste", label: t(TAB_LABEL.taste) },
          { value: "ratings", label: t(TAB_LABEL.ratings) },
          { value: "cellar", label: t(TAB_LABEL.cellar) },
        ]}
        className="mx-auto flex w-full max-w-md [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-2"
      />

      <div role="region" aria-label={t(TAB_LABEL[tab])}>
        {!data.access[tab] ? (
          <NotShared text={t(`notShared.${tab}`, { name })} />
        ) : tab === "taste" ? (
          <TasteTab taste={data.taste} />
        ) : tab === "ratings" ? (
          <RatingsTab ratings={data.ratings ?? []} />
        ) : (
          <CellarTab wines={data.cellar?.wines ?? []} racks={data.cellar?.racks ?? []} />
        )}
      </div>

      <div className="mt-4 flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          {t("unfriend")}
        </Button>
      </div>
      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("unfriendTitle", { name })}
        body={t("unfriendBody", { name })}
        confirmLabel={t("unfriend")}
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(data.person.userId, {
            onSuccess: () => {
              setConfirming(false);
              router.push("/friends");
            },
          })
        }
      />
    </div>
  );
}

/** Three numbers under the name: what there is to look at. */
function TasteLine({
  taste,
  ratings,
  cellar,
}: {
  taste: FriendTaste | null;
  ratings: FriendRating[] | null;
  cellar: FriendCellarWine[] | null;
}) {
  const t = useTranslations("friends");
  const items = [
    ratings !== null && { key: "ratings", n: ratings.length, label: t("statRatings") },
    taste?.average != null && {
      key: "avg",
      n: taste.average.toLocaleString(undefined, { maximumFractionDigits: 1 }),
      label: t("statAverage"),
    },
    cellar !== null && {
      key: "bottles",
      n: cellar.reduce((a, w) => a + w.bottles, 0),
      label: t("statBottles"),
    },
  ].filter(Boolean) as Array<{ key: string; n: number | string; label: string }>;
  if (items.length === 0) return null;
  return (
    <dl className="mt-1 flex justify-center gap-8">
      {items.map((i) => (
        <div key={i.key} className="flex flex-col-reverse items-center">
          <dt className="text-caption text-ink-3">{i.label}</dt>
          <dd className="font-display text-headline leading-none tnum">{i.n}</dd>
        </div>
      ))}
    </dl>
  );
}

function NotShared({ text }: { text: string }) {
  return (
    <p className="mx-auto mt-4 max-w-md rounded-card bg-surface px-6 py-10 text-center text-body text-ink-2 ring-1 ring-hairline">
      {text}
    </p>
  );
}

function TasteTab({ taste }: { taste: FriendTaste | null }) {
  const t = useTranslations("friends");
  const ti = useTranslations("insights");
  const tw = useTranslations("wineTypes");
  const locale = useLocale();
  if (!taste || taste.tastings === 0) return <NotShared text={t("tasteEmpty")} />;

  const head = tasteHeadline(taste);
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const s = taste.structure;

  return (
    <div className="mt-4 flex flex-col gap-4" data-testid="friend-taste">
      <Card title={t("tasteTitle")}>
        <p className="font-display text-headline text-balance" data-testid="taste-headline">
          {head.favouriteType && t("tasteMostly", { type: tw(head.favouriteType).toLowerCase() })}
          {head.favouriteType && head.leanings.length > 0 && " "}
          {head.leanings.length > 0 &&
            t("tasteLikes", { words: list.format(head.leanings.map((l) => t(`leaning.${l}`))) })}
        </p>
        {s && (
          <div className="mt-5 flex flex-col gap-4">
            {SCALES.map((key) => {
              const value = s[key];
              if (value === null) return null;
              const scale = ti(`scales.${key}.name`);
              return (
                <div key={key} className="grid grid-cols-[5rem_1fr_5rem] items-center gap-3">
                  <span className="text-small text-ink-2">{ti(`scales.${key}.low`)}</span>
                  <div
                    role="meter"
                    aria-label={scale}
                    aria-valuemin={1}
                    aria-valuemax={5}
                    aria-valuenow={value}
                    aria-valuetext={ti("scaleValue", { name: scale, value })}
                    className="relative h-2.5 rounded-full bg-raised ring-1 ring-hairline"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 w-1/4 rounded-full bg-accent shadow-raised"
                      style={{ left: `${((value - 1) / 4) * 75}%` }}
                    />
                  </div>
                  <span className="text-right text-small text-ink-2">
                    {ti(`scales.${key}.high`)}
                  </span>
                </div>
              );
            })}
            <p className="text-caption text-ink-3">{t("structureNote")}</p>
          </div>
        )}
      </Card>

      {taste.byType.length > 0 && (
        <Card title={t("typesTitle")}>
          <Donut
            label={t("typesTitle")}
            chartLabel={t("typesChart", { count: taste.tastings })}
            unit={t("statRatings").toLowerCase()}
            rows={taste.byType.map((r) => ({
              key: r.type,
              label: tw(r.type),
              count: r.count,
              colour: wineFill(r.type),
            }))}
          />
        </Card>
      )}

      {taste.regions.length > 0 && (
        <Card title={t("regionsTitle")}>
          <BarList
            label={t("regionsTitle")}
            max={5}
            rows={taste.regions.map((r) => ({
              key: r.region,
              label: r.region,
              count: r.average ?? 0,
              text: r.average === null ? "–" : r.average.toFixed(1),
            }))}
          />
          <p className="mt-3 text-caption text-ink-3">{t("regionsNote")}</p>
        </Card>
      )}

      {taste.words.length > 0 && (
        <Card title={t("wordsTitle")}>
          <ul className="flex flex-wrap gap-2">
            {taste.words.map((w) => (
              <li
                key={w.word}
                className="rounded-full bg-raised px-3 py-1.5 text-small text-ink ring-1 ring-hairline"
              >
                {w.word}
                <span className="ml-1.5 text-ink-3 tnum">{w.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {taste.favourites.length > 0 && (
        <Card title={t("favouritesTitle")}>
          <ol className="flex flex-col gap-3">
            {taste.favourites.map((f, i) => (
              <li key={`${f.producer}-${f.wine}-${f.year}`} className="flex items-center gap-3">
                <span className="w-5 text-center font-display text-title text-ink-3 tnum">
                  {i + 1}
                </span>
                <StageThumb
                  type={f.type}
                  producer={f.producer}
                  wineName={f.wine}
                  className="h-14 w-10"
                />
                <div className="min-w-0 flex-1">
                  <p className={`truncate ${EYEBROW}`}>{f.producer}</p>
                  <p className="truncate text-body font-medium text-ink">
                    {f.wine} <span className="text-ink-2 tnum">{formatVintage(f.year)}</span>
                  </p>
                </div>
                <Stars score={f.stars * 2} label={t("starsLabel", { stars: f.stars })} />
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

const matches = (q: string, ...parts: Array<string | null | number>) => {
  const needle = q.trim().toLowerCase();
  return !needle || parts.some((p) => p !== null && String(p).toLowerCase().includes(needle));
};

function RatingsTab({ ratings }: { ratings: FriendRating[] }) {
  const t = useTranslations("friends");
  const locale = useLocale();
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => ratings.filter((r) => matches(q, r.producer, r.wine, r.year, r.region, r.note)),
    [ratings, q],
  );
  if (ratings.length === 0) return <NotShared text={t("ratingsEmpty")} />;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(
      new Date(iso),
    );

  return (
    <div className="mt-4 flex flex-col gap-3" data-testid="friend-ratings">
      {ratings.length > 6 && (
        <Field
          label={t("filterLabel")}
          hideLabel
          placeholder={t("filterPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
        />
      )}
      <ul className="flex flex-col gap-3">
        {shown.map((r) => {
          const where = placeLine(r.region, r.countryCode, locale);
          return (
            <li
              key={r.id}
              className="rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline"
            >
              <div className="flex gap-3">
                <StageThumb
                  type={r.type}
                  producer={r.producer}
                  wineName={r.wine}
                  className="h-20 w-14"
                />
                <div className="min-w-0 flex-1">
                  <p className={`truncate ${EYEBROW}`}>{r.producer}</p>
                  <h3 className="font-display text-title text-ink">
                    {r.wine} <span className="text-ink-2 tnum">{formatVintage(r.year)}</span>
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {r.stars !== null && (
                      <Stars score={r.stars * 2} label={t("starsLabel", { stars: r.stars })} />
                    )}
                    <span className="text-caption text-ink-3">
                      {date(r.tastedAt)}
                      {where && ` · ${where}`}
                    </span>
                  </div>
                </div>
              </div>
              {r.words.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {r.words.map((w) => (
                    <li
                      key={w}
                      className="rounded-full bg-raised px-2.5 py-1 text-caption text-ink-2"
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              )}
              {r.note && (
                <p className="mt-3 whitespace-pre-wrap rounded-[16px] bg-raised px-4 py-3 text-body text-ink">
                  {r.note}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="text-center text-small text-ink-3">{t("noMatch")}</p>}
    </div>
  );
}

function CellarTab({ wines, racks }: { wines: FriendCellarWine[]; racks: FriendRack[] }) {
  const t = useTranslations("friends");
  const locale = useLocale();
  const [view, setView] = useState<"list" | "racks">("list");
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => wines.filter((w) => matches(q, w.producer, w.wine, w.year, w.region)),
    [wines, q],
  );
  const placed = racks.filter((r) => r.rows > 0 && r.cols > 0);
  if (wines.length === 0) return <NotShared text={t("cellarEmpty")} />;
  const bottles = wines.reduce((a, w) => a + w.bottles, 0);

  return (
    <div className="mt-4 flex flex-col gap-3" data-testid="friend-cellar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-ink-2">
          {t("cellarSummary", { bottles, wines: wines.length })}
        </p>
        {placed.length > 0 && (
          <Segmented
            label={t("cellarViewLabel")}
            value={view}
            onChange={setView}
            options={[
              { value: "list", label: t("viewList") },
              { value: "racks", label: t("viewRacks") },
            ]}
          />
        )}
      </div>

      {view === "list" || placed.length === 0 ? (
        <>
          {wines.length > 6 && (
            <Field
              label={t("filterLabel")}
              hideLabel
              placeholder={t("filterPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              type="search"
            />
          )}
          <ul className="flex flex-col divide-y divide-hairline rounded-card bg-surface px-4 shadow-raised ring-1 ring-hairline">
            {shown.map((w) => {
              const where = placeLine(w.region, w.countryCode, locale);
              return (
                <li
                  key={`${w.producer}-${w.wine}-${w.year}`}
                  className="flex items-center gap-3 py-3"
                >
                  <StageThumb
                    type={w.type}
                    producer={w.producer}
                    wineName={w.wine}
                    className="h-14 w-10"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate ${EYEBROW}`}>{w.producer}</p>
                    <p className="truncate text-body font-medium text-ink">
                      {w.wine} <span className="text-ink-2 tnum">{formatVintage(w.year)}</span>
                    </p>
                    {(where || w.places.length > 0) && (
                      <p className="truncate text-caption text-ink-3">
                        {[where, w.places.join(", ")].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <span
                    className="shrink-0 rounded-full bg-raised px-2.5 py-1 text-caption font-semibold text-ink tnum"
                    aria-label={t("bottlesLabel", { count: w.bottles })}
                  >
                    ×{w.bottles}
                  </span>
                </li>
              );
            })}
          </ul>
          {shown.length === 0 && (
            <p className="text-center text-small text-ink-3">{t("noMatch")}</p>
          )}
        </>
      ) : (
        placed.map((r) => (
          <Card
            key={r.label}
            title={r.label}
            aside={
              <span className="text-small text-ink-3 tnum">
                {t("rackFilled", { count: r.bottles.length, total: r.rows * r.cols })}
              </span>
            }
          >
            <RackGrid
              rows={r.rows}
              cols={r.cols}
              bottles={r.bottles.map((b) => ({
                bottleId: `${r.label}:${b.row}:${b.col}`,
                vintageId: "",
                producer: b.producer,
                wineName: b.wine,
                type: b.type,
                year: b.year,
                region: null,
                countryCode: null,
                row: b.row,
                col: b.col,
                image: null,
              }))}
            />
          </Card>
        ))
      )}
    </div>
  );
}
