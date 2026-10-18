"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  currentValueCents,
  ERROR_MESSAGES,
  parseMoneyToCents,
  PROFILE_VERSION,
  type InsightOutput,
  type VintageInsightView,
} from "@cellr/domain";
import {
  useGenerateInsight,
  useInsight,
  useSaveMyValue,
  useValuate,
} from "@/features/insights/hooks";
import { ValueLine } from "@/features/stats/charts";
import { ApiError, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { useToast } from "@/ui/toast";
import { useDay, useMoney } from "./bottle-bits";
import { FLAVOR_COLOUR, FLAVOR_ICON, PAIRING_ICON } from "./profile-icons";
import { EYEBROW, Section, Tag } from "./vintage-bits";

const SCALES = ["body", "tannin", "sweetness", "acidity"] as const;

/** true while the profile is being written by itself, right after the wine was added */
function useAutomatic(vintageId: string) {
  return useQuery({
    queryKey: ["insight-pending", vintageId],
    queryFn: () => false,
    enabled: false,
    initialData: false,
    staleTime: Infinity,
  }).data;
}

/**
 * What the AI can tell about this wine, always labelled as its estimate, above the plain facts the page knows
 * (`children`). The profile is written once and then stays: the same words every time. An older kind of
 * profile can only be filled in.
 */
export function AboutSection({
  vintageId,
  title,
  children,
}: {
  vintageId: string;
  title: string;
  /** The wine's own facts (style, region…), shown under the profile. */
  children: ReactNode;
}) {
  const t = useTranslations("insights");
  const te = useTranslations();
  const day = useDay();
  const { data } = useInsight(vintageId);
  const generate = useGenerateInsight(vintageId);
  const automatic = useAutomatic(vintageId);
  const busy = generate.isPending || automatic === true;
  const [failure, setFailure] = useState<string | null>(null);

  const view: VintageInsightView | undefined = data;
  const out = view?.insight?.output ?? null;
  const older = out !== null && out.version < PROFILE_VERSION;

  async function ask() {
    setFailure(null);
    try {
      await generate.mutateAsync();
    } catch (e) {
      setFailure(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <Section title={title}>
      {view && (
        <div data-testid="insight" className="flex flex-col gap-5">
          {!view.ready ? (
            <p className="text-body text-ink-2">{t("notReady")}</p>
          ) : out ? (
            <>
              <Profile out={out} />
              {older && (
                <div className="flex flex-col items-start gap-2 rounded-[16px] bg-raised p-3">
                  <p className="text-small text-ink-2">{t("completeHint")}</p>
                  <Button size="sm" variant="secondary" loading={busy} onClick={ask}>
                    {t("complete")}
                  </Button>
                </div>
              )}
              <p className="text-caption text-ink-2">
                {t("estimateNote", { level: t(`confidence.${out.confidence}`) })} ·{" "}
                {t("writtenOn", { day: day(view.insight!.generatedAt) })}
              </p>
            </>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-body text-ink-2">{t("intro")}</p>
              <Button variant="secondary" loading={busy} onClick={ask}>
                {busy ? t("thinking") : t("ask")}
              </Button>
            </div>
          )}
          {failure && (
            <p role="alert" className="text-small text-danger">
              {failure}
            </p>
          )}
        </div>
      )}
      {view && <hr className="my-5 border-hairline" />}
      {children}
    </Section>
  );
}

function Profile({ out }: { out: InsightOutput }) {
  const t = useTranslations("insights");
  const stats = [
    out.abvPercent !== null && { key: "abv", label: t("abv"), value: `${out.abvPercent}%` },
    out.serving && {
      key: "serving",
      label: t("serving"),
      value: t("servingValue", { min: out.serving.minC, max: out.serving.maxC }),
    },
    out.decantMinutes !== null && {
      key: "decant",
      label: t("decant"),
      value:
        out.decantMinutes === 0
          ? t("decantNone")
          : t("decantValue", { minutes: out.decantMinutes }),
    },
  ].filter((s): s is { key: string; label: string; value: string } => Boolean(s));

  return (
    <>
      <p className="font-display text-title italic text-balance text-ink">{out.summary}</p>
      {out.style && (
        <p className="-mt-2 text-small font-medium uppercase tracking-[0.12em] text-bronze">
          {out.style}
        </p>
      )}
      {out.tasting && <p className="text-body text-ink-2">{out.tasting}</p>}
      {out.grapes.length > 0 && (
        <div>
          <p className={EYEBROW}>{t("grapes")}</p>
          <Tags items={out.grapes} />
        </div>
      )}
      {stats.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.key} className="rounded-[16px] bg-raised p-3">
              <dt className="text-caption text-ink-2">{s.label}</dt>
              <dd className="mt-0.5 font-display text-title tnum text-ink">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {out.aging && (
        <div>
          <p className={EYEBROW}>{t("aging")}</p>
          <p className="mt-1 text-body text-ink">{out.aging}</p>
        </div>
      )}
    </>
  );
}

function Tags({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-2">
      {items.map((item, i) => (
        <Tag key={item} last={i === items.length - 1}>
          {item}
        </Tag>
      ))}
    </ul>
  );
}

/**
 * How it tastes, the way wine apps show it: four scales from light to full, soft to firm, dry to sweet and gentle
 * to fresh, then the aroma families with their notes. Only there when the profile has them.
 */
export function TasteSection({ vintageId }: { vintageId: string }) {
  const t = useTranslations("insights");
  const out = useInsight(vintageId).data?.insight?.output ?? null;
  const structure = out?.structure ?? null;
  const flavors = out?.flavors ?? [];
  if (!out || (!structure && flavors.length === 0)) return null;

  return (
    <Section title={t("tasteTitle")} testId="taste">
      {structure && (
        <div className="flex flex-col gap-4">
          {SCALES.map((key) => {
            const value = structure[key];
            if (value === null) return null;
            const name = t(`scales.${key}.name`);
            return (
              <div key={key} className="grid grid-cols-[5.5rem_1fr_5.5rem] items-center gap-3">
                <span className="text-small text-ink-2">{t(`scales.${key}.low`)}</span>
                <div
                  role="meter"
                  aria-label={name}
                  aria-valuemin={1}
                  aria-valuemax={5}
                  aria-valuenow={value}
                  aria-valuetext={t("scaleValue", { name, value })}
                  className="relative h-2.5 rounded-full bg-raised ring-1 ring-hairline"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 w-1/4 rounded-full bg-accent shadow-raised"
                    style={{ left: `${((value - 1) / 4) * 75}%` }}
                  />
                </div>
                <span className="text-right text-small text-ink-2">{t(`scales.${key}.high`)}</span>
              </div>
            );
          })}
        </div>
      )}
      {flavors.length > 0 && (
        <>
          <h3 className={`${EYEBROW} ${structure ? "mt-6" : ""}`}>{t("aromasTitle")}</h3>
          <ul className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            {flavors.map((f) => {
              const Icon = FLAVOR_ICON[f.group];
              const colour = FLAVOR_COLOUR[f.group];
              return (
                <li key={f.group} className="flex items-center gap-3 rounded-[16px] bg-raised p-3">
                  <span
                    aria-hidden="true"
                    className="grid size-11 shrink-0 place-items-center rounded-full"
                    style={{
                      background: `color-mix(in srgb, ${colour} 18%, transparent)`,
                      color: `light-dark(${colour}, color-mix(in oklab, ${colour} 65%, white))`,
                    }}
                  >
                    <Icon size={22} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-body font-medium text-ink">{t(`flavor.${f.group}`)}</p>
                    <p className="text-small text-ink-2">{f.notes.join(", ")}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="mt-4 text-caption text-ink-2">{t("tasteNote")}</p>
    </Section>
  );
}

/** What to eat with it: kinds of food as icons, then the dishes the profile named. */
export function PairsSection({ vintageId }: { vintageId: string }) {
  const t = useTranslations("insights");
  const out = useInsight(vintageId).data?.insight?.output ?? null;
  if (!out || (out.pairingKinds.length === 0 && out.pairings.length === 0)) return null;
  return (
    <Section title={t("pairsTitle")} testId="pairs">
      {out.pairingKinds.length > 0 && (
        <ul className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4">
          {out.pairingKinds.map((k) => {
            const Icon = PAIRING_ICON[k];
            return (
              <li key={k} className="flex flex-col items-center gap-2 text-center">
                <span
                  aria-hidden="true"
                  className="grid size-14 place-items-center rounded-full bg-raised text-accent-fg ring-1 ring-hairline"
                >
                  <Icon size={26} strokeWidth={1.5} />
                </span>
                <span className="text-small text-ink">{t(`pairKind.${k}`)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {out.pairings.length > 0 && (
        <div className={out.pairingKinds.length > 0 ? "mt-5" : ""}>
          <p className={EYEBROW}>{t("pairings")}</p>
          <Tags items={out.pairings} />
        </div>
      )}
    </Section>
  );
}

/**
 * What a bottle is worth now: your own number if you gave one, else the latest value looked up on the web, with
 * the pages it came from, and how it moved. A new lookup at most once a month.
 */
export function WorthSection({ vintageId, currency }: { vintageId: string; currency: string }) {
  const t = useTranslations("insights");
  const te = useTranslations();
  const toast = useToast();
  const locale = useLocale();
  const day = useDay();
  const { data } = useInsight(vintageId);
  const saveValue = useSaveMyValue(vintageId);
  const valuate = useValuate(vintageId);
  const money = useMoney(data?.currency ?? currency);
  const automatic = useAutomatic(vintageId) === true;
  const [editing, setEditing] = useState(false);
  const [valueText, setValueText] = useState("");
  const [valueError, setValueError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  if (!data?.ready) return null;
  const view: VintageInsightView = data;
  const legacy = view.insight?.output.value ?? null;
  const v = view.valuation;
  const worth = currentValueCents(view);
  const message = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

  async function lookup() {
    setLookupError(null);
    try {
      await valuate.mutateAsync();
    } catch (e) {
      setLookupError(
        e instanceof ApiError && e.code === "NOT_FOUND" ? t("valueNotFound") : message(e),
      );
    }
  }

  async function submitValue(event: FormEvent) {
    event.preventDefault();
    const parsed = parseMoneyToCents(valueText);
    if (parsed === undefined) return setValueError(t("valueError"));
    setValueError(null);
    try {
      await saveValue.mutateAsync(parsed);
      setEditing(false);
      toast.show(t("valueSaved"));
    } catch (e) {
      setValueError(message(e));
    }
  }

  const startEdit = () => {
    setValueText(
      view.myValueCents === null
        ? ""
        : (view.myValueCents / 100).toFixed(2).replace(".", locale === "nl" ? "," : "."),
    );
    setValueError(null);
    setEditing(true);
  };

  const monthLabel = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(iso),
    );

  return (
    <Section title={t("valueTitle")} testId="value">
      {worth !== null ? (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-display tnum text-ink" data-testid="worth">
              {money(worth)}
            </span>
            <span className="text-body text-ink-2">{t("perBottle")}</span>
          </p>
          <p className="mt-1 text-small text-ink-2">
            {view.myValueCents !== null
              ? t("valueMine")
              : v
                ? t("valueRangeSourced", { low: money(v.lowCents), high: money(v.highCents) })
                : legacy
                  ? t("valueRange", { low: money(legacy.lowCents), high: money(legacy.highCents) })
                  : ""}
          </p>
          {view.myValueCents === null && v && (
            <div className="mt-4 flex flex-col gap-2">
              {v.basis && <p className="text-small text-ink">{v.basis}</p>}
              {v.sources.length > 0 ? (
                <div>
                  <p className={EYEBROW}>{t("valueSources")}</p>
                  <ul className="mt-1.5 flex flex-wrap gap-2" data-testid="value-sources">
                    {v.sources.map((s) => (
                      <li key={s.url}>
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="inline-flex min-h-9 items-center gap-1 rounded-full bg-raised px-3 text-small text-ink underline-offset-2 hover:underline"
                        >
                          {s.name}
                          <span aria-hidden="true">↗</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-caption text-ink-2">{t("valueNoSources")}</p>
              )}
              <p className="text-caption text-ink-2">{t("valueAsOf", { day: day(v.valuedAt) })}</p>
            </div>
          )}
          {view.myValueCents === null && !v && legacy?.basis && (
            <p className="mt-1 text-caption text-ink-2">{legacy.basis}</p>
          )}
          {view.valueHistory.length > 1 && (
            <div className="mt-5">
              <p className={EYEBROW}>{t("valueHistory")}</p>
              <div className="mt-2">
                <ValueLine
                  label={t("valueHistory")}
                  points={view.valueHistory.map((h) => ({ month: h.valuedAt, cents: h.cents }))}
                  format={money}
                  monthLabel={monthLabel}
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-body text-ink-2">{t("valueNone")}</p>
      )}

      {view.valuationsReady && (
        <div className="mt-4 flex flex-col items-start gap-2">
          {view.nextValuationAt === null ? (
            <Button
              size="sm"
              variant={v ? "ghost" : "secondary"}
              loading={valuate.isPending || (automatic && !v)}
              onClick={lookup}
            >
              {valuate.isPending ? t("valueLooking") : v ? t("valueAgain") : t("valueLookup")}
            </Button>
          ) : (
            <p className="text-caption text-ink-2">
              {t("valueAgainFrom", { day: day(view.nextValuationAt) })}
            </p>
          )}
          {lookupError && (
            <p role="alert" className="text-small text-danger">
              {lookupError}
            </p>
          )}
        </div>
      )}

      {editing ? (
        <form onSubmit={submitValue} noValidate className="mt-4 flex flex-col gap-3">
          <Field
            label={t("myValueLabel", { currency: view.currency })}
            hint={t("myValueHint")}
            inputMode="decimal"
            value={valueText}
            error={valueError}
            onChange={(e) => setValueText(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={saveValue.isPending}>
              {t("valueSave")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              {t("valueCancel")}
            </Button>
            {view.myValueCents !== null && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => saveValue.mutate(null, { onSuccess: () => setEditing(false) })}
              >
                {t("valueClear")}
              </Button>
            )}
          </div>
        </form>
      ) : (
        <Button className="mt-4" size="sm" variant="secondary" onClick={startEdit}>
          {view.myValueCents === null ? t("valueSet") : t("valueChange")}
        </Button>
      )}
    </Section>
  );
}
