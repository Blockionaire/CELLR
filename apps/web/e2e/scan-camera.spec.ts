import { expect, test } from "@playwright/test";
import { arrive, makeJpeg } from "./helpers";
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
    test(`${phone.name}: the three modes are clear, and shutter and library stay on screen in each`, async ({
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
      const modes = page.getByRole("radiogroup", { name: "How are you scanning?" });
      await expect(modes.getByRole("radio", { name: "Single bottle" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(page.getByText("One label, one bottle. Check it and add it.")).toBeVisible();
      await expectReachable(page);
      for (const [mode, hint] of [
        ["Same wine", /scan one label, then say how many/],
        ["Batch", /a photo per label, one after another/],
      ] as const) {
        await modes.getByRole("radio", { name: mode }).click();
        await expect(page.getByText(hint)).toBeVisible();
        await expectReachable(page);
      }
      await page.screenshot({
        path: `test-results/shots/scan-fit-${phone.width}x${phone.height}.png`,
      });
      await context.close();
    });
  }
});

test.describe("without a live camera, the phone's own camera takes over", () => {
  test("the camera is only asked for when wanted; refused, it says so and the shutter opens the phone's camera", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { cameraCalls: number };
      w.cameraCalls = 0;
      navigator.mediaDevices.getUserMedia = () => {
        w.cameraCalls += 1;
        return Promise.reject(new DOMException("no", "NotAllowedError"));
      };
    });
    await arrive(page, "scandeny");
    await page.goto("/scan");
    const calls = () =>
      page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls);
    // Not allowed before: nothing is asked until the person wants the live camera.
    await expect(page.getByText("The live camera is off.")).toBeVisible();
    await page.getByRole("radio", { name: "Batch" }).click();
    expect(await calls()).toBe(0);
    await page.getByRole("button", { name: "Use the camera" }).first().click();
    await expect(page.getByText(/CELLR may not use the camera/)).toBeVisible();
    expect(await calls()).toBe(1);
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("shutter").click();
    const picked = await chooser;
    expect(await picked.element().getAttribute("capture")).toBe("environment");
  });

  test("refused once, never asked again by itself: not on returning to the viewfinder, nor from the background", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { cameraCalls: number };
      w.cameraCalls = 0;
      navigator.mediaDevices.getUserMedia = () => {
        w.cameraCalls += 1;
        return Promise.reject(new DOMException("no", "NotAllowedError"));
      };
    });
    await arrive(page, "scandenyback");
    await page.goto("/scan");
    const calls = () =>
      page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls);
    await page.getByRole("button", { name: "Use the camera" }).first().click();
    await expect(page.getByText(/CELLR may not use the camera/)).toBeVisible();
    expect(await calls()).toBe(1);

    // A photo with the phone's own camera: off to its review, then back to the viewfinder.
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: await makeJpeg(page) });
    await expect(page.getByTestId("capture")).toHaveCount(0);
    await page.getByRole("button", { name: "Try another photo" }).click();
    await expect(page.getByTestId("capture")).toBeVisible();

    // The app goes to the background and comes back.
    for (const s of ["hidden", "visible"] as const)
      await page.evaluate((state) => {
        Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      }, s);
    await page.waitForTimeout(500);
    expect(await calls()).toBe(1);

    // Only a new tap asks again.
    await page.getByRole("button", { name: "Try the camera again" }).click();
    await expect.poll(calls).toBe(2);
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
    await page.getByRole("button", { name: "Use the camera" }).click();
    await expect(page.getByText(/The camera stopped/)).toBeVisible();
    await page.getByRole("button", { name: "Try the camera again" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls))
      .toBeGreaterThanOrEqual(2);
  });
});
