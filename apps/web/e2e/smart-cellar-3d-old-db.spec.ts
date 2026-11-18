import { expect, test } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive } from "./helpers";

/**
 * Not part of the normal run: the product's 3D cellar on a REAL database that does not have the Smart Cellar steps
 * (migrations 0043-0045), with the new view's gate open. Nothing is mocked: the app's own API finds the columns
 * missing and the screen falls back to the existing view.
 *
 *   terminal 1:  STACK_MIGRATIONS_BEFORE=20261120000043 bash scripts/local-stack/up.sh
 *   terminal 2:  OLD_DB=1 pnpm exec playwright test smart-cellar-3d-old-db --project=desktop
 *
 * (Playwright reuses a stack that is already up. Stop it afterwards: the other suites need every migration.)
 */
test.skip(!process.env.OLD_DB, "only against a database without the Smart Cellar steps (OLD_DB=1)");
test.use({ baseURL: PREVIEW_URL });
test.setTimeout(150_000);

test("a preview on a database without 0043-0045: the existing 3D view, whole; every action still works", async ({
  page,
  request,
}) => {
  const { email } = await arrive(page, "olddb");
  const { call } = await apiClient(request, email);
  const place = (
    await call("post", "/storage", { label: "Old rack", kind: "rack", rows: 3, cols: 4 }, 201)
  ).body as { id: string };
  await call("post", "/storage", { label: "Old fridge", kind: "fridge", rows: 2, cols: 3 }, 201);
  const wine = (
    await call(
      "post",
      "/wines",
      { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" },
      201,
    )
  ).body as { id: string };
  await call(
    "post",
    "/bottles",
    { wineId: wine.id, year: 2015, quantity: 3, locationId: place.id },
    201,
  );

  // the app's own API, on this database: switched on, and honest about what the database has
  const capabilities = (await call("get", "/smart-cellar", undefined, 200)).body as {
    reads: boolean;
    schema: { reads: string; writes: string };
  };
  expect(capabilities.reads).toBe(true);
  expect(capabilities.schema).toEqual({ reads: "missing", writes: "missing" });
  const list = await call("get", "/smart-cellar/storage", undefined, 404);
  expect(JSON.stringify(list.body)).toContain("isn't set up on this server yet");

  // the old API is what it was
  const racks = (await call("get", "/racks", undefined, 200)).body as {
    units: Array<{ label: string; bottles: unknown[] }>;
  };
  expect(racks.units.map((u) => [u.label, u.bottles.length])).toEqual([
    ["Old rack", 3],
    ["Old fridge", 0],
  ]);

  // the screen: the existing view, nothing said about anything being wrong
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page.getByTestId("smart-3d")).toHaveAttribute("data-mode", "schema-missing", {
    timeout: 30_000,
  });
  const legacy = page.getByTestId("cellar-3d");
  await expect(legacy).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
  await expect(page.getByTestId("smart-3d-failed")).toHaveCount(0);
  await expect(page.getByTestId("smart-3d-stage")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Old rack" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // and it is the whole existing view: a bottle can be looked at, with its actions
  await page.getByRole("button", { name: /Pavillon Rouge 2015, shelf 1, position 1/ }).focus();
  await page.keyboard.press("Enter");
  const legacyPanel = page.getByTestId("bottle-showcase");
  await expect(legacyPanel).toHaveAttribute("data-open", "true", { timeout: 30_000 });
  await expect(legacyPanel.getByRole("button", { name: "Open this bottle" })).toBeVisible();
});
