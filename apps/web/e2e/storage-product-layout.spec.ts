import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive } from "./helpers";

/**
 * Smart Cellar 3D, sprint 10 (pass 2): the product's 3D cellar on a phone does not jump while a place loads, and its
 * row of places is easy to use. Real household on the local stack, the preview server (new renderer open).
 */
test.setTimeout(180_000);
test.use({ baseURL: PREVIEW_URL });
const expect = baseExpect.configure({ timeout: 30_000 });

const OAK = { v: 1, material: "wood", color: "oak", lighting: "none", door: "none" };
const view = (page: Page) => page.getByTestId("smart-3d");
const strip = (page: Page) => page.getByTestId("smart-3d-units");

async function household(page: Page, label: string, request: Parameters<typeof apiClient>[0]) {
  const { email } = await arrive(page, label);
  const { call } = await apiClient(request, email);
  const ids: string[] = [];
  // six places with long names: more than a phone's width of chips
  for (let i = 1; i <= 6; i++) {
    const id = (
      (
        await call(
          "post",
          "/storage",
          { label: `Rack number ${i} in the cellar`, kind: "rack", rows: 3, cols: 4 },
          201,
        )
      ).body as { id: string }
    ).id;
    await call(
      "put",
      `/smart-cellar/storage/${id}/layout`,
      {
        structure: { template: "rack_classic", rows: 3, cols: 4, cellCapacity: 1, zones: [] },
        appearance: OAK,
      },
      200,
    );
    ids.push(id);
  }
  return ids;
}

test("while a place loads its stage already has its own size: nothing below it moves", async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(!isMobile, "the stage's height follows the place's proportions on a phone");
  await household(page, "layout1", request);
  // hold the place's bottles back a moment, so the loading stage is there to be measured
  await page.route("**/api/v1/smart-cellar/storage/*/bottles", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  const pending = page.getByTestId("smart-3d-stage-pending");
  await expect(pending).toBeVisible();
  const before = (await pending.boundingBox())!;
  const stage = page.getByTestId("smart-3d-stage");
  await expect(stage).toBeVisible();
  const after = (await stage.boundingBox())!;
  // the same box: before this sprint the skeleton was 416 px and the stage 320 px here (a 3 x 4 rack)
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
});

test("the row of places: thumb-sized chips, a fade where there is more, reached by keyboard, the chosen one in view", async ({
  page,
  request,
  isMobile,
}) => {
  await household(page, "layout2", request);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(view(page)).toHaveAttribute("data-mode", "ready");
  const chips = strip(page).getByRole("button");
  await expect(chips).toHaveCount(6);
  for (const box of await Promise.all((await chips.all()).map((c) => c.boundingBox())))
    expect(box!.height).toBeGreaterThanOrEqual(44);
  // more to the right, and the page itself never scrolls sideways
  await expect(strip(page)).toHaveAttribute("data-more", "after");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  // the last place, chosen: it is brought into view inside the row, and the fade is now on the left
  const last = chips.nth(5);
  if (isMobile) {
    await strip(page).evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await last.tap();
  } else {
    // by keyboard: each chip is a button in the tab order
    await chips.nth(0).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
    await expect(last).toBeFocused();
    await page.keyboard.press("Enter");
  }
  await expect(last).toHaveAttribute("aria-pressed", "true");
  const row = (await strip(page).boundingBox())!;
  const chip = (await last.boundingBox())!;
  expect(chip.x).toBeGreaterThanOrEqual(row.x - 1);
  expect(chip.x + chip.width).toBeLessThanOrEqual(row.x + row.width + 1);
  await expect(strip(page)).toHaveAttribute("data-more", /before/);
});
