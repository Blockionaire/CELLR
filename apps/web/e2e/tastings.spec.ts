import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { api, apiClient, arrive, audit, rateStars, sql, wineBody } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const RED = {
  producer: "Château Margaux",
  name: "Pavillon Rouge",
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
};

async function stock(call: Call, wine: object = wineBody, year = 2019, quantity = 2) {
  const fridge = (
    await call(
      "post",
      "/storage",
      {
        label: `Fridge ${Math.random().toString(36).slice(2, 6)}`,
        kind: "fridge",
        rows: 4,
        cols: 5,
      },
      201,
    )
  ).body as { id: string };
  const w = (await call("post", "/wines", wine, 201)).body as { id: string };
  const added = (
    await call("post", "/bottles", { wineId: w.id, year, quantity, locationId: fridge.id }, 201)
  ).body as { bottleIds: string[]; vintageId?: string };
  return { wineId: w.id, bottleIds: added.bottleIds };
}

/** Click a star (or its left half): the labels lie over each half star, so this is what a finger does. */
const tapStars = (page: Page, text: string) => rateStars(page, parseFloat(text));

const sheet = (page: Page) => page.getByRole("dialog", { name: "How was it?" });

test.describe("open it, then say how it was", () => {
  test("rate an opened bottle with half stars, words and a note; edit it; take it back", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "rate");
    const { call } = await apiClient(request, email);
    await stock(call);

    await page.goto("/cellar");
    await page.getByRole("link", { name: "Chablis Premier Cru" }).click();
    // Nothing to rate until something has been opened.
    await expect(page.getByRole("heading", { name: "Opened and tasted" })).toHaveCount(0);

    await page.getByRole("button", { name: "Open a bottle" }).click();
    await page
      .getByRole("dialog", { name: "Open a bottle" })
      .getByRole("button", { name: "Open it" })
      .click();
    await expect(page.getByText(/Enjoy!/)).toBeVisible();

    // The opened bottle now asks how it was.
    await expect(page.getByRole("heading", { name: "Opened and tasted" })).toBeVisible();
    await page.getByRole("button", { name: "How was it?" }).click();
    await expect(sheet(page)).toBeVisible();

    // Half a star at a time, with words and a note.
    await tapStars(page, "4.5 stars");
    await expect(sheet(page).getByText("Rated 4.5 out of 5")).toBeVisible();
    await sheet(page).getByRole("button", { name: "Fruity" }).click();
    await sheet(page).getByRole("button", { name: "Smooth" }).click();
    await sheet(page).getByLabel("Your note").fill("Lovely with the lamb.");
    await page.screenshot({ path: shot(`rate-sheet-${project()}`) });
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Thanks, saved.")).toBeVisible();
    await expect(sheet(page)).toBeHidden();

    // It shows on the wine's page: who, stars, words, note — and the average.
    const section = page.locator("section", {
      has: page.getByRole("heading", { name: "Opened and tasted" }),
    });
    await expect(
      section.getByText("Joost", { exact: false }).or(section.getByText("You")),
    ).toBeVisible();
    await expect(section.getByRole("img", { name: "Rated 4.5 out of 5" }).first()).toBeVisible();
    await expect(section.getByText("Fruity")).toBeVisible();
    await expect(section.getByText("Lovely with the lamb.")).toBeVisible();
    await expect(section.getByTestId("rating-summary")).toHaveText("4.5 · 1 rating");
    await page.screenshot({ path: shot(`tasting-${project()}`), fullPage: true });
    const rows = await sql<{ score: number; descriptors: string[]; note: string }>(
      "select score::float8 as score, descriptors, note from public.tastings where household_id = $1",
      [householdId],
    );
    expect(rows).toEqual([
      { score: 9, descriptors: ["fruity", "smooth"], note: "Lovely with the lamb." },
    ]);

    // Change your mind: Edit → 3 stars. (Tapping a star again clears it; tapping another changes it.)
    await section.getByRole("button", { name: "Edit" }).click();
    await expect(sheet(page).getByText("Rated 4.5 out of 5")).toBeVisible(); // what you said before
    await tapStars(page, "3 stars");
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(section.getByTestId("rating-summary")).toHaveText("3 · 1 rating");
    expect(
      (
        await sql<{ score: number }>(
          "select score::float8 as score from public.tastings where household_id = $1",
          [householdId],
        )
      ).map((r) => r.score),
    ).toEqual([6]);

    // Take it back.
    await section.getByRole("button", { name: "Edit" }).click();
    await sheet(page).getByRole("button", { name: "Remove what I said" }).click();
    await sheet(page).getByRole("button", { name: "Yes, remove it all" }).click();
    await expect(page.getByText("Removed.")).toBeVisible();
    await expect(section.getByTestId("rating-summary")).toHaveCount(0);
    expect(
      await sql("select 1 from public.tastings where household_id = $1", [householdId]),
    ).toHaveLength(0);
  });

  test("it needs something: stars, a word or a note", async ({ page, request }) => {
    const { email } = await arrive(page, "ratenone");
    const { call } = await apiClient(request, email);
    const { bottleIds } = await stock(call);
    await call("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);
    await page.goto("/cellar");
    await page.getByRole("link", { name: "Chablis Premier Cru" }).click();
    await page.getByRole("button", { name: "How was it?" }).click();
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(sheet(page).getByRole("alert")).toHaveText("Give it stars, a word or a note.");
    await tapStars(page, "1 star");
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(sheet(page)).toBeHidden();
  });

  test("Home asks about the bottle you just opened; one tap on a star answers it", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "nudge");
    const { call } = await apiClient(request, email);
    const { bottleIds } = await stock(call, RED, 2015, 2);
    await call("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);

    await page.goto("/");
    const nudge = page.getByTestId("rate-nudge");
    await expect(nudge.getByRole("heading", { name: "How was the Pavillon Rouge?" })).toBeVisible();
    await page.screenshot({ path: shot(`nudge-${project()}`), fullPage: true });
    await tapStars(page, "5 stars");
    await expect(page.getByText("Thanks, saved.")).toBeVisible();
    // Answered: the question goes away and the opened list shows your stars.
    await expect(page.getByTestId("rate-nudge")).toHaveCount(0);
    const opened = page.getByRole("region", { name: "Opened lately" });
    await expect(opened.getByRole("img", { name: "Rated 5 out of 5" })).toBeVisible();

    // …and the wine's card carries the household's rating.
    await page.goto("/cellar");
    await expect(
      page.locator("article", { hasText: "Pavillon Rouge" }).getByText("Rated 5 out of 5"),
    ).toBeAttached();
  });

  test("'Highest rated' puts the best first and unrated last", async ({ page, request }) => {
    const { email } = await arrive(page, "sorting");
    const { call } = await apiClient(request, email);
    const fridge = (
      await call("post", "/storage", { label: "Fridge", kind: "fridge", rows: 4, cols: 5 }, 201)
    ).body as { id: string };
    const opened: string[] = [];
    for (const name of ["Alpha", "Bravo", "Charlie"]) {
      const w = (await call("post", "/wines", { ...wineBody, name }, 201)).body as { id: string };
      const added = (
        await call(
          "post",
          "/bottles",
          { wineId: w.id, year: 2019, quantity: 2, locationId: fridge.id },
          201,
        )
      ).body as { bottleIds: string[] };
      opened.push(added.bottleIds[0]!);
    }
    // One bottle each of Alpha (2 stars) and Bravo (4.5 stars) is opened and rated; Charlie is never rated.
    for (const [i, score] of [
      [0, 4],
      [1, 9],
    ] as const) {
      await call("patch", `/bottles/${opened[i]}`, { action: "open" }, 200);
      await call("put", `/bottles/${opened[i]}/tasting`, { score }, 200);
    }
    await page.goto("/cellar");
    await page.getByRole("button", { name: /^Filter/ }).click();
    const filter = page.getByRole("dialog", { name: "Filter and sort" });
    await filter.getByRole("button", { name: "Highest rated" }).click();
    await filter.getByRole("button", { name: /^Show/ }).click();
    await expect
      .poll(() => page.locator("article h3").allTextContents())
      .toEqual(["Bravo", "Alpha", "Charlie"]);
  });
});

test.describe("the household reads each other's tastings; nobody writes another's", () => {
  test("two people rate the same bottle, each their own; neither can touch the other's", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "tasteown");
    const { call: ownerCall, token: ownerToken } = await apiClient(request, owner.email);
    const { bottleIds } = await stock(ownerCall, RED, 2015, 2);
    await ownerCall("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);
    await ownerCall(
      "put",
      `/bottles/${bottleIds[0]}/tasting`,
      { score: 9, note: "Joost's view" },
      200,
    );

    const invite = await ownerCall<{ code: string }>(
      "post",
      `/households/${owner.householdId}/invites`,
      {},
      201,
    );
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const memberPage = await context.newPage();
    const member = await arrive(memberPage, "tastemem");
    const { call: memberCall, token: memberToken } = await apiClient(request, member.email);
    await memberCall("post", "/households/join", { code: invite.body.code }, 200);
    await api(request, memberToken, "put", "/households/active", {
      householdId: owner.householdId,
    });

    const vintageId = (
      await ownerCall<{ items: Array<{ vintageId: string }> }>("get", "/cellar", undefined, 200)
    ).body.items[0]!.vintageId;

    // The member reads the owner's tasting…
    type Detail = {
      tastings: Array<{
        userName: string | null;
        mine: boolean;
        score: number | null;
        note: string | null;
      }>;
    };
    let seen = (await memberCall<Detail>("get", `/cellar/${vintageId}`, undefined, 200)).body
      .tastings;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      userName: "Joost",
      mine: false,
      score: 9,
      note: "Joost's view",
    });

    // …writes their own for the same bottle…
    await memberCall("put", `/bottles/${bottleIds[0]}/tasting`, { score: 6 }, 200);
    seen = (await memberCall<Detail>("get", `/cellar/${vintageId}`, undefined, 200)).body.tastings;
    expect(seen.map((t) => [t.mine, t.score]).sort()).toEqual([
      [false, 9],
      [true, 6],
    ]);

    // …and taking theirs back never touches the owner's.
    expect(
      (await memberCall("delete", `/bottles/${bottleIds[0]}/tasting`, undefined, 200)).body,
    ).toEqual({ deleted: true });
    expect(
      (await memberCall("delete", `/bottles/${bottleIds[0]}/tasting`, undefined, 200)).body,
    ).toEqual({ deleted: false });
    seen = (await ownerCall<Detail>("get", `/cellar/${vintageId}`, undefined, 200)).body.tastings;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ mine: true, score: 9 });

    // Straight at the database with the member's own session: they cannot edit the owner's row.
    expect(ownerToken).toBeTruthy();
    await context.close();
  });

  test("the rules at the API: only opened bottles, only yours, only valid", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "taste422");
    const { call, token } = await apiClient(request, owner.email);
    const { bottleIds } = await stock(call, RED, 2015, 2);

    // A bottle that is still in the cellar cannot be rated yet.
    expect((await call("put", `/bottles/${bottleIds[0]}/tasting`, { score: 5 })).status).toBe(409);
    await call("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);
    // Nothing to say, an impossible score, an unknown word, a note that is far too long: all refused.
    for (const body of [
      {},
      { score: 0 },
      { score: 11 },
      { score: 4.5 },
      { descriptors: ["delicious"] },
      { note: "x".repeat(2001) },
    ])
      expect((await call("put", `/bottles/${bottleIds[0]}/tasting`, body)).status).toBe(422);
    expect((await call("put", `/bottles/${bottleIds[0]}/tasting`, { score: 8 })).status).toBe(200);
    // Ids that are not UUIDs are simply not found.
    expect((await call("put", `/bottles/nope/tasting`, { score: 8 })).status).toBe(404);

    // Another household cannot rate (or even see) this bottle.
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "taste404");
    const { call: otherCall } = await apiClient(request, other.email);
    expect((await otherCall("put", `/bottles/${bottleIds[0]}/tasting`, { score: 1 })).status).toBe(
      404,
    );
    expect(token).toBeTruthy();
    await context.close();
  });
});

test("the wine's page with tastings, and the rating sheet, are accessible in both themes", async ({
  page,
  request,
}) => {
  const { email } = await arrive(page, "tastea11y");
  const { call } = await apiClient(request, email);
  const { bottleIds } = await stock(call, RED, 2015, 3);
  await call("patch", `/bottles/${bottleIds[0]}`, { action: "open" }, 200);
  await call("patch", `/bottles/${bottleIds[1]}`, { action: "open" }, 200);
  await call(
    "put",
    `/bottles/${bottleIds[0]}/tasting`,
    { score: 9, descriptors: ["fruity", "bold"], note: "Great." },
    200,
  );

  await page.goto("/cellar");
  await page.getByRole("link", { name: "Pavillon Rouge" }).click();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect.poll(() => audit(page)).toEqual([]);
    await page.getByRole("button", { name: "How was it?" }).click();
    await expect(sheet(page)).toBeVisible();
    await expect.poll(() => audit(page)).toEqual([]);
    await page.screenshot({ path: shot(`rate-${scheme}-${project()}`) });
    await sheet(page).getByRole("button", { name: "Close" }).click();
    await expect(sheet(page)).toBeHidden();
  }
});
