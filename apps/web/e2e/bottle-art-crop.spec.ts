import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, signIn, sql, stamp } from "./helpers";

/**
 * A finished 2D bottle picture usually comes with a wide transparent border. In the cellar's cards and rows the
 * bottle itself fills the picture's frame: the border is cut away in the browser (also for pictures already in the
 * library), so the bottle is not lost in empty space.
 */
test.skip(({ isMobile }) => !isMobile, "the phone");

const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";

/** A 1200×1600 transparent PNG with a slim bottle in the middle: about a sixth of the width, half the height. */
async function paddedBottle(page: Page) {
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 1600;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#cdbf72";
    ctx.fillRect(570, 400, 60, 160);
    ctx.fillRect(500, 560, 200, 640);
    ctx.fillStyle = "#f4ecd8";
    ctx.fillRect(520, 800, 160, 220);
    return c.toDataURL("image/png").split(",")[1]!;
  });
  return { name: "bottle.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

test("a 2D bottle picture with a wide transparent border fills its frame in the cellar list", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { email } = await arrive(page, "artcrop");
  const { call } = await apiClient(request, email);
  const wine = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { producer: "Capichera", name: `Vign'Angena ${stamp()}`, type: "white", countryCode: "IT" },
      201,
    )
  ).body;
  await call(
    "post",
    "/bottles",
    { wineId: wine.id, year: 2025, quantity: 1, locationId: null },
    201,
  );

  await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    ADMIN_EMAIL,
  ]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await context.newPage();
  await signIn(admin, ADMIN_EMAIL);
  await admin.goto(`/admin/wines/${wine.id}`);
  await admin.locator('input[name="picture"]').setInputFiles(await paddedBottle(admin));
  await admin.getByRole("button", { name: "Upload as draft" }).click();
  await expect(admin.getByText(/Uploaded as a draft/)).toBeVisible();
  await context.close();
  await sql("update public.wine_bottle_art set published_at = now() where wine_id = $1", [wine.id]);

  await page.goto("/cellar");
  await page.getByRole("radio", { name: "List" }).click();
  const frame = page.locator('[data-art="true"]').first();
  const bottle = frame.locator('[data-art-cropped="true"]');
  await expect(bottle).toBeVisible();
  const [f, b] = await Promise.all([frame.boundingBox(), bottle.boundingBox()]);
  // the bottle (not its empty border) takes most of the frame's height, and keeps its own proportions
  expect(b!.height / f!.height).toBeGreaterThan(0.85);
  expect(b!.width / b!.height).toBeCloseTo(200 / 800, 1);
});
