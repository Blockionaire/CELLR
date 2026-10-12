"use client";

import { useTranslations } from "next-intl";
import { formatStars, type RatingSummary, type TastingView } from "@cellr/domain";
import { cn } from "@/ui/cn";
import { StarIcon } from "@/ui/icons";
import { Stars } from "@/ui/stars";
import { useDay } from "./bottle-bits";

/** One person's verdict: who, how many stars, the words, the note. */
export function TastingItem({
  tasting,
  onEdit,
}: {
  tasting: TastingView;
  /** Only given for the signed-in person's own. */
  onEdit?: (() => void) | undefined;
}) {
  const t = useTranslations("tasting");
  const day = useDay();
  const who = tasting.mine ? t("you") : (tasting.userName ?? t("someone"));
  return (
    <article className="flex flex-col gap-1.5 rounded-control bg-raised px-4 py-3">
      <header className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-small font-medium text-ink">
          {who}
          {tasting.score !== null && (
            <Stars
              score={tasting.score}
              label={t("rated", { stars: formatStars(tasting.score) })}
              size={15}
            />
          )}
        </p>
        <span className="flex items-center gap-1 text-caption text-ink-2 tnum">
          {day(tasting.tastedAt)}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="-my-3 ml-2 min-h-11 px-2 text-small font-medium text-accent-fg"
            >
              {t("edit")}
            </button>
          )}
        </span>
      </header>
      {tasting.descriptors.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("wordsTitle")}>
          {tasting.descriptors.map((d) => (
            <li
              key={d}
              className="rounded-full border border-hairline px-2.5 py-0.5 text-caption text-ink-2"
            >
              {t(`descriptors.${d}`)}
            </li>
          ))}
        </ul>
      )}
      {tasting.note && <p className="text-body text-ink">{tasting.note}</p>}
    </article>
  );
}

/** "★ 4.3": what the household thought, in a corner of a card or after the year in a row. */
export function RatingBadge({
  rating,
  inline = false,
  className,
}: {
  rating: RatingSummary;
  inline?: boolean;
  className?: string;
}) {
  const t = useTranslations("tasting");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-caption font-medium tnum",
        inline
          ? "ml-2 align-middle text-ink-2"
          : "rounded-full bg-surface px-2 py-0.5 text-ink shadow-raised",
        className,
      )}
    >
      <StarIcon size={13} fill="currentColor" className="text-accent-fg" />
      <span aria-hidden="true">{rating.average}</span>
      <span className="sr-only">{t("rated", { stars: rating.average })}</span>
    </span>
  );
}
