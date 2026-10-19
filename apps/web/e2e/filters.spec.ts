import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { api, apiClient, arrive, audit, sessionToken, wineBody } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const WINES = [
  { wine: wineBody, year: 2019, quantity: 3 }, // Domaine Test · Chablis Premier Cru, white, France
  {
    wine: {
      producer: "Château Margaux",
      name: "Pavillon Rouge",
      type: "red",
      countryCode: "FR",
      region: "Bordeaux",
    },
    year: 2015,
    quantity: 2,
  },
  {
    wine: {
      producer: "Bollinger",
      name: "Special Cuvée",
      type: "sparkling",
      countryCode: "FR",
      region: "Champagne",
    },
    year: null,
    quantity: 1,
  },
  {
    wine: {
      producer: "Marqués de Riscal",
      name: "Reserva",
      type: "red",
      countryCode: "ES",
      region: "Rioja",
    },
    year: 2008,
    quantity: 1,
  },
  {
    wine: {
      producer: "Antinori",
      name: "Tignanello",
      type: "red",
      countryCode: "IT",
      region: "Tuscany",
    },
    year: 2018,
    quantity: 1,
  },
];

async function furnish(call: Call) {
  const fridge = (
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 5, cols: 4 }, 201)
  ).body as { id: string };
  const rack = (
    await call("post", "/storage", { label: "Cellar rack", kind: "rack", rows: 3, cols: 3 }, 201)
  ).body as { id: string };
  const ids: string[] = [];
  for (const [i, { wine, year, quantity }] of WINES.entries()) {
    const w = (await call("post", "/wines", wine, 201)).body as { id: string };
    ids.push(w.id);
    // The Spanish and Italian wines live in the rack, the rest in the fridge.
    await call(
      "post",
      "/bottles",
      { wineId: w.id, year, quantity, locationId: i >= 3 ? rack.id : fridge.id },
      201,
    );
  }
  return ids;
}

const cardTitles = (page: Page) => page.locator("article h3").allTextContents();

const openFilters = async (page: Page) => {
  await page.getByRole("button", { name: /^Filter/ }).click();
  return page.getByRole("dialog", { name: "Filter and sort" });
};

test.describe("favourites", () => {
  test("star a wine: it stays starred, and 'only my favourites' shows just those", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "fav");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/cellar");
    await expect(page.locator("article")).toHaveCount(5);

    const heart = page.getByRole("button", { name: "Favourite: Château Margaux Pavillon Rouge" });
    await expect(heart).toHaveAttribute("aria-pressed", "false");
    await heart.click();
    // The heart answers at once; the message follows.
    await expect(heart).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Added to your favourites.")).toBeVisible();
    await page.screenshot({ path: shot(`favourite-${project()}`), fullPage: true });

    // It is stored on the server, not just in this page.
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Favourite: Château Margaux Pavillon Rouge" }),
    ).toHaveAttribute("aria-pressed", "true");

    const sheet = await openFilters(page);
    await sheet.getByRole("button", { name: "Only my favourites" }).click();
    await expect(sheet.getByRole("button", { name: "Show 1 wine" })).toBeVisible();
    await sheet.getByRole("button", { name: "Show 1 wine" }).click();
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article h3")).toHaveText("Pavillon Rouge");

    // Un-star it from the page of the wine itself.
    await page.getByRole("link", { name: "Pavillon Rouge" }).click();
    // Wait until the wine's own page is there (the heart on the card has the same name).
    await expect(page.getByRole("heading", { name: "Pavillon Rouge", level: 1 })).toBeVisible();
    const wineHeart = page.getByRole("button", {
      name: "Favourite: Château Margaux Pavillon Rouge",
    });
    await expect(wineHeart).toHaveAttribute("aria-pressed", "true");
    await wineHeart.click();
    await expect(wineHeart).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Removed from your favourites.")).toBeVisible();
  });

  test("in the list, swiping a row to the right stars it, and a plain tap still opens the wine", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "swipe");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "List" }).click();
    const heart = page.getByRole("button", { name: "Favourite: Château Margaux Pavillon Rouge" });
    await expect(heart).toHaveAttribute("aria-pressed", "false");

    const row = page.locator("article", { has: heart });
    // in the middle of the screen: clear of the tab bar, which a touch near the bottom would hit
    await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = (await row.boundingBox())!;
    const y = box.y + box.height / 2;
    // A real finger: touch events through the browser's own protocol.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    await touch("touchStart", box.x + 40);
    for (let dx = 10; dx <= 190; dx += 20) await touch("touchMove", box.x + 40 + dx);
    await touch("touchEnd", 0);
    await expect(heart).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Added to your favourites.")).toBeVisible();
    // the swipe did not open the wine
    await expect(page).toHaveURL(/\/cellar$/);

    await page.getByRole("link", { name: "Pavillon Rouge" }).click();
    await expect(page.getByRole("heading", { name: "Pavillon Rouge", level: 1 })).toBeVisible();
  });

  test("a heart is personal, and you cannot star a wine you cannot see", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "favown");
    const { call } = await apiClient(request, owner.email);
    const [wineId] = await furnish(call);

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "favoth");
    const token = await sessionToken(other.email);

    // Someone else's private wine is "not found" (no hint that it exists)…
    const attempt = await api(request, token, "put", `/wines/${wineId}/favorite`, {
      favorite: true,
    });
    expect(attempt.status()).toBe(404);
    // …and a malformed request is refused before it reaches anything (validation error).
    expect(
      (await api(request, token, "put", `/wines/${wineId}/favorite`, { favorite: "yes" })).status(),
    ).toBe(422);
    expect(
      (await api(request, token, "put", `/wines/not-an-id/favorite`, { favorite: true })).status(),
    ).toBe(404); // a path id that is not a UUID is simply "not found"

    // The owner's own star works, and is theirs alone.
    const mine = await api(
      request,
      await sessionToken(owner.email),
      "put",
      `/wines/${wineId}/favorite`,
      { favorite: true },
    );
    expect(mine.status()).toBe(200);
    expect(await mine.json()).toEqual({ wineId, favorite: true });
    const theirView = (await (await api(request, token, "get", "/cellar")).json()) as {
      items: Array<{ favorite: boolean }>;
    };
    expect(theirView.items.every((i) => !i.favorite)).toBe(true);
    await context.close();
  });
});

test.describe("filter and sort", () => {
  test("narrow by type, country and vintage; every choice is a chip you can remove", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "filt");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/cellar");
    await expect(page.locator("article")).toHaveCount(5);

    const sheet = await openFilters(page);
    await page.screenshot({ path: shot(`filters-${project()}`) });
    // The choices come from what is actually in the cellar, with how many each would show.
    await expect(sheet.getByRole("button", { name: "Red 3", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "France 3", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Non-vintage 1", exact: true })).toBeVisible();

    await sheet.getByRole("button", { name: "Red 3", exact: true }).click();
    await expect(sheet.getByRole("button", { name: "Show 3 wines" })).toBeVisible();
    await sheet.getByRole("button", { name: "France 3", exact: true }).click();
    // Red AND France: one wine.
    await expect(sheet.getByRole("button", { name: "Show 1 wine" })).toBeVisible();
    await sheet.getByRole("button", { name: "Show 1 wine" }).click();
    await expect(page.locator("article h3")).toHaveText("Pavillon Rouge");

    const chips = page.getByRole("list", { name: "Active filters" });
    await expect(chips.getByRole("button", { name: "Remove filter: Red" })).toBeVisible();
    await expect(chips.getByRole("button", { name: "Remove filter: France" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Filter and sort, 2 active" })).toBeVisible();

    await chips.getByRole("button", { name: "Remove filter: Red" }).click();
    await expect
      .poll(async () => (await cardTitles(page)).sort())
      .toEqual(["Chablis Premier Cru", "Pavillon Rouge", "Special Cuvée"].sort());

    // Within one group any choice matches: white or sparkling, in France.
    const again = await openFilters(page);
    await again.getByRole("button", { name: "Non-vintage 1", exact: true }).click();
    await again.getByRole("button", { name: "Show 1 wine" }).click();
    await expect(page.locator("article h3")).toHaveText("Special Cuvée");
  });

  test("sorting reorders without losing anything, and places filter too", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "sort");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/cellar");

    const sheet = await openFilters(page);
    await sheet.getByRole("button", { name: "Wine name" }).click();
    await sheet.getByRole("button", { name: /^Show 5 wines/ }).click();
    await expect
      .poll(() => cardTitles(page))
      .toEqual(["Chablis Premier Cru", "Pavillon Rouge", "Reserva", "Special Cuvée", "Tignanello"]);

    const second = await openFilters(page);
    await second.getByRole("button", { name: "Vintage, newest" }).click();
    await second.getByRole("button", { name: /^Show 5 wines/ }).click();
    // Newest first, non-vintage last.
    await expect
      .poll(() => cardTitles(page))
      .toEqual(["Chablis Premier Cru", "Tignanello", "Pavillon Rouge", "Reserva", "Special Cuvée"]);

    const third = await openFilters(page);
    await third.getByRole("button", { name: "Cellar rack 2", exact: true }).click();
    await third.getByRole("button", { name: /^Show 2 wines/ }).click();
    await expect
      .poll(async () => (await cardTitles(page)).sort())
      .toEqual(["Reserva", "Tignanello"]);
  });

  test("nothing matches: say so, and one tap clears it", async ({ page, request }) => {
    const { email } = await arrive(page, "nomatch");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/cellar");

    const sheet = await openFilters(page);
    await sheet.getByRole("button", { name: "Red 3", exact: true }).click();
    await sheet.getByRole("button", { name: "Non-vintage 1", exact: true }).click();
    await expect(sheet.getByRole("button", { name: "Nothing matches" })).toBeVisible();
    await sheet.getByRole("button", { name: "Nothing matches" }).click();
    await expect(page.getByText("No bottles match.")).toBeVisible();
    await page.getByRole("button", { name: "Clear search and filters" }).click();
    await expect(page.locator("article")).toHaveCount(5);
  });

  test("going into a wine and back finds the list as you left it", async ({ page, request }) => {
    const { email } = await arrive(page, "memory");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/cellar");

    const sheet = await openFilters(page);
    await sheet.getByRole("button", { name: "Red 3", exact: true }).click();
    await sheet.getByRole("button", { name: /^Show 3 wines/ }).click();
    await expect(page.locator("article")).toHaveCount(3);

    await page.getByRole("link", { name: "Reserva" }).click();
    await expect(page.getByRole("heading", { name: "Reserva" })).toBeVisible();
    await page.getByRole("link", { name: "Cellar", exact: true }).first().click();
    await expect(page.locator("article")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Remove filter: Red" })).toBeVisible();
  });

  test("the cellar with filters is accessible in both themes", async ({ page, request }) => {
    const { email } = await arrive(page, "filta11y");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/cellar");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const sheet = await openFilters(page);
      await expect.poll(() => audit(page)).toEqual([]);
      await page.screenshot({ path: shot(`filters-${scheme}-${project()}`) });
      await sheet.getByRole("button", { name: "Close" }).click();
      await expect(sheet).toBeHidden();
      await expect.poll(() => audit(page)).toEqual([]);
    }
  });
});
