import { expect, test } from "@playwright/test";
import { apiClient, arrive, audit, sql, wineBody } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

test.describe("language", () => {
  test("Dutch is one tap in the profile, kept for the person and used everywhere", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "lang");
    const { call } = await apiClient(request, email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await call("post", "/bottles", { wineId: wine.id, year: 2019, quantity: 2 }, 201);

    await page.goto("/profile");
    await page.getByRole("radio", { name: "Nederlands" }).click();
    await expect(page.getByRole("radio", { name: "Nederlands" })).toBeChecked();
    await expect(page.getByText("Je gegevens")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "nl");
    expect(
      await sql<{ locale: string }>(
        "select p.locale from public.profiles p join auth.users u on u.id = p.id where u.email = $1",
        [email],
      ),
    ).toEqual([{ locale: "nl" }]);

    await page.goto("/");
    await expect(page.getByText("Wat drinken we vanavond?")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Snelkoppelingen" })).toBeVisible();
    await page.screenshot({ path: shot(`home-nl-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);

    await page.goto("/cellar");
    await expect(page.getByRole("heading", { name: "Kelder", level: 1 })).toBeVisible();
    await expect(page.getByText("2 flessen · 1 wijn")).toBeVisible();

    // Back to English from the same place.
    await page.goto("/profile");
    await page.getByRole("radio", { name: "English" }).click();
    await expect(page.getByText("Your data")).toBeVisible();
  });

  test("a new device follows the profile, and the sign-in page follows the browser", async ({
    page,
    browser,
    request,
  }) => {
    const { email } = await arrive(page, "lang2");
    await sql(
      "update public.profiles set locale = 'nl' where id = (select id from auth.users where email = $1)",
      [email],
    );
    // This browser has the English cookie/none: the app switches itself to the profile's language.
    await page.goto("/profile");
    await expect(page.getByText("Je gegevens")).toBeVisible();

    const dutchBrowser = await browser.newContext({ locale: "nl-NL" });
    const signIn = await dutchBrowser.newPage();
    await signIn.goto("/sign-in");
    await expect(signIn.getByRole("button", { name: "Stuur me een code" })).toBeVisible();
    await dutchBrowser.close();
    void request;
  });
});
