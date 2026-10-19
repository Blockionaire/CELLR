import { expect, test } from "@playwright/test";
import { arrive } from "./helpers";
import { expectReachable } from "./scan-helpers";

// A real (fake) camera for this file: Chromium's test pattern, with permission granted.
test.use({
  permissions: ["camera"],
  launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test.describe("with a live camera", () => {
  test("the picture is live, the shutter takes it and the label is read", async ({ page }) => {
    test.skip(test.info().project.name !== "phone", "one device is enough for the camera itself");
    await arrive(page, "scanlive");
    let sent = 0;
    await page.route("**/api/v1/scans", (route) => {
      sent += 1;
      return route.continue();
    });
    await page.goto("/scan");
    await expect(page.getByLabel("Camera view")).toHaveAttribute("data-state", "live", {
      timeout: 10_000,
    });
    await expectReachable(page);
    await page.getByTestId("shutter").click();
    // The photo goes the usual way: read, then reviewed (the fake model has nothing to say about it).
    await expect.poll(() => sent, { timeout: 15_000 }).toBe(1);
    await expect(page.getByTestId("capture")).toHaveCount(0);

    // Leaving the screen stops the camera (no light left on).
    await page.goto("/");
    const tracks = await page.evaluate(
      () => [...document.querySelectorAll("video")].filter((v) => v.srcObject).length,
    );
    expect(tracks).toBe(0);
  });
});
