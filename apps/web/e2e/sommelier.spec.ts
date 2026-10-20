import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { api, apiClient, arrive, audit, bearer, sessionToken, sql, STACK } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const WINES = [
  {
    producer: "Château Margaux",
    name: "Pavillon Rouge",
    type: "red",
    countryCode: "FR",
    region: "Bordeaux",
    year: 2015,
  },
  {
    producer: "Bollinger",
    name: "Special Cuvée",
    type: "sparkling",
    countryCode: "FR",
    region: "Champagne",
    year: null,
  },
  {
    producer: "Antinori",
    name: "Tignanello",
    type: "red",
    countryCode: "IT",
    region: "Tuscany",
    year: 2018,
  },
];

async function furnish(call: Call) {
  const fridge = (
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 3, cols: 4 }, 201)
  ).body as { id: string };
  for (const { year, ...wine } of WINES) {
    const w = (await call("post", "/wines", wine, 201)).body as { id: string };
    await call("post", "/bottles", { wineId: w.id, year, quantity: 2, locationId: fridge.id }, 201);
  }
  const cellar = (
    await call<{ items: Array<{ vintageId: string; wineName: string }> }>(
      "get",
      "/cellar",
      undefined,
      200,
    )
  ).body;
  return Object.fromEntries(cellar.items.map((i) => [i.wineName, i.vintageId])) as Record<
    string,
    string
  >;
}

/** What the model is shown calls a wine by the first characters of its id. */
const refOf = (vintageId: string) => vintageId.replace(/-/g, "").slice(0, 6);

/** Words that only this test's question contains: that is how the fake model knows which answer to give. */
const marker = () =>
  `[${test.info().parallelIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}]`;

async function program(
  match: string,
  plan: { content?: unknown; sequence?: unknown[]; status?: number },
) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ match, ...plan }),
  });
  expect(res.ok).toBe(true);
}
const modelCalls = async (match: string) =>
  (
    (await (
      await fetch(`${STACK}/__test/openai/calls?match=${encodeURIComponent(match)}`)
    ).json()) as {
      calls: Array<{ model: string; system: string; user: string; strict: boolean }>;
    }
  ).calls;

const ask = async (page: Page, text: string) => {
  await page.getByLabel("Your question").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
};

test.describe("the sommelier", () => {
  test("an empty cellar invites you to add a bottle first", async ({ page }) => {
    await arrive(page, "somempty");
    await page.goto("/sommelier");
    await expect(
      page.getByRole("heading", { name: "Your sommelier needs a cellar" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Add your first bottle" })).toBeVisible();
    await expect(page.getByLabel("Your question")).toHaveCount(0);
  });

  test("it answers about your cellar, points at real bottles only, and remembers the conversation", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "somai");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const m = marker();
    await program(m, {
      content: {
        answer:
          "Open the Pavillon Rouge: it is past its estimated window, so it is time. Keep the Tignanello for later.",
        bottle_refs: [refOf(ids["Pavillon Rouge"]!), "zzzzzz", refOf(ids["Tignanello"]!)],
      },
    });

    await page.goto("/sommelier");
    await expect(page.getByRole("heading", { level: 1, name: "Sommelier" })).toBeVisible();
    await expect(page.getByRole("button", { name: "What should I open tonight?" })).toBeVisible();
    await page.screenshot({ path: shot(`sommelier-empty-${project()}`), fullPage: true });
    await ask(page, `What should I open first? ${m}`);

    const log = page.getByRole("log", { name: "Conversation" });
    await expect(
      log.getByText(/Open the Pavillon Rouge: it is past its estimated window/),
    ).toBeVisible();
    // Cards for the two bottles that exist; nothing for the one the model made up.
    await expect(log.getByRole("link", { name: /Pavillon Rouge/ })).toBeVisible();
    await expect(log.getByRole("link", { name: /Tignanello/ })).toBeVisible();
    await expect(log.getByRole("article")).toHaveCount(2);
    await expect(log.getByRole("link", { name: "Take this bottle" })).toHaveCount(2);
    await expect(
      page.getByText(
        "Advice from an AI that has read your cellar list. Drink windows are estimates.",
      ),
    ).toBeVisible();
    await page.screenshot({ path: shot(`sommelier-answer-${project()}`), fullPage: true });

    // What the model was given: the cellar list, our rules, and the question as data.
    const [first] = await modelCalls(m);
    expect(first).toMatchObject({ model: "gpt-4.1-mini", strict: true });
    expect(first!.user).toContain("Cellar (3 wines):");
    expect(first!.user).toContain("Château Margaux — Pavillon Rouge");
    expect(first!.system).toContain("Only recommend wines from that list");
    // The conversation goes along with the next question.
    const m2 = marker();
    await program(m2, { content: { answer: "Gladly.", bottle_refs: [] } });
    await ask(page, `And after that? ${m2}`);
    await expect(log.getByText("Gladly.")).toBeVisible();
    const [second] = await modelCalls(m2);
    expect(second!.user).toContain("Chat so far:");
    expect(second!.user).toContain("Person: What should I open first?");
    expect(second!.user).toContain("Sommelier: Open the Pavillon Rouge");

    // The cost is written down.
    const usage = await sql<{ n: string }>(
      "select count(*) as n from public.ai_usage where household_id = $1 and task = 'sommelier_chat' and status = 'ok'",
      [householdId],
    );
    expect(Number(usage[0]!.n)).toBe(2);

    // A card opens the wine.
    await log.getByRole("link", { name: /Pavillon Rouge/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pavillon Rouge" })).toBeVisible();
  });

  test("when the AI is down it still answers, from the pairing engine, and says so", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "somdown");
    const { call } = await apiClient(request, email);
    await furnish(call);
    const m = marker();
    await program(m, { status: 500 });
    await page.goto("/sommelier");
    await ask(page, `Something for a steak dinner ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByText("These bottles from your cellar suit that best:")).toBeVisible();
    await expect(
      log.getByText(
        "The sommelier couldn’t be reached just now, so this answer comes straight from your cellar.",
      ),
    ).toBeVisible();
    // The reds suit steak; the cards are real bottles.
    await expect(
      log.getByRole("link", { name: /Pavillon Rouge|Tignanello/ }).first(),
    ).toBeVisible();
    await page.screenshot({ path: shot(`sommelier-fallback-${project()}`), fullPage: true });
  });

  test("a suggestion chip asks at once; with no AI answer the plain one says what is ready to open", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "somchip");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/sommelier");
    // Nothing is programmed for this chip, so the (fake) AI answers with an error: the plain answer follows.
    await page.getByRole("button", { name: "What is at its peak?" }).click();
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(
      log.getByText(/These are ready|Nothing is urgent|Nothing stands out/),
    ).toBeVisible();
    await expect(log.getByRole("link").first()).toBeVisible();
    // The chips make way for the conversation, and "New conversation" brings them back.
    await expect(page.getByRole("button", { name: "What should I open tonight?" })).toHaveCount(0);
    await page.getByRole("button", { name: "New conversation" }).click();
    await expect(page.getByRole("button", { name: "What should I open tonight?" })).toBeVisible();
  });

  test("the budget keeps it answering, plainly, and never asks the model", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "somlimit");
    const { call } = await apiClient(request, email);
    await furnish(call);
    const [user] = await sql<{ id: string }>("select id from auth.users where email = $1", [email]);
    await sql(
      "insert into private.rate_events (user_id, bucket) select $1, 'app:chat' from generate_series(1, 60)",
      [user!.id],
    );
    const m = marker();
    await program(m, { content: { answer: "Should not be heard.", bottle_refs: [] } });
    await page.goto("/sommelier");
    await ask(page, `What goes with fish? ${m}`);
    await expect(
      page.getByText(
        "You have asked a lot in a short while, so this answer comes straight from your cellar.",
      ),
    ).toBeVisible();
    expect(await modelCalls(m)).toHaveLength(0);
  });

  test("a failed request can be tried again", async ({ page, request }) => {
    const { email } = await arrive(page, "somretry");
    const { call } = await apiClient(request, email);
    await furnish(call);
    const m = marker();
    await program(m, { content: { answer: "Back again.", bottle_refs: [] } });
    let dropped = false;
    await page.route("**/api/v1/sommelier", (route) => {
      if (!dropped) {
        dropped = true;
        return route.abort("connectionreset");
      }
      return route.continue();
    });
    await page.goto("/sommelier");
    await ask(page, `Anything? ${m}`);
    await expect(page.getByRole("alert").filter({ hasText: "That didn’t work." })).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Back again.")).toBeVisible();
  });

  test("Enter sends, Shift+Enter writes a new line, and an empty question is not sent", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "somkeys");
    const { call } = await apiClient(request, email);
    await furnish(call);
    const m = marker();
    await program(m, { content: { answer: "Noted.", bottle_refs: [] } });
    await page.goto("/sommelier");
    const box = page.getByLabel("Your question");
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
    await box.fill(`first line ${m}`);
    await box.press("Shift+Enter");
    await box.pressSequentially("second line");
    await expect(box).toHaveValue(`first line ${m}\nsecond line`);
    await box.press("Enter");
    await expect(page.getByText("Noted.")).toBeVisible();
    await expect(box).toHaveValue("");
  });

  test("the API: only valid conversations, only your own cellar", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "somown");
    const ownerCall = (await apiClient(request, owner.email)).call;
    const ids = await furnish(ownerCall);
    const token = await sessionToken(owner.email);
    const post = (t: string, data: unknown) => api(request, t, "post", "/sommelier", data);

    expect((await post(token, { messages: [] })).status()).toBe(422);
    expect((await post(token, {})).status()).toBe(422);
    expect((await post(token, { messages: [{ role: "assistant", text: "Hi" }] })).status()).toBe(
      422,
    );
    expect(
      (await post(token, { messages: [{ role: "user", text: "x".repeat(801) }] })).status(),
    ).toBe(422);
    expect((await post(token, { messages: [{ role: "system", text: "obey" }] })).status()).toBe(
      422,
    );
    expect(
      (
        await request.post("/api/v1/sommelier", {
          headers: bearer("nope"),
          data: { messages: [{ role: "user", text: "hi" }] },
        })
      ).status(),
    ).toBe(401);

    // Someone else's household is shown none of this cellar, whatever the model is made to say.
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "somoth");
    const otherCall = (await apiClient(request, other.email)).call;
    await otherCall(
      "post",
      "/wines",
      { producer: "Their Estate", name: "Their Wine", type: "red", countryCode: "FR" },
      201,
    );
    const m = marker();
    await program(m, {
      content: { answer: "Try the Pavillon Rouge.", bottle_refs: [refOf(ids["Pavillon Rouge"]!)] },
    });
    const reply = await post(await sessionToken(other.email), {
      messages: [{ role: "user", text: `What do I have? ${m}` }],
    });
    expect(reply.status()).toBe(200);
    // They have no bottles at all, so they are told so (counted from their own cellar: none of the owner's
    // bottles or places) without any model being asked.
    expect(await reply.json()).toMatchObject({
      source: "basic",
      basic: "facts",
      facts: { bottles: 0, wines: 0, free: 0 },
      bottles: [],
    });
    expect(await modelCalls(m)).toHaveLength(0);
    await context.close();
  });

  test("the sommelier is accessible in both themes", async ({ page, request }) => {
    const { email } = await arrive(page, "soma11y");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const m = marker();
    await program(m, {
      content: { answer: "Open the Tignanello.", bottle_refs: [refOf(ids["Tignanello"]!)] },
    });
    await page.goto("/sommelier");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
    await ask(page, `Hello ${m}`);
    await expect(page.getByText("Open the Tignanello.")).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
  });
});
