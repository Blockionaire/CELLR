import type { useTranslations } from "next-intl";
import { wineLabel, type AnswerCheck, type SommelierBottle } from "@cellr/domain";

/** The sommelier namespace's translator. */
type SommelierT = ReturnType<typeof useTranslations<"sommelier">>;

/**
 * The words the screen shows when the answer check (Sommelier V1+, part `check`) took the sommelier's own text away:
 * one sentence made from what is certain, the cards V1 chose and its verdict. It never repeats the removed words.
 */
export function checkSentence(
  answer: { bottles: readonly SommelierBottle[]; verdict?: "match" | "partial" | "none" | null },
  t: SommelierT,
): string {
  const [first, ...others] = answer.bottles;
  if (!first) return answer.verdict === "none" ? t("check.noneFits") : t("check.nothing");
  const kind =
    answer.verdict === "match" || answer.verdict === "partial" ? answer.verdict : "other";
  const sentence = t(`check.cardOnly.${kind}`, { wine: wineLabel(first) });
  return others.length > 0 ? `${sentence} ${t("check.more", { count: others.length })}` : sentence;
}

/** A short note on what the check took away, or null when the text is as the sommelier wrote it. */
export function checkNote(check: AnswerCheck | null | undefined, t: SommelierT): string | null {
  if (!check || check.text === "kept") return null;
  return t(`check.note.${check.text}`);
}

/** A buy entry's price line: the person's own budget band, or that the price is not known. Never the model's. */
export function buyPriceLabel(
  buy: { priceBand?: readonly [number, number | null] | null },
  t: SommelierT,
): string {
  const band = buy.priceBand;
  if (!band) return t("check.priceUnknown");
  const [min, max] = band;
  if (max === null) return t("check.priceBandFrom", { min });
  if (min === 0) return t("check.priceBandUpTo", { max });
  return t("check.priceBand", { min, max });
}
