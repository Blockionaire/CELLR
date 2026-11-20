import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiClient, arrive, audit, bearer, signIn, SOMMELIER_URL, sql, STACK } from "./helpers";

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
    await expect(serving).toContainText(
      "A rule of thumb for wines like this, not a fact about this bottle.",
    );
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

  test("keeping is answered for the owned bottle; a bottle that is not in the cellar is not served up as if it were", async ({
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
    // What the window rests on is said: here the table for its style, not a fact about the bottle.
    await expect(keeping).toContainText("This is an estimate for wines like it");
    expect(await audit(page)).toEqual([]);

    // No Chablis in this cellar: the engines do not answer as if there were one. The question goes to the
    // general sommelier (the test's model), and no serving card for a bottle appears.
    const res = await fetch(`${STACK}/__test/openai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        match: "serve my essai Chablis",
        content: { answer: "I do not see a Chablis in your cellar.", bottle_refs: [] },
      }),
    });
    expect(res.ok).toBe(true);
    await ask(page, "At what temperature should I serve my essai Chablis?");
    await expect(
      page
        .getByRole("log", { name: "Conversation" })
        .getByText("I do not see a Chablis in your cellar."),
    ).toBeVisible();
    await expect(page.getByTestId("plan-serving")).toHaveCount(0);
    await expect(page.getByTestId("plan")).toHaveCount(1);
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

test.describe("what came of a bottle (sommelier_learning)", () => {
  test.use({ baseURL: SOMMELIER_URL });

  test("opened, with the dish, how it went: three things said apart, kept, and never a thumb", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "s3out");
    const { call, token } = await apiClient(request, email);
    await furnish(call, [PAUILLAC, CHABLIS]);
    await page.goto("/sommelier");
    await ask(page, "What should I open with roast lamb?");
    const plan = await planNo(page, 1);
    const said = plan.getByTestId("pick-outcome");
    await expect(said).toHaveCount(1);
    const outcomes = () =>
      sql<{
        with_dish: boolean | null;
        enjoyed: string | null;
        plan_kind: string;
        plan_outcome: string;
      }>(
        `select o.with_dish, o.enjoyed, o.plan_kind, o.plan_outcome from public.sommelier_outcomes o
           join auth.users u on u.id = o.user_id where u.email = $1`,
        [email],
      );
    const thumbs = () =>
      sql<{ n: string }>(
        `select count(*)::text as n from public.sommelier_feedback f
           join auth.users u on u.id = f.user_id where u.email = $1`,
        [email],
      );

    // Nothing is asked about the dish before the bottle was opened.
    await expect(said.getByText("With the dish?")).toHaveCount(0);
    await said.getByRole("button", { name: "I opened it" }).click();
    await expect(said.getByRole("button", { name: "I opened it" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(outcomes)
      .toEqual([{ with_dish: null, enjoyed: null, plan_kind: "pairing", plan_outcome: "good" }]);
    // How it went is only asked of someone who had the two together.
    await expect(said.getByText("How did the two go together?")).toHaveCount(0);
    const withDish = said.getByRole("group", { name: "With the dish?" });
    await withDish.getByRole("button", { name: "Yes" }).focus();
    await page.keyboard.press("Enter");
    const went = said.getByRole("group", { name: "How did the two go together?" });
    await went.getByRole("button", { name: "So-so" }).click();
    await expect(went.getByRole("button", { name: "So-so" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(said).toContainText("This is about the wine with the dish, not about my answer.");
    await expect
      .poll(outcomes)
      .toEqual([{ with_dish: true, enjoyed: "mixed", plan_kind: "pairing", plan_outcome: "good" }]);
    // Saying all this rated nothing.
    expect(await thumbs()).toEqual([{ n: "0" }]);
    await page.screenshot({ path: shot(`sommelier3-outcome-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);
    await fitsTheScreen(page);

    // A thumb is its own record, and changes nothing about the bottle.
    await page.getByRole("button", { name: "Useful", exact: true }).click();
    await expect.poll(thumbs).toEqual([{ n: "1" }]);
    expect(await outcomes()).toEqual([
      { with_dish: true, enjoyed: "mixed", plan_kind: "pairing", plan_outcome: "good" },
    ]);

    // Kept with the conversation.
    await page.reload();
    const again = (await planNo(page, 1)).getByTestId("pick-outcome");
    await expect(
      again
        .getByRole("group", { name: "How did the two go together?" })
        .getByRole("button", { name: "So-so" }),
    ).toHaveAttribute("aria-pressed", "true");

    // "Not with the dish" takes back how it went: nothing is claimed about a pairing that was not had.
    await again
      .getByRole("group", { name: "With the dish?" })
      .getByRole("button", { name: "No" })
      .click();
    await expect
      .poll(outcomes)
      .toEqual([{ with_dish: false, enjoyed: null, plan_kind: "pairing", plan_outcome: "good" }]);
    await expect(again.getByText("How did the two go together?")).toHaveCount(0);
    // And "I did not open it" takes everything back.
    await again.getByRole("button", { name: "I opened it" }).click();
    await expect.poll(outcomes).toEqual([]);

    // A bottle the answer never offered cannot get an outcome, whatever a client sends.
    const offered = await sql<{ id: string; answer: { bottles: Array<{ vintageId: string }> } }>(
      `select m.id, m.answer from public.sommelier_messages m join auth.users u on u.id = m.user_id
        where u.email = $1 and m.role = 'assistant'`,
      [email],
    );
    const cellar = (
      await call<{ items: Array<{ vintageId: string; wineName: string }> }>("get", "/cellar")
    ).body;
    const chablis = cellar.items.find((i) => i.wineName === "Chablis")!.vintageId;
    expect(offered[0]!.answer.bottles.map((b) => b.vintageId)).not.toContain(chablis);
    // (asked as an app would, with a token, of the server where the switch is on)
    const refused = await request.put(`${SOMMELIER_URL}/api/v1/sommelier/outcomes`, {
      headers: bearer(token),
      data: { messageId: offered[0]!.id, vintageId: chablis, opened: true },
    });
    expect(refused.status()).toBe(404);
    expect(await outcomes()).toEqual([]);
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
    await expect(page.getByTestId("pick-outcome")).toHaveCount(0);
    await call(
      "put",
      "/sommelier/outcomes",
      {
        messageId: "6f1c2b0a-1111-4111-8111-111111111111",
        vintageId: "6f1c2b0a-2222-4222-8222-222222222222",
        opened: true,
      },
      404,
    );
  });
});

// The admin of the local stack (playwright.config.ts: CELLR_ADMIN_USER_IDS).
const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";
async function asAdmin(browser: Browser) {
  await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    ADMIN_EMAIL,
  ]);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn(page, ADMIN_EMAIL);
  return { page, close: () => context.close() };
}

test.describe("the sommelier's report (/admin/sommelier)", () => {
  test("is a real 404 for someone who is not an admin", async ({ page }) => {
    await arrive(page, "s3notadmin");
    const load = await page.goto("/admin/sommelier");
    expect(load?.status()).toBe(404);
    await expect(page.getByText("What came of offered bottles")).toHaveCount(0);
  });

  test("shows an admin counts only, with thumbs and outcomes apart", async ({ browser }) => {
    test.skip(
      test.info().project.name !== "desktop",
      "the admin is a desk tool; one run is enough",
    );
    const { page, close } = await asAdmin(browser);
    try {
      await page.goto("/admin/sommelier");
      await expect(page.getByRole("heading", { level: 1, name: "Sommelier" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Ratings of answers" })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "What came of offered bottles" }),
      ).toBeVisible();
      await expect(page.getByText("Model cost per question")).toBeVisible();
      // No address of a person and no id of anything is on the page.
      const text = await page.locator("#admin-main").innerText();
      expect(text).not.toMatch(/@cellr\.invalid|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
      await page.screenshot({ path: shot("admin-sommelier"), fullPage: true });
      expect(await audit(page)).toEqual([]);
    } finally {
      await close();
    }
  });
});
