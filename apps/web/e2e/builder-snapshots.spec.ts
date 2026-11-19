import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { STORAGE_TEMPLATE_IDS } from "@cellr/domain";
import { PREVIEW_URL } from "./helpers";

/**
 * Not a test: makes the Rack Builder's template cards (sprint 3). Each card is a still of the template as the
 * renderer itself draws it (the template gallery, full of made-up bottles, at its default size and look), saved
 * once into public/builder/templates. So the catalogue shows fourteen small images, never fourteen live scenes.
 *   BUILDER_SNAPSHOTS=1 pnpm exec playwright test builder-snapshots --project=desktop
 * Run it again when a template's look changes (and look at the result before committing it).
 */
test.skip(!process.env.BUILDER_SNAPSHOTS, "only when asked for (BUILDER_SNAPSHOTS=1)");
test.use({ baseURL: PREVIEW_URL, viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });

const OUT = path.resolve("public", "builder", "templates");

test("make the template cards", async ({ page }) => {
  test.setTimeout(600_000);
  fs.mkdirSync(OUT, { recursive: true });
  for (const id of STORAGE_TEMPLATE_IDS) {
    await page.goto(`/design/cellar-3d?template=${id}&fill=full&quality=high&studio=light`);
    const stage = page.getByTestId("gallery-stage");
    const canvas = stage.locator("canvas[data-engine]");
    await expect(canvas).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 120_000 });
    await expect(canvas).toHaveAttribute("data-prewarmed", /^\d+$/, { timeout: 120_000 });
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const box = (await canvas.boundingBox())!;
    // a 4:3 window onto the middle of the picture: the card's own shape
    const width = Math.min(box.width, (box.height * 4) / 3);
    const height = (width * 3) / 4;
    await page.screenshot({
      path: path.join(OUT, `${id}.jpg`),
      type: "jpeg",
      quality: 80,
      clip: {
        x: box.x + (box.width - width) / 2,
        y: box.y + (box.height - height) / 2,
        width,
        height,
      },
    });
  }
});
