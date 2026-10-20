import type { useTranslations } from "next-intl";
import { formatVintage, type SommelierAnswer } from "@cellr/domain";

/** The sommelier namespace's translator. */
type SommelierT = ReturnType<typeof useTranslations<"sommelier">>;

/**
 * The sentence for a plain answer. A question about the cellar gets its counted numbers; one naming a few wines
 * gets where each bottle is (place, shelf, position, and how many have no place yet), all from the counted facts.
 */
export function plainSentence(a: SommelierAnswer, t: SommelierT): string {
  if (a.basic === "facts" && a.facts) {
    const located = a.facts.located ?? [];
    if (located.length > 0)
      return located
        .map((w) =>
          t("basic.factsWhere", {
            wine: w.year === null ? w.wine : `${w.wine} ${formatVintage(w.year)}`,
            count: w.count,
            spots: [
              ...w.spots.map((s) => t("basic.factsSpot", s)),
              ...(w.unplaced > 0 ? [t("basic.factsNoPlace", { count: w.unplaced })] : []),
            ].join("; "),
          }),
        )
        .join("\n");
    const counts = t("basic.facts", {
      bottles: a.facts.bottles,
      wines: a.facts.wines,
      free: a.facts.free,
    });
    const { matches } = a.facts;
    // No wine named: the cellar-wide totals. Named but not there: say so.
    if (matches === null) return counts;
    if (matches === 0) return `${t("basic.factsMatches", { matches })} ${counts}`;
    if (a.facts.kind === "quantity")
      return t("basic.factsCount", { bottles: a.facts.matchedBottles ?? 0, vintages: matches });
    if (a.facts.kind === "selection") {
      const names = a.facts.names ?? [];
      return t("basic.factsList", {
        matches,
        names: names.join(", "),
        more: Math.max(0, matches - names.length),
      });
    }
    // Where, but several wines fit: which one?
    return t("basic.factsMatches", { matches });
  }
  return a.basic && a.basic !== "facts" ? t(`basic.${a.basic}`) : "";
}
