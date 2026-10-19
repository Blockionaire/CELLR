import { expect, type Page } from "@playwright/test";

/** The shutter (and the library button) sit fully inside the screen, above the tab bar. */
export async function expectReachable(page: Page) {
  const shutter = page.getByTestId("shutter");
  await expect(shutter).toBeVisible();
  const box = (await shutter.boundingBox())!;
  const nav = (await page
    .getByRole("navigation", { name: /Main|Hoofd/ })
    .last()
    .boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThan(0);
  // Clear of the tab bar, including the raised Scan button that sits above it.
  expect(box.y + box.height).toBeLessThanOrEqual(nav.y - 24);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  // Nothing needed scrolling to get here.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const library = page.getByRole("button", { name: /Choose a photo|Choose photos/ });
  const lib = (await library.boundingBox())!;
  expect(lib.y + lib.height).toBeLessThanOrEqual(nav.y);
}
