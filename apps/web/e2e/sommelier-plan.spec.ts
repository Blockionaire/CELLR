import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, audit, SOMMELIER_URL, sql, STACK } from "./helpers";

/**
 * Sommelier 3.0 in a browser, on the server where its switches are NAMED (playwright.config.ts). The engines decide
 * and the screen draws their plan from codes: so what is checked here is that a person on a phone and at a desk
 * gets the plan, that it holds only what the cellar holds, that it says so when nothing suits, that no shop is
 * invented, that the screen passes WCAG 2.1 AA and does not scroll sideways, and that no model was asked.
 *
 * The same questions on a server without the switches are the last test: nothing of this shows.
 */

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const PAUILLAC = {
  producer: "Domaine Essai",
  name: "Pauillac",
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
  year: 2015,
};
const CHABLIS = {
  producer: "Domaine Essai",
  name: "Chablis",
  type: "white",
  countryCode: "FR",
  region: "Burgundy",
  year: 2021,
};
const CHAMPAGNE = {
  producer: "Maison Essai",
  name: "Champagne Brut",
  type: "sparkling",
  countryCode: "FR",
  region: "Champagne",
  year: null,
};

async function furnish(call: Call, wines: Array<typeof PAUILLAC | typeof CHAMPAGNE>, quantity = 2) {
  for (const { year, ...wine } of wines) {
    const w = (await call("post", "/wines", wine, 201)).body as { id: string };
    await call("post", "/bottles", { wineId: w.id, year, quantity }, 201);
  }
}

const ask = async (page: Page, text: string) => {
  await page.getByLabel("Your question").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
};

/**
 * The plan of the n-th answer. `last()` alone would be the previous answer while the next is still on its way.
 */
const planNo = async (page: Page, n: number) => {
  await expect(page.getByTestId("plan")).toHaveCount(n);
  return page.getByTestId("plan").nth(n - 1);
};

/** How often the fake model was asked something that contains these words. */
const modelCalls = async (match: string) =>
  (
    (await (
      await fetch(`${STACK}/__test/openai/calls?match=${encodeURIComponent(match)}`)
    ).json()) as { calls: unknown[] }
  ).calls.length;

/** The page is as wide as the screen: nothing of the plan pushes it sideways. */
const fitsTheScreen = async (page: Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    "the page scrolls sideways",
  ).toBeLessThanOrEqual(0);

/** No link out of the app anywhere in the conversation: nothing was "found in a shop". */
const noLinkOut = async (page: Page) =>
  expect(page.getByRole("log", { name: "Conversation" }).locator('a[href^="http"]')).toHaveCount(0);

test.describe("sommelier 3.0, switched on by name", () => {
  test.use({ baseURL: SOMMELIER_URL });

  test("a dish gets a wine from the cellar with its reasons, and no model is asked", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "s3pair");
    const { call } = await apiClient(request, email);
    await furnish(call, [PAUILLAC, CHABLIS, CHAMPAGNE]);

    await page.goto("/sommelier");
    const question = "What should I open with roast lamb for the essai dinner?";
    await ask(page, question);

    const plan = await planNo(page, 1);
    await expect(plan.getByTestId("plan-headline")).toContainText("A good match from your cellar:");
    await expect(plan.getByTestId("plan-dish")).toContainText(/lamb/i);
    // The red is offered, with a reason a person can read; the white and the bubbles are not passed off as a match.
    const picks = plan.getByTestId("plan-picks");
    await expect(picks.getByRole("link", { name: /Pauillac/ })).toBeVisible();
    await expect(picks.getByRole("link", { name: /Chablis/ })).toHaveCount(0);
    await expect(plan.getByTestId("plan-reasons").first()).toContainText(/\w/);
    // It says how sure it is, and on what.
    await expect(plan.getByTestId("plan-confidence")).toContainText(/Judged by|I know little/);
    await noLinkOut(page);

    await page.screenshot({ path: shot(`sommelier3-pairing-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);
    await fitsTheScreen(page);
    // The engines decided; no model was asked to.
    expect(await modelCalls("essai dinner")).toBe(0);

    // The conversation is kept, and comes back as the same plan.
    await page.reload();
    await expect(page.getByTestId("plan").last().getByTestId("plan-headline")).toContainText(
      "A good match from your cellar:",
    );
  });

  test("when nothing suits it says so, and offers no bottle as if it did", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "s3none");
    const { call } = await apiClient(request, email);
    await furnish(call, [PAUILLAC]);

    await page.goto("/sommelier");
    await ask(page, "What should I open with oysters?");

    const plan = await planNo(page, 1);
    await expect(plan.getByTestId("plan-headline")).toContainText(
      "Nothing in your cellar really suits this.",
    );
    await expect(plan.getByTestId("plan-picks")).toHaveCount(0);
    await page.screenshot({ path: shot(`sommelier3-none-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);
    await fitsTheScreen(page);
  });

  test("buying: it asks what is missing, keeps what was said, and invents no shop", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "s3buy");
    const { call } = await apiClient(request, email);
    await furnish(call, [CHABLIS]);

    await page.goto("/sommelier");
    await ask(page, "I want to buy a wine for roast lamb");

    // One question at a time, with answers that can be tapped or reached by keyboard.
    const first = await planNo(page, 1);
    await expect(first.getByTestId("plan-ask")).toContainText("What may a bottle cost?");
    const quick = first.getByRole("group", { name: "Answer" });
    await expect(quick.getByRole("button", { name: "Up to €25" })).toBeVisible();
    expect(await audit(page)).toEqual([]);
    await quick.getByRole("button", { name: "Up to €25" }).focus();
    await page.keyboard.press("Enter");

    // The dish of the first turn is still the dish: styles for lamb, within the budget just given.
    const advice = await planNo(page, 2);
    const buy = advice.getByTestId("plan-buy");
    await expect(buy).toBeVisible();
    await expect(advice.getByTestId("plan-dish")).toContainText(/lamb/i);
    await expect(buy.getByTestId("plan-style").first()).toBeVisible();
    const prices = await buy.getByTestId("plan-style").allInnerTexts();
    for (const text of prices) {
      const from = /€\s?(\d+)/.exec(text);
      if (from) expect(Number(from[1]), text).toBeLessThanOrEqual(25);
    }
    // No shop is connected, and it says so: a style to look for, no offer, no price of a bottle, no link.
    await expect(advice.getByTestId("plan-offer-check")).toHaveText(
      "I cannot look in shops yet, so this is a style to look for, not an offer.",
    );
    await expect(advice.getByTestId("plan-offer")).toHaveCount(0);
    await noLinkOut(page);
    // The old model-written "buy" suggestions (a product name with a made-up price) are gone with it.
    await expect(page.getByTestId("buy")).toHaveCount(0);

    await page.screenshot({ path: shot(`sommelier3-buying-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);
    await fitsTheScreen(page);
  });

  test("serving, a menu and bottles for guests are answered from the cellar", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "s3exp");
    const { call } = await apiClient(request, email);
    await furnish(call, [PAUILLAC, CHABLIS, CHAMPAGNE]);

    await page.goto("/sommelier");
    await ask(page, "At what temperature should I serve my Chablis?");
    const serving = (await planNo(page, 1)).getByTestId("plan-serving");
    await expect(serving).toHaveCount(1);
    await expect(serving).toContainText(/Serve at \d+–\d+ °C\./);
    await expect(serving).toContainText("A white-wine glass.");
    // A rule of thumb is called a rule of thumb.
    await expect(serving).toContainText(/rule of thumb|known about this exact wine/);
    await expect(serving.getByRole("link", { name: /Chablis/ })).toBeVisible();

    await ask(page, "Oysters to start, then roast lamb, and for dessert chocolate fondant");
    const courses = (await planNo(page, 2)).getByTestId("plan-courses");
    await expect(courses.getByRole("listitem")).toHaveCount(3);
    await expect(
      courses
        .getByRole("listitem")
        .nth(1)
        .getByRole("link", { name: /Pauillac/ }),
    ).toBeVisible();
    // No sweet wine in this cellar: the dessert gets none, and it says so.
    await expect(courses.getByRole("listitem").nth(2)).toContainText(
      "Nothing in your cellar suits this course.",
    );
    await page.screenshot({ path: shot(`sommelier3-menu-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);
    await fitsTheScreen(page);

    await ask(page, "8 guests, roast lamb. Do I have enough bottles?");
    const quantity = (await planNo(page, 3)).getByTestId("plan-quantity");
    await expect(quantity).toContainText(
      "For 8 guests you need about 4 bottles (half a bottle each).",
    );
    // Two bottles of the one red that suits: two short, said in so many words.
    await expect(quantity).toContainText("You have 2 bottles that suit: 2 short.");
    await page.screenshot({ path: shot(`sommelier3-quantity-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);
    await fitsTheScreen(page);
  });

  test("a bottle that is not in the cellar is not served up as if it were", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "s3own");
    const { call } = await apiClient(request, email);
    await furnish(call, [PAUILLAC]);
    await page.goto("/sommelier");
    await ask(page, "How long can I keep my Pauillac?");
    const keeping = (await planNo(page, 1)).getByTestId("plan-keeping");
    await expect(keeping.getByRole("link", { name: /Pauillac/ })).toBeVisible();
    await expect(keeping).toContainText(/Best between \d{4} and \d{4}\.|Too little is known/);
    expect(await audit(page)).toEqual([]);
  });

  test("friends: sharing taste with a friend's sommelier is off until you turn it on, and a stranger's name uses nothing", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "s3soc");
    const { call } = await apiClient(request, email);
    await furnish(call, [PAUILLAC]);

    await page.goto("/friends");
    const consent = page.getByRole("switch", { name: "Friends' sommelier" });
    await expect(consent).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByText(/Never your bottles, your ratings, your notes or your name/),
    ).toBeVisible();
    expect(await audit(page)).toEqual([]);
    await fitsTheScreen(page);
    // By keyboard, and it is kept.
    await consent.focus();
    await page.keyboard.press("Space");
    await expect(consent).toHaveAttribute("aria-checked", "true");
    await page.reload();
    await expect(page.getByRole("switch", { name: "Friends' sommelier" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.screenshot({ path: shot(`sommelier3-sharing-${project()}`), fullPage: true });

    // Someone who is not a friend: said so, nothing of theirs used, and the turn is not kept.
    await page.goto("/sommelier");
    await ask(page, "@nobody.essai is coming for roast lamb, what do I open?");
    const plan = await planNo(page, 1);
    await expect(plan.getByTestId("plan-friends")).toContainText(
      "not one of your friends, so nothing of theirs was used",
    );
    await expect(
      plan.getByTestId("plan-picks").getByRole("link", { name: /Pauillac/ }),
    ).toBeVisible();
    expect(await audit(page)).toEqual([]);
    await fitsTheScreen(page);
    expect(await modelCalls("nobody.essai")).toBe(0);
    const kept = await sql<{ n: string }>(
      `select count(*)::text as n from public.sommelier_messages m
         join auth.users u on u.id = m.user_id
        where u.email = $1 and m.content ilike '%nobody.essai%'`,
      [email],
    );
    expect(kept).toEqual([{ n: "0" }]);
  });

  test("in Dutch the plan is Dutch", async ({ page, request }) => {
    const { email } = await arrive(page, "s3nl");
    const { call } = await apiClient(request, email);
    await furnish(call, [PAUILLAC, CHABLIS]);
    await page.goto("/profile");
    await page.getByRole("radio", { name: "Nederlands" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");

    await page.goto("/sommelier");
    await page.getByLabel("Je vraag").fill("Wat schenk ik bij lamsbout?");
    await page.getByRole("button", { name: "Verstuur" }).click();
    const plan = await planNo(page, 1);
    await expect(plan.getByTestId("plan-headline")).toContainText("Een goede match uit je kelder:");
    await expect(
      plan.getByTestId("plan-picks").getByRole("link", { name: /Pauillac/ }),
    ).toBeVisible();
    await page.screenshot({ path: shot(`sommelier3-nl-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);
    await fitsTheScreen(page);
  });
});

test.describe("sommelier 3.0, not switched on", () => {
  // The default server: what Production and Preview are until someone names the switches.
  test("nothing of it shows, and its API is not there", async ({ page, request }) => {
    const { email } = await arrive(page, "s3off");
    const { call } = await apiClient(request, email);
    await furnish(call, [PAUILLAC]);
    await call("get", "/sharing/sommelier", undefined, 404);
    await call("put", "/sharing/sommelier", { tasteForFriends: true }, 404);

    await page.goto("/friends");
    await expect(page.getByRole("switch", { name: "Friends' sommelier" })).toHaveCount(0);

    await page.goto("/sommelier");
    await ask(page, "At what temperature should I serve my Pauillac?");
    // An answer came (the old sommelier's), and it is not a plan.
    await expect(page.getByTestId("answer-feedback")).toHaveCount(1);
    await expect(page.getByTestId("plan")).toHaveCount(0);
  });
});
