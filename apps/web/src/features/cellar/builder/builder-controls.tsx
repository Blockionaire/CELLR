"use client";

import { useTranslations } from "next-intl";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  STORAGE_TEMPLATES,
  ZONE_TEMP_C,
  type StorageColor,
  type StorageTemplateId,
  type StorageZone,
  type ZonePurpose,
} from "@cellr/domain";
import { cn } from "@/ui/cn";
import { CheckIcon, MinusIcon, PlusIcon } from "@/ui/icons";
import { Segmented } from "@/ui/segmented";
import { PREMIUM_TONES } from "../storage3d/palette";
import { cardFacts, groupedTemplates, templateSnapshot } from "./catalogue";

/**
 * The builder's controls (sprint 3). Built from the app's own pieces (Segmented, the stepper's look, the card
 * surfaces), each a labelled group a keyboard and a screen reader can use, each target at least 44 px.
 */

export function Section({
  title,
  children,
  aside,
  id,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="font-display text-title text-ink">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ---- Templates --------------------------------------------------------------------------------------------------

/**
 * Every template, grouped, as a still picture made by the renderer ahead of time (fourteen small images, never
 * fourteen live scenes). A radio group: one is chosen; arrow keys move between them.
 */
export function TemplateCatalogue({
  value,
  chosen,
  onChoose,
}: {
  value: StorageTemplateId;
  /** False while the template is only a suggestion: no card shows as chosen. */
  chosen: boolean;
  onChoose: (id: StorageTemplateId) => void;
}) {
  const t = useTranslations("builder");
  const tt = useTranslations("storageTemplates");
  const groups = groupedTemplates();
  const order = groups.flatMap((g) => g.ids);
  const refs = useRef(new Map<StorageTemplateId, HTMLButtonElement>());
  const focusable = chosen ? value : order[0]!;

  const onKeyDown = (event: KeyboardEvent, id: StorageTemplateId) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = order[(order.indexOf(id) + step + order.length) % order.length]!;
    refs.current.get(next)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("sections.template")}
      className="flex flex-col gap-5"
      data-testid="builder-catalogue"
    >
      {groups.map(({ group, ids }) => (
        <div key={group} className="flex flex-col gap-2">
          <h3 className="text-caption font-medium uppercase tracking-[0.08em] text-ink-2">
            {t(`groups.${group}`)}
          </h3>
          <div className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0">
            {ids.map((id) => {
              const facts = cardFacts(id);
              const selected = chosen && id === value;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    if (el) refs.current.set(id, el);
                    else refs.current.delete(id);
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={id === focusable ? 0 : -1}
                  onClick={() => onChoose(id)}
                  onKeyDown={(e) => onKeyDown(e, id)}
                  data-testid={`template-${id}`}
                  data-savable={facts.savable}
                  className={cn(
                    "group relative flex w-[13.5rem] shrink-0 snap-start flex-col overflow-hidden rounded-card bg-surface text-left ring-1 transition-[box-shadow,transform] duration-200 ease-cellr sm:w-auto",
                    selected
                      ? "shadow-raised ring-2 ring-accent"
                      : "ring-hairline hover:-translate-y-0.5 hover:shadow-raised",
                  )}
                >
                  <span className="relative block aspect-[4/3] w-full overflow-hidden bg-[#efe7dc]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a small static still, sized by its box */}
                    <img
                      src={templateSnapshot(id)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={400}
                      height={300}
                      className="size-full object-cover transition-transform duration-500 ease-cellr group-hover:scale-[1.03]"
                    />
                    {!facts.savable && (
                      <span className="absolute left-2 top-2 rounded-full bg-surface/95 px-2.5 py-1 text-caption font-medium text-ink shadow-raised">
                        {t("card.previewOnly")}
                      </span>
                    )}
                    {selected && (
                      <span
                        aria-hidden="true"
                        className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-accent text-accent-ink shadow-raised"
                      >
                        <CheckIcon size={16} />
                      </span>
                    )}
                  </span>
                  <span className="flex flex-1 flex-col gap-1 p-3">
                    <span className="font-medium text-ink">{tt(`${id}.name`)}</span>
                    <span className="text-caption text-ink-2">{tt(`${id}.description`)}</span>
                    <span className="mt-1 flex flex-wrap gap-1.5 text-caption text-ink-2">
                      <Fact>{t("card.capacity", { count: facts.capacity })}</Fact>
                      <Fact>
                        {facts.holds.kind === "single"
                          ? t("card.perSpot")
                          : facts.holds.kind === "deep"
                            ? t("card.deep", { min: facts.holds.min, max: facts.holds.max })
                            : t("card.bins", { count: facts.holds.count })}
                      </Fact>
                      {facts.zones > 0 && <Fact>{t("card.zones", { count: facts.zones })}</Fact>}
                      {facts.door && <Fact>{t("card.door")}</Fact>}
                    </span>
                    {!facts.savable && (
                      <span className="mt-1 text-caption text-ink-2">
                        {t("card.previewOnlyHint")}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const Fact = ({ children }: { children: ReactNode }) => (
  <span className="rounded-full bg-raised px-2 py-0.5">{children}</span>
);

// ---- Numbers ------------------------------------------------------------------------------------------------------

/** A compact stepper: 44 px buttons, the number between them, the limits enforced by disabling. */
export function DimensionStepper({
  label,
  value,
  min,
  max,
  onChange,
  testId,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  testId: string;
  note?: ReactNode;
}) {
  const t = useTranslations("builder");
  const what = label.toLowerCase();
  const button =
    "grid size-11 place-items-center rounded-full bg-raised text-ink transition-[transform,colors] duration-150 ease-cellr hover:bg-hairline active:scale-95 disabled:opacity-35";
  return (
    <div className="flex flex-col gap-1">
      <div
        role="group"
        aria-label={label}
        data-testid={testId}
        data-value={value}
        data-min={min}
        data-max={max}
        className="flex items-center justify-between gap-3 rounded-card bg-surface px-4 py-2 ring-1 ring-hairline"
      >
        <span className="min-w-0 text-small text-ink">{label}</span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            className={button}
            aria-label={t("fewer", { what })}
            disabled={value <= min}
            onClick={() => onChange(value - 1)}
          >
            <MinusIcon size={18} />
          </button>
          <output aria-live="polite" className="min-w-9 text-center font-display text-title tnum">
            {value}
          </output>
          <button
            type="button"
            className={button}
            aria-label={t("more", { what })}
            disabled={value >= max}
            onClick={() => onChange(value + 1)}
          >
            <PlusIcon size={18} />
          </button>
        </span>
      </div>
      {note}
    </div>
  );
}

// ---- Choices -----------------------------------------------------------------------------------------------------

/** A choice among a few named options. One option only: said as a fact, not offered as a control. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
  testId,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  name: (value: T) => string;
  testId: string;
}) {
  const t = useTranslations("builder");
  if (options.length <= 1)
    return (
      <p className="text-small text-ink-2" data-testid={testId} data-value={value}>
        {t("onlyOne", { what: label, value: name(value) })}
      </p>
    );
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId} data-value={value}>
      <span className="text-small text-ink-2">{label}</span>
      <Segmented
        layout="block"
        label={label}
        value={value}
        onChange={onChange}
        options={options.map((o) => ({ value: o, label: name(o) }))}
      />
    </div>
  );
}

/** Colour swatches of the current material: a radio group, the renderer's own tones, the name always readable. */
export function Swatches({
  label,
  colors,
  value,
  onChange,
  name,
}: {
  label: string;
  colors: readonly StorageColor[];
  value: StorageColor;
  onChange: (value: StorageColor) => void;
  name: (value: StorageColor) => string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + colors.length) % colors.length;
    onChange(colors[next]!);
    refs.current[next]?.focus();
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid="builder-color" data-value={value}>
      <span className="text-small text-ink-2">
        {label}: <span className="text-ink">{name(value)}</span>
      </span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {colors.map((color, index) => {
          const selected = color === value;
          return (
            <button
              key={color}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={name(color)}
              title={name(color)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(color)}
              onKeyDown={(e) => onKeyDown(e, index)}
              data-color={color}
              className={cn(
                "grid size-11 place-items-center rounded-full transition-[box-shadow,transform] duration-150 ease-cellr",
                selected
                  ? "ring-2 ring-accent ring-offset-2 ring-offset-canvas"
                  : "hover:scale-105",
              )}
            >
              <span
                aria-hidden="true"
                className="grid size-9 place-items-center rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.25),inset_0_-1px_1px_rgba(255,255,255,0.25)] ring-1 ring-black/10"
                style={{ background: PREMIUM_TONES[color] }}
              >
                {selected && <CheckIcon size={16} className="text-white mix-blend-difference" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Zones -------------------------------------------------------------------------------------------------------

/**
 * Temperature zones of a cooler: how many, where they split, what each is for, and the temperature it is SET to (or
 * none). Only what the domain's zone model holds; every change keeps the zones a split of the shelves.
 */
export function ZonesEditor({
  template,
  rows,
  zones,
  onCount,
  onSplit,
  onPurpose,
  onTemp,
}: {
  template: StorageTemplateId;
  rows: number;
  zones: readonly StorageZone[];
  onCount: (n: number) => void;
  onSplit: (lastShelfOfFirst: number) => void;
  onPurpose: (index: number, purpose: ZonePurpose) => void;
  onTemp: (index: number, value: number | null) => void;
}) {
  const t = useTranslations("builder.zones");
  const max = Math.min(STORAGE_TEMPLATES[template].zones?.max ?? 0, rows);
  const counts = Array.from({ length: max + 1 }, (_, i) => String(i));
  return (
    <div className="flex flex-col gap-4" data-testid="builder-zones" data-count={zones.length}>
      <p className="text-small text-ink-2">{t("intro")}</p>
      <div className="flex flex-col gap-1.5">
        <span className="text-small text-ink-2">{t("count")}</span>
        <Segmented
          layout="block"
          label={t("count")}
          value={String(zones.length)}
          onChange={(v) => onCount(Number(v))}
          options={counts.map((c) => ({ value: c, label: c === "0" ? t("none") : c }))}
        />
      </div>
      {zones.length === 2 && (
        <DimensionStepper
          label={t("split")}
          value={zones[0]!.toRow}
          min={1}
          max={rows - 1}
          onChange={onSplit}
          testId="builder-zone-split"
        />
      )}
      <ol className="flex flex-col gap-3">
        {zones.map((zone, i) => (
          <li
            key={i}
            className="flex flex-col gap-3 rounded-card bg-surface p-4 ring-1 ring-hairline"
            data-testid={`builder-zone-${i}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-ink">{t("zone", { n: i + 1 })}</span>
              <span className="text-caption text-ink-2">
                {t("shelves", {
                  count: zone.toRow - zone.fromRow + 1,
                  from: zone.fromRow,
                  to: zone.toRow,
                })}
              </span>
            </div>
            <Segmented
              layout="block"
              label={`${t("zone", { n: i + 1 })}: ${t("purpose")}`}
              value={zone.purpose}
              onChange={(p) => onPurpose(i, p)}
              options={[
                { value: "storage", label: t("storage") },
                { value: "serving", label: t("serving") },
              ]}
            />
            <TempSetting
              zoneLabel={t("zone", { n: i + 1 })}
              preset={
                STORAGE_TEMPLATES[template].zones?.defaults[
                  Math.min(i, (STORAGE_TEMPLATES[template].zones?.defaults.length ?? 1) - 1)
                ]?.targetTempC ?? 12
              }
              value={zone.targetTempC}
              onChange={(v) => onTemp(i, v)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function TempSetting({
  zoneLabel,
  preset,
  value,
  onChange,
}: {
  zoneLabel: string;
  /** What switching the setting on starts from: the template's own preset for this zone. */
  preset: number;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const t = useTranslations("builder.zones");
  const set = value !== null;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex min-h-11 items-center justify-between gap-3 text-small text-ink">
        <span>
          {t("setTemp")}
          <span className="block text-caption text-ink-2">{t("setting")}</span>
        </span>
        <input
          type="checkbox"
          className="size-5 accent-[var(--color-accent)]"
          checked={set}
          aria-label={`${zoneLabel}: ${t("setTemp")}`}
          onChange={(e) => onChange(e.target.checked ? preset : null)}
        />
      </label>
      {set ? (
        <div
          role="group"
          aria-label={`${zoneLabel}: ${t("setTemp")}`}
          className="flex items-center justify-between gap-3"
        >
          <span className="text-small text-ink" data-testid="builder-zone-temp">
            {t("setTo", { value: value.toFixed(1) })}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full bg-raised disabled:opacity-35"
              aria-label={`${zoneLabel}: −0.5 °C`}
              disabled={value <= ZONE_TEMP_C.min}
              onClick={() => onChange(value - ZONE_TEMP_C.step)}
            >
              <MinusIcon size={18} />
            </button>
            <button
              type="button"
              className="grid size-11 place-items-center rounded-full bg-raised disabled:opacity-35"
              aria-label={`${zoneLabel}: +0.5 °C`}
              disabled={value >= ZONE_TEMP_C.max}
              onClick={() => onChange(value + ZONE_TEMP_C.step)}
            >
              <PlusIcon size={18} />
            </button>
          </span>
        </div>
      ) : (
        <span className="text-caption text-ink-2">{t("notSet")}</span>
      )}
    </div>
  );
}
