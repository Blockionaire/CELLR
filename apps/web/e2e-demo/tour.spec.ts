import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { READONLY_URL, drawn, open3D, signInDemo } from "./demo";

/**
 * Not a test: the visual tour of the demonstration cellar (sprint 6). Changes nothing (it opens panels and cancels).
 *   DEMO_TOUR=1 SHOTS_DIR=/some/dir pnpm exec playwright test -c playwright.demo.config.ts tour
 */
test.skip(!process.env.DEMO_TOUR, "only when asked for (DEMO_TOUR=1)");
const OUT = process.env.SHOTS_DIR ?? "test-results/demo-tour";

const PLACES = [
  "Walnut rack",
  "Metal wall system",
  "Dual-zone cooler",
  "Kitchen cooler",
  "Undercounter cooler",
  "Open shelves",
  "Mahogany cabinet",
  "Wine crates",
  "Brass wall pegs",
  "Wall rails",
  "Studio rack",
  "Old fridge",
];

test("tour", async ({ page }, info) => {
  fs.mkdirSync(OUT, { recursive: true });
  const device = info.project.name;
  const shot = async (name: string, full = false) => {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${device}-${name}.png`), fullPage: full });
  };
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  await signInDemo(page);
  await shot("01-home");
  await page.goto("/cellar");
  await shot("02-cellar-grid");
  await open3D(page);
  await drawn(page);
  await shot("03-3d-first", true);

  // every place
  for (const [i, label] of PLACES.entries()) {
    await page.getByRole("button", { name: label, exact: true }).click();
    if (label === "Old fridge") await page.waitForTimeout(4000);
    else await drawn(page);
    await page.getByTestId("smart-3d").scrollIntoViewIfNeeded();
    await shot(
      `10-place-${String(i + 1).padStart(2, "0")}-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    );
  }

  // a bottle taken out (walnut rack)
  await page.getByRole("button", { name: "Walnut rack", exact: true }).click();
  await drawn(page);
  await page.getByRole("button", { name: /Grand Vin 2015, shelf 1, position 1/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspection-panel")).toHaveAttribute("data-open", "true");
  await page.waitForTimeout(2500);
  await shot("20-bottle-out", true);
  await page.keyboard.press("Escape");

  // zones of the dual cooler, and a bottle there
  await page.getByRole("button", { name: "Dual-zone cooler", exact: true }).click();
  await drawn(page);
  await shot("21-dual-zone-cooler", true);

  // a bottle without a place: placement and advice
  await page
    .getByTestId("placement-unplaced")
    .getByRole("button", { name: "Place" })
    .first()
    .click();
  await expect(page.getByTestId("advice-panel")).toHaveAttribute("data-status", "ok");
  await shot("30-advice-keep", true);
  await page
    .getByTestId("advice-recommendations")
    .getByTestId("advice-option")
    .first()
    .getByTestId("advice-show")
    .click();
  await drawn(page);
  await shot("31-advice-shown", true);
  await page.getByTestId("advice-intent").getByRole("button", { name: "Serve soon" }).click();
  await expect(page.getByTestId("advice-panel")).toHaveAttribute("data-fresh", "fresh");
  await shot("32-advice-serve", true);
  await page.getByTestId("placement-cancel").click();

  // the Rack Builder: the catalogue, and an existing place
  await page.goto("/cellar/builder");
  await expect(page.getByTestId("rack-builder")).toHaveAttribute("data-mode", "new");
  await page.waitForTimeout(3000);
  await shot("40-builder-catalogue", true);
  await page.getByTestId("template-cooler_dual").click();
  await page.waitForTimeout(3000);
  await shot("41-builder-dual-cooler", true);
  await page.getByTestId("template-rack_double_depth").click();
  await page.waitForTimeout(3000);
  await shot("42-builder-preview-only", true);

  // read-only: the same experience, nothing can be saved or moved
  // (the session cookie is the same on every port of localhost: already signed in there)
  await open3D(page, READONLY_URL);
  await page
    .getByTestId("placement-unplaced")
    .getByRole("button", { name: "Place" })
    .first()
    .click();
  await expect(page.getByTestId("placement-read-only")).toBeVisible();
  await shot("50-readonly-placement", true);
});

void (null as unknown as Page);
