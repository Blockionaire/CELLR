import fs from "node:fs";
import { test, type Page } from "@playwright/test";
import { apiClient, arrive, wineBody } from "./helpers";

/**
 * Not a test: frames of the main movements, slowed down ×8 so they can be looked at as a strip.
 *   MOTION_DEMO=1 SHOTS_DIR=/some/dir pnpm exec playwright test motion-demo --project=phone
 */
test.skip(!process.env.MOTION_DEMO, "only when asked for (MOTION_DEMO=1)");
// The slowing-down style is injected by the test, which the page's own policy would rightly refuse.
test.use({ bypassCSP: true });
const OUT = process.env.SHOTS_DIR ?? "test-results/motion";

const SLOW = `
::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation-duration: 2.4s !important; }
.settle-in, .pop-in, .uncork, .reveal, .fan-card { animation-duration: 2.4s !important; }
`;

async function frames(page: Page, name: string, act: () => Promise<unknown>, times: number[]) {
  const started = Date.now();
  void act();
  for (const [i, t] of times.entries()) {
    const wait = t - (Date.now() - started);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${OUT}/${name}-${i}.png` });
  }
}

test("film the main movements", async ({ page, request }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(OUT, { recursive: true });
  const { email } = await arrive(page, "motion");
  const { call } = await apiClient(request, email);
  const fridge = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Wine fridge", kind: "fridge", rows: 3, cols: 4 },
      201,
    )
  ).body;
  for (const [name, type] of [
    ["Chablis Premier Cru", "white"],
    ["Pavillon Rouge", "red"],
    ["Bandol Rosé", "rose"],
    ["Barolo", "red"],
  ] as const) {
    const w = (await call<{ id: string }>("post", "/wines", { ...wineBody, name, type }, 201)).body;
    await call(
      "post",
      "/bottles",
      { wineId: w.id, year: 2019, quantity: 2, locationId: fridge.id },
      201,
    );
  }
  await page.goto("/cellar");
  await page.addStyleTag({ content: SLOW });

  // 1. A card becomes the wine's page.
  await frames(
    page,
    "card-to-page",
    () => page.getByRole("link", { name: "Pavillon Rouge" }).click(),
    [80, 500, 1000, 1600, 2600],
  );
  await page.waitForTimeout(1500);

  // 2. Opening a bottle: the cork comes off in the toast, the count pops.
  await page.addStyleTag({ content: SLOW });
  await page.getByRole("button", { name: "Open a bottle" }).click();
  const sheet = page.getByRole("dialog", { name: "Open a bottle" });
  await frames(
    page,
    "open",
    () => sheet.getByRole("button", { name: "Open it" }).click(),
    [300, 900, 1500, 2300, 3200],
  );

  // 3. Filtering: the cards that stay glide to their places.
  await page.goto("/cellar");
  await page.addStyleTag({ content: SLOW });
  await page.waitForTimeout(2600);
  await frames(
    page,
    "filter",
    () => page.getByRole("button", { name: /^Red/ }).click(),
    [60, 500, 1100, 1700, 2600],
  );
});
