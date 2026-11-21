import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive } from "./helpers";

/**
 * Not a test: the photographer of placement advice (Smart Cellar 3D, sprint 5), on the preview test server.
 *   VISUAL_ADVICE=1 SHOTS_DIR=/some/dir pnpm exec playwright test visual-advice
 */
test.skip(!process.env.VISUAL_ADVICE, "only when asked for (VISUAL_ADVICE=1)");
test.use({ baseURL: PREVIEW_URL });

const OUT = process.env.SHOTS_DIR ?? "test-results/advice";
const drawn = (page: Page) =>
  expect(page.getByTestId("smart-3d-stage").locator("canvas[data-engine]")).toHaveAttribute(
    "data-frames",
    /^[1-9]/,
    { timeout: 90_000 },
  );

test("photograph advice", async ({ page, request }, info) => {
  test.setTimeout(900_000);
  fs.mkdirSync(OUT, { recursive: true });
  const device = info.project.name;
  const shot = async (name: string, full = true) => {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${device}-${name}.png`), fullPage: full });
  };
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const { email } = await arrive(page, "photoadvice");
  const { call } = await apiClient(request, email);
  const t = await import("@cellr/domain");
  const place = async (
    label: string,
    kind: string,
    rows: number,
    cols: number,
    template: "rack_classic" | "cooler_dual",
    zones: object[] = [],
  ) => {
    const id = (
      (await call("post", "/storage", { label, kind, rows, cols }, 201)).body as { id: string }
    ).id;
    await call(
      "put",
      `/smart-cellar/storage/${id}/layout`,
      {
        structure: { template, rows, cols, cellCapacity: 1, zones },
        appearance: { v: 1, ...t.STORAGE_TEMPLATES[template].appearance.default },
      },
      200,
    );
    return id;
  };
  const rack = await place("Walnut rack", "rack", 4, 6, "rack_classic");
  const cooler = await place("Wine cooler", "fridge", 6, 4, "cooler_dual", [
    { fromRow: 1, toRow: 2, purpose: "serving", targetTempC: 8 },
    { fromRow: 3, toRow: 6, purpose: "storage", targetTempC: 12 },
  ]);
  const w = (
    await call(
      "post",
      "/wines",
      { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" },
      201,
    )
  ).body as { id: string };
  const other = (
    await call(
      "post",
      "/wines",
      { producer: "Domaine Test", name: "Chablis", type: "white", countryCode: "FR" },
      201,
    )
  ).body as { id: string };
  await call("post", "/bottles", { wineId: w.id, year: 2015, quantity: 3, locationId: rack }, 201);
  await call(
    "post",
    "/bottles",
    { wineId: other.id, year: 2019, quantity: 4, locationId: cooler },
    201,
  );
  await call("post", "/bottles", { wineId: w.id, year: 2015, quantity: 1, locationId: null }, 201);
  void cooler;

  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await drawn(page);
  await page
    .getByTestId("placement-unplaced")
    .getByRole("button", { name: "Place" })
    .first()
    .click();
  await expect(page.getByTestId("advice-panel")).toHaveAttribute("data-status", "ok", {
    timeout: 30_000,
  });
  await shot("advice-store");
  await page.getByTestId("advice-option").nth(1).getByTestId("advice-show").click();
  await drawn(page);
  await shot("advice-second-shown");
  await page.getByTestId("advice-intent").getByRole("button", { name: "Serve soon" }).click();
  await expect(page.getByTestId("advice-panel")).toHaveAttribute("data-intent", "serve");
  await expect(page.getByTestId("advice-panel")).toHaveAttribute("data-status", "ok");
  await page.getByTestId("advice-option").first().getByTestId("advice-show").click();
  await drawn(page);
  await shot("advice-serve-shown");
});
