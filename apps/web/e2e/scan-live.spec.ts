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

test.describe("one camera for the whole visit", () => {
  test("repeated scans and mode changes do not ask for the camera again; the background and leaving release it", async ({
    page,
  }) => {
    test.skip(test.info().project.name !== "phone", "one device is enough for the camera itself");
    await page.addInitScript(() => {
      const w = window as unknown as { cameraCalls: number };
      w.cameraCalls = 0;
      const ask = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = (c) => {
        w.cameraCalls += 1;
        return ask(c);
      };
    });
    await arrive(page, "scancam");
    const calls = () =>
      page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls);
    const view = page.getByLabel("Camera view");
    const picture = () =>
      page.evaluate(() => {
        const v = document.querySelector("video");
        const s = v?.srcObject as MediaStream | null | undefined;
        return s ? s.getVideoTracks().map((t) => t.readyState === "live" && t.enabled) : [];
      });

    await page.goto("/scan");
    await expect(view).toHaveAttribute("data-state", "live", { timeout: 10_000 });
    expect(await calls()).toBe(1);

    // Two scans in a row: photo, its review, back to the viewfinder. The camera is never asked for again.
    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId("shutter").click();
      await expect(page.getByTestId("capture")).toHaveCount(0);
      await page.getByRole("button", { name: "Try another photo" }).click();
      await expect(view).toHaveAttribute("data-state", "live");
      await expect.poll(picture).toEqual([true]);
    }
    for (const mode of ["Same wine", "Batch", "Single bottle"]) {
      await page.getByRole("radio", { name: mode }).click();
      await expect.poll(picture).toEqual([true]);
    }
    expect(await calls()).toBe(1);

    // The app goes to the background: the camera is let go at once, and asked for again on return.
    const visibility = (state: "hidden" | "visible") =>
      page.evaluate((s) => {
        Object.defineProperty(document, "visibilityState", { value: s, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);
    await visibility("hidden");
    await expect.poll(picture).toEqual([]);
    await visibility("visible");
    await expect(view).toHaveAttribute("data-state", "live");
    await expect.poll(picture).toEqual([true]);
    expect(await calls()).toBe(2);
  });
});
