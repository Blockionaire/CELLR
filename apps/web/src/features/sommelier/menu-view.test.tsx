import { createTranslator, NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MenuAdvice } from "@cellr/domain";
import en from "../../../messages/en.json";
import nl from "../../../messages/nl.json";
import { menuCutNote, menuLines } from "./menu-lines";
import { MenuView } from "./menu-view";

const t = {
  en: createTranslator({ locale: "en", messages: en, namespace: "sommelier" }),
  nl: createTranslator({ locale: "nl", messages: nl, namespace: "sommelier" }),
};

const MENU: MenuAdvice = {
  courses: [
    { said: "Oysters", vintageId: "white", why: "Crisp and saline.", shared: false },
    { said: "roast lamb", vintageId: "red", why: "Firm enough for the lamb.", shared: true },
    { said: "beef stew", vintageId: "red", why: null, shared: true },
    {
      said: "qwertzu",
      vintageId: null,
      why: "Nothing in the cellar is sweet enough.",
      shared: false,
    },
  ],
  cut: false,
};

describe("a menu's lines", () => {
  it("draws each wine once, with the first course it is poured with", () => {
    const lines = menuLines(MENU, t.en as never);
    expect(lines.map((l) => [l.n, l.said, l.card, l.first, l.note])).toEqual([
      [1, "Oysters", "white", true, null],
      [2, "roast lamb", "red", false, null],
      [3, "beef stew", null, false, "The same wine as with course 2."],
      [4, "qwertzu", null, false, "Nothing in your cellar really suits this course."],
    ]);
    expect(lines.map((l) => l.label)).toEqual(["Course 1", "Course 2", "Course 3", "Course 4"]);
    expect(lines[3]!.why).toBe("Nothing in the cellar is sweet enough.");
  });

  it("says it in Dutch too", () => {
    const lines = menuLines(MENU, t.nl as never);
    expect(lines[0]!.label).toBe("Gang 1");
    expect(lines[2]!.note).toBe("Dezelfde wijn als bij gang 2.");
    expect(lines[3]!.note).toBe("Niets in je kelder past echt bij deze gang.");
    expect(menuCutNote({ ...MENU, cut: true }, t.nl as never, 8)).toBe(
      "Alleen de eerste 8 gangen zijn gepland.",
    );
    expect(menuCutNote(MENU, t.nl as never, 8)).toBeNull();
  });

  it("has every sentence in both languages", () => {
    for (const lang of ["en", "nl"] as const) {
      const m = (lang === "en" ? en : nl).sommelier.menu as Record<string, string>;
      expect(Object.keys(m).sort()).toEqual(["course", "cut", "none", "same", "title"]);
      for (const text of Object.values(m)) expect(text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("the menu on screen", () => {
  const render = (menu: MenuAdvice, locale: "en" | "nl" = "en", missing: string[] = []) =>
    renderToStaticMarkup(
      <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : nl}>
        <MenuView
          menu={menu}
          card={(id, first) =>
            missing.includes(id) ? null : <article data-card={id} data-first={String(first)} />
          }
        />
      </NextIntlClientProvider>,
    );

  it("is one row per course: the course, its card, the reason", () => {
    const html = render(MENU);
    expect(html).toContain('data-testid="menu"');
    expect(html.match(/data-testid="menu-course"/g)).toHaveLength(4);
    expect(html.match(/data-card=/g)).toHaveLength(2);
    expect(html).toContain('data-card="white" data-first="true"');
    expect(html).toContain('data-card="red" data-first="false"');
    expect(html).toContain("Firm enough for the lamb.");
    expect(html).toContain("The same wine as with course 2.");
    expect(html).toContain("Nothing in your cellar really suits this course.");
    expect(html).toContain("Your menu, course by course");
  });

  it("says a course has no wine when its card cannot be drawn", () => {
    const html = render(MENU, "en", ["white"]);
    expect(html.match(/data-card=/g)).toHaveLength(1);
    expect(html.match(/Nothing in your cellar really suits this course\./g)).toHaveLength(2);
  });

  it("is in Dutch, and says when courses were left out", () => {
    const html = render({ ...MENU, cut: true }, "nl");
    expect(html).toContain("Je menu, gang voor gang");
    expect(html).toContain("Alleen de eerste 8 gangen zijn gepland.");
  });

  it("is plain text: what the model wrote is never markup", () => {
    const html = render({
      courses: [
        {
          said: "<img src=x onerror=alert(1)>",
          vintageId: null,
          why: "<b>bold</b>",
          shared: false,
        },
        { said: "lamb", vintageId: null, why: null, shared: false },
      ],
      cut: false,
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("wraps long words instead of scrolling sideways on a phone", () => {
    const html = render({
      courses: [
        { said: "x".repeat(80), vintageId: null, why: "y".repeat(240), shared: false },
        { said: "lamb", vintageId: null, why: null, shared: false },
      ],
      cut: false,
    });
    // Every text that can be long can break, and every row may shrink below its content's width.
    expect(html.match(/break-words/g)!.length).toBeGreaterThanOrEqual(4);
    expect(html.match(/min-w-0/g)!.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toMatch(/whitespace-nowrap|overflow-x/);
  });
});
