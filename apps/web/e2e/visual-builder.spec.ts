import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive } from "./helpers";

/**
 * Not a test: the photographer of the Rack Builder (Smart Cellar 3D, sprint 3), on the test server where it is open
 * and saves, with a real household in the local stack.
 *   VISUAL_BUILDER=1 SHOTS_DIR=/some/dir pnpm exec playwright test visual-builder
 * The desktop project takes the desktop pictures, the phone project the phone's.
 */
test.skip(!process.env.VISUAL_BUILDER, "only when asked for (VISUAL_BUILDER=1)");
test.use({ baseURL: PREVIEW_URL });

const OUT = process.env.SHOTS_DIR ?? "test-results/builder";
const drawn = (page: Page) =>
  expect(page.getByTestId("builder-stage").locator("canvas[data-engine]")).toHaveAttribute(
    "data-frames",
    /^[1-9]/,
    { timeout: 90_000 },
  );

test("photograph the Rack Builder", async ({ page, request }, info) => {
  test.setTimeout(900_000);
  fs.mkdirSync(OUT, { recursive: true });
  const device = info.project.name;
  const shot = async (name: string, full = false) => {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${device}-${name}.png`), fullPage: full });
  };
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const { email } = await arrive(page, "photobuild");
  const { call } = await apiClient(request, email);
  const rack = (
    (await call("post", "/storage", { label: "Hall rack", kind: "rack", rows: 5, cols: 8 }, 201))
      .body as { id: string }
  ).id;
  const wines = [
    { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" },
    { producer: "Domaine Test", name: "Chablis", type: "white", countryCode: "FR" },
    { producer: "Maison Brut", name: "Brut Réserve", type: "sparkling", countryCode: "FR" },
  ];
  for (const [i, wine] of wines.entries()) {
    const w = (await call("post", "/wines", wine, 201)).body as { id: string };
    await call(
      "post",
      "/bottles",
      { wineId: w.id, year: 2015 + i, quantity: 6, locationId: rack },
      201,
    );
  }

  // a new place: the catalogue, the default rack
  await page.goto("/cellar/builder");
  await drawn(page);
  await shot("new-rack");
  await shot("new-rack-full", true);
  // a dual-zone cooler, its zones
  await page.getByTestId("template-cooler_dual").click();
  await drawn(page);
  await page.getByTestId("builder-zones").scrollIntoViewIfNeeded();
  await shot("new-cooler-zones");
  // a preview-only template
  await page.getByTestId("template-diamond_bins").click();
  await drawn(page);
  await page.getByTestId("builder-savebar").scrollIntoViewIfNeeded();
  await shot("new-bins-preview-only");

  // an existing place with bottles, from before templates
  await page.goto(`/cellar/builder/${rack}`);
  await drawn(page);
  await shot("edit-legacy");
  await page.getByTestId("template-rack_classic").click();
  const colsDown = page.getByTestId("builder-cols").getByRole("button").first();
  for (let i = 0; i < 6; i++) await colsDown.click();
  await drawn(page);
  await page.getByTestId("builder-blockers").scrollIntoViewIfNeeded();
  await shot("edit-blockers");
});
