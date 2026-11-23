import { expect, test } from "@playwright/test";
import { apiClient, arrive, audit, FEATURES_URL } from "./helpers";
import {
  ask,
  askAt,
  chosen,
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
 * Sommelier V1+, P4 and P5: the `annotate` and `quantities` parts (docs/sprints/sommelier-3-mega/
 * SOMMELIER_CLOSEOUT.md §6). On the features server V1's cards carry the app's own facts (drink now or keep, how to
 * serve), a question about serving shows those first, and a number of people gets the bottles counted against what
 * is free to open. The wines, the words and the verdict stay V1's; the default server (the parts off, as production
 * is) answers exactly as it did.
 */

test.use({ baseURL: FEATURES_URL });

const shot = (name: string) => `test-results/shots/${name}-${test.info().project.name}.png`;

test.describe("facts on the sommelier's cards (CELLR_SOMMELIER=annotate,quantities)", () => {
  test("a pairing: each card says when to drink it and how to serve it; asked how to serve, that comes first", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "cards");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const m = marker();
    await program(m, {
      content: {
        answer: "The Tignanello has the structure for it; the Pavillon Rouge would do as well.",
        bottle_refs: [refOf(ids["Tignanello"]!), refOf(ids["Pavillon Rouge"]!)],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await page.goto("/sommelier");
    await ask(page, `What goes with a grilled steak? ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByText("The Tignanello has the structure for it")).toBeVisible();
    const cards = log.getByRole("article");
    await expect(cards).toHaveCount(2);
    // The first card is V1's first choice, and the one with the primary button.
    await expect(cards.first().getByRole("link", { name: "Tignanello" })).toBeVisible();
    const facts = log.getByTestId("annotation");
    await expect(facts).toHaveCount(2);
    // A temperature worded as the rule of thumb it is, never as a fact about this bottle.
    await expect(facts.first()).toContainText(/about \d+–\d+ °C/);
    await expect(facts.first()).toContainText("rule of thumb");
    await expect(facts.first()).toHaveAttribute("data-emphasis", "none");
    // No number of people was named: nothing is counted.
    await expect(log.getByTestId("quantity")).toHaveCount(0);
    await expectNoSidewaysScroll(page);
    await expect.poll(() => audit(page)).toEqual([]);
    await page.screenshot({ path: shot("v1plus-cards"), fullPage: true });

    // A follow-up about serving: the app's facts go to the model, and the card shows the serving line first.
    const s = marker();
    await program(s, {
      content: {
        answer: "Give it about an hour of air and serve it just under room temperature.",
        bottle_refs: [],
        verdict: "not_pairing",
        buy: [],
        used_taste: false,
      },
    });
    await ask(page, `How should I serve the Tignanello? ${s}`);
    await expect(log.getByText("Give it about an hour of air")).toBeVisible();
    const [served] = await modelCalls(s);
    expect(served!.user).toContain("Serving facts (worked out by the app");
    expect(served!.user).toContain(`- ${refOf(ids["Tignanello"]!)} | Antinori — Tignanello | 2018`);
    // The model pointed at no bottle; the wine asked about still gets its card, with the serving line in full.
    const serving = log.getByTestId("annotation").last();
    await expect(serving).toHaveAttribute("data-emphasis", "serving");
    await expect(serving.locator("p").first()).toContainText(/°C/);
    await expect(serving.locator("p").first()).toContainText(/glass/);
    await page.screenshot({ path: shot("v1plus-cards-serving"), fullPage: true });

    // Kept with the answer: the same facts are there after a reload.
    await page.reload();
    await expect(
      page.getByRole("log", { name: "Conversation" }).getByTestId("annotation"),
    ).toHaveCount(3);
  });

  test("for a number of people: the bottles needed against what is free to open, counted by the app", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "guests");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const m = marker();
    await program(m, {
      content: {
        answer: "The Pavillon Rouge for the lamb, or the Tignanello if you want more grip.",
        bottle_refs: [refOf(ids["Pavillon Rouge"]!), refOf(ids["Tignanello"]!)],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await page.goto("/sommelier");
    await ask(page, `We are 8 for dinner. What goes with roast lamb? ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    const quantity = log.getByTestId("quantity");
    await expect(quantity).toBeVisible();
    await expect(quantity).toContainText("For 8 people at dinner: about 4 bottles in all");
    // Three bottles of the first, six of the second: one short, and enough.
    await expect(quantity).toContainText(
      "Château Margaux Pavillon Rouge: 3 free to open, 1 short.",
    );
    await expect(quantity).toContainText("Antinori Tignanello: 6 free to open, enough.");
    // The model was told who is coming and that the app counts.
    const [call1] = await modelCalls(m);
    expect(call1!.user).toContain("- 8 people, a dinner.");
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: shot("v1plus-quantity"), fullPage: true });

    // The number of people is remembered for the next question in the conversation.
    const next = marker();
    await program(next, {
      content: {
        answer: "With the cheese, stay with the Tignanello.",
        bottle_refs: [refOf(ids["Tignanello"]!)],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await ask(page, `And with the cheese afterwards? ${next}`);
    await expect(log.getByTestId("quantity").last()).toContainText("For 8 people at dinner");
  });

  test("in Dutch on a small phone: the facts and the count in Dutch, nothing wider than the screen", async ({
    page,
    request,
    isMobile,
  }) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 740 });
    const { email } = await arrive(page, "cardsnl");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    await setLocale(email, "nl");
    const m = marker();
    await program(m, {
      content: {
        answer: "De Tignanello past er goed bij.",
        bottle_refs: [refOf(ids["Tignanello"]!), refOf(ids["Riesling Schlossberg"]!)],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await page.goto("/sommelier");
    await ask(page, `We zijn met 12 personen. Wat schenk ik bij de biefstuk? ${m}`, DUTCH);
    const log = page.getByRole("log", { name: "Gesprek" });
    await expect(log.getByTestId("annotation").first()).toContainText(/ongeveer \d+–\d+ °C/);
    await expect(log.getByTestId("annotation").first()).toContainText("vuistregel");
    const quantity = log.getByTestId("quantity");
    await expect(quantity).toContainText(
      "Voor 12 personen aan tafel: ongeveer 6 flessen in totaal",
    );
    await expect(quantity).toContainText("Antinori Tignanello: 6 vrij om te openen, genoeg.");
    await expect(quantity).toContainText(
      "Domaine Weinbach Riesling Schlossberg: 1 vrij om te openen, 5 te weinig.",
    );
    await expectNoSidewaysScroll(page);
    await expect.poll(() => audit(page)).toEqual([]);
    await page.screenshot({ path: shot("v1plus-cards-nl-small"), fullPage: true });
  });
});

test.describe("the cards' facts and V1 (API)", () => {
  test.skip(({ isMobile }) => isMobile, "an API comparison: the screen does not take part");

  test("V1's wines, words and verdict are the same on both servers; only the facts are added", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "cardsapi");
    const { call, token } = await apiClient(request, email);
    const ids = await furnish(call);
    const content = {
      answer: "Open the Tignanello.",
      bottle_refs: [refOf(ids["Tignanello"]!), "nosuch"],
      verdict: "match",
      buy: [],
      used_taste: false,
    };
    const answers: Record<string, unknown>[] = [];
    const prompts: string[] = [];
    for (const base of [DEFAULT_URL, FEATURES_URL]) {
      const m = marker();
      await program(m, { content });
      answers.push(await askAt(request, base, token, `What goes with a steak? ${m}`));
      prompts.push((await modelCalls(m))[0]!.user.replaceAll(m, "[marker]"));
    }
    const [v1, plus] = answers as [Record<string, unknown>, Record<string, unknown>];
    expect(v1.annotations).toBeUndefined();
    expect(v1.quantity).toBeUndefined();
    const { annotations } = plus;
    // The same wines and verdict, the same words, and the same question put to the model: the facts are added.
    expect(chosen(plus)).toEqual(chosen(v1));
    expect(plus.text).toEqual(v1.text);
    expect(prompts[1]).toEqual(prompts[0]);
    // One per card: a reference the model made up has no card and no facts.
    expect((annotations as Array<{ vintageId: string }>).map((a) => a.vintageId)).toEqual([
      ids["Tignanello"],
    ]);

    // A question about the cellar itself is left exactly as it was, on both.
    const fact = marker();
    await program(fact, { status: 500 });
    const counted = await Promise.all(
      [DEFAULT_URL, FEATURES_URL].map((base) =>
        askAt(request, base, token, [
          { role: "user", text: "We are 8 for dinner." },
          { role: "assistant", text: "Lovely." },
          { role: "user", text: `How many bottles of Tignanello do I have? ${fact}` },
        ]),
      ),
    );
    expect(chosen(counted[1]!)).toEqual(chosen(counted[0]!));
    expect(counted[1]!.facts).toEqual(counted[0]!.facts);
    expect(counted[1]!.annotations).toBeUndefined();
    expect(counted[1]!.quantity).toBeUndefined();
  });
});
