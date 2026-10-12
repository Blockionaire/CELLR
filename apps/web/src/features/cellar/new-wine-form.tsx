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
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Field } from "@/ui/field";
import { useCreateWine } from "./hooks";
import { countryName } from "./wine-visuals";

interface NewWineFormProps {
  initialName: string;
  /** Producers already in the household's list, offered as suggestions so spellings stay consistent. */
  producers: string[];
  onCreated: (wine: WineSummary) => void;
}

/** Step 1b: only what identifies the wine. Three required answers; the rest is optional. */
export function NewWineForm({ initialName, producers, onCreated }: NewWineFormProps) {
  const t = useTranslations("addBottle");
  const tTypes = useTranslations("wineTypes");
  const te = useTranslations();
  const locale = useLocale();
  const create = useCreateWine();
  const listId = useId();
  const countryId = useId();

  const [producer, setProducer] = useState("");
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<WineType>("red");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
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
          {WINE_TYPES.map((value) => (
            <Chip key={value} selected={type === value} onClick={() => setType(value)}>
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full ring-1 ring-current/40"
                  style={{ background: `var(--wine-${value})` }}
                />
                {tTypes(value)}
              </span>
            </Chip>
          ))}
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
