import { expect, test } from "@playwright/test";
import { apiClient, arrive, audit, FEATURES_URL } from "./helpers";
import {
  ask,
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
 * Sommelier V1+, the whole journey with every part on (the features server: CELLR_SOMMELIER names check, annotate,
 * quantities, menu and fallback). One person, one conversation: advice with cards, how to serve the wine, a menu for
 * the guests with the bottles counted, a follow-up, and a model that goes down. Each part has its own spec; this one
 * proves they hold together on a phone and on a desktop, in English and in Dutch, and that the conversation is
 * still there, drawn the same, after a reload.
 */

test.use({ baseURL: FEATURES_URL });

const shot = (name: string) => `test-results/shots/${name}-${test.info().project.name}.png`;

test.describe("the sommelier, from advice to the table (every V1+ part on)", () => {
  test("advice, serving, a menu for six, a follow-up and the model down, in one conversation", async ({
    page,
    request,
  }) => {
    test.slow(); // five questions and a reload in one conversation
    const { email } = await arrive(page, "journey");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const tig = refOf(ids["Tignanello"]!);
    const pav = refOf(ids["Pavillon Rouge"]!);
    const bol = refOf(ids["Special Cuvée"]!);
    const log = page.getByRole("log", { name: "Conversation" });
    await page.goto("/sommelier");

    // 1. Advice. The model writes refs (prompt v7); the names and vintages shown are the cellar's own.
    const m1 = marker();
    await program(m1, {
      content: {
        answer: `Open [[${tig}]] with the steak; [[${pav}]] would be the gentler choice.`,
        bottle_refs: [tig, pav],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await ask(page, `What goes with a grilled steak? ${m1}`);
    await expect(log).toContainText(
      "Open Antinori Tignanello 2018 with the steak; Château Margaux Pavillon Rouge 2015 would be the gentler choice.",
    );
    const cards = log.getByRole("article");
    await expect(cards).toHaveCount(2);
    // The first card is the first recommendation: its button is the primary one.
    await expect(cards.first().getByRole("link", { name: "Tignanello" })).toBeVisible();
    await expect(log.getByTestId("annotation")).toHaveCount(2);
    await expect(log.getByTestId("annotation").first()).toContainText(/°C/);
    await expect(log.getByTestId("check-note")).toHaveCount(0);
    expect((await modelCalls(m1))[0]!.system).toContain("[[a1b2c3]]");
    await expectNoSidewaysScroll(page);

    // 2. How to serve it: the app's facts go to the model, the card shows the serving line first.
    const m2 = marker();
    await program(m2, {
      content: {
        answer: `Serve [[${tig}]] just under room temperature; a carafe does it no harm.`,
        bottle_refs: [],
        verdict: "not_pairing",
        buy: [],
        used_taste: false,
      },
    });
    await ask(page, `How should I serve the Tignanello? ${m2}`);
    await expect(log).toContainText("Serve Antinori Tignanello 2018 just under room temperature");
    expect((await modelCalls(m2))[0]!.user).toContain("Serving facts (worked out by the app");
    await expect(log.getByTestId("annotation").last()).toHaveAttribute("data-emphasis", "serving");
    await expect(log.getByTestId("annotation").last()).toContainText(/glass/);

    // 3. A menu for six: one call, one wine per course, the bottles counted course by course. A reason that
    //    names a price is not shown.
    const m3 = marker();
    await program(m3, {
      content: {
        answer: "Bubbles first, then your firmest red; nothing sweet is there for the fondant.",
        bottle_refs: [bol, tig],
        verdict: "partial",
        buy: [],
        used_taste: false,
        courses: [
          { course: 1, ref: bol, why: `[[${bol}]] and oysters are a classic.` },
          { course: 2, ref: tig, why: "Grip for the steak; a bottle like this costs about €90." },
          { course: 3, ref: null, why: "Nothing sweet enough in your cellar." },
        ],
      },
    });
    await ask(
      page,
      `We will be 6 at dinner: oysters to start, then a grilled steak, and for dessert a chocolate fondant. Which wine with each course? ${m3}`,
    );
    const menu = log.getByTestId("menu");
    await expect(menu.getByTestId("menu-course")).toHaveCount(3);
    await expect(menu.getByTestId("menu-course").nth(0).getByTestId("menu-why")).toHaveText(
      "Bollinger Special Cuvée and oysters are a classic.",
    );
    await expect(
      menu.getByTestId("menu-course").nth(1).getByRole("link", { name: "Tignanello" }),
    ).toBeVisible();
    await expect(menu.getByTestId("menu-course").nth(1).getByTestId("menu-why")).toHaveCount(0);
    await expect(menu.getByTestId("menu-course").nth(2).getByRole("article")).toHaveCount(0);
    await expect(log).not.toContainText("€");
    // The menu's cards carry their facts too.
    await expect(menu.getByTestId("annotation")).toHaveCount(2);
    const quantity = log.getByTestId("quantity").last();
    await expect(quantity).toHaveAttribute("data-mode", "sequence");
    await expect(quantity).toContainText("For 6 people at dinner");
    await expect(quantity).toContainText("Antinori Tignanello");
    const calls3 = await modelCalls(m3);
    expect(calls3).toHaveLength(1);
    expect(calls3[0]!.user).toContain("- 6 people, a dinner.");
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: shot("v1plus-journey-menu"), fullPage: true });

    // 4. A follow-up: the menu and the guests are still known.
    const m4 = marker();
    await program(m4, {
      content: {
        answer: `With cheese in between, stay with [[${tig}]].`,
        bottle_refs: [tig],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await ask(page, `And if we add a cheese course before dessert? ${m4}`);
    await expect(log).toContainText("With cheese in between, stay with Antinori Tignanello 2018.");
    const [follow] = await modelCalls(m4);
    expect(follow!.user).toContain("Menu (context only:");
    expect(follow!.user).toContain("- 6 people, a dinner.");
    // What the model hears of the conversation so far is what was shown: names, never refs.
    expect(follow!.user).toContain("Open Antinori Tignanello 2018 with the steak");
    expect(follow!.user).not.toContain(`[[${tig}]] with the steak`);

    // 5. The model goes down: the engines answer, and say why.
    const m5 = marker();
    await program(m5, { status: 500 });
    await ask(page, `What goes with roast lamb? ${m5}`);
    await expect(log.getByTestId("plan")).toBeVisible();
    await expect(log.getByTestId("answer-reason")).toHaveText(
      "The sommelier couldn’t be reached just now, so this answer comes straight from your cellar.",
    );
    await expect(log.getByTestId("plan").getByTestId("annotation").first()).toBeVisible();
    expect(await modelCalls(m5)).toHaveLength(1);
    await expectNoSidewaysScroll(page);
    await expect.poll(() => audit(page)).toEqual([]);
    await page.screenshot({ path: shot("v1plus-journey"), fullPage: true });

    // The whole conversation is kept and drawn the same after a reload.
    await page.reload();
    const again = page.getByRole("log", { name: "Conversation" });
    await expect(again.getByTestId("menu-course")).toHaveCount(3);
    await expect(again.getByTestId("plan")).toBeVisible();
    await expect(again.getByTestId("quantity").first()).toBeVisible();
    await expect(again).toContainText("Open Antinori Tignanello 2018 with the steak");
    await expect(again).not.toContainText("[[");
  });

  test("in Dutch on a small phone: advice with an invented bottle, then a menu for eight", async ({
    page,
    request,
    isMobile,
  }) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 740 });
    const { email } = await arrive(page, "journeynl");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    await setLocale(email, "nl");
    const tig = refOf(ids["Tignanello"]!);
    const rie = refOf(ids["Riesling Schlossberg"]!);
    const log = page.getByRole("log", { name: "Gesprek" });
    await page.goto("/sommelier");

    // Words about a bottle that is not there are replaced; V1's cards and their facts stay.
    const m1 = marker();
    await program(m1, {
      content: {
        answer: "Je Sassicaia 2016 is hier perfect bij.",
        bottle_refs: [tig],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await ask(page, `Wat schenk ik bij een gegrilde biefstuk? ${m1}`, DUTCH);
    await expect(log).toContainText(
      "Antinori Tignanello 2018 uit je kelder past hier het best bij.",
    );
    await expect(log.getByTestId("check-note")).toBeVisible();
    await expect(log).not.toContainText("Sassicaia");
    await expect(log.getByTestId("annotation").first()).toContainText("vuistregel");

    const m2 = marker();
    await program(m2, {
      content: {
        answer: "Wit bij de vis, rood bij het vlees.",
        bottle_refs: [rie, tig],
        verdict: "match",
        buy: [],
        used_taste: false,
        courses: [
          { course: 1, ref: rie, why: "Fris bij de zalm." },
          { course: 2, ref: tig, why: "Stevig bij het lam." },
        ],
      },
    });
    await ask(
      page,
      `We zijn met 8 personen. Vooraf gerookte zalm, daarna lamsrack. Welke wijn per gang? ${m2}`,
      DUTCH,
    );
    await expect(log.getByTestId("menu").getByTestId("menu-course")).toHaveCount(2);
    const quantity = log.getByTestId("quantity").last();
    await expect(quantity).toContainText("Voor 8 personen aan tafel");
    // One Riesling against two needed: the app says how many are short.
    await expect(quantity).toContainText(
      /Riesling Schlossberg: 2 flessen nodig, 1 vrij om te openen: 1 te weinig\./,
    );
    await expectNoSidewaysScroll(page);
    await expect.poll(() => audit(page)).toEqual([]);
    await page.screenshot({ path: shot("v1plus-journey-nl-small"), fullPage: true });
  });
});
