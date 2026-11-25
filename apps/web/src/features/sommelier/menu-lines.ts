import type { useTranslations } from "next-intl";
import type { MenuAdvice } from "@cellr/domain";

/** The sommelier namespace's translator. */
type SommelierT = ReturnType<typeof useTranslations<"sommelier">>;

/** One course of a menu, as the screen draws it. */
export interface MenuLine {
  /** 1-based, in the order of the menu. */
  n: number;
  /** For a screen reader: "Course 2". */
  label: string;
  said: string;
  /** The wine whose card is drawn on this row; null when this row has no card of its own. */
  card: string | null;
  /** The wine is the first card of the menu (the one to take first). */
  first: boolean;
  why: string | null;
  /** A sentence instead of a card: nothing suits, no wine could be chosen, or the same wine as an earlier course. */
  note: string | null;
}

/**
 * A menu, course by course. A wine is drawn once, with the first course it is poured with; a later course that
 * gets the same wine says so in words, so a menu stays short on a phone. A course without a wine says only what is
 * true: the model's own reason why nothing suits when it gave one (instead of a second, general sentence), "nothing
 * in your cellar really suits this course" when it said so without a reason, and "no wine could be chosen" when it
 * named a wine that is not in the cellar or left the course out (nobody said that nothing suits).
 */
export function menuLines(menu: MenuAdvice, t: SommelierT): MenuLine[] {
  const firstCourseOf = new Map<string, number>();
  let firstCard: string | null = null;
  return menu.courses.map((c, i) => {
    const n = i + 1;
    const base = { n, label: t("menu.course", { n }), said: c.said, why: c.why };
    if (c.vintageId === null)
      return c.unchosen === true
        ? { ...base, card: null, first: false, why: null, note: t("menu.unchosen") }
        : { ...base, card: null, first: false, note: c.why === null ? t("menu.none") : null };
    const earlier = firstCourseOf.get(c.vintageId);
    if (earlier !== undefined)
      return { ...base, card: null, first: false, note: t("menu.same", { n: earlier }) };
    firstCourseOf.set(c.vintageId, n);
    firstCard ??= c.vintageId;
    return { ...base, card: c.vintageId, first: firstCard === c.vintageId, note: null };
  });
}

/** Said under the menu when the person named more courses than are planned. */
export const menuCutNote = (menu: MenuAdvice, t: SommelierT, max: number): string | null =>
  menu.cut ? t("menu.cut", { count: max }) : null;
