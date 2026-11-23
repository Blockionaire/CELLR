"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MENU_MAX_COURSES, type MenuAdvice } from "@cellr/domain";
import { menuCutNote, menuLines } from "./menu-lines";

/**
 * A MENU, ONE WINE PER COURSE (Sommelier V1+, part `menu`). One compact row per course: the course in the person's
 * own words, the wine V1 chose for it (drawn by the chat's own card), and its reason in a line. A course without a
 * wine says so plainly; a wine poured twice is drawn once and named again in words. Phone first: everything wraps,
 * nothing scrolls sideways at 360 px, and nothing moves.
 */
export function MenuView({
  menu,
  card,
}: {
  menu: MenuAdvice;
  /** How a wine of the menu is drawn (the chat's own card); `first`: the first wine of the menu. */
  card: (vintageId: string, first: boolean) => ReactNode;
}) {
  const t = useTranslations("sommelier");
  const lines = menuLines(menu, t);
  const cut = menuCutNote(menu, t, MENU_MAX_COURSES);
  return (
    <section
      aria-label={t("menu.title")}
      data-testid="menu"
      className="flex min-w-0 flex-col gap-2"
    >
      <h3 className="px-1 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
        {t("menu.title")}
      </h3>
      <ol className="flex min-w-0 flex-col gap-3">
        {lines.map((line) => {
          const drawn = line.card === null ? null : card(line.card, line.first);
          // The card cannot be drawn (the wine is not among the answer's cards): no wine is shown, so say that no
          // wine could be chosen, and leave out the reason, which was about that wine. Never an empty row.
          const missing = line.card !== null && (drawn === null || drawn === undefined);
          const note = missing ? t("menu.unchosen") : line.note;
          const why = missing ? null : line.why;
          return (
            <li
              key={line.n}
              data-testid="menu-course"
              data-course={line.n}
              data-wine={line.card ?? ""}
              className="flex min-w-0 flex-col gap-1.5"
            >
              <p className="flex min-w-0 items-baseline gap-2 px-1">
                <span
                  aria-hidden="true"
                  className="tnum shrink-0 text-caption font-semibold text-bronze"
                >
                  {line.n}
                </span>
                <span className="sr-only">{line.label}: </span>
                <span className="min-w-0 break-words font-display text-title leading-snug text-ink">
                  {line.said}
                </span>
              </p>
              {drawn}
              {note && (
                <p className="break-words px-1 text-small text-ink-3" data-testid="menu-note">
                  {note}
                </p>
              )}
              {why && (
                <p className="break-words px-1 text-small text-ink-2" data-testid="menu-why">
                  {why}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {cut && <p className="px-1 text-caption text-ink-3">{cut}</p>}
    </section>
  );
}
