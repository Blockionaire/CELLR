import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive, bearer, makeJpeg, sql } from "./helpers";

/**
 * Not a test: the photographer of the product's 3D cellar with the new storage view (Smart Cellar 3D, sprint 2B.3),
 * on the test server where its gate is open, with a real household in the local stack.
 *   VISUAL_PRODUCT3D=1 SHOTS_DIR=/some/dir pnpm exec playwright test visual-product3d
 * The desktop project takes the desktop pictures, the phone project the phone's.
 */
test.skip(!process.env.VISUAL_PRODUCT3D, "only when asked for (VISUAL_PRODUCT3D=1)");
test.use({ baseURL: PREVIEW_URL });

const OUT = process.env.SHOTS_DIR ?? "test-results/product3d";
const stage = (page: Page) => page.getByTestId("smart-3d-stage");
const storage = (page: Page) => stage(page).getByTestId("inspectable-storage");
const drawn = (page: Page) =>
  expect(stage(page).locator("canvas[data-engine]")).toHaveAttribute("data-frames", /^[1-9]/, {
    timeout: 60_000,
  });

test("photograph the product's 3D cellar", async ({ page, request }, info) => {
  test.setTimeout(600_000);
  fs.mkdirSync(OUT, { recursive: true });
  const device = info.project.name;
  const shot = async (name: string) => {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${device}-${name}.png`) });
  };
  const { email } = await arrive(page, "photo3d");
  const { call, token } = await apiClient(request, email);
  const place = async (label: string, kind: string, rows: number, cols: number) =>
    ((await call("post", "/storage", { label, kind, rows, cols }, 201)).body as { id: string }).id;
  const bottles = async (wine: object, year: number, quantity: number, locationId: string) => {
    const w = (await call("post", "/wines", wine, 201)).body as { id: string };
    return (await call("post", "/bottles", { wineId: w.id, year, quantity, locationId }, 201))
      .body as { vintageId: string };
  };
  const rack = await place("Walnut rack", "rack", 5, 8);
  await sql(
    "update public.cellar_locations set template = 'rack_classic', slot_semantics = 'depth' where id = $1",
    [rack],
  );
  const cooler = await place("Wine cooler", "fridge", 8, 4);
  await call(
    "put",
    `/smart-cellar/storage/${cooler}/layout`,
    {
      structure: {
        template: "cooler_dual",
        rows: 8,
        cols: 4,
        cellCapacity: 1,
        zones: [
          { fromRow: 1, toRow: 4, purpose: "storage", targetTempC: 12 },
          { fromRow: 5, toRow: 8, purpose: "serving", targetTempC: 7.5 },
        ],
      },
      appearance: { v: 1, material: "metal", color: "graphite", lighting: "warm", door: "glass" },
    },
    200,
  );
  const fridge = await place("Old fridge", "fridge", 4, 4);
  const newer = await place("Newer rack", "rack", 3, 4);
  await sql(
    "update public.cellar_locations set template = 'hex_rack_2031', slot_semantics = 'depth' where id = $1",
    [newer],
  );
  const red = await bottles(
    {
      producer: "Château Margaux",
      name: "Pavillon Rouge",
      type: "red",
      countryCode: "FR",
      region: "Bordeaux",
    },
    2015,
    9,
    rack,
  );
  await bottles(
    {
      producer: "Domaine Test",
      name: "Chablis Premier Cru",
      type: "white",
      countryCode: "FR",
      region: "Burgundy",
    },
    2019,
    7,
    rack,
  );
  await bottles(
    {
      producer: "Maison Test",
      name: "Brut Réserve",
      type: "sparkling",
      countryCode: "FR",
      region: "Champagne",
    },
    2012,
    5,
    rack,
  );
  await bottles(
    {
      producer: "Weingut Test",
      name: "Riesling Kabinett",
      type: "white",
      countryCode: "DE",
      region: "Mosel",
    },
    2021,
    10,
    cooler,
  );
  await bottles(
    {
      producer: "Quinta Norte",
      name: "Vintage Port",
      type: "fortified",
      countryCode: "PT",
      region: "Douro",
    },
    2011,
    6,
    cooler,
  );
  await bottles(
    {
      producer: "Bodega Test",
      name: "Rioja Reserva",
      type: "red",
      countryCode: "ES",
      region: "Rioja",
    },
    2016,
    6,
    fridge,
  );
  await bottles(
    {
      producer: "Cascina Bella",
      name: "Barolo",
      type: "red",
      countryCode: "IT",
      region: "Piedmont",
    },
    2016,
    5,
    newer,
  );
  // a label photo of the household's own for the red
  const photo = await makeJpeg(page, {
    width: 600,
    height: 800,
    words: "PAVILLON ROUGE",
    color: "#efe6d3",
  });
  const stored = (await (
    await request.post("/api/v1/images", {
      headers: bearer(token),
      multipart: {
        photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
        side: "front",
        blurColor: "#efe6d3",
      },
    })
  ).json()) as { id: string };
  await call("put", `/cellar/${red.vintageId}/photo`, { imageId: stored.id, side: "front" }, 200);

  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page.getByTestId("smart-3d")).toHaveAttribute("data-mode", "ready", {
    timeout: 30_000,
  });
  await drawn(page);
  await shot("1-rack-new-view");

  const out = async (label: RegExp) => {
    await page.getByRole("button", { name: label }).first().focus();
    await page.keyboard.press("Enter");
    await expect(storage(page)).toHaveAttribute("data-showcase", "inspecting", { timeout: 45_000 });
  };
  const back = async () => {
    await page.keyboard.press("Escape");
    await expect(storage(page)).toHaveAttribute("data-showcase", "idle", { timeout: 45_000 });
  };
  await out(/Pavillon Rouge 2015, shelf 1, position 2/);
  await shot("2-rack-bottle-with-its-label-photo");
  if (device === "phone") {
    await page.getByTestId("smart-3d-wine-link").scrollIntoViewIfNeeded();
    await shot("2b-rack-panel-under-the-picture");
  }
  await back();
  await out(/Brut Réserve 2012/);
  await shot("3-rack-bottle-drawn-label");
  await back();

  await page.getByRole("button", { name: "Wine cooler" }).click();
  await expect(stage(page)).toHaveAttribute("data-template", "cooler_dual");
  await drawn(page);
  await shot("4-cooler-new-view");
  await out(/Vintage Port 2011/);
  await shot("5-cooler-bottle-through-the-door");
  await back();

  await page.getByRole("button", { name: "Old fridge" }).click();
  await expect(page.getByTestId("cellar-3d")).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await shot("6-legacy-place-existing-view");

  await page.getByRole("button", { name: "Newer rack" }).click();
  await expect(stage(page)).toHaveAttribute("data-renderer", "neutral");
  await drawn(page);
  await shot("7-unknown-arrangement-neutral");
});
