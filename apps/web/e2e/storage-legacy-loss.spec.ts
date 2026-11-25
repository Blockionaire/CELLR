import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive } from "./helpers";

/**
 * Smart Cellar 3D, sprint 10 (pass 2): the EXISTING 3D view (a place from before templates) when the browser takes the
 * graphics memory back, five times over, while Quick Add's placeholders are on offer. Each time: the notice, then the
 * same picture holding the same resources, one canvas, and the placeholders back. Real household on the local stack.
 */
test.setTimeout(240_000);
test.use({ baseURL: PREVIEW_URL });
const expect = baseExpect.configure({ timeout: 30_000 });

const view = (page: Page) => page.getByTestId("smart-3d");
const stage = (page: Page) => page.getByTestId("cellar-3d");
const canvas = (page: Page) => stage(page).locator("canvas[data-engine]");
const ghosts = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __cellrLegacy3d?: { ghosts: () => { count: number } | null } }
      ).__cellrLegacy3d?.ghosts()?.count ?? 0,
  );

test("the existing view, lost and given back five times while adding: the same picture, resources and placeholders", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const { email } = await arrive(page, "legacyloss");
  const { call } = await apiClient(request, email);
  // a rack from before templates: 3 x 4, two bottles on it
  const rack = (
    (await call("post", "/storage", { label: "Old rack", kind: "rack", rows: 3, cols: 4 }, 201))
      .body as { id: string }
  ).id;
  const wine = (
    (await call("post", "/wines", { producer: "Old", name: "Rouge", type: "red" }, 201)).body as {
      id: string;
    }
  ).id;
  await call("post", "/bottles", { wineId: wine, year: 2016, quantity: 2, locationId: rack }, 201);

  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(view(page)).toHaveAttribute("data-unit-renderer", "legacy");
  await expect(canvas(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 60_000 });
  await page.getByTestId("quick-add-start").click();
  await expect(view(page)).toHaveAttribute("data-quick", "placing");
  await expect.poll(() => ghosts(page)).toBe(10);

  const held = async () => ({
    geometries: await canvas(page).getAttribute("data-geometries"),
    textures: await canvas(page).getAttribute("data-textures"),
    programs: await canvas(page).getAttribute("data-programs"),
    canvases: await canvas(page).count(),
    ghosts: await ghosts(page),
  });
  const rounds: Array<Awaited<ReturnType<typeof held>>> = [];
  for (let round = 0; round < 5; round++) {
    await canvas(page).evaluate((c: HTMLCanvasElement) => {
      (c.getContext("webgl2") ?? c.getContext("webgl"))!
        .getExtension("WEBGL_lose_context")!
        .loseContext();
    });
    // the notice stands over the picture (the existing view keeps its lost canvas under it until "Show 3D again")
    await expect(page.getByTestId("cellar-3d-lost")).toBeVisible();
    await page.getByRole("button", { name: "Show 3D again" }).click();
    await expect(canvas(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 60_000 });
    // still adding, the placeholders back
    await expect(view(page)).toHaveAttribute("data-quick", "placing");
    await expect.poll(() => ghosts(page)).toBe(10);
    await page.waitForTimeout(400);
    rounds.push(await held());
  }
  for (const r of rounds) expect(r).toEqual(rounds[0]);
  expect(rounds[0]!.canvases).toBe(1);
});
