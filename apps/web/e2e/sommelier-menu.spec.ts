import { expect, test } from "@playwright/test";
import { apiClient, arrive, audit, FEATURES_URL } from "./helpers";
import {
  ask,
  askAt,
  DEFAULT_URL,
  DUTCH,
  expectNoSidewaysScroll,
  furnish,
  marker,
  modelCalls,
  program,
  refOf,
  setLocale,
} from "./sommelier-v1plus";

/**
 * Sommelier V1+, P6: the `menu` part (docs/sprints/sommelier-3-mega/SOMMELIER_CLOSEOUT.md §6). On the features
 * server a menu of several courses is put to V1's model as numbered courses, in the one call it always made, and
 * comes back as one wine per course, each checked against the cellar. A follow-up keeps the menu; "this one or that
 * one" shows both wines, the model's choice first. The default server (the part off, as production is) answers a
 * menu exactly as V1 always did.
 */

test.use({ baseURL: FEATURES_URL });

const shot = (name: string) => `test-results/shots/${name}-${test.info().project.name}.png`;
const MENU =
  "Oysters to start, then a grilled steak, and for dessert a chocolate fondant. Which wine with each course?";

test.describe("a menu, course by course (CELLR_SOMMELIER=menu)", () => {
  test("one wine per course from one call; a made-up wine is no card; the follow-up still knows the menu", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "menu");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const m = marker();
    await program(m, {
      content: {
        answer:
          "From bubbles to a firm red; nothing in your cellar is sweet enough for the fondant.",
        bottle_refs: [refOf(ids["Special Cuvée"]!), refOf(ids["Tignanello"]!)],
        verdict: "partial",
        buy: [],
        used_taste: false,
        courses: [
          {
            course: 1,
            ref: refOf(ids["Special Cuvée"]!),
            why: "Bubbles and brine belong together.",
          },
          { course: 2, ref: refOf(ids["Tignanello"]!), why: "Grip for the char of the steak." },
          { course: 3, ref: "nosuch", why: "A made-up Banyuls." },
        ],
      },
    });
    await page.goto("/sommelier");
    await ask(page, `${MENU} ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByText("From bubbles to a firm red")).toBeVisible();
    const menu = log.getByTestId("menu");
    await expect(menu).toBeVisible();
    const courses = menu.getByTestId("menu-course");
    await expect(courses).toHaveCount(3);
    await expect(courses.nth(0)).toContainText(/oysters/i);
    await expect(courses.nth(0).getByRole("link", { name: "Special Cuvée" })).toBeVisible();
    await expect(courses.nth(0).getByTestId("menu-why")).toHaveText(
      "Bubbles and brine belong together.",
    );
    await expect(courses.nth(1).getByRole("link", { name: "Tignanello" })).toBeVisible();
    // The third course's wine does not exist: no card, no made-up reason, and it says so.
    await expect(courses.nth(2)).toContainText(/chocolate fondant/i);
    await expect(courses.nth(2).getByRole("article")).toHaveCount(0);
    await expect(courses.nth(2).getByTestId("menu-note")).toBeVisible();
    await expect(log).not.toContainText("Banyuls");
    // The wines are shown once, with their course: two cards in all.
    await expect(log.getByRole("article")).toHaveCount(2);
    // One call, with the courses numbered for the model.
    const calls = await modelCalls(m);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.user).toContain("Menu (the person's courses, in the order they are served):");
    expect(calls[0]!.user).toMatch(/2\. .*steak/i);
    await expectNoSidewaysScroll(page);
    await expect.poll(() => audit(page)).toEqual([]);
    await page.screenshot({ path: shot("v1plus-menu"), fullPage: true });

    // A follow-up that does not repeat the menu: the model is given it again, as context.
    const f = marker();
    await program(f, {
      content: {
        answer: "With a cheese course in between, stay with the Tignanello.",
        bottle_refs: [refOf(ids["Tignanello"]!)],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await ask(page, `And if we add a cheese course before dessert? ${f}`);
    await expect(log.getByText("With a cheese course in between")).toBeVisible();
    const [follow] = await modelCalls(f);
    expect(follow!.user).toContain("Menu (context only:");
    expect(follow!.user).toMatch(/1\. .*oysters/i);

    // Kept with the conversation: the menu is drawn the same after a reload.
    await page.reload();
    await expect(
      page.getByRole("log", { name: "Conversation" }).getByTestId("menu-course"),
    ).toHaveCount(3);
  });

  test("in Dutch on a small phone: the menu in Dutch, nothing wider than the screen", async ({
    page,
    request,
    isMobile,
  }) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 740 });
    const { email } = await arrive(page, "menunl");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    await setLocale(email, "nl");
    const m = marker();
    await program(m, {
      content: {
        answer: "Eén rode wijn draagt beide gangen.",
        bottle_refs: [refOf(ids["Riesling Schlossberg"]!), refOf(ids["Pavillon Rouge"]!)],
        verdict: "match",
        buy: [],
        used_taste: false,
        courses: [
          { course: 1, ref: refOf(ids["Riesling Schlossberg"]!), why: "Fris bij de vis." },
          { course: 2, ref: refOf(ids["Pavillon Rouge"]!), why: "Stevig genoeg voor het lam." },
          { course: 3, ref: refOf(ids["Pavillon Rouge"]!), why: "Past ook bij de harde kazen." },
        ],
      },
    });
    await page.goto("/sommelier");
    await ask(
      page,
      `Vooraf gerookte zalm, daarna lamsrack en als toetje een kaasplank. Welke wijn per gang? ${m}`,
      DUTCH,
    );
    const log = page.getByRole("log", { name: "Gesprek" });
    const courses = log.getByTestId("menu").getByTestId("menu-course");
    await expect(courses).toHaveCount(3);
    await expect(courses.nth(1).getByRole("link", { name: "Pavillon Rouge" })).toBeVisible();
    // The same wine with the third course is drawn once and named in words.
    await expect(courses.nth(2).getByRole("article")).toHaveCount(0);
    await expect(courses.nth(2).getByTestId("menu-note")).toContainText("gang 2");
    await expectNoSidewaysScroll(page);
    await expect.poll(() => audit(page)).toEqual([]);
    await page.screenshot({ path: shot("v1plus-menu-nl-small"), fullPage: true });
  });

  test("'this one or that one?': both wines are the cards, the sommelier's choice first", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "compare");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const m = marker();
    await program(m, {
      content: {
        answer: "The Pavillon Rouge: its softer tannin suits the lamb better.",
        bottle_refs: [refOf(ids["Pavillon Rouge"]!)],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await page.goto("/sommelier");
    await ask(page, `The Tignanello or the Pavillon Rouge with roast lamb? ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByText("The Pavillon Rouge: its softer tannin")).toBeVisible();
    const cards = log.getByRole("article");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByRole("link", { name: "Pavillon Rouge" })).toBeVisible();
    await expect(cards.nth(1).getByRole("link", { name: "Tignanello" })).toBeVisible();
    const [asked] = await modelCalls(m);
    expect(asked!.user).toContain(
      `Compare: the person asks to choose between two wines from the cellar list: `,
    );
    expect(asked!.user).toContain(refOf(ids["Tignanello"]!));
    await page.screenshot({ path: shot("v1plus-compare"), fullPage: true });
  });
});

test.describe("the menu and V1 (API)", () => {
  test.skip(({ isMobile }) => isMobile, "an API comparison: the screen does not take part");

  test("the default server answers a menu as V1 always did; a question that is no menu is V1's on both", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "menuapi");
    const { call, token } = await apiClient(request, email);
    const ids = await furnish(call);
    const content = {
      answer: "Bubbles, then the red.",
      bottle_refs: [refOf(ids["Special Cuvée"]!), refOf(ids["Tignanello"]!)],
      verdict: "match",
      buy: [],
      used_taste: false,
      courses: [{ course: 1, ref: refOf(ids["Special Cuvée"]!), why: "Brine." }],
    };
    const m = marker();
    await program(m, { content });
    const v1 = await askAt(request, DEFAULT_URL, token, `${MENU} ${m}`);
    expect(v1.menu).toBeUndefined();
    expect((v1.bottles as unknown[]).length).toBe(2);
    const [plainCall] = await modelCalls(m);
    expect(plainCall!.user).not.toContain("Menu (");

    const answers: Record<string, unknown>[] = [];
    const prompts: string[] = [];
    for (const base of [DEFAULT_URL, FEATURES_URL]) {
      const q = marker();
      await program(q, { content: { ...content, courses: undefined } });
      answers.push(await askAt(request, base, token, `What goes with a grilled steak? ${q}`));
      prompts.push((await modelCalls(q))[0]!.user.replaceAll(q, "[marker]"));
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(prompts[1]).toEqual(prompts[0]);
  });
});
