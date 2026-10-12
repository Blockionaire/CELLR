import { expect, test, type BrowserContextOptions } from "@playwright/test";
import { api, apiClient, arrive, audit, sessionToken, sql } from "./helpers";

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
    year: 2012,
    quantity: 3,
    priceCents: 9000,
  },
  {
    producer: "Antinori",
    name: "Tignanello",
    type: "red",
    countryCode: "IT",
    region: "Tuscany",
    year: 2018,
    quantity: 2,
    priceCents: 7000,
  },
  {
    producer: "Domaine Test",
    name: "Chablis Premier Cru",
    type: "white",
    countryCode: "FR",
    region: "Burgundy",
    year: 2019,
    quantity: 2,
    priceCents: 3000,
  },
  {
    producer: "Bollinger",
    name: "Special Cuvée",
    type: "sparkling",
    countryCode: "FR",
    region: "Champagne",
    year: null,
    quantity: 1,
    priceCents: null,
  },
] as const;

/** A cellar with a bit of everything: prices, opened bottles with ratings, and a value for one wine. */
async function furnish(call: Call) {
  const ids: Record<string, { vintage: string; bottles: string[] }> = {};
  for (const w of WINES) {
    const wine = (
      await call<{ id: string }>(
        "post",
        "/wines",
        {
          producer: w.producer,
          name: w.name,
          type: w.type,
          countryCode: w.countryCode,
          region: w.region,
        },
        201,
      )
    ).body;
    const added = (
      await call<{ bottleIds: string[] }>(
        "post",
        "/bottles",
        {
          wineId: wine.id,
          year: w.year,
          quantity: w.quantity,
          locationId: null,
          priceCents: w.priceCents,
        },
        201,
      )
    ).body;
    const [v] = await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1",
      [wine.id],
    );
    ids[w.name] = { vintage: v!.id, bottles: added.bottleIds };
  }
  return ids;
}

test.describe("insights", () => {
  test("the cellar in numbers: what you have, what it cost and is worth, when it is ready, what you drank", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "stats");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    // Open two bottles and rate them; give one wine a value of its own.
    await call("patch", `/bottles/${ids["Pavillon Rouge"]!.bottles[0]}`, { action: "open" }, 200);
    await call("put", `/bottles/${ids["Pavillon Rouge"]!.bottles[0]}/tasting`, { score: 10 }, 200);
    await call(
      "patch",
      `/bottles/${ids["Chablis Premier Cru"]!.bottles[0]}`,
      { action: "open" },
      200,
    );
    await call(
      "put",
      `/bottles/${ids["Chablis Premier Cru"]!.bottles[0]}/tasting`,
      { score: 7 },
      200,
    );
    await call(
      "put",
      `/cellar/${ids["Tignanello"]!.vintage}/insight`,
      { myValueCents: 11000 },
      200,
    );

    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "Insights", level: 1 })).toBeVisible();

    const tiles = page.getByTestId("stat-tiles");
    // 2 + 2 + 1 + 1 bottles are left in the cellar; 4 wines
    await expect(tiles).toContainText("Bottles");
    await expect(tiles.locator("dd").nth(0)).toHaveText("6");
    await expect(tiles.locator("dd").nth(1)).toHaveText("4");
    // Paid: 2×90 + 2×70 + 1×30 (+ one with no price)
    await expect(tiles.locator("dd").nth(2)).toContainText("350");
    await expect(tiles).toContainText("from 5 bottles with a price");
    // Worth: 2 bottles of Tignanello at 110
    await expect(tiles.locator("dd").nth(3)).toContainText("220");
    await expect(tiles).toContainText("more than paid");

    await expect(page.getByRole("list", { name: "What you have" })).toContainText("Red");
    await expect(page.getByRole("list", { name: "Countries" })).toContainText("France");
    await expect(page.getByRole("list", { name: "Countries" })).toContainText("Italy");
    await expect(page.getByRole("list", { name: "Vintages" })).toContainText("2010s");
    await expect(page.getByRole("list", { name: "Bottles by stage today" })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Ready to drink, year by year" }).getByRole("listitem"),
    ).toHaveCount(15);
    await expect(
      page
        .getByRole("list", { name: "Bottles opened per month, last twelve months" })
        .getByRole("listitem"),
    ).toHaveCount(12);
    await expect(page.getByText("2 bottles opened in all.")).toBeVisible();

    const loved = page.getByRole("list", { name: "Highest rated wines" });
    await expect(loved.getByRole("listitem").first()).toContainText("Pavillon Rouge");
    await expect(loved.getByRole("listitem").nth(1)).toContainText("Chablis Premier Cru");
    await page.screenshot({ path: shot(`insights-${project()}`), fullPage: true });

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
  });

  test("an empty cellar says so, and the same numbers are there for an app", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "statsempty");
    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "Nothing to count yet" })).toBeVisible();
    const { call } = await apiClient(request, email);
    const stats = (await call<Record<string, unknown>>("get", "/stats", undefined, 200)).body;
    expect(stats).toMatchObject({ bottleCount: 0, wineCount: 0, openedCount: 0 });
    expect(stats.money).toMatchObject({ spentCents: null, worthCents: null });
  });

  test("another household's numbers are its own", async ({ page, browser, request }) => {
    const { email } = await arrive(page, "statsiso");
    const { call } = await apiClient(request, email);
    await furnish(call);

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "statsother");
    const token = await sessionToken(other.email);
    const theirs = (await (await api(request, token, "get", "/stats")).json()) as {
      bottleCount: number;
    };
    expect(theirs.bottleCount).toBe(0);
    await otherPage.goto("/insights");
    await expect(otherPage.getByRole("heading", { name: "Nothing to count yet" })).toBeVisible();
    await context.close();
  });

  test("in Dutch too", async ({ page, request }) => {
    const { email } = await arrive(page, "statsnl");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page
      .context()
      .addCookies([{ name: "locale", value: "nl", url: "http://localhost:3100" }]);
    await sql(
      "update public.profiles set locale = 'nl' where id = (select id from auth.users where email = $1)",
      [email],
    );
    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "Inzichten", level: 1 })).toBeVisible();
    await expect(page.getByTestId("stat-tiles")).toContainText("Gekocht voor");
    await expect(page.getByRole("list", { name: "Landen" })).toContainText("Frankrijk");
  });
});

test.describe("a wine's life as a chart", () => {
  test("shows the window, today, and a dot for every bottle you opened", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "chart");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const wine = ids["Pavillon Rouge"]!;
    await call("patch", `/bottles/${wine.bottles[0]}`, { action: "open" }, 200);
    await call("patch", `/bottles/${wine.bottles[1]}`, { action: "open" }, 200);

    await page.goto(`/cellar/${wine.vintage}`);
    const chart = page.getByTestId("drink-chart");
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute(
      "aria-label",
      /opens up from \d{4}, at its best \d{4} to \d{4}, to be drunk by \d{4}/,
    );
    await expect(chart.getByTestId("opened-mark")).toHaveCount(2);
    await expect(page.getByText("● 2 bottles opened")).toBeVisible();
    await page.locator("figure").filter({ has: chart }).screenshot({ path: shot(`drink-chart-${project()}`) });
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }

    // A wine without a vintage has no window, so no chart.
    await page.goto(`/cellar/${ids["Special Cuvée"]!.vintage}`);
    await expect(page.getByTestId("drink-chart")).toHaveCount(0);
  });
});
