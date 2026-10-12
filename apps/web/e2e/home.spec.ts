import { expect, test, type BrowserContextOptions } from "@playwright/test";
import { api, apiClient, arrive, audit, sessionToken, wineBody } from "./helpers";

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

async function furnish(call: Call) {
  const fridge = (
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 4, cols: 5 }, 201)
  ).body as { id: string };
  const chablis = (await call("post", "/wines", wineBody, 201)).body as { id: string };
  await call(
    "post",
    "/bottles",
    {
      wineId: chablis.id,
      year: 2019,
      quantity: 3,
      locationId: fridge.id,
      priceCents: 2450,
    },
    201,
  );
  const red = (await call("post", "/wines", RED, 201)).body as { id: string };
  const added = (
    await call(
      "post",
      "/bottles",
      { wineId: red.id, year: 2015, quantity: 2, locationId: null, priceCents: 9000 },
      201,
    )
  ).body as { bottleIds: string[] };
  return { fridge, added };
}

test.describe("home", () => {
  test("an empty cellar invites you to add the first bottle", async ({ page }) => {
    await arrive(page, "homeempty");
    await page.goto("/");
    await expect(page.getByText("What should we drink tonight?")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your cellar starts here." })).toBeVisible();
    await expect(page.getByTestId("home-stats")).toHaveCount(0);
    await page.getByRole("link", { name: "Add a bottle" }).click();
    await expect(page).toHaveURL(/\/cellar\/add/);
  });

  test("shortcuts lead to scanning, the sommelier and the wishlist", async ({ page }) => {
    await arrive(page, "homecuts");
    await page.goto("/");
    const cuts = page.getByRole("navigation", { name: "Shortcuts" });
    for (const [name, url] of [
      ["Ask the sommelier", /\/sommelier/],
      ["Wishlist", /\/wishlist/],
      ["Scan a label", /\/scan/],
    ] as const) {
      await cuts.getByRole("link", { name }).click();
      await expect(page).toHaveURL(url);
      await page.goto("/");
    }
  });

  test("a cellar at a glance: totals, value, what arrived, what was opened, space", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "home");
    const { call } = await apiClient(request, email);
    const { added } = await furnish(call);
    // One bottle opened today.
    await call("patch", `/bottles/${added.bottleIds[0]}`, { action: "open" }, 200);

    await page.goto("/");
    const stats = page.getByTestId("home-stats");
    // 3 Chablis + 1 Pavillon Rouge left = 4 bottles, 2 wines.
    await expect(stats.getByText("Bottles", { exact: true })).toBeVisible();
    await expect(stats.locator("dd").nth(0)).toHaveText("4");
    await expect(stats.locator("dd").nth(1)).toHaveText("2");
    // Value counts the bottles still in the cellar that have a price: 3 × 24.50 + 1 × 90.00 = €163,50 → €164.
    await expect(stats.locator("dd").nth(2)).toContainText("164");
    await expect(stats.getByText("from 4 bottles with a price")).toBeVisible();

    const added1 = page.getByRole("region", { name: "Recently added" });
    await expect(added1.getByRole("link", { name: "Pavillon Rouge" })).toBeVisible();
    await expect(added1.getByRole("link", { name: "Chablis Premier Cru" })).toBeVisible();

    const opened = page.getByRole("region", { name: "Opened lately" });
    await expect(opened.getByRole("link", { name: "Pavillon Rouge" })).toBeVisible();
    await expect(opened.getByText("today")).toBeVisible();

    const space = page.getByRole("region", { name: "Space" });
    await expect(space.getByText("3 of 20 spots in use")).toBeVisible();
    await expect(space.getByRole("meter")).toHaveAttribute("aria-valuenow", "3");
    await expect(space.getByText("1 bottle has no place yet")).toBeVisible();
    await page.screenshot({ path: shot(`home-${project()}`), fullPage: true });

    // A card leads to the wine.
    await added1.getByRole("link", { name: "Chablis Premier Cru" }).click();
    await expect(
      page.getByRole("heading", { name: "Chablis Premier Cru", level: 1 }),
    ).toBeVisible();
  });

  test("the same numbers are available to the API (a native app would use it)", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "homeapi");
    const { call } = await apiClient(request, email);
    await furnish(call);
    const { body } = await call<{
      bottleCount: number;
      wineCount: number;
      valueCents: number;
      pricedCount: number;
      capacity: number;
      used: number;
      unplaced: number;
      recentlyAdded: Array<{ wineName: string }>;
    }>("get", "/home", undefined, 200);
    expect(body).toMatchObject({
      bottleCount: 5,
      wineCount: 2,
      valueCents: 3 * 2450 + 2 * 9000,
      pricedCount: 5,
      capacity: 20,
      used: 3,
      unplaced: 2,
    });
    expect(body.recentlyAdded.map((i) => i.wineName).sort()).toEqual([
      "Chablis Premier Cru",
      "Pavillon Rouge",
    ]);
  });

  test("another household's home shows none of it", async ({ page, browser, request }) => {
    const owner = await arrive(page, "homeown");
    const { call } = await apiClient(request, owner.email);
    await furnish(call);

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "homeoth");
    const body = await (await api(request, await sessionToken(other.email), "get", "/home")).json();
    expect(body).toMatchObject({
      bottleCount: 0,
      wineCount: 0,
      valueCents: null,
      recentlyAdded: [],
      recentlyOpened: [],
    });
    await otherPage.goto("/");
    await expect(
      otherPage.getByRole("heading", { name: "Your cellar starts here." }),
    ).toBeVisible();
    await context.close();
  });

  test("home is accessible in both themes", async ({ page, request }) => {
    const { email } = await arrive(page, "homea11y");
    const { call } = await apiClient(request, email);
    const { added } = await furnish(call);
    await call("patch", `/bottles/${added.bottleIds[0]}`, { action: "open" }, 200);
    await page.goto("/");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
      await page.screenshot({ path: shot(`home-${scheme}-${project()}`), fullPage: true });
    }
  });
});
