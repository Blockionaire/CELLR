import { describe, expect, it } from "vitest";
import { FOOD, menuContext, parseMenu } from "@cellr/domain/intelligence";
import { MENU_SCENARIOS, menuDishOf, menuExpectations } from "./scenarios-menu";
import { CELLARS, WINE_KEYS } from "./wines";

describe("the menu scenarios", () => {
  it("are 12 to 20 menus with unique ids, in both languages, of two to five courses", () => {
    expect(MENU_SCENARIOS.length).toBeGreaterThanOrEqual(12);
    expect(MENU_SCENARIOS.length).toBeLessThanOrEqual(20);
    expect(new Set(MENU_SCENARIOS.map((s) => s.id)).size).toBe(MENU_SCENARIOS.length);
    const langs = MENU_SCENARIOS.map((s) => s.lang);
    expect(langs.filter((l) => l === "en").length).toBeGreaterThanOrEqual(6);
    expect(langs.filter((l) => l === "nl").length).toBeGreaterThanOrEqual(6);
    for (const s of MENU_SCENARIOS) {
      expect(s.courses.length, s.id).toBeGreaterThanOrEqual(2);
      expect(s.courses.length, s.id).toBeLessThanOrEqual(5);
      expect(CELLARS[s.cellar], s.id).toBeDefined();
      expect(s.turns.length, s.id).toBeGreaterThan(0);
    }
  });

  it("label every course with a reference dish whose wines are benchmark wines", () => {
    for (const s of MENU_SCENARIOS)
      for (const c of s.courses) {
        if (c.dish === null) continue;
        const card = menuDishOf(c.dish);
        for (const key of [...card.good, ...card.ok]) expect(WINE_KEYS.has(key), key).toBe(true);
        expect(
          card.good.filter((k) => card.ok.includes(k)),
          c.dish,
        ).toEqual([]);
      }
  });

  it("are read by the app's menu reader course by course, as labelled", () => {
    for (const s of MENU_SCENARIOS) {
      const m = parseMenu(s.turns[0]!.user, FOOD);
      expect(m, s.id).not.toBeNull();
      expect(
        m!.courses.map((c) => c.said),
        s.id,
      ).toEqual(s.courses.map((c) => c.said));
      // A course with a reference dish is read; one without is said, unread.
      expect(
        m!.courses.map((c) => c.food !== null),
        s.id,
      ).toEqual(s.courses.map((c) => c.dish !== null));
      expect(m!.cut, s.id).toBe(false);
    }
  });

  it("keep the menu through the follow-ups", () => {
    const followUps = MENU_SCENARIOS.filter((s) => s.followUp);
    expect(followUps.length).toBeGreaterThanOrEqual(2);
    for (const s of followUps) {
      // As the screen sends it: each question followed by the sommelier's answer.
      const messages = s.turns.flatMap((t, i) =>
        i < s.turns.length - 1
          ? [
              { role: "user" as const, text: t.user },
              { role: "assistant" as const, text: "An answer." },
            ]
          : [{ role: "user" as const, text: t.user }],
      );
      const context = menuContext(messages);
      expect(context?.fromHistory, s.id).toBe(true);
      expect(context!.menu.courses.map((c) => c.said)).toEqual(s.courses.map((c) => c.said));
      expect(s.followUp!.course).toBeLessThanOrEqual(s.courses.length);
    }
  });

  it("include courses that the cellar has nothing for, so an honest 'none' is measured", () => {
    const levels = MENU_SCENARIOS.flatMap((s) => menuExpectations(s).map((e) => e.level));
    expect(levels).toContain("none");
    expect(levels).toContain("any");
    expect(levels.filter((l) => l === "good").length).toBeGreaterThan(levels.length / 2);
    // In the full cellar, every readable course has a wine that suits it.
    for (const s of MENU_SCENARIOS.filter((x) => x.cellar === "all"))
      for (const e of menuExpectations(s))
        expect(e.level === "good" || e.level === "any", s.id).toBe(true);
  });

  it("know which owned wines are right and which are poor for each course", () => {
    const [oysters, lamb] = menuExpectations(MENU_SCENARIOS.find((s) => s.id === "mn-10")!);
    expect(oysters).toEqual({ level: "none", right: [], poor: ["rioja-reserva"] });
    expect(lamb).toEqual({ level: "good", right: ["rioja-reserva"], poor: [] });
  });
});
