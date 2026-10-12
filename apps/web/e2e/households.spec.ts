import { expect, test, type BrowserContextOptions } from "@playwright/test";
import { api, apiClient, arrive, audit, sessionToken, wineBody } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

test.describe("more than one household", () => {
  test("a second household is a separate cellar, one tap away", async ({ page, request }) => {
    const { email } = await arrive(page, "multi");
    const { call } = await apiClient(request, email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await call("post", "/bottles", { wineId: wine.id, year: 2019, quantity: 2 }, 201);

    await page.goto("/profile");
    // One household: no list to choose from, just the way to add another.
    await expect(page.getByRole("list", { name: "Your households" })).toHaveCount(0);
    await page.getByRole("button", { name: "Start or join another household" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Household name").fill("The cabin");
    await sheet.getByRole("button", { name: "Create household" }).click();

    // Creating it takes you there: its cellar is empty, the first one's is not.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Your cellar starts here." })).toBeVisible();
    await page.goto("/profile");
    const list = page.getByRole("list", { name: "Your households" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list.getByRole("listitem").filter({ hasText: "The cabin" })).toContainText(
      "Current",
    );
    await page.screenshot({ path: shot(`households-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);

    await list.getByRole("button", { name: /^Switch to / }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/cellar");
    await expect(page.getByText("Chablis", { exact: false }).first()).toBeVisible();
  });

  test("joining with a code adds the household and switches to it", async ({
    page,
    browser,
    request,
  }) => {
    const host = await (async () => {
      const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
      const hostPage = await context.newPage();
      const arrived = await arrive(hostPage, "multihost");
      const invite = (await (
        await api(
          request,
          await sessionToken(arrived.email),
          "post",
          `/households/${arrived.householdId}/invites`,
          {},
        )
      ).json()) as { code: string };
      await context.close();
      return { code: invite.code, householdId: arrived.householdId };
    })();

    const { email } = await arrive(page, "multijoin");
    await page.goto("/profile");
    await page.getByRole("button", { name: "Start or join another household" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: "Join with a code" }).click();
    await sheet.getByLabel("Invite code").fill("not a code");
    await sheet.getByRole("button", { name: "Join household" }).click();
    await expect(sheet.getByText("Invite codes have 12 letters and numbers.")).toBeVisible();
    await sheet.getByLabel("Invite code").fill(host.code);
    await sheet.getByRole("button", { name: "Join household" }).click();

    await expect(page).toHaveURL(/\/$/);
    const me = (await (await api(request, await sessionToken(email), "get", "/me")).json()) as {
      activeHouseholdId: string;
      households: unknown[];
    };
    expect(me.households).toHaveLength(2);
    expect(me.activeHouseholdId).toBe(host.householdId);
  });
});
