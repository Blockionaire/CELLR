import { expect, test } from "@playwright/test";
import { apiClient, arrive, audit } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const THIS_YEAR = new Date().getFullYear();

/** A Bordeaux red's window is 3–10 years after the harvest (no price, no quality words in the name). */
const WINES = [
  { name: "Old Claret", year: THIS_YEAR - 18 }, // long past
  { name: "Prime Claret", year: THIS_YEAR - 6 }, // in the middle of its window
  { name: "Young Claret", year: THIS_YEAR - 1 }, // opens in a couple of years
  { name: "Plain Blend", year: null }, // non-vintage: no window
];

async function furnish(call: Call) {
  const fridge = (
    await call("post", "/storage", { label: "Fridge", kind: "fridge", rows: 4, cols: 5 }, 201)
  ).body as { id: string };
  for (const { name, year } of WINES) {
    const w = (
      await call(
        "post",
        "/wines",
        { producer: "Château Test", name, type: "red", countryCode: "FR", region: "Bordeaux" },
        201,
      )
    ).body as { id: string };
    await call("post", "/bottles", { wineId: w.id, year, quantity: 1, locationId: fridge.id }, 201);
  }
}

const card = (page: import("@playwright/test").Page, name: string) =>
  page.locator("article", { hasText: name });

test.describe("when to drink it", () => {
  test("every card says where its wine stands; non-vintage says nothing", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "drink");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/cellar");
    await expect(card(page, "Old Claret").getByText("Past its best")).toBeVisible();
    await expect(card(page, "Prime Claret").getByText("At its best")).toBeVisible();
    await expect(card(page, "Young Claret").getByText("Not yet")).toBeVisible();
    // No year to count from: no label at all, rather than a made-up one.
    await expect(
      card(page, "Plain Blend").getByText(/best|Not yet|Drink soon|Opening up/),
    ).toHaveCount(0);
    await page.screenshot({ path: shot(`drink-cards-${project()}`), fullPage: true });
  });

  test("the wine's page shows its window, today, and says it is a guess", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "drinkpage");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/cellar");
    await page.getByRole("link", { name: "Prime Claret" }).click();
    const section = page.locator("section", {
      has: page.getByRole("heading", { name: "When to drink it" }),
    });
    await expect(section.getByText("At its best")).toBeVisible();
    await expect(section.getByTestId("drink-explain")).toContainText("the stretch it was made for");
    // The window: 3–10 years after the harvest.
    await expect(section.getByText(String(THIS_YEAR - 3), { exact: true })).toBeVisible();
    await expect(section.getByText(String(THIS_YEAR + 4), { exact: true })).toBeVisible();
    await expect(section.getByText("Today")).toBeVisible();
    await expect(section.getByText(/A guess, not a verdict/)).toBeVisible();
    await page.screenshot({ path: shot(`drink-page-${project()}`), fullPage: true });

    await page.goto("/cellar");
    await page.getByRole("link", { name: "Young Claret" }).click();
    await expect(page.getByTestId("drink-explain")).toContainText("Give it time");
    await page.goto("/cellar");
    await page.getByRole("link", { name: "Plain Blend" }).click();
    await expect(page.getByTestId("drink-explain")).toContainText("no year to count from");
  });

  test("filter by what can be opened, and sort by what to open first", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "drinkfilter");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/cellar");
    const titles = () => page.locator("article h3").allTextContents();

    await page.getByRole("button", { name: /^Filter/ }).click();
    const sheet = page.getByRole("dialog", { name: "Filter and sort" });
    await sheet.getByRole("button", { name: "Ready now" }).click();
    await sheet.getByRole("button", { name: /^Show 1 wine/ }).click();
    expect(await titles()).toEqual(["Prime Claret"]);

    const again = page.getByRole("dialog", { name: "Filter and sort" });
    await page.getByRole("button", { name: /^Filter/ }).click();
    await again.getByRole("button", { name: "Ready now" }).click(); // off
    await again.getByRole("button", { name: "Drink soon" }).click();
    await again.getByRole("button", { name: /^Show 1 wine/ }).click();
    expect(await titles()).toEqual(["Old Claret"]);

    await page.getByRole("button", { name: /^Filter/ }).click();
    await again.getByRole("button", { name: "Drink soon" }).click(); // off
    await again.getByRole("button", { name: "Still waiting" }).click();
    await again.getByRole("button", { name: /^Show 1 wine/ }).click();
    expect(await titles()).toEqual(["Young Claret"]);

    await page.getByRole("button", { name: /^Filter/ }).click();
    await again.getByRole("button", { name: "Still waiting" }).click(); // off
    await again.getByRole("button", { name: "Drink first" }).click();
    await again.getByRole("button", { name: /^Show 4 wines/ }).click();
    // Past its best first, then in its window, then not yet, and the wine with no window last.
    expect(await titles()).toEqual(["Old Claret", "Prime Claret", "Young Claret", "Plain Blend"]);
  });

  test("Home puts what should be opened soon on top of the list", async ({ page, request }) => {
    const { email } = await arrive(page, "drinkhome");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await page.goto("/");
    const soon = page.getByRole("region", { name: "Drink soon" });
    await expect(soon.getByRole("link", { name: "Old Claret" })).toBeVisible();
    await expect(soon.getByText("Past its best")).toBeVisible();
    // A wine in the middle of its window is not urgent.
    await expect(soon.getByRole("link", { name: "Prime Claret" })).toHaveCount(0);
  });

  test("it is accessible in both themes", async ({ page, request }) => {
    const { email } = await arrive(page, "drinka11y");
    const { call } = await apiClient(request, email);
    await furnish(call);
    for (const path of ["/", "/cellar"]) {
      await page.goto(path);
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await expect.poll(() => audit(page)).toEqual([]);
      }
    }
    await page.goto("/cellar");
    await page.getByRole("link", { name: "Prime Claret" }).click();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
      await page.screenshot({ path: shot(`drink-page-${scheme}-${project()}`), fullPage: true });
    }
  });
});
