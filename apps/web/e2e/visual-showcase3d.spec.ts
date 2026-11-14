import fs from "node:fs";
import path from "node:path";
import { test } from "@playwright/test";
import { PREVIEW_URL } from "./helpers";
import { phaseIs, show } from "./storage3d";

/**
 * Not a test: a photographer for the bottle showcase of the new storage view (Smart Cellar 3D, sprint 2B.1). For
 * each of the hard cases: the bottle on display, and one picture halfway home (the view's own test hook holds the
 * movement there), on a desktop-sized and a phone-sized screen.
 *   VISUAL_SHOWCASE3D=1 SHOTS_DIR=/some/dir pnpm exec playwright test visual-showcase3d --project=desktop
 */
test.skip(!process.env.VISUAL_SHOWCASE3D, "only when asked for (VISUAL_SHOWCASE3D=1)");
test.use({ deviceScaleFactor: 2, baseURL: PREVIEW_URL });

const OUT = process.env.SHOTS_DIR ?? "test-results/showcase3d";
const CASES: Array<[name: string, query: string, midway: number]> = [
  ["front-drawn-out", "template=rack_double_depth&fill=full&inspect=b-2:3:1&quality=high", 0.3],
  ["rear-behind-bottle", "template=rack_double_depth&fill=full&inspect=b-2:3:2&quality=high", 0.5],
  ["rear-front-free", "template=rack_double_depth&rows=8&cols=1&inspect=b-7:1:2&quality=high", 0.3],
  ["diamond-pile", "template=diamond_bins&fill=full&inspect=b-1:2:3&quality=high", 0.5],
  ["wall-rail", "template=wall_rails&rows=6&cols=2&fill=full&inspect=b-3:1:1&quality=high", 0.3],
  [
    "cabinet-glass-door",
    "template=cabinet_closed&door=glass&fill=full&inspect=b-2:3:1&quality=high",
    0.5,
  ],
  ["cooler-dual", "template=cooler_dual&fill=full&inspect=b-6:2:1&quality=high", 0.5],
  [
    "unknown-arrangement",
    "sample=unknown&unknown=bins-as-depth&fill=full&inspect=b-1:2:1&quality=high",
    0.5,
  ],
];
const SIZES = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;

test("photograph the showcase", async ({ page }) => {
  test.setTimeout(1_800_000);
  fs.mkdirSync(OUT, { recursive: true });
  const stage = page.getByTestId("gallery-stage");
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const [name, query, midway] of CASES) {
      if (ONLY && !ONLY.includes(name)) continue;
      await show(page, query, { prewarmed: false });
      await phaseIs(page, "inspecting");
      await page.waitForTimeout(1500);
      await stage.scrollIntoViewIfNeeded();
      // the picture and, on a phone, the panel below it
      const shot = async (file: string) => {
        if (size.name === "phone") await page.screenshot({ path: path.join(OUT, file) });
        else await stage.screenshot({ path: path.join(OUT, file) });
      };
      await shot(`${size.name}-${name}-shown.png`);
      if (size.name === "desktop") {
        // halfway home: held there by the view's test hook
        await page.evaluate(
          (p) => ((window as unknown as { __cellrHoldReturn: number }).__cellrHoldReturn = p),
          midway,
        );
        await page.keyboard.press("Escape");
        await phaseIs(page, "returning");
        await page.waitForTimeout(3500);
        await shot(`${size.name}-${name}-midway.png`);
        await page.evaluate(
          () => ((window as unknown as { __cellrHoldReturn: number }).__cellrHoldReturn = 0),
        );
        await phaseIs(page, "idle");
        await page.waitForTimeout(1200);
        await shot(`${size.name}-${name}-back.png`);
      }
    }
  }
});
