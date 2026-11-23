import type { useTranslations } from "next-intl";
import type { BottleAnnotation, QuantityAdvice } from "@cellr/domain";

/** The sommelier namespace's translator. */
type SommelierT = ReturnType<typeof useTranslations<"sommelier">>;

export type AnnotationEmphasis = "serving" | "keeping" | null;

/**
 * THE FACTS UNDER A SOMMELIER CARD, in words (Sommelier V1+ parts `annotate` and `quantities`). Each piece is a
 * fixed wording of a code the app computed; nothing is the model's. Short on purpose: at most two lines per card,
 * because the card above already shows the phase, the first place, the bottle count and the reservation. What a
 * rule of thumb says is worded as one ("about", "estimate", "rule of thumb"); only what is known about the exact
 * wine (its profile, the household's own window) is stated plainly.
 */
const SEP = " · ";
const join = (parts: ReadonlyArray<string | null | false | undefined>) =>
  parts.filter((p): p is string => typeof p === "string" && p !== "").join(SEP);

/** "At its best now", and in full "At its best now · 2022–2031, an estimate for its style". */
function drinkText(d: BottleAnnotation["drink"], full: boolean, t: SommelierT): string {
  if (d.advice === "unknown") return full ? t("annotate.drink.unknown") : "";
  const advice =
    d.advice === "keep" && d.phase === "developing"
      ? t("annotate.drink.improving")
      : t(`annotate.drink.${d.advice}`);
  const years =
    d.from !== null && d.until !== null
      ? t("annotate.window.range", { from: d.from, until: d.until })
      : d.until !== null
        ? t("annotate.window.until", { until: d.until })
        : d.from !== null
          ? t("annotate.window.from", { from: d.from })
          : null;
  if (!full) return years ? `${advice} (${years})` : advice;
  return join([advice, years && `${years}, ${t(`annotate.windowBasis.${d.basis}`)}`]);
}

/** "About 16–18 °C · decant about 90 min · rule of thumb"; in full also the fridge and the glass. */
function servingText(s: BottleAnnotation["serving"], full: boolean, t: SommelierT): string {
  if (s === null) return full ? t("annotate.serve.unknown") : "";
  const known = s.basis === "profile";
  const temp =
    s.tempC.min === s.tempC.max && known
      ? `${s.tempC.min} °C`
      : t(known ? "annotate.serve.temp" : "annotate.serve.tempAbout", s.tempC);
  const fridge =
    s.fridgeMinutes > 0
      ? t("annotate.serve.fridge", { minutes: s.fridgeMinutes })
      : t("annotate.serve.noChill");
  // Only what is worth saying on a card: "no need to decant" is said only when asked how to serve it.
  const decant =
    s.decant === null
      ? null
      : s.decant.kind === "no" && !full
        ? null
        : t(`annotate.serve.decant.${s.decant.kind}`, { minutes: s.decant.minutes });
  const basis = t(
    s.decant === null
      ? "annotate.serve.basis.colour"
      : known
        ? "annotate.serve.basis.profile"
        : "annotate.serve.basis.style",
  );
  return full
    ? join([temp, fridge, decant, t(`annotate.serve.glass.${s.glass}`), basis])
    : join([temp, decant, basis]);
}

/** What the card above does not say: how many are free to open, and every place beyond the first. */
function stockText(a: BottleAnnotation, t: SommelierT): string {
  const r = a.reserved;
  const reserved =
    r === null
      ? null
      : r.free === 0
        ? t("annotate.reserved.all", { count: r.count })
        : t("annotate.reserved.some", { free: r.free, total: r.count + r.free });
  const { places, unplaced } = a.where;
  const where =
    places.length > 1 || (places.length > 0 && unplaced > 0)
      ? join([
          t("annotate.where.places", { places: places.join(", ") }),
          unplaced > 0 && t("annotate.where.unplaced", { count: unplaced }),
        ])
      : null;
  return join([reserved, where]);
}

/**
 * At most two short lines for one card. A serving question puts the serving line first and in full, a keeping
 * question the drinking window; otherwise the short facts. Lines with nothing to say are left out.
 */
export function annotationLines(
  a: BottleAnnotation,
  emphasis: AnnotationEmphasis,
  t: SommelierT,
): string[] {
  const lines =
    emphasis === "serving"
      ? [servingText(a.serving, true, t), join([drinkText(a.drink, false, t), stockText(a, t)])]
      : emphasis === "keeping"
        ? [drinkText(a.drink, true, t), join([servingText(a.serving, false, t), stockText(a, t)])]
        : [join([drinkText(a.drink, false, t), servingText(a.serving, false, t)]), stockText(a, t)];
  return lines.filter((l) => l !== "");
}

/**
 * The bottles for the guests: one line for the need, one per wine against what is free to open. `nameOf` gives a
 * wine's name as the card shows it; a wine it does not know is left out rather than named wrongly.
 */
export function quantityLines(
  q: QuantityAdvice,
  nameOf: (vintageId: string) => string | null,
  t: SommelierT,
): string[] {
  const head = t("quantity.need", {
    guests: q.guests,
    needed: q.needed,
    gathering: t(`quantity.gathering.${q.gathering}`),
    basis: t(`quantity.basis.${q.gathering}`),
  });
  const wines = q.wines.flatMap((w) => {
    const wine = nameOf(w.vintageId);
    if (wine === null) return [];
    const values = { wine, needed: w.needed, available: w.available, short: w.short };
    const key =
      q.mode === "alternatives"
        ? w.short > 0
          ? "quantity.altShort"
          : "quantity.altEnough"
        : w.short > 0
          ? "quantity.short"
          : "quantity.enough";
    return [t(key, values)];
  });
  return [head, ...wines];
}
