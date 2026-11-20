import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive, sql } from "./helpers";

/**
 * Not a test: the photographer of placement (Smart Cellar 3D, sprint 4), on the preview test server.
 *   VISUAL_PLACEMENT=1 SHOTS_DIR=/some/dir pnpm exec playwright test visual-placement
 */
test.skip(!process.env.VISUAL_PLACEMENT, "only when asked for (VISUAL_PLACEMENT=1)");
test.use({ baseURL: PREVIEW_URL });

const OUT = process.env.SHOTS_DIR ?? "test-results/placement";
const drawn = (page: Page) =>
  expect(page.getByTestId("smart-3d-stage").locator("canvas[data-engine]")).toHaveAttribute(
    "data-frames",
    /^[1-9]/,
    { timeout: 90_000 },
  );

test("photograph placement", async ({ page, request }, info) => {
  test.setTimeout(900_000);
  fs.mkdirSync(OUT, { recursive: true });
  const device = info.project.name;
  const shot = async (name: string, full = false) => {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${device}-${name}.png`), fullPage: full });
  };
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const { email } = await arrive(page, "photoplace");
  const { call } = await apiClient(request, email);
  const place = async (
    label: string,
    kind: string,
    rows: number,
    cols: number,
    template: string,
    zones?: object[],
  ) => {
    const id = (
      (await call("post", "/storage", { label, kind, rows, cols }, 201)).body as { id: string }
    ).id;
    const t = await import("@cellr/domain");
    const tpl = t.STORAGE_TEMPLATES[template as "rack_classic"];
    await call(
      "put",
      `/smart-cellar/storage/${id}/layout`,
      {
        structure: { template, rows, cols, cellCapacity: 1, zones: zones ?? [] },
        appearance: { v: 1, ...tpl.appearance.default },
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
  const wines = [
    { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" },
    { producer: "Domaine Test", name: "Chablis", type: "white", countryCode: "FR" },
  ];
  for (const [i, wine] of wines.entries()) {
    const w = (await call("post", "/wines", wine, 201)).body as { id: string };
    await call(
      "post",
      "/bottles",
      { wineId: w.id, year: 2015 + i, quantity: 5, locationId: rack },
      201,
    );
    await call(
      "post",
      "/bottles",
      { wineId: w.id, year: 2015 + i, quantity: 3, locationId: cooler },
      201,
    );
    await call(
      "post",
      "/bottles",
      { wineId: w.id, year: 2015 + i, quantity: 1, locationId: null },
      201,
    );
  }

  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await drawn(page);
  await shot("occupied");
  // a bottle, out, with Move
  await page.getByRole("button", { name: /Pavillon Rouge 2015, shelf 1, position 1/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("smart-3d-move")).toBeVisible({ timeout: 30_000 });
  await shot("bottle-selected");
  await page.getByTestId("smart-3d-move").click();
  await expect(page.getByTestId("placement-panel")).toBeVisible();
  await page.getByTestId("spot-picker").locator('[data-spot="3:4:1"]').click();
  await shot("destination-selected");
  await shot("destination-selected-full", true);
  await page.getByTestId("spot-picker").locator('[data-spot="1:2:1"]').click();
  await shot("swap-confirmation", true);
  await page.getByTestId("placement-cancel").click();
  // the cooler with zones
  await page.getByRole("button", { name: "Wine cooler", exact: true }).click();
  await drawn(page);
  await shot("dual-zone-cooler", true);
});

/**
 * The other kinds, on the local disposable stack only: an empty place, a two-deep rack and bins (counters). A place
 * with more than one bottle per cell can't be saved while depth placement is off, so for the photograph the depth
 * setting of THIS throwaway database is switched on just long enough to write the two places, then off again. The
 * app's own constant stays off, so what is photographed is what a person would see today: past index 1 unavailable.
 */
test("photograph the other kinds (isolated test mode)", async ({ page, request }, info) => {
  test.setTimeout(900_000);
  fs.mkdirSync(OUT, { recursive: true });
  const device = info.project.name;
  const shot = async (name: string, full = false) => {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${device}-${name}.png`), fullPage: full });
  };
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const { email } = await arrive(page, "photokinds");
  const { call } = await apiClient(request, email);
  const t = await import("@cellr/domain");
  const plain = async (label: string, rows: number, cols: number) =>
    (
      (await call("post", "/storage", { label, kind: "rack", rows, cols }, 201)).body as {
        id: string;
      }
    ).id;
  const empty = await plain("Empty rack", 3, 5);
  await call(
    "put",
    `/smart-cellar/storage/${empty}/layout`,
    {
      structure: { template: "rack_classic", rows: 3, cols: 5, cellCapacity: 1, zones: [] },
      appearance: { v: 1, ...t.STORAGE_TEMPLATES.rack_classic.appearance.default },
    },
    200,
  );
  const deep = await plain("Two-deep rack", 3, 4);
  const bins = await plain("Diamond bins", 2, 3);
  await sql("update private.cellar_settings set depth_placement = true");
  try {
    for (const [id, template, cap, semantics] of [
      [deep, "rack_double_depth", 2, "depth"],
      [bins, "diamond_bins", 8, "ordinal"],
    ] as const) {
      await sql(
        "update public.cellar_locations set template = $2, cell_capacity = $3, slot_semantics = $4, appearance = $5::jsonb where id = $1",
        [
          id,
          template,
          cap,
          semantics,
          JSON.stringify({ v: 1, ...t.STORAGE_TEMPLATES[template].appearance.default }),
        ],
      );
    }
  } finally {
    await sql("update private.cellar_settings set depth_placement = false");
  }
  const w = (
    await call(
      "post",
      "/wines",
      { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" },
      201,
    )
  ).body as { id: string };
  for (const [loc, n] of [
    [deep, 5],
    [bins, 2],
    [null, 1],
  ] as const)
    await call("post", "/bottles", { wineId: w.id, year: 2015, quantity: n, locationId: loc }, 201);

  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  // the empty rack: every spot selectable
  await page.getByRole("button", { name: "Empty rack", exact: true }).click();
  await drawn(page);
  await page
    .getByTestId("placement-unplaced")
    .getByRole("button", { name: "Place" })
    .first()
    .click();
  await expect(page.getByTestId("placement-panel")).toBeVisible();
  await page.getByTestId("placement-units").getByRole("button", { name: "Empty rack" }).click();
  await shot("empty-storage", true);
  await page.getByTestId("placement-cancel").click();
  // the two-deep rack: the place behind each front is shown, and not offered while depth is off
  await page.getByRole("button", { name: "Two-deep rack", exact: true }).click();
  await drawn(page);
  await page.getByRole("button", { name: /Pavillon Rouge 2015, shelf 1, position 1/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("smart-3d-move").click();
  await expect(page.getByTestId("spot-picker")).toBeVisible();
  await shot("multi-depth-isolated", true);
  await page.getByTestId("placement-cancel").click();
  // bins: a compartment is one choice with how full it is; a filled one can't take more while depth is off
  await page.getByRole("button", { name: "Diamond bins", exact: true }).click();
  await drawn(page);
  await page.getByTestId("placement-start").click();
  await page.getByTestId("placement-units").getByRole("button", { name: "Diamond bins" }).click();
  await shot("ordinal-bins", true);
});

test("photograph the flat fallback (no WebGL)", async ({ page, request }, info) => {
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof original;
  });
  const { email } = await arrive(page, "photoflat");
  const { call } = await apiClient(request, email);
  const t = await import("@cellr/domain");
  const id = (
    (await call("post", "/storage", { label: "Oak rack", kind: "rack", rows: 3, cols: 4 }, 201))
      .body as { id: string }
  ).id;
  await call(
    "put",
    `/smart-cellar/storage/${id}/layout`,
    {
      structure: { template: "rack_classic", rows: 3, cols: 4, cellCapacity: 1, zones: [] },
      appearance: { v: 1, ...t.STORAGE_TEMPLATES.rack_classic.appearance.default },
    },
    200,
  );
  const w = (
    await call(
      "post",
      "/wines",
      { producer: "Domaine Test", name: "Chablis", type: "white", countryCode: "FR" },
      201,
    )
  ).body as { id: string };
  await call("post", "/bottles", { wineId: w.id, year: 2016, quantity: 4, locationId: id }, 201);
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page.getByTestId("smart-3d-flat")).toBeVisible({ timeout: 30_000 });
  await page
    .getByTestId("smart-3d-flat")
    .getByRole("button", { name: /position 2/ })
    .first()
    .click();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUT, `${info.project.name}-flat-fallback.png`),
    fullPage: true,
  });
  await page.getByTestId("smart-3d-flat-chosen").getByTestId("smart-3d-move").click();
  await page.getByTestId("spot-picker").locator('[data-spot="3:2:1"]').click();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(OUT, `${info.project.name}-flat-fallback-move.png`),
    fullPage: true,
  });
});
