"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import {
  CreateWineSchema,
  ERROR_MESSAGES,
  WINE_COUNTRIES,
  WINE_TYPES,
  type WineSummary,
  type WineType,
} from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { CheckIcon } from "@/ui/icons";
import { useCreateWine } from "./hooks";
import { STAGE } from "./wine-card";
import { WineStage } from "./wine-stage";
import { countryName, placeLine, shapeFor } from "./wine-visuals";

/** What a scan read off the label, to start the form with. A null type means "not clear: choose". */
export interface NewWineDraft {
  producer: string;
  name: string;
  type: WineType | null;
  countryCode: string | null;
  region: string | null;
}

interface NewWineFormProps {
  initialName: string;
  /** Starts the form from what a label scan read; the person checks and corrects it. */
  draft?: NewWineDraft | undefined;
  /** Producers already in the household's list, offered as suggestions so spellings stay consistent. */
  producers: string[];
  onCreated: (wine: WineSummary) => void;
}

/** Step 1b: only what identifies the wine. Three required answers; the rest is optional. */
export function NewWineForm({ initialName, draft, producers, onCreated }: NewWineFormProps) {
  const t = useTranslations("addBottle");
  const tTypes = useTranslations("wineTypes");
  const te = useTranslations();
  const locale = useLocale();
  const create = useCreateWine();
  const listId = useId();
  const countryId = useId();

  const [producer, setProducer] = useState(draft?.producer ?? "");
  const [name, setName] = useState(draft?.name ?? initialName);
  const [type, setType] = useState<WineType | null>(draft ? draft.type : "red");
  const [country, setCountry] = useState(draft?.countryCode ?? "");
  const [region, setRegion] = useState(draft?.region ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (type === null) return setError(t("typeRequired"));
    const parsed = CreateWineSchema.safeParse({
      producer,
      name,
      type,
      ...(country ? { countryCode: country } : {}),
      region,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
    try {
      onCreated(await create.mutateAsync(parsed.data));
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {/* A live preview: the bottle on its stage, typeset from what is typed. Decorative, the fields say it all. */}
      <div
        aria-hidden="true"
        className="flex items-center gap-4 rounded-card bg-surface p-3 shadow-raised ring-1 ring-hairline"
      >
        <WineStage
          type={type ?? "red"}
          muted={type === null}
          producer={producer}
          name={name}
          size="card"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-caption font-medium uppercase tracking-[0.14em]",
              producer.trim() ? "text-bronze" : "text-ink-3",
            )}
          >
            {producer.trim() || t("producerPlaceholder")}
          </p>
          <p
            className={cn(
              "mt-0.5 line-clamp-2 font-display text-title",
              name.trim() ? "text-ink" : "text-ink-3",
            )}
          >
            {name.trim() || t("namePlaceholder")}
          </p>
          <p className="mt-1 text-small text-ink-2">
            {[type ? tTypes(type) : null, placeLine(region.trim() || null, country || null, locale)]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <Field
        label={t("producerLabel")}
        placeholder={t("producerPlaceholder")}
        autoFocus
        autoComplete="off"
        autoCapitalize="words"
        list={listId}
        value={producer}
        onChange={(e) => setProducer(e.target.value)}
      />
      <datalist id={listId}>
        {producers.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <Field
        label={t("nameLabel")}
        placeholder={t("namePlaceholder")}
        autoComplete="off"
        autoCapitalize="words"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div>
        <p className="mb-2 text-small font-medium text-ink-2">{t("typeLabel")}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("typeLabel")}>
          {WINE_TYPES.map((value) => {
            const on = type === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => setType(value)}
                className={cn(
                  "inline-flex h-12 items-center gap-2 rounded-full pl-3.5 pr-4 text-small text-ink transition-transform duration-150 ease-cellr active:scale-[0.97]",
                  STAGE[value],
                  on ? "font-semibold ring-2 ring-accent-fg" : "font-medium ring-1 ring-hairline",
                )}
              >
                <BottleGlyph shape={shapeFor(value)} tint={value} className="w-[0.7rem] shrink-0" />
                {tTypes(value)}
                {on && <CheckIcon size={16} className="-mr-1 text-accent-fg" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={countryId} className="text-small font-medium text-ink-2">
            {t("countryLabel")}
          </label>
          <select
            id={countryId}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="h-12 w-full rounded-control border border-hairline bg-surface px-3 text-body text-ink focus-visible:border-accent-fg focus-visible:outline-none"
          >
            <option value="">{t("countryNone")}</option>
            {WINE_COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {countryName(code, locale)}
              </option>
            ))}
          </select>
          <p className="text-caption text-ink-3">{t("countryHint")}</p>
        </div>
        <Field
          label={t("regionLabel")}
          placeholder={t("regionPlaceholder")}
          hint={t("regionHint")}
          autoComplete="off"
          autoCapitalize="words"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" block loading={create.isPending}>
        {t("continue")}
      </Button>
    </form>
  );
}
