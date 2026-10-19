import { expect, test } from "@playwright/test";
import { arrive } from "./helpers";
import { expectReachable } from "./scan-helpers";

/**
 * The scan screen on real phone sizes: the shutter is always on screen and reachable, the live camera is used
 * where there is one, and the phone's own camera (a file input) takes over wherever there is not.
 */

const PHONES = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 13", width: 390, height: 844 },
] as const;

test.describe("the scanner fits the phone", () => {
  for (const phone of PHONES) {
    test(`${phone.name}: shutter and library are on screen, for one bottle and for several`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: phone.width, height: phone.height },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await arrive(page, "scanfit");
      await page.goto("/scan");
      await expect(page.getByRole("heading", { level: 1, name: "Scan a label" })).toBeVisible();
      await expectReachable(page);
      await page.getByRole("radio", { name: "Several in a row" }).click();
      await expectReachable(page);
      await page.screenshot({
        path: `test-results/shots/scan-fit-${phone.width}x${phone.height}.png`,
      });
      await context.close();
    });
  }
});

test.describe("without a live camera, the phone's own camera takes over", () => {
  test("permission refused: it says so, and the shutter opens the phone's camera", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("no", "NotAllowedError"));
    });
    await arrive(page, "scandeny");
    await page.goto("/scan");
    await expect(page.getByText(/CELLR may not use the camera/)).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("shutter").click();
    const picked = await chooser;
    expect(await picked.element().getAttribute("capture")).toBe("environment");
  });

  test("no camera at all: it says so, and both buttons still work", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    });
    await arrive(page, "scannone");
    await page.goto("/scan");
    await expect(page.getByText(/No live camera here/)).toBeVisible();
    const library = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose a photo" }).click();
    expect(await (await library).element().getAttribute("capture")).toBeNull();
  });

  test("a camera that fails can be tried again", async ({ page }) => {
    await page.addInitScript(() => {
      let calls = 0;
      navigator.mediaDevices.getUserMedia = () => {
        calls += 1;
        (window as unknown as { cameraCalls: number }).cameraCalls = calls;
        return Promise.reject(new DOMException("busy", "NotReadableError"));
      };
    });
    await arrive(page, "scanbusy");
    await page.goto("/scan");
    await expect(page.getByText(/The camera stopped/)).toBeVisible();
    await page.getByRole("button", { name: "Try the camera again" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls))
      .toBeGreaterThanOrEqual(2);
  });
});
