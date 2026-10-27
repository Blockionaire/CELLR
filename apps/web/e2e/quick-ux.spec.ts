import { expect, test } from "@playwright/test";
import { apiClient, arrive, sql, wineBody } from "./helpers";

/**
 * Four small UX fixes, end to end on a phone: a rating to a tenth of a star by sliding, correcting one bottle's
 * year, coming back to the cellar view you left, and places that fold away.
 */

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

async function place(call: Call, label: string) {
  return (await call("post", "/storage", { label, kind: "rack", rows: 2, cols: 3 }, 201)).body as {
    id: string;
  };
}
async function wine(call: Call, year: number, quantity: number, locationId: string) {
  const w = (await call("post", "/wines", wineBody, 201)).body as { id: string };
  return (await call("post", "/bottles", { wineId: w.id, year, quantity, locationId }, 201))
    .body as { bottleIds: string[]; vintageId: string };
}
const view = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("radiogroup", { name: "Cellar view" }).getByRole("radio", { name });

test.describe("quick UX fixes", () => {
  test("slide across the stars to 4.2, save, and see exactly 4.2 again", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "uxrate");
    const { call } = await apiClient(request, email);
    const rack = await place(call, "Rack");
    const added = await wine(call, 2019, 1, rack.id);
    await call("patch", `/bottles/${added.bottleIds[0]}`, { action: "open" }, 200);

    await page.goto(`/cellar/${added.vintageId}`);
    await page.getByRole("button", { name: "How was it?" }).click();
    const sheet = page.getByRole("dialog", { name: "How was it?" });
    const stars = sheet.getByTestId("stars-input");
    const box = (await stars.boundingBox())!;
    // Five 40px stars 4px apart: 4.2 stars is 4 whole stars and gaps, then a fifth of the fifth star.
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 5, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, y, { steps: 5 });
    await expect(sheet.getByText(/^\d\.\d \/ 5$/)).toBeVisible(); // follows the finger
    await page.mouse.move(box.x + 4 * 44 + 8, y, { steps: 5 });
    await page.mouse.up();
    await expect(sheet.getByText("4.2 / 5")).toBeVisible();
    await expect(stars).toHaveAttribute("aria-valuenow", "4.2");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();

    expect(
      await sql<{ score: string }>(
        "select score::text from public.tastings where household_id = $1",
        [householdId],
      ),
    ).toEqual([{ score: "8.4" }]);
    await page.reload();
    await expect(page.getByTestId("rating-summary")).toContainText("4.2");
    await page.getByRole("button", { name: "Edit" }).last().click();
    await expect(sheet.getByTestId("stars-input")).toHaveAttribute("aria-valuenow", "4.2");
    await expect(sheet.getByText("4.2 / 5")).toBeVisible();
  });

  test("correct one bottle's year: it moves to 2020, the other 2019 stays", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "uxyear");
    const { call } = await apiClient(request, email);
    const rack = await place(call, "Rack");
    const added = await wine(call, 2019, 2, rack.id);

    await page.goto(`/cellar/${added.vintageId}`);
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const sheet = page.getByRole("dialog", { name: "Edit" });
    await expect(sheet.getByLabel("Year")).toHaveValue("2019");
    await sheet.getByLabel("Which bottle").selectOption({ index: 1 });
    await sheet.getByLabel("Year").fill("2020");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(page).not.toHaveURL(new RegExp(added.vintageId), { timeout: 15_000 });
    await expect(page.getByText("2020").first()).toBeVisible();

    const years = await sql<{ year: number; n: string }>(
      `select v.year, count(*)::text as n from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
        where b.household_id = $1 group by v.year order by v.year`,
      [householdId],
    );
    expect(years).toEqual([
      { year: 2019, n: "1" },
      { year: 2020, n: "1" },
    ]);
    // The moved bottle is the one chosen, still in its spot.
    const [moved] = await sql<{ id: string; loc_row: number; loc_col: number }>(
      `select b.id, b.loc_row, b.loc_col from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
        where b.household_id = $1 and v.year = 2020`,
      [householdId],
    );
    expect(moved!.id).toBe(added.bottleIds[1]);
  });

  test("back from a bottle returns to the view you left; six places fold into a compact overview", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "uxnav");
    const { call } = await apiClient(request, email);
    const racks = [];
    for (let i = 1; i <= 6; i++) racks.push(await place(call, `Place ${i}`));
    await wine(call, 2019, 1, racks[2]!.id);

    // The server remembered "grid" when the page first loaded; switch to List, open the wine, come back.
    await page.goto("/cellar");
    await view(page, "List").click();
    await page
      .getByRole("link", { name: /Chablis Premier Cru/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/cellar\/[0-9a-f-]{36}/);
    await page.goBack(); // what an iOS swipe back does
    await expect(view(page, "List")).toHaveAttribute("aria-checked", "true");

    // Racks: six places, all folded; open two independently.
    await view(page, "Racks").click();
    const places = page.getByTestId("place");
    await expect(places).toHaveCount(6);
    const header = (n: number) => page.getByRole("button", { name: `Place ${n}`, exact: true });
    for (let n = 1; n <= 6; n++) await expect(header(n)).toHaveAttribute("aria-expanded", "false");
    await header(3).click();
    await header(5).click();
    await expect(header(3)).toHaveAttribute("aria-expanded", "true");
    await expect(header(5)).toHaveAttribute("aria-expanded", "true");
    await expect(header(1)).toHaveAttribute("aria-expanded", "false");
    await header(5).click();
    await expect(header(5)).toHaveAttribute("aria-expanded", "false");
    await expect(header(3)).toHaveAttribute("aria-expanded", "true");

    // Open the bottle from its place, then the page's own back arrow: still Racks, Place 3 still open.
    await page.getByRole("button", { name: /Chablis Premier Cru.*shelf 1, position 1/ }).click();
    await page.getByRole("link", { name: "Details" }).click();
    await expect(page).toHaveURL(/\/cellar\/[0-9a-f-]{36}/);
    await page.getByRole("link", { name: "Cellar" }).first().click();
    await expect(view(page, "Racks")).toHaveAttribute("aria-checked", "true");
    await expect(header(3)).toHaveAttribute("aria-expanded", "true");
    await expect(header(1)).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("quick rating on Home is never lost", () => {
  async function openedBottle(call: Call) {
    const rack = await place(call, "Rack");
    const added = await wine(call, 2019, 1, rack.id);
    await call("patch", `/bottles/${added.bottleIds[0]}`, { action: "open" }, 200);
  }
  const scores = (householdId: string) =>
    sql<{ score: string }>("select score::text from public.tastings where household_id = $1", [
      householdId,
    ]).then((rows) => rows.map((r) => r.score));

  test("rate with the keys and leave at once: the rating is saved, once", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "uxleave");
    const { call } = await apiClient(request, email);
    await openedBottle(call);
    await page.goto("/");
    const stars = page.getByTestId("rate-nudge").getByTestId("stars-input");
    await stars.focus();
    await stars.press("Home");
    for (let i = 0; i < 32; i++) await stars.press("ArrowRight"); // 4.2
    // Straight away, before the key burst has settled: off to the cellar.
    await page.getByRole("link", { name: "Cellar" }).last().click();
    await expect(page).toHaveURL(/\/cellar$/);
    await expect.poll(() => scores(householdId)).toEqual(["8.4"]);
  });

  test("tapping the same value again clears it, on screen and on the server", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "uxclear");
    const { call } = await apiClient(request, email);
    await openedBottle(call);
    await page.goto("/");
    const nudge = page.getByTestId("rate-nudge");
    await expect(nudge.getByTestId("stars-input")).toBeVisible();
    const box = (await nudge.getByTestId("stars-input").boundingBox())!;
    const at = { x: box.x + 3 * 44 + 20, y: box.y + box.height / 2 }; // 3.5 stars
    const writes: string[] = [];
    page.on("request", (r) => r.url().includes("/tasting") && writes.push(r.method()));
    const removed = page.waitForResponse(
      (r) => r.url().includes("/tasting") && r.request().method() === "DELETE",
    );
    await page.mouse.click(at.x, at.y);
    await page.mouse.click(at.x, at.y); // the same value again: cleared
    await expect(nudge.getByText("– / 5")).toBeVisible();
    // Both writes go out in order, the second only after the first: saved, then removed; nothing is left behind.
    expect((await removed).status()).toBe(200);
    expect(writes).toEqual(["PUT", "DELETE"]);
    expect(await scores(householdId)).toEqual([]);
  });
});

test("back from a bottle opened in the 3D cellar returns to 3D", async ({ page, request }) => {
  test.setTimeout(90_000);
  const { email } = await arrive(page, "ux3d");
  const { call } = await apiClient(request, email);
  const rack = await place(call, "Rack");
  await wine(call, 2019, 1, rack.id);
  await page.goto("/cellar");
  await view(page, "3D").click();
  const scene = page.getByTestId("cellar-3d");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await page
    .getByRole("list", { name: /Bottles in Rack/i })
    .getByRole("button")
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(scene).toHaveAttribute("data-showcase", "open");
  await page.getByRole("link", { name: "Full page" }).click();
  await expect(page).toHaveURL(/\/cellar\/[0-9a-f-]{36}/);
  await page.goBack();
  await expect(view(page, "3D")).toHaveAttribute("aria-checked", "true");
});
