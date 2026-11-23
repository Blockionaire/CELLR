import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive } from "./helpers";

/**
 * Smart Cellar 3D, sprint 10: AIMING WITH A FINGER ON A DENSE RACK. On a 30 x 30 rack on a phone the free spots on
 * offer are about 12 px apart: a fingertip covers several, and which one a tap lands on is chance. Such a tap now
 * chooses nothing; the view comes closer round the spot instead, and the next tap is clear. A spot with room round it
 * is chosen at the first tap, as before (`e2e/quick-add.spec.ts` holds that on a 3 x 4 rack). Real signed-in
 * household on the local stack, the preview server where placement is open.
 */
test.setTimeout(180_000);
test.use({ baseURL: PREVIEW_URL });
const expect = baseExpect.configure({ timeout: 20_000 });

const OAK = { v: 1, material: "wood", color: "oak", lighting: "none", door: "none" };
const view = (page: Page) => page.getByTestId("smart-3d");
const canvas = (page: Page) => page.getByTestId("smart-3d-stage").locator("canvas[data-engine]");
const sheet = (page: Page) => page.getByTestId("quick-sheet");

type Readout = {
  locateSpot: (r: number, c: number) => { x: number; y: number } | null;
  camera: () => { position: number[]; inside: boolean };
};
async function spotOnPage(page: Page, row: number, col: number) {
  await canvas(page).scrollIntoViewIfNeeded();
  const at = await page.evaluate(
    ([r, c]) =>
      (window as unknown as { __cellrStorage3d: Readout }).__cellrStorage3d.locateSpot(r!, c!),
    [row, col],
  );
  expect(at, `spot ${row}:${col}`).not.toBeNull();
  const box = (await canvas(page).boundingBox())!;
  return { x: box.x + at!.x, y: box.y + at!.y };
}
const distance = async (page: Page) => Number(await canvas(page).getAttribute("data-distance"));

test("a finger on a spot too small to be sure of brings the view closer, and the next tap chooses that spot", async ({
  page,
  request,
  hasTouch,
}) => {
  test.skip(!hasTouch, "a finger");
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const { email } = await arrive(page, "aim30");
  const { call } = await apiClient(request, email);
  const rack = (
    (await call("post", "/storage", { label: "Big rack", kind: "rack", rows: 30, cols: 30 }, 201))
      .body as { id: string }
  ).id;
  await call(
    "put",
    `/smart-cellar/storage/${rack}/layout`,
    {
      structure: { template: "rack_classic", rows: 30, cols: 30, cellCapacity: 1, zones: [] },
      appearance: OAK,
    },
    200,
  );
  const wine = (
    (await call("post", "/wines", { producer: "Aim", name: "Rouge", type: "red" }, 201)).body as {
      id: string;
    }
  ).id;
  await call("post", "/bottles", { wineId: wine, year: 2018, quantity: 3, locationId: rack }, 201);

  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(view(page)).toHaveAttribute("data-mode", "ready");
  await expect(canvas(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 90_000 });
  await page.getByTestId("quick-add-start").click();
  await expect(view(page)).toHaveAttribute("data-quick", "placing");
  await expect(canvas(page)).toHaveAttribute("data-spots", "897");
  // nudge the camera once so that it writes where it stands (it writes on every move)
  await page.mouse.wheel(0, 1);

  // the spots are far closer together than a fingertip
  const a = await spotOnPage(page, 15, 15);
  const b = await spotOnPage(page, 15, 16);
  const gap = Math.hypot(a.x - b.x, a.y - b.y);
  expect(gap).toBeLessThan(24);
  await expect.poll(() => distance(page)).toBeGreaterThan(0);
  const far = await distance(page);

  await page.touchscreen.tap(a.x, a.y);
  // nothing was chosen: no sheet, still choosing, every spot still on offer; the view came closer
  await expect.poll(() => distance(page)).toBeLessThan(far * 0.6);
  await page.waitForTimeout(500);
  await expect(sheet(page)).toBeHidden();
  await expect(view(page)).toHaveAttribute("data-quick", "placing");
  await expect(canvas(page)).toHaveAttribute("data-spots", "897");
  // the spot that was tapped is now a fingertip clear of its neighbour, and still under where the finger was aimed
  const a2 = await spotOnPage(page, 15, 15);
  const b2 = await spotOnPage(page, 15, 16);
  expect(Math.hypot(a2.x - b2.x, a2.y - b2.y)).toBeGreaterThanOrEqual(24);
  // and the camera did not end inside the furniture
  const cam = await page.evaluate(() =>
    (window as unknown as { __cellrStorage3d: Readout }).__cellrStorage3d.camera(),
  );
  expect(cam.inside).toBe(false);

  // the second tap is clear: it chooses exactly that spot
  await page.touchscreen.tap(a2.x, a2.y);
  await expect(sheet(page)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Add a bottle here" })).toContainText(
    "Big rack · shelf 15 · spot 15",
  );
});
