import { expect, test } from "@playwright/test";
import { apiClient, arrive, audit, FEATURES_URL } from "./helpers";
import {
  ask,
  askAt,
  DEFAULT_URL,
  expectNoSidewaysScroll,
  furnish,
  marker,
  modelCalls,
  program,
  refOf,
  setLocale,
} from "./sommelier-v1plus";

/**
 * Sommelier V1+, P3: the `check` part (docs/sprints/sommelier-3-mega/SOMMELIER_CLOSEOUT.md §6). On the features
 * server the model is asked with prompt v7 (a cellar wine is written as its ref, and there is no place for a price),
 * and what it says is checked: a ref becomes the cellar's own name and vintage; an invented bottle, a wrong vintage
 * or a wrong number of bottles takes the model's words away (the cards V1 chose stay); a price or a shop is left
 * out. The default server (the part off, as production is) asks with v6 and shows V1's answer as it always did.
 */

test.use({ baseURL: FEATURES_URL });

const shot = (name: string) => `test-results/shots/${name}-${test.info().project.name}.png`;

test.describe("the sommelier's words are checked (CELLR_SOMMELIER=check)", () => {
  test("refs become the cellar's own names; a wine that is not owned can still be talked about", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "chkrefs");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const m = marker();
    await program(m, {
      content: {
        answer: `Open [[${refOf(ids["Tignanello"]!)}]] with the steak: it has more grip than [[${refOf(ids["Pavillon Rouge"]!)}]]. A Barolo would be the classic choice, but you have none.`,
        bottle_refs: [refOf(ids["Tignanello"]!)],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await page.goto("/sommelier");
    await ask(page, `What goes with a grilled steak? ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(
      log.getByText(
        "Open Antinori Tignanello 2018 with the steak: it has more grip than Château Margaux Pavillon Rouge 2015. A Barolo would be the classic choice, but you have none.",
      ),
    ).toBeVisible();
    // Nothing was taken away, so nothing is said about it; the first card is V1's first choice.
    await expect(log.getByTestId("check-note")).toHaveCount(0);
    await expect(log.getByRole("article")).toHaveCount(1);
    await expect(log.getByRole("article").getByRole("link", { name: "Tignanello" })).toBeVisible();
    await expect(log).not.toContainText("[[");
    await expectNoSidewaysScroll(page);
    await expect.poll(() => audit(page)).toEqual([]);
    await page.screenshot({ path: shot("v1plus-check-kept"), fullPage: true });
  });

  test("an invented bottle and a wrong vintage: the model's words go, the cards stay, and the next question never hears them", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "chkbad");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const m = marker();
    await program(m, {
      content: {
        answer: "Your Sassicaia 2016 is perfect with this, and so is your Tignanello 2012.",
        bottle_refs: [refOf(ids["Tignanello"]!), refOf(ids["Pavillon Rouge"]!)],
        verdict: "match",
        buy: [],
        used_taste: false,
      },
    });
    await page.goto("/sommelier");
    await ask(page, `What goes with a grilled steak? ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    // One sentence made from what is certain: the first card and the verdict.
    await expect(
      log.getByText(
        "Antinori Tignanello 2018 from your cellar suits this best. One more is shown below.",
      ),
    ).toBeVisible();
    await expect(log.getByTestId("check-note")).toHaveText(
      "The sommelier’s own words were left out: they said something about your cellar that could not be checked.",
    );
    await expect(log.getByRole("article")).toHaveCount(2);
    await expect(log).not.toContainText("Sassicaia");
    await expect(log).not.toContainText("2012");
    await page.screenshot({ path: shot("v1plus-check-replaced"), fullPage: true });

    // Kept as it was shown, and the same after a reload.
    await page.reload();
    const again = page.getByRole("log", { name: "Conversation" });
    await expect(
      again.getByText("Antinori Tignanello 2018 from your cellar suits this best."),
    ).toBeVisible();
    await expect(again).not.toContainText("Sassicaia");

    // The conversation that goes along with the next question holds the shown sentence, never the removed words.
    const next = marker();
    await program(next, {
      content: {
        answer: "Yes.",
        bottle_refs: [],
        verdict: "not_pairing",
        buy: [],
        used_taste: false,
      },
    });
    await ask(page, `And is it ready? ${next}`);
    await expect(again).toContainText("Yes.");
    const [heard] = await modelCalls(next);
    expect(heard!.user).toContain("Antinori Tignanello 2018 from your cellar suits this best.");
    expect(heard!.user).not.toContain("Sassicaia");
  });

  test("tonight, in Dutch on a small phone: no price and no shop, the person's own budget instead", async ({
    page,
    request,
    isMobile,
  }) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 740 });
    const { email } = await arrive(page, "chkbuy");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await setLocale(email, "nl");
    const m = marker();
    await program(m, {
      content: {
        answer:
          "Niets in je kelder past echt bij oesters. Een Chablis zou ideaal zijn. Die kost ongeveer €25 bij Gall & Gall.",
        bottle_refs: [],
        verdict: "none",
        buy: [
          { wine: "Chablis, bv. William Fèvre", why: "Strak en mineraal." },
          { wine: "Muscadet Sèvre et Maine", why: "Fris en zilt, voor maar €12 per fles." },
        ],
        used_taste: false,
      },
    });
    await page.goto(`/tonight?ask=${encodeURIComponent(`Oesters vanavond ${m}`)}`);
    const log = page.getByRole("log", { name: "Gesprek" });
    // The sentence with the price and the shop is gone; the two before it are as the sommelier wrote them.
    await expect(
      log.locator("p", { hasText: "Niets in je kelder past echt bij oesters." }),
    ).toHaveText(/Niets in je kelder past echt bij oesters\. Een Chablis zou ideaal zijn\.$/);
    await expect(log.getByTestId("check-note")).toHaveText(
      "Een deel van het antwoord is weggelaten: het kon niet worden gecontroleerd.",
    );
    const buy = log.getByTestId("buy");
    await expect(buy.getByText("Chablis, bv. William Fèvre")).toBeVisible();
    await expect(buy.getByText("Muscadet Sèvre et Maine")).toBeVisible();
    // The budget the person chose (€15–30 until they choose another), said once; never the model's number.
    await expect(buy.getByTestId("buy-price")).toHaveText("€15–30, je budget");
    await expect(log).not.toContainText("€25");
    await expect(log).not.toContainText("€12");
    await expect(log).not.toContainText("Gall");
    await expectNoSidewaysScroll(page);
    await expect.poll(() => audit(page)).toEqual([]);
    await page.screenshot({ path: shot("v1plus-check-buy-nl-small"), fullPage: true });
  });
});

test.describe("the check and V1 (API)", () => {
  test.skip(({ isMobile }) => isMobile, "an API comparison: the screen does not take part");

  test("the default server asks with v6 and shows V1's answer as it was; the features server asks with v7 and checks", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "chkapi");
    const { call, token } = await apiClient(request, email);
    const ids = await furnish(call);
    const content = {
      answer: "Your Sassicaia 2016 is perfect. It costs about €25.",
      bottle_refs: [refOf(ids["Tignanello"]!), "nosuch"],
      verdict: "partial",
      buy: [{ wine: "Chablis", why: "Lean.", price: "about €22" }],
      used_taste: false,
    };
    const answers: Record<string, unknown>[] = [];
    const calls: Array<{ system: string; user: string }> = [];
    for (const base of [DEFAULT_URL, FEATURES_URL]) {
      const m = marker();
      await program(m, { content });
      answers.push(await askAt(request, base, token, `What goes with oysters? ${m}`));
      const [first] = await modelCalls(m);
      calls.push({ system: first!.system, user: first!.user.replaceAll(m, "[marker]") });
      expect(await modelCalls(m)).toHaveLength(1);
    }
    const [v1, plus] = answers as [Record<string, unknown>, Record<string, unknown>];
    // Production's configuration: prompt v6, the answer as the model worded it, its price and all.
    expect(calls[0]!.system).toContain('a rough price per bottle in euros ("about €20")');
    expect(calls[0]!.system).not.toContain("[[a1b2c3]]");
    expect(v1).toMatchObject({
      source: "ai",
      text: "Your Sassicaia 2016 is perfect. It costs about €25.",
      buy: [{ wine: "Chablis", why: "Lean.", price: "about €22" }],
    });
    expect(v1.check).toBeUndefined();
    // The part on: v7 (refs, no price), the same question, and the words checked.
    expect(calls[1]!.system).toContain("[[a1b2c3]]");
    expect(calls[1]!.system).not.toContain("about €20");
    expect(calls[1]!.user).toEqual(calls[0]!.user);
    expect(plus).toMatchObject({
      source: "ai",
      text: null,
      verdict: "partial",
      buy: [{ wine: "Chablis", why: "Lean.", price: "", priceBand: null }],
    });
    expect((plus.check as { text: string; codes: string[] }).text).toBe("replaced");
    expect((plus.check as { codes: string[] }).codes).toContain("not-in-cellar");
    // The wines V1 chose are the same on both: the check never changes a card.
    expect(plus.bottles).toEqual(v1.bottles);
    expect(JSON.stringify(plus)).not.toMatch(/Sassicaia|€/);

    // A question about the cellar itself: the counted numbers may be said, on both servers.
    const fact = marker();
    await program(fact, {
      content: {
        answer: "You have 6 bottles of Tignanello.",
        bottle_refs: [],
        verdict: "not_pairing",
        buy: [],
        used_taste: false,
      },
    });
    const counted = await askAt(
      request,
      FEATURES_URL,
      token,
      `How many bottles of Tignanello do I have? ${fact}`,
    );
    expect(counted).toMatchObject({ source: "ai", text: "You have 6 bottles of Tignanello." });
    expect(counted.check).toEqual({ v: 1, text: "kept", codes: [] });
  });
});
