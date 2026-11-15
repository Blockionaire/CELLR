import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { api, apiClient, arrive, audit, sessionToken, sql, STACK } from "./helpers";

/**
 * The sommelier's kept conversation (migration 0046) and the ratings of its answers: there again after a wine page,
 * a reload or a fresh start of the app; gone after "New conversation" or 7 quiet days; never anyone else's; and
 * never asked twice.
 */

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

async function furnish(call: Call) {
  const fridge = (
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 3, cols: 4 }, 201)
  ).body as { id: string };
  for (const wine of [
    { producer: "Château Margaux", name: "Pavillon Rouge", region: "Bordeaux", year: 2015 },
    { producer: "Antinori", name: "Tignanello", region: "Tuscany", year: 2018 },
  ]) {
    const { year, ...rest } = wine;
    const w = (await call("post", "/wines", { ...rest, type: "red", countryCode: "FR" }, 201))
      .body as { id: string };
    await call("post", "/bottles", { wineId: w.id, year, quantity: 2, locationId: fridge.id }, 201);
  }
  const cellar = (
    await call<{ items: Array<{ vintageId: string; wineName: string }> }>("get", "/cellar")
  ).body;
  return Object.fromEntries(cellar.items.map((i) => [i.wineName, i.vintageId])) as Record<
    string,
    string
  >;
}

const refOf = (vintageId: string) => vintageId.replace(/-/g, "").slice(0, 6);
const marker = () =>
  `[${test.info().parallelIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}]`;

async function program(
  match: string,
  plan: { content?: unknown; status?: number; delayMs?: number },
) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ match, ...plan }),
  });
  expect(res.ok).toBe(true);
}
/** The model calls whose newest question carries the marker (the chat so far carries older ones along). */
const callsFor = async (match: string) =>
  (
    (await (
      await fetch(`${STACK}/__test/openai/calls?match=${encodeURIComponent(match)}`)
    ).json()) as {
      calls: Array<{ user: string }>;
    }
  ).calls.filter((c) => (c.user.split("Question: ").pop() ?? "").includes(match));

const ask = async (page: Page, text: string) => {
  await page.getByLabel("Your question").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
};
const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Main" })
    .filter({ visible: true })
    .getByRole("link", { name });
const userId = async (email: string) =>
  (await sql<{ id: string }>("select id from auth.users where email = $1", [email]))[0]!.id;
const kept = async (email: string) =>
  sql<{ conversation_id: string; role: string; content: string | null }>(
    `select m.conversation_id, m.role, m.content from public.sommelier_messages m
      where m.user_id = $1 order by m.seq`,
    [await userId(email)],
  );

test.describe("the sommelier remembers", () => {
  test("the conversation stays after a wine page, other screens, a reload and a fresh start, and goes along with the next question", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "memkeep");
    const ids = await furnish((await apiClient(request, email)).call);
    const m = marker();
    await program(m, {
      content: {
        answer: "Open the Pavillon Rouge tonight.",
        bottle_refs: [refOf(ids["Pavillon Rouge"]!)],
      },
    });

    await page.goto("/sommelier");
    await ask(page, `What should I open? ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByText("Open the Pavillon Rouge tonight.")).toBeVisible();

    // To the wine, and back with the app's own navigation: the same words, the same card, nothing doubled.
    await log
      .getByRole("link", { name: /Pavillon Rouge/ })
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Pavillon Rouge" })).toBeVisible();
    await nav(page, "Sommelier").click();
    await expect(log.getByText("Open the Pavillon Rouge tonight.")).toBeVisible();
    // and back again with the browser's own back button, a few times over
    for (let i = 0; i < 3; i++) {
      await nav(page, "Home").click();
      await expect(page).toHaveURL(/\/$/);
      await page.goBack();
      await expect(log.getByText("Open the Pavillon Rouge tonight.")).toBeVisible();
    }
    await expect(log.getByText(`What should I open? ${m}`)).toHaveCount(1);
    await expect(log.getByText("Open the Pavillon Rouge tonight.")).toHaveCount(1);
    await expect(log.getByRole("article")).toHaveCount(1);
    // The chips made way for the conversation and do not come back on their own.
    await expect(page.getByTestId("example-questions")).toHaveCount(0);

    // A reload, and a fresh start of the app (a new tab: nothing in memory, only the session), show it again.
    await page.reload();
    await expect(log.getByText("Open the Pavillon Rouge tonight.")).toBeVisible();
    const fresh = await page.context().newPage();
    await fresh.goto("/sommelier");
    const freshLog = fresh.getByRole("log", { name: "Conversation" });
    await expect(freshLog.getByText(`What should I open? ${m}`)).toBeVisible();
    await expect(freshLog.getByRole("link", { name: /Pavillon Rouge/ }).first()).toBeVisible();
    await fresh.screenshot({ path: shot(`sommelier-kept-${project()}`), fullPage: true });

    // Coming back never asked the model again.
    expect(await callsFor(m)).toHaveLength(1);

    // The next question carries the conversation that was brought back.
    const m2 = marker();
    await program(m2, { content: { answer: "Then the Tignanello.", bottle_refs: [] } });
    await ask(fresh, `And after that? ${m2}`);
    await expect(freshLog.getByText("Then the Tignanello.")).toBeVisible();
    const [second] = await callsFor(m2);
    expect(second!.user).toContain(`Person: What should I open? ${m}`);
    expect(second!.user).toContain("Sommelier: Open the Pavillon Rouge tonight.");

    // Kept once each, in one conversation.
    const rows = await kept(email);
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(new Set(rows.map((r) => r.conversation_id)).size).toBe(1);
    await fresh.close();
  });

  test("a question still on its way when you leave is answered once, and is there when you come back", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "memwait");
    await furnish((await apiClient(request, email)).call);
    const m = marker();
    await program(m, { content: { answer: "Worth the wait.", bottle_refs: [] }, delayMs: 2500 });
    await page.goto("/sommelier");
    await ask(page, `Take your time ${m}`);
    await nav(page, "Home").click();
    await expect(page).toHaveURL(/\/$/);
    await nav(page, "Sommelier").click();
    const log = page.getByRole("log", { name: "Conversation" });
    // Still asking: the question is there, the sommelier is thinking, and it cannot be asked twice meanwhile.
    await expect(log.getByText(`Take your time ${m}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "New conversation" })).toBeDisabled();
    await expect(log.getByText("Worth the wait.")).toBeVisible({ timeout: 15_000 });
    await expect(log.getByText(`Take your time ${m}`)).toHaveCount(1);
    expect(await callsFor(m)).toHaveLength(1);
    await page.reload();
    await expect(log.getByText("Worth the wait.")).toHaveCount(1);
    expect((await kept(email)).length).toBe(2);
  });

  test("a new conversation starts clean, and the old words are never sent to the model again", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "memnew");
    await furnish((await apiClient(request, email)).call);
    const m = marker();
    await program(m, { content: { answer: "The first answer.", bottle_refs: [] } });
    await page.goto("/sommelier");
    await ask(page, `First question ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByText("The first answer.")).toBeVisible();
    const before = (await kept(email))[0]!.conversation_id;

    await page.getByRole("button", { name: "New conversation" }).click();
    await expect(page.getByTestId("example-questions")).toBeVisible();
    await expect(log.getByRole("listitem")).toHaveCount(0);
    // It is gone on the server too: a reload does not bring it back.
    await page.reload();
    await expect(page.getByTestId("example-questions")).toBeVisible();
    await expect(log.getByText("The first answer.")).toHaveCount(0);
    expect(await kept(email)).toEqual([]);

    const m2 = marker();
    await program(m2, { content: { answer: "A fresh start.", bottle_refs: [] } });
    await ask(page, `Second question ${m2}`);
    await expect(log.getByText("A fresh start.")).toBeVisible();
    const [call] = await callsFor(m2);
    expect(call!.user).not.toContain("First question");
    expect(call!.user).not.toContain("The first answer.");
    const rows = await kept(email);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.conversation_id).not.toBe(before);
  });

  test("after 7 quiet days the old conversation is not continued", async ({ page, request }) => {
    const { email } = await arrive(page, "memexp");
    await furnish((await apiClient(request, email)).call);
    const m = marker();
    await program(m, { content: { answer: "Long ago.", bottle_refs: [] } });
    await page.goto("/sommelier");
    await ask(page, `Old question ${m}`);
    await expect(page.getByText("Long ago.")).toBeVisible();
    const old = (await kept(email))[0]!.conversation_id;

    await sql(
      "update public.sommelier_conversations set last_activity_at = now() - interval '7 days 5 minutes' where id = $1",
      [old],
    );
    await page.reload();
    await expect(page.getByTestId("example-questions")).toBeVisible();
    await expect(page.getByText("Long ago.")).toHaveCount(0);

    const m2 = marker();
    await program(m2, { content: { answer: "Today.", bottle_refs: [] } });
    await ask(page, `New question ${m2}`);
    await expect(page.getByText("Today.")).toBeVisible();
    expect((await callsFor(m2))[0]!.user).not.toContain("Old question");
    // The expired one was deleted when the next question began a new one.
    const rows = await kept(email);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.conversation_id).not.toBe(old);
  });

  test("the API: a question sent twice is answered once, and nobody else sees, rates or clears your conversation", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "memown");
    await furnish((await apiClient(request, owner.email)).call);
    const token = await sessionToken(owner.email);
    const m = marker();
    await program(m, { content: { answer: "Only once.", bottle_refs: [] } });
    const questionId = crypto.randomUUID();
    const body = { messages: [{ role: "user", text: `Twice? ${m}` }], questionId };
    const first = await (await api(request, token, "post", "/sommelier", body)).json();
    const again = await (await api(request, token, "post", "/sommelier", body)).json();
    expect(first.saved.messageId).toEqual(expect.any(String));
    expect(again).toMatchObject({ text: "Only once.", saved: first.saved });
    expect(await callsFor(m)).toHaveLength(1);
    expect(await kept(owner.email)).toHaveLength(2);
    expect(
      (await api(request, token, "post", "/sommelier", { ...body, questionId: "nope" })).status(),
    ).toBe(422);

    const view = await (await api(request, token, "get", "/sommelier/conversation")).json();
    expect(view.conversation.messages.map((x: { role: string }) => x.role)).toEqual([
      "user",
      "assistant",
    ]);

    // Someone else, in a household of their own.
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const other = await arrive(await context.newPage(), "memoth");
    const theirs = await sessionToken(other.email);
    expect(await (await api(request, theirs, "get", "/sommelier/conversation")).json()).toEqual({
      conversation: null,
    });
    const rate = (t: string, rating: string | null) =>
      api(request, t, "put", "/sommelier/feedback", { messageId: first.saved.messageId, rating });
    expect((await rate(theirs, "negative")).status()).toBe(404);
    expect((await api(request, theirs, "delete", "/sommelier/conversation")).status()).toBe(204);
    expect(await kept(owner.email)).toHaveLength(2);
    // Sending the owner's question id brings back nothing of theirs (they get their own, unkept, answer).
    const m2 = marker();
    await program(m2, { content: { answer: "Your own answer.", bottle_refs: [] } });
    const stolen = await (
      await api(request, theirs, "post", "/sommelier", {
        messages: [{ role: "user", text: `Theirs? ${m2}` }],
        questionId,
      })
    ).json();
    expect(stolen.text).not.toBe("Only once.");
    expect(stolen.saved ?? null).toBeNull();
    expect(await kept(owner.email)).toHaveLength(2);

    // Ratings: the owner's own, checked; a nonsense rating is refused.
    expect((await rate(token, "positive")).status()).toBe(200);
    expect((await rate(token, "meh")).status()).toBe(422);
    expect(
      (
        await api(request, token, "put", "/sommelier/feedback", {
          messageId: questionId,
          rating: "positive",
        })
      ).status(),
    ).toBe(404);
    await context.close();
  });
});

test.describe("rating an answer", () => {
  test("two quiet thumbs under each answer: chosen, changed, taken back, kept after a reload, one record each", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "memrate");
    await furnish((await apiClient(request, email)).call);
    const [m1, m2] = [marker(), marker()];
    await program(m1, { content: { answer: "First, the Margaux.", bottle_refs: [] } });
    await program(m2, { content: { answer: "Then the Tignanello.", bottle_refs: [] } });
    await page.goto("/sommelier");
    await ask(page, `What goes with lamb? ${m1}`);
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByText("First, the Margaux.")).toBeVisible();
    await ask(page, `And after? ${m2}`);
    await expect(log.getByText("Then the Tignanello.")).toBeVisible();

    // One pair per answer, none for the questions.
    const groups = log.getByRole("group", { name: "Was this answer useful?" });
    await expect(groups).toHaveCount(2);
    const [one, two] = [groups.nth(0), groups.nth(1)];
    const up = (g: typeof one) => g.getByRole("button", { name: "Useful", exact: true });
    const down = (g: typeof one) => g.getByRole("button", { name: "Not useful" });
    await expect(up(one)).toHaveAttribute("aria-pressed", "false");
    await expect(down(one)).toHaveAttribute("aria-pressed", "false");

    const feedback = async () =>
      sql<{ rating: string; model: string | null; question_kind: string; answer_source: string }>(
        "select rating, model, question_kind, answer_source from public.sommelier_feedback where user_id = $1 order by created_at",
        [await userId(email)],
      );
    // Every rating request the screen sends, until its answer is back: "settled" is when none is on its way.
    let open = 0;
    const isRating = (url: string) => url.endsWith("/api/v1/sommelier/feedback");
    page.on("request", (r) => void (isRating(r.url()) && open++));
    page.on("requestfinished", (r) => void (isRating(r.url()) && open--));
    page.on("requestfailed", (r) => void (isRating(r.url()) && open--));
    const settled = () => expect.poll(() => open).toBe(0);

    await up(one).click();
    await expect(up(one)).toHaveAttribute("aria-pressed", "true");
    await settled();
    expect(await feedback()).toEqual([
      { rating: "positive", model: "gpt-6-luna", question_kind: "pairing", answer_source: "ai" },
    ]);

    await down(one).click();
    await expect(down(one)).toHaveAttribute("aria-pressed", "true");
    await expect(up(one)).toHaveAttribute("aria-pressed", "false");
    await settled();
    expect((await feedback()).map((f) => f.rating)).toEqual(["negative"]);

    // The second answer on its own; tapping fast (on, off, on) lands on the last tap, with one record.
    await up(two).click();
    await up(two).click();
    await up(two).click();
    await expect(up(two)).toHaveAttribute("aria-pressed", "true");
    await settled();
    expect((await feedback()).map((f) => f.rating)).toEqual(["negative", "positive"]);

    // Taking a rating back.
    await down(one).click();
    await expect(down(one)).toHaveAttribute("aria-pressed", "false");
    await settled();
    expect((await feedback()).map((f) => f.rating)).toEqual(["positive"]);
    await page.screenshot({ path: shot(`sommelier-rated-${project()}`), fullPage: true });

    // After a reload the choices are as they were left.
    await page.reload();
    await expect(groups).toHaveCount(2);
    await expect(up(one)).toHaveAttribute("aria-pressed", "false");
    await expect(down(one)).toHaveAttribute("aria-pressed", "false");
    await expect(up(two)).toHaveAttribute("aria-pressed", "true");
    expect(await audit(page)).toEqual([]);
  });
});

test.describe("my taste profile", () => {
  test("is a button of its own beside 'Use my taste', with a full touch area, and still opens the profile", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "memtaste");
    await furnish((await apiClient(request, email)).call);
    await page.goto("/sommelier");
    const profile = page.getByRole("link", { name: "My taste profile" });
    const taste = page.getByTestId("use-taste");
    await expect(profile).toHaveAttribute("href", "/taste-profile");
    await expect(taste).toHaveAttribute("aria-pressed", "true");

    // It looks like a button: a filled pill, not a line of text.
    const look = await profile.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        bg: s.backgroundColor,
        radius: parseFloat(s.borderRadius),
        height: el.getBoundingClientRect().height,
      };
    });
    expect(look.bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(look.radius).toBeGreaterThan(10);
    expect(look.height).toBeGreaterThanOrEqual(36);
    // Its touch area reaches 44px high: just above and below the pill is still the link.
    const box = (await profile.boundingBox())!;
    for (const y of [box.y - 3, box.y + box.height + 3]) {
      const hit = await page.evaluate(
        ([x, yy]) => document.elementFromPoint(x!, yy!)?.closest("a")?.getAttribute("href") ?? null,
        [box.x + box.width / 2, y] as const,
      );
      expect(hit).toBe("/taste-profile");
    }
    // The taste toggle still is the main action, and still works.
    await taste.click();
    await expect(taste).toHaveAttribute("aria-pressed", "false");
    await taste.click();
    await expect(taste).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: shot(`sommelier-taste-buttons-${project()}`) });

    await profile.click();
    await expect(page).toHaveURL(/\/taste-profile$/);
  });
});
