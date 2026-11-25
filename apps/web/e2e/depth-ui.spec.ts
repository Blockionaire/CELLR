import { expect as baseExpect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive, sql } from "./helpers";

/**
 * DEPTH ON, in the screens (Smart Cellar 3D, sprint 9; ADR-011). OPT-IN: needs the local stack started with
 * STACK_DEPTH=1 (the gated depth files on its own throwaway database, the depth gate open on the preview server only).
 *   STACK_DEPTH=1 pnpm --filter @cellr/web e2e depth-ui --project=desktop --trace off
 * Without it every test here is skipped; the screens with depth CLOSED are held by the existing specs (placement,
 * rack-builder, quick-add, racks), which run unchanged.
 */
test.skip(process.env.STACK_DEPTH !== "1", "opt-in: STACK_DEPTH=1 (see the comment above)");
test.skip(({ isMobile }) => isMobile, "desktop project");
test.setTimeout(150_000);
test.use({ baseURL: PREVIEW_URL });
const expect = baseExpect.configure({ timeout: 15_000 });

type Call = Awaited<ReturnType<typeof apiClient>>["call"];
const RED = { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" };
const LOOK = { v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" };

async function deepRack(call: Call, label: string) {
  const id = (
    (await call("post", "/storage", { label, kind: "rack", rows: 3, cols: 4 }, 201)).body as {
      id: string;
    }
  ).id;
  await call(
    "put",
    `/smart-cellar/storage/${id}/layout`,
    {
      structure: { template: "rack_double_depth", rows: 3, cols: 4, cellCapacity: 2, zones: [] },
      appearance: LOOK,
    },
    200,
  );
  return id;
}
async function loose(call: Call, quantity: number) {
  const w = (await call("post", "/wines", RED, 201)).body as { id: string };
  return (
    (await call("post", "/bottles", { wineId: w.id, year: 2015, quantity, locationId: null }, 201))
      .body as {
      bottleIds: string[];
    }
  ).bottleIds;
}
const moveTo = (
  call: Call,
  id: string,
  locationId: string,
  row: number,
  col: number,
  index: number,
) =>
  call(
    "post",
    `/smart-cellar/bottles/${id}/move`,
    { from: null, to: { locationId, row, col, index } },
    200,
  );
const where = async (id: string) =>
  (
    await sql<{ s: string }>(
      "select loc_row || ':' || loc_col || ':' || loc_index as s from public.bottles where id = $1",
      [id],
    )
  )[0]!.s;

async function open3D(page: Page) {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page.getByTestId("smart-3d")).toHaveAttribute("data-mode", "ready");
}

test("depth on: a back spot is offered in the list, placed into, and the cell shows both bottles", async ({
  page,
  request,
}) => {
  const { email } = await arrive(page, "dpui");
  const { call } = await apiClient(request, email);
  const rack = await deepRack(call, "Deep rack");
  const [front, back, third] = await loose(call, 3);
  await moveTo(call, front!, rack, 1, 1, 1);
  await open3D(page);
  const list = page.getByTestId("placement-unplaced");
  await list.getByRole("button", { name: "Place" }).first().click();
  const picker = page.getByTestId("spot-picker");
  // the back of the cell whose front is taken is not offered; the back of an empty cell is
  await expect(picker.locator('[data-spot="1:1:2"]')).toHaveAttribute("data-state", "behind");
  await expect(picker.locator('[data-spot="1:2:2"]')).toHaveAttribute("data-state", "free");
  await expect(picker.locator('[data-spot="1:2:2"]')).toHaveAccessibleName(
    /place 2 from the front: free/,
  );
  await picker.locator('[data-spot="1:2:2"]').click();
  await expect(page.getByTestId("placement-summary")).toContainText("place 2 from the front");
  await page.getByTestId("placement-confirm").click();
  await expect(
    page.getByText(/is now at Deep rack · shelf 1 · spot 2 · place 2 from the front/),
  ).toBeVisible();
  const placed = await sql<{ id: string; s: string }>(
    "select id, loc_row || ':' || loc_col || ':' || loc_index as s from public.bottles where id = any($1::uuid[]) and loc_index = 2",
    [[back, third]],
  );
  expect(placed.map((p) => p.s)).toEqual(["1:2:2"]);
  expect(await where(front!)).toBe("1:1:1");
});

test("depth on: the old racks view shows a two-bottle cell as its front bottle and '+1 behind', and never drags it", async ({
  page,
  request,
}) => {
  const { email } = await arrive(page, "dpracks");
  const { call } = await apiClient(request, email);
  const rack = await deepRack(call, "Deep rack");
  const [front, back] = await loose(call, 2);
  await moveTo(call, back!, rack, 2, 2, 2);
  await moveTo(call, front!, rack, 2, 2, 1);
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "Racks" }).click();
  const cell = page.getByRole("button", {
    name: /Pavillon Rouge 2015, shelf 2, position 2, and 1 more bottle behind it/,
  });
  await expect(cell).toBeVisible();
  await expect(cell).toHaveAttribute("data-behind", "1");
  await expect(cell).toHaveAttribute("data-bottle-id", front!);
});

test("depth on: the Rack Builder saves a double-depth rack, and refuses a smaller layout that strands a back bottle", async ({
  page,
  request,
}) => {
  const { email } = await arrive(page, "dpbuild");
  const { call } = await apiClient(request, email);
  const rack = (
    (await call("post", "/storage", { label: "Hall rack", kind: "rack", rows: 3, cols: 4 }, 201))
      .body as {
      id: string;
    }
  ).id;
  await page.goto(`/cellar/builder/${rack}`);
  const builder = page.getByTestId("rack-builder");
  await expect(builder).toHaveAttribute("data-mode", "edit");
  // with depth open the double-depth rack is not "preview only"
  await expect(page.getByTestId("template-rack_double_depth")).toHaveAttribute(
    "data-savable",
    "true",
  );
  await page.getByTestId("template-rack_double_depth").click();
  await expect(builder).toHaveAttribute("data-status", "ready");
  await page.getByTestId("builder-save").click();
  await page.getByTestId("builder-confirm-save").click();
  await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
  const [row] = await sql<{ template: string; cell_capacity: number }>(
    "select template, cell_capacity from public.cellar_locations where id = $1",
    [rack],
  );
  expect(row).toMatchObject({ template: "rack_double_depth" });
  expect(row!.cell_capacity).toBeGreaterThan(1);
  // a bottle at the deepest place, then a shallower draft: blocked, nothing saved
  const [b] = await loose(call, 1);
  await moveTo(call, b!, rack, 3, 1, row!.cell_capacity); // at the back of the bottom shelf
  await page.reload();
  await expect(builder).toHaveAttribute("data-mode", "edit");
  // the template allows no fewer than 2 per spot, so a back bottle is stranded by taking its shelf away
  await page.getByTestId("builder-rows").getByRole("button").first().click();
  await expect(builder).toHaveAttribute("data-status", "blocked");
  await expect(page.locator('[data-problem="in_use"]')).toBeVisible();
  await expect(page.getByTestId("builder-save")).toBeDisabled();
  expect(
    (
      await sql<{ c: number }>(
        "select cell_capacity as c from public.cellar_locations where id = $1",
        [rack],
      )
    )[0]!.c,
  ).toBe(row!.cell_capacity);
});
