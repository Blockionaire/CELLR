import { expect as baseExpect, test, type Page } from "@playwright/test";
import {
  APP_URL,
  FEATURES_URL,
  PREVIEW_URL,
  apiClient,
  arrive,
  audit,
  bearer,
  signIn,
  sql,
} from "./helpers";

/**
 * Smart Cellar 3D, sprint 3: the Rack Builder, with a real signed-in household in the local stack.
 *
 * The three test servers (playwright.config.ts) are the three states of its gate:
 *   3100  nothing set                                                         closed: "not found", no way in
 *   3101  CELLR_SMART_CELLAR_BUILDER=1 (and API "write") on an unmarked production build   must stay CLOSED
 *   3102  the same on a Vercel preview, on the local stack's database           open, and saving is possible
 * A preview that points at the production database is not reproducible here without touching it: that rule is held
 * by unit tests of the server's gate (lib/smart-cellar-write-target.test.ts, smart-cellar-builder-gate.test.ts),
 * and the builder's preview-only mode is shown here by what the server says (capabilities: writes false).
 */
test.setTimeout(150_000);
/**
 * Every assertion here may wait up to 15 s (not 5): the builder's page loads its data and draws its first picture
 * with a software renderer on the test machine, which on a cold server or a loaded one can take more than 5 s.
 * Nothing is weakened: what is expected is the same, only how long it may take to appear.
 */
const expect = baseExpect.configure({ timeout: 15_000 });

type Call = Awaited<ReturnType<typeof apiClient>>["call"];
const RED = { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" };

async function addPlace(call: Call, label: string, kind: string, rows: number, cols: number) {
  return ((await call("post", "/storage", { label, kind, rows, cols }, 201)).body as { id: string })
    .id;
}
async function addBottles(call: Call, quantity: number, locationId: string | null) {
  const w = (await call("post", "/wines", RED, 201)).body as { id: string };
  return (await call("post", "/bottles", { wineId: w.id, year: 2015, quantity, locationId }, 201))
    .body as { bottleIds: string[] };
}
const placeRow = (id: string) =>
  sql<{
    label: string;
    kind: string;
    template: string | null;
    grid_rows: number;
    grid_cols: number;
    cell_capacity: number;
    slot_semantics: string | null;
    appearance: Record<string, unknown> | null;
    updated_at: string;
  }>(
    "select label, kind, template, grid_rows, grid_cols, cell_capacity, slot_semantics, appearance, updated_at::text from public.cellar_locations where id = $1",
    [id],
  ).then((r) => r[0]!);
const zoneRows = (id: string) =>
  sql<{ from_row: number; to_row: number; purpose: string; target_temp_c: string | null }>(
    "select from_row, to_row, purpose, target_temp_c::text from public.cellar_location_zones where location_id = $1 order by zone_index",
    [id],
  );
const bottleRows = (id: string) =>
  sql(
    "select id, location_id, loc_row, loc_col, loc_index, status, updated_at::text from public.bottles where location_id = $1 order by id",
    [id],
  );
const placesOf = (householdId: string) =>
  sql<{ id: string; label: string }>(
    "select id, label from public.cellar_locations where household_id = $1 order by created_at",
    [householdId],
  );

/**
 * The app's "not found" page, and nothing of the builder. (The signed-in area streams its pages, so a page that
 * turns out not to exist is answered with the not-found page inside a 200; what matters is what is in it.)
 */
async function notFoundAt(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "We couldn't find that page." })).toBeVisible();
  await expect(page.getByTestId("rack-builder")).toHaveCount(0);
  expect(await page.content()).not.toContain("builder-catalogue");
}

// ---- driving the builder ------------------------------------------------------------------------------------------
const builder = (page: Page) => page.getByTestId("rack-builder");
const stage = (page: Page) => page.getByTestId("builder-stage");
const saveButton = (page: Page) => page.getByTestId("builder-save");
const drawn = (page: Page) =>
  expect(stage(page).locator("canvas[data-engine]")).toHaveAttribute("data-frames", /^[1-9]/, {
    timeout: 90_000,
  });
const debugOn = (page: Page) =>
  page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
async function step(
  page: Page,
  field: "rows" | "cols" | "cellCapacity",
  direction: "down" | "up",
  times = 1,
) {
  const group = page.getByTestId(`builder-${field}`);
  const button = group.getByRole("button").nth(direction === "down" ? 0 : 1);
  for (let i = 0; i < times; i++) await button.click();
}
const value = async (page: Page, field: string) =>
  Number(await page.getByTestId(`builder-${field}`).getAttribute("data-value"));

/** Everything the page asks the server for, and whether any builder code was fetched. */
function watch(page: Page) {
  const paths: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    paths.push(url.pathname);
  });
  return {
    builderPages: () => paths.filter((p) => p.startsWith("/cellar/builder")),
    smart: () => paths.filter((p) => p.startsWith("/api/v1/smart-cellar")),
  };
}

// =================================================================================================================
test.describe("gate closed (the default)", () => {
  test.use({ baseURL: APP_URL });

  test("no way in from the racks, the page is not found, and no layout can be written", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "bclosed");
    const { call, token } = await apiClient(request, email);
    const rack = await addPlace(call, "Rack", "rack", 3, 4);
    await addBottles(call, 1, rack);
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "Racks" }).click();
    await expect(page.getByRole("button", { name: /Rack/ }).first()).toBeVisible();
    await expect(page.getByTestId("builder-entry")).toHaveCount(0);
    for (const path of ["/cellar/builder", `/cellar/builder/${rack}`]) await notFoundAt(page, path);
    const put = await request.put(`/api/v1/smart-cellar/storage/${rack}/layout`, {
      headers: bearer(token),
      data: {},
    });
    expect(put.status()).toBe(404);
  });
});

test.describe("gate asked for on a production build: stays CLOSED", () => {
  test.use({ baseURL: FEATURES_URL });

  test("CELLR_SMART_CELLAR_BUILDER=1 opens nothing there, and the API cannot write", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "bprod");
    const { call, token } = await apiClient(request, email);
    const rack = await addPlace(call, "Rack", "rack", 3, 4);
    await addBottles(call, 1, rack);
    const before = await placeRow(rack);
    await notFoundAt(page, "/cellar/builder");
    await notFoundAt(page, `/cellar/builder/${rack}`);
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "Racks" }).click();
    await expect(page.getByTestId("builder-entry")).toHaveCount(0);
    const put = await request.put(`/api/v1/smart-cellar/storage/${rack}/layout`, {
      headers: bearer(token),
      data: {
        structure: { template: "rack_classic", rows: 3, cols: 4, cellCapacity: 1, zones: [] },
        appearance: { v: 1, material: "wood", color: "oak", lighting: "none", door: "none" },
      },
    });
    expect(put.status()).toBe(403);
    expect(await placeRow(rack)).toEqual(before);
  });
});

// =================================================================================================================
test.describe("gate open (an internal preview on a test database)", () => {
  test.use({ baseURL: PREVIEW_URL });

  test("the catalogue: all fourteen templates, three of them preview only, never saved as something else", async ({
    page,
  }) => {
    await debugOn(page);
    await arrive(page, "bcat");
    await page.goto("/cellar/builder");
    await expect(builder(page)).toHaveAttribute("data-mode", "new");
    const cards = page.getByTestId("builder-catalogue").getByRole("radio");
    await expect(cards).toHaveCount(14);
    const previewOnly = page.locator('[data-testid^="template-"][data-savable="false"]');
    await expect(previewOnly).toHaveCount(3);
    for (const id of ["rack_double_depth", "cube_modular", "diamond_bins"])
      await expect(page.getByTestId(`template-${id}`)).toContainText("Preview only");
    await drawn(page);

    // a preview-only template: drawn, its bottles per spot as the template has them, and no save
    await page.getByTestId("template-rack_double_depth").click();
    await expect(stage(page)).toHaveAttribute("data-template", "rack_double_depth");
    await expect(stage(page)).toHaveAttribute("data-cell-capacity", "2");
    await expect(builder(page)).toHaveAttribute("data-status", "preview");
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.getByTestId("builder-problems")).toContainText("can't be stored yet");
    // it cannot be stepped down to one
    await expect(page.getByTestId("builder-cellCapacity")).toHaveAttribute("data-min", "2");
    await expect(page.getByTestId("builder-use-one")).toHaveCount(0);

    // crates come six to a compartment: a preview, until one per compartment is chosen, explicitly
    await page.getByTestId("template-crate_storage").click();
    await expect(builder(page)).toHaveAttribute("data-status", "preview");
    await page.getByTestId("builder-use-one").click();
    await expect(stage(page)).toHaveAttribute("data-cell-capacity", "1");
    await expect(builder(page)).toHaveAttribute("data-status", "ready");
    await expect(saveButton(page)).toBeEnabled();

    // every template can be chosen and is drawn
    for (const id of [
      "rack_classic",
      "rack_metal",
      "shelving_open",
      "cabinet_closed",
      "cube_modular",
      "diamond_bins",
      "wall_pegs",
      "wall_rails",
      "cooler_single",
      "cooler_dual",
      "cooler_undercounter",
      "rack_generic",
    ]) {
      await page.getByTestId(`template-${id}`).click();
      await expect(stage(page)).toHaveAttribute("data-template", id);
      await expect(page.getByTestId(`template-${id}`)).toHaveAttribute("aria-checked", "true");
    }
    await drawn(page);
    // one canvas, whatever was chosen
    await expect(page.locator("canvas[data-engine]")).toHaveCount(1);
  });

  test("a new place from start to finish: designed, saved in one place, and in the cellar", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { householdId, email } = await arrive(page, "bnew");
    // a bottle not on any place yet, so the cellar has its views
    await addBottles((await apiClient(request, email)).call, 1, null);
    const seen = watch(page);
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "Racks" }).click();
    await page.getByTestId("builder-entry").first().click();
    await expect(page).toHaveURL(/\/cellar\/builder$/);
    await drawn(page);

    await page.getByTestId("template-cooler_dual").click();
    await page.getByTestId("builder-name").fill("Kitchen cooler");
    await step(page, "rows", "down", 2); // 8 → 6 shelves
    await expect(stage(page)).toHaveAttribute("data-rows", "6");
    // the zones followed the shelves, still a split
    await expect(page.getByTestId("builder-zone-0")).toContainText("shelves 1–3");
    await expect(page.getByTestId("builder-zone-1")).toContainText("shelves 4–6");
    await page.getByTestId("builder-zone-split").getByRole("button").first().click(); // top zone: 2 shelves
    await page
      .getByRole("radiogroup", { name: "Colour" })
      .getByRole("radio", { name: "Stainless steel" })
      .click();
    await expect(stage(page)).toHaveAttribute("data-color", "stainless");
    await page.getByTestId("builder-lighting").getByRole("radio", { name: "Cool light" }).click();
    await expect(stage(page)).toHaveAttribute("data-lighting", "cool");
    await expect(builder(page)).toHaveAttribute("data-status", "ready");

    await saveButton(page).click();
    // two calls and a refresh of the cellar, on a machine that draws in software: allow it the time
    await expect(page).toHaveURL(/\/cellar\/builder\/[0-9a-f-]{36}\?saved=1$/, { timeout: 30_000 });
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
    const id = page.url().match(/builder\/([0-9a-f-]{36})/)![1]!;

    const row = await placeRow(id);
    expect(row).toMatchObject({
      label: "Kitchen cooler",
      kind: "fridge",
      template: "cooler_dual",
      grid_rows: 6,
      grid_cols: 5,
      cell_capacity: 1,
      slot_semantics: "depth",
    });
    expect(row.appearance).toEqual({
      v: 1,
      material: "metal",
      color: "stainless",
      lighting: "cool",
      door: "glass",
    });
    expect(await zoneRows(id)).toEqual([
      { from_row: 1, to_row: 2, purpose: "serving", target_temp_c: "8.0" },
      { from_row: 3, to_row: 6, purpose: "storage", target_temp_c: "12.0" },
    ]);
    // exactly one place was made
    expect((await placesOf(householdId)).map((p) => p.label)).toEqual(["Kitchen cooler"]);
    expect(seen.builderPages().length).toBeGreaterThan(0);

    // back in the cellar: there it is
    await page.getByTestId("builder-see-in-cellar").click();
    await page.getByRole("radio", { name: "Racks" }).click();
    await expect(page.getByText("Kitchen cooler")).toBeVisible();
  });

  test("the design fails after the place was made: said, kept, and saved on the second try, never made twice", async ({
    page,
  }) => {
    await debugOn(page);
    const { householdId } = await arrive(page, "bpartial");
    let failures = 1;
    await page.route("**/api/v1/smart-cellar/storage/*/layout", async (route) => {
      if (failures-- > 0)
        return route.fulfill({
          status: 500,
          json: { error: { code: "INTERNAL", message: "boom", retryable: true } },
        });
      return route.continue();
    });
    await page.goto("/cellar/builder");
    await page.getByTestId("template-rack_metal").click();
    await page.getByTestId("builder-name").fill("Garage rack");
    await saveButton(page).click();
    await expect(page).toHaveURL(/\/cellar\/builder\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const id = page.url().match(/builder\/([0-9a-f-]{36})/)![1]!;
    const banner = page.getByTestId("builder-partial-create");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("A basic place “Garage rack” was made");
    // the basic place is there, without a design; nothing was deleted to hide it
    expect(await placeRow(id)).toMatchObject({ label: "Garage rack", template: null });
    // the draft was kept: still the metal rack
    await expect(stage(page)).toHaveAttribute("data-template", "rack_metal");
    // a reload keeps the place and the draft (nothing is made again)
    // after a reload the builder loads again (a picture drawn in software): give it the time
    await page.reload();
    await expect(page.getByTestId("builder-partial-create")).toBeVisible({ timeout: 30_000 });
    await saveButton(page).click();
    await page.getByTestId("builder-confirm-save").click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
    expect(await placeRow(id)).toMatchObject({ template: "rack_metal", kind: "rack" });
    expect((await placesOf(householdId)).map((p) => p.id)).toEqual([id]);
  });

  test("making the place fails: nothing is made, the draft stays, and it can be tried again", async ({
    page,
  }) => {
    const { householdId } = await arrive(page, "bnet");
    await page.goto("/cellar/builder");
    await page.getByTestId("builder-name").fill("Cellar wall");
    await page.route("**/api/v1/storage", (route) =>
      route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
    );
    await saveButton(page).click();
    await expect(page.getByTestId("builder-save-failed")).toContainText("Nothing was saved");
    expect(await placesOf(householdId)).toEqual([]);
    await page.unroute("**/api/v1/storage");
    await saveButton(page).click();
    await expect(page).toHaveURL(/\?saved=1$/, { timeout: 30_000 });
    expect((await placesOf(householdId)).map((p) => p.label)).toEqual(["Cellar wall"]);
  });

  test("an existing place with bottles: suggested, never decided by opening; bottles block what would strand them; saved as chosen, no bottle moved", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { email } = await arrive(page, "bedit");
    const { call } = await apiClient(request, email);
    const rack = await addPlace(call, "Hall rack", "rack", 5, 8);
    await addBottles(call, 12, rack);
    const before = await placeRow(rack);
    const bottlesBefore = await bottleRows(rack);

    await page.goto("/cellar");
    await page.getByRole("radio", { name: "Racks" }).click();
    // one place: it is open already
    await page.getByRole("button", { name: "Manage" }).click();
    await page.getByTestId("builder-entry-edit").click();
    await expect(page).toHaveURL(new RegExp(`/cellar/builder/${rack}$`));
    await drawn(page);
    await expect(builder(page)).toHaveAttribute("data-mode", "edit");
    await expect(page.getByTestId("builder-suggested")).toContainText("Classic wooden rack");
    await expect(stage(page)).toHaveAttribute("data-bottles", "12");
    await expect(builder(page)).toHaveAttribute("data-status", "blocked");
    await expect(page.locator('[data-problem="no_template"]')).toBeVisible();
    // opening it wrote nothing
    expect(await placeRow(rack)).toEqual(before);

    await page.getByTestId("template-rack_classic").click();
    await expect(builder(page)).toHaveAttribute("data-status", "ready");
    // 12 bottles fill shelf 1 (8) and half of shelf 2: fewer spots per shelf strands some
    await step(page, "cols", "down", 3);
    const blockers = page.getByTestId("builder-blockers");
    await expect(blockers).toBeVisible();
    await expect(blockers).toContainText("would lose their spot");
    await expect(stage(page)).toHaveAttribute("data-stranded", /^[1-9]/);
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.locator('[data-problem="in_use"]')).toBeVisible();
    // back to what fits: the blockers go
    await page.getByTestId("builder-undo").click();
    await page.getByTestId("builder-undo").click();
    await page.getByTestId("builder-undo").click();
    await expect(blockers).toHaveCount(0);
    await step(page, "rows", "up", 1);
    await page
      .getByRole("radiogroup", { name: "Colour" })
      .getByRole("radio", { name: "Oak" })
      .click();

    await saveButton(page).click();
    const confirm = page.getByTestId("builder-confirm");
    await expect(confirm).toContainText("Kind: — → Classic wooden rack");
    await expect(confirm).toContainText("Size: 5 × 8 → 6 × 8");
    await page.getByTestId("builder-confirm-save").click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });

    const after = await placeRow(rack);
    expect(after).toMatchObject({
      template: "rack_classic",
      slot_semantics: "depth",
      grid_rows: 6,
      grid_cols: 8,
      cell_capacity: 1,
    });
    expect(after.appearance).toMatchObject({ material: "wood", color: "oak" });
    // not one bottle moved, renumbered or touched
    expect(await bottleRows(rack)).toEqual(bottlesBefore);

    // straight on: another colour and a new name, saved over the version just saved (never taken for someone
    // else's change), the look as a layout save and the name as a rename
    await page
      .getByRole("radiogroup", { name: "Colour" })
      .getByRole("radio", { name: "Pine" })
      .click();
    await page.getByTestId("builder-name").fill("Hall rack, oak");
    await expect(page.getByTestId("builder-changed-elsewhere")).toHaveCount(0);
    await saveButton(page).click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("builder-save-failed")).toHaveCount(0);
    expect(await placeRow(rack)).toMatchObject({
      label: "Hall rack, oak",
      template: "rack_classic",
    });
    expect((await placeRow(rack)).appearance).toMatchObject({ color: "pine" });
    expect(await bottleRows(rack)).toEqual(bottlesBefore);
    // and once more, a rename only
    await page.getByTestId("builder-name").fill("Hall rack");
    await saveButton(page).click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
    expect((await placeRow(rack)).label).toBe("Hall rack");
  });

  test("a place whose stored design this app does not know: shown neutral, nothing decided, nothing written by looking", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { email } = await arrive(page, "bunknown");
    const { call } = await apiClient(request, email);
    const rack = await addPlace(call, "Odd rack", "rack", 3, 4);
    await sql(
      "update public.cellar_locations set template = 'hex_rack_2031', slot_semantics = 'depth' where id = $1",
      [rack],
    );
    const before = await placeRow(rack);
    await page.goto(`/cellar/builder/${rack}`);
    await drawn(page);
    await expect(stage(page)).toHaveAttribute("data-neutral", "true");
    await expect(page.getByTestId("builder-unknown")).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
    await page.getByTestId("template-rack_metal").click();
    await expect(stage(page)).toHaveAttribute("data-neutral", "false");
    await expect(stage(page)).toHaveAttribute("data-template", "rack_metal");
    expect(await placeRow(rack)).toEqual(before);
  });

  test("a place changed by someone else meanwhile is not overwritten: said, and the latest version can be loaded", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { email } = await arrive(page, "bstale");
    const { call } = await apiClient(request, email);
    const rack = await addPlace(call, "Shared rack", "rack", 4, 6);
    await call(
      "put",
      `/smart-cellar/storage/${rack}/layout`,
      {
        structure: { template: "rack_classic", rows: 4, cols: 6, cellCapacity: 1, zones: [] },
        appearance: { v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" },
      },
      200,
    );
    await page.goto(`/cellar/builder/${rack}`);
    await drawn(page);
    await page
      .getByRole("radiogroup", { name: "Colour" })
      .getByRole("radio", { name: "Ebony" })
      .click();
    // someone else in the household saves another colour meanwhile
    await call(
      "put",
      `/smart-cellar/storage/${rack}/layout`,
      {
        structure: { template: "rack_classic", rows: 4, cols: 6, cellCapacity: 1, zones: [] },
        appearance: { v: 1, material: "wood", color: "pine", lighting: "none", door: "none" },
      },
      200,
    );
    await saveButton(page).click();
    const failed = page.getByTestId("builder-save-failed");
    await expect(failed).toHaveAttribute("data-stale", "true");
    await expect(failed).toContainText("Someone changed this place");
    // their colour is what is stored
    expect((await placeRow(rack)).appearance).toMatchObject({ color: "pine" });
    await failed.getByRole("button", { name: "Load the latest version" }).click();
    await expect(page.getByTestId("builder-color")).toHaveAttribute("data-value", "pine");
    await expect(builder(page)).toHaveAttribute("data-dirty", "false");
  });

  test("loading the latest version fails: nothing is lost, it is said, and it can be tried again (review correction)", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { email } = await arrive(page, "breload");
    const { call } = await apiClient(request, email);
    const rack = await addPlace(call, "Shared rack", "rack", 4, 6);
    const layout = (color: string) => ({
      structure: { template: "rack_classic", rows: 4, cols: 6, cellCapacity: 1, zones: [] },
      appearance: { v: 1, material: "wood", color, lighting: "none", door: "none" },
    });
    await call("put", `/smart-cellar/storage/${rack}/layout`, layout("walnut"), 200);
    await page.goto(`/cellar/builder/${rack}`);
    await drawn(page);
    await page
      .getByRole("radiogroup", { name: "Colour" })
      .getByRole("radio", { name: "Ebony" })
      .click();
    await step(page, "rows", "up", 1);
    await call("put", `/smart-cellar/storage/${rack}/layout`, layout("pine"), 200);
    await saveButton(page).click();
    // a change of size asks first
    await page.getByTestId("builder-confirm-save").click();
    const failed = page.getByTestId("builder-save-failed");
    await expect(failed).toHaveAttribute("data-stale", "true");

    // the server cannot be reached: the cached place (walnut) must not be taken for the latest one
    const bottles = `**/api/v1/smart-cellar/storage/${rack}/bottles`;
    await page.route(bottles, (route) => route.abort("internetdisconnected"));
    await failed.getByRole("button", { name: "Load the latest version" }).click();
    const reloadFailed = page.getByTestId("builder-reload-failed");
    await expect(reloadFailed).toContainText("The latest version couldn't be loaded");
    await expect(reloadFailed).toContainText("Your changes are still here");
    await expect(page.getByTestId("builder-color")).toHaveAttribute("data-value", "ebony");
    expect(await value(page, "rows")).toBe(5);
    await expect(builder(page)).toHaveAttribute("data-dirty", "true");
    // the draft is still in the browser's memory, and undo still has its history
    expect(
      await page.evaluate(() =>
        Object.keys(window.sessionStorage).some((k) => k.startsWith("cellr:builder:v1:")),
      ),
    ).toBe(true);
    await expect(page.getByTestId("builder-undo")).toBeEnabled();

    // signed out meanwhile (401): said as well, still nothing lost
    await page.unroute(bottles);
    await page.route(bottles, (route) =>
      route.fulfill({
        status: 401,
        json: {
          error: { code: "UNAUTHORIZED", message: "Please sign in again.", retryable: false },
        },
      }),
    );
    await reloadFailed.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("builder-reload-failed")).toBeVisible();
    await expect(page.getByTestId("builder-color")).toHaveAttribute("data-value", "ebony");

    // back: trying again loads what the server has now
    await page.unroute(bottles);
    await page
      .getByTestId("builder-reload-failed")
      .getByRole("button", { name: "Try again" })
      .click();
    await expect(page.getByTestId("builder-color")).toHaveAttribute("data-value", "pine");
    await expect(builder(page)).toHaveAttribute("data-dirty", "false");
    await expect(page.getByTestId("builder-reload-failed")).toHaveCount(0);
  });

  test("after a save, a refresh that fails changes nothing: the next save stands on the save's own revision (review correction)", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { email } = await arrive(page, "bpostsave");
    const { call } = await apiClient(request, email);
    const rack = await addPlace(call, "Hall rack", "rack", 4, 6);
    await page.goto(`/cellar/builder/${rack}`);
    await drawn(page);
    await page.getByTestId("template-rack_classic").click();
    // from here on every refresh of this place fails
    await page.route(`**/api/v1/smart-cellar/storage/${rack}/bottles`, (route) =>
      route.abort("internetdisconnected"),
    );
    await saveButton(page).click();
    await page.getByTestId("builder-confirm-save").click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
    // again: a look, then a look and a name (layout save, then a conditional rename), with no refresh at all
    await page
      .getByRole("radiogroup", { name: "Colour" })
      .getByRole("radio", { name: "Oak" })
      .click();
    await saveButton(page).click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole("radiogroup", { name: "Colour" })
      .getByRole("radio", { name: "Pine" })
      .click();
    await page.getByTestId("builder-name").fill("Hall rack, pine");
    await saveButton(page).click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("builder-save-failed")).toHaveCount(0);
    await expect(page.getByTestId("builder-changed-elsewhere")).toHaveCount(0);
    const row = await placeRow(rack);
    expect(row).toMatchObject({ label: "Hall rack, pine", template: "rack_classic" });
    expect(row.appearance).toMatchObject({ color: "pine" });
  });

  test("a rename made against a stale version is refused, and theirs is kept (review correction)", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { email } = await arrive(page, "brename");
    const { call } = await apiClient(request, email);
    const rack = await addPlace(call, "Old name", "rack", 4, 6);
    await call(
      "put",
      `/smart-cellar/storage/${rack}/layout`,
      {
        structure: { template: "rack_classic", rows: 4, cols: 6, cellCapacity: 1, zones: [] },
        appearance: { v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" },
      },
      200,
    );
    await page.goto(`/cellar/builder/${rack}`);
    await drawn(page);
    await page.getByTestId("builder-name").fill("My new name");
    // someone else renames it meanwhile, through the existing edit (no revision: as every client of today)
    await call("patch", `/storage/${rack}`, { label: "Their name" }, 200);
    await saveButton(page).click();
    const failed = page.getByTestId("builder-save-failed");
    await expect(failed).toHaveAttribute("data-stale", "true");
    expect((await placeRow(rack)).label).toBe("Their name");
    await failed.getByRole("button", { name: "Load the latest version" }).click();
    await expect(page.getByTestId("builder-name")).toHaveValue("Their name");
    // and now, against the current version, it is taken
    await page.getByTestId("builder-name").fill("My new name");
    await saveButton(page).click();
    await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
    expect((await placeRow(rack)).label).toBe("My new name");
  });

  test("PATCH /storage/:id: as before without If-Match; a rename with it is applied only to the version named (review correction)", async ({
    page,
    request,
    browser,
  }) => {
    const { email } = await arrive(page, "bpatch");
    const { token, call } = await apiClient(request, email);
    const rack = await addPlace(call, "Rack", "rack", 3, 4);
    const patch = (data: object, ifMatch?: string) =>
      request.patch(`/api/v1/storage/${rack}`, {
        headers: { ...bearer(token), ...(ifMatch === undefined ? {} : { "if-match": ifMatch }) },
        data,
      });
    // existing clients: rename and resize, no revision involved, the answer as before
    const legacy = await patch({ label: "Rack A", rows: 4 });
    expect(legacy.status()).toBe(200);
    const legacyBody = (await legacy.json()) as Record<string, unknown>;
    expect(legacyBody).toMatchObject({ label: "Rack A", rows: 4, cols: 4 });
    expect(legacyBody).not.toHaveProperty("revision");

    const revisionOf = async () =>
      (
        (await call("get", `/smart-cellar/storage/${rack}`, undefined, 200)).body as {
          revision: string;
        }
      ).revision;
    const before = await revisionOf();
    // a stale revision: 409, nothing changes
    const stale = await patch({ label: "Rack B" }, `"2000-01-01T00:00:00+00:00"`);
    expect(stale.status()).toBe(409);
    expect((await placeRow(rack)).label).toBe("Rack A");
    // not a time at all: names no version of this place, 409 as well
    expect((await patch({ label: "Rack B" }, `"not-a-revision"`)).status()).toBe(409);
    // more than a rename against a version: refused, unchanged
    const shaping = await patch({ label: "Rack B", rows: 5 }, `"${before}"`);
    expect(shaping.status()).toBe(422);
    expect(await placeRow(rack)).toMatchObject({ label: "Rack A", grid_rows: 4 });
    // a header that names no single revision is refused, never read as "no condition"
    expect((await patch({ label: "Rack B" }, "*")).status()).toBe(422);
    // the current revision: renamed, and the new revision comes back
    const ok = await patch({ label: "Rack B" }, `"${before}"`);
    expect(ok.status()).toBe(200);
    const body = (await ok.json()) as { label: string; revision: string };
    expect(body.label).toBe("Rack B");
    expect(body.revision).not.toBe(before);
    expect(body.revision).toBe(await revisionOf());
    // the same revision again: it is no longer current
    expect((await patch({ label: "Rack C" }, `"${before}"`)).status()).toBe(409);
    expect((await placeRow(rack)).label).toBe("Rack B");

    // another household, with the right revision: not found, unchanged
    const other = await browser.newPage({ baseURL: PREVIEW_URL });
    const { email: otherEmail } = await arrive(other, "bpatch2");
    await other.close();
    const { token: otherToken } = await apiClient(request, otherEmail);
    const foreign = await request.patch(`/api/v1/storage/${rack}`, {
      headers: { ...bearer(otherToken), "if-match": `"${body.revision}"` },
      data: { label: "Mine now" },
    });
    expect(foreign.status()).toBe(404);
    expect((await placeRow(rack)).label).toBe("Rack B");
  });

  test("two sessions save one place: the second is told, sees the first's layout, keeps its own change on top, and saves (sprint 8)", async ({
    page,
    request,
    browser,
  }) => {
    await debugOn(page);
    const { email } = await arrive(page, "bcas");
    const { call } = await apiClient(request, email);
    const rack = await addPlace(call, "Shared rack", "rack", 4, 6);
    await addBottles(call, 3, rack);
    const bottlesBefore = await bottleRows(rack);
    await call(
      "put",
      `/smart-cellar/storage/${rack}/layout`,
      {
        structure: { template: "rack_classic", rows: 4, cols: 6, cellCapacity: 1, zones: [] },
        appearance: { v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" },
      },
      200,
    );
    // the same person on a second device: a session of its own
    const other = await browser.newContext({
      baseURL: PREVIEW_URL,
      viewport: { width: 1280, height: 800 },
    });
    const second = await other.newPage();
    try {
      await debugOn(second);
      await signIn(second, email);
      await page.goto(`/cellar/builder/${rack}`);
      await second.goto(`/cellar/builder/${rack}`);
      await drawn(page);
      await drawn(second);

      // the first session changes the colour and saves
      await page
        .getByRole("radiogroup", { name: "Colour" })
        .getByRole("radio", { name: "Ebony" })
        .click();
      await saveButton(page).click();
      await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
      // ...and saves again straight on, from the revision its own save answered with: never "stale" (a revision that
      // lost its microseconds anywhere between the database, PostgREST, the app and If-Match would be)
      await page
        .getByRole("radiogroup", { name: "Colour" })
        .getByRole("radio", { name: "Oak" })
        .click();
      await saveButton(page).click();
      await expect(page.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("builder-save-failed")).toHaveCount(0);
      expect((await placeRow(rack)).appearance).toMatchObject({ color: "oak" });

      // the second session, opened before those saves, adds a shelf and saves: refused, and said
      await step(second, "rows", "up", 1);
      await saveButton(second).click();
      await second.getByTestId("builder-confirm-save").click();
      const failed = second.getByTestId("builder-save-failed");
      await expect(failed).toHaveAttribute("data-stale", "true");
      await expect(failed).toContainText("Someone changed this place");
      // the newer save is what is stored, untouched; no bottle moved
      expect(await placeRow(rack)).toMatchObject({ grid_rows: 4, template: "rack_classic" });
      expect((await placeRow(rack)).appearance).toMatchObject({ color: "oak" });
      expect(await bottleRows(rack)).toEqual(bottlesBefore);
      // its own change is still there while it decides
      expect(await value(second, "rows")).toBe(5);

      // keep my change on the latest version: the first session's colour, the second's shelf, nothing saved yet
      await failed.getByTestId("builder-keep-mine").click();
      const rebased = second.getByTestId("builder-rebased");
      await expect(rebased).toBeVisible();
      await expect(rebased).toHaveAttribute("data-theirs", "look");
      await expect(rebased).toHaveAttribute("data-mine", "size");
      await expect(rebased).toContainText("Changed by someone else: look.");
      await expect(second.getByTestId("builder-color")).toHaveAttribute("data-value", "oak");
      expect(await value(second, "rows")).toBe(5);
      await expect(builder(second)).toHaveAttribute("data-dirty", "true");
      expect((await placeRow(rack)).grid_rows).toBe(4);
      // undo goes back to the draft as it was before (and redo is simply choosing again)
      await expect(second.getByTestId("builder-undo")).toBeEnabled();

      // and now it saves, on the latest revision
      await saveButton(second).click();
      await second.getByTestId("builder-confirm-save").click();
      await expect(second.getByTestId("builder-saved")).toBeVisible({ timeout: 30_000 });
      const after = await placeRow(rack);
      expect(after).toMatchObject({ grid_rows: 5, grid_cols: 6, template: "rack_classic" });
      expect(after.appearance).toMatchObject({ color: "oak" });
      expect(await bottleRows(rack)).toEqual(bottlesBefore);

      // the first session, now behind in turn, is told the same way when it saves
      await page
        .getByRole("radiogroup", { name: "Colour" })
        .getByRole("radio", { name: "Pine" })
        .click();
      await saveButton(page).click();
      const firstStale = page.getByTestId("builder-save-failed");
      const elsewhere = page.getByTestId("builder-changed-elsewhere");
      await expect(firstStale.or(elsewhere).first()).toBeVisible();
      expect((await placeRow(rack)).appearance).toMatchObject({ color: "oak" });
    } finally {
      await other.close();
    }
  });

  test("the API refuses a stale revision, and takes the current one (If-Match)", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "bifmatch");
    const { token, call } = await apiClient(request, email);
    const rack = await addPlace(call, "Rack", "rack", 3, 4);
    const body = {
      structure: { template: "rack_classic", rows: 3, cols: 4, cellCapacity: 1, zones: [] },
      appearance: { v: 1, material: "wood", color: "oak", lighting: "none", door: "none" },
    };
    const { revision } = (await call("get", `/smart-cellar/storage/${rack}`, undefined, 200))
      .body as {
      revision: string;
    };
    expect(revision).toBeTruthy();
    const stale = await request.put(`/api/v1/smart-cellar/storage/${rack}/layout`, {
      headers: { ...bearer(token), "if-match": '"2000-01-01 00:00:00+00"' },
      data: body,
    });
    expect(stale.status()).toBe(409);
    expect((await placeRow(rack)).template).toBeNull();
    const ok = await request.put(`/api/v1/smart-cellar/storage/${rack}/layout`, {
      headers: { ...bearer(token), "if-match": `"${revision}"` },
      data: body,
    });
    expect(ok.status()).toBe(200);
    expect((await placeRow(rack)).template).toBe("rack_classic");
  });

  test("two saves of one place at once: one of them, whole, never a mix of zones", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "brace");
    const { call } = await apiClient(request, email);
    const cooler = await addPlace(call, "Cooler", "fridge", 8, 4);
    const layout = (split: number) => ({
      structure: {
        template: "cooler_dual",
        rows: 8,
        cols: 4,
        cellCapacity: 1,
        zones: [
          { fromRow: 1, toRow: split, purpose: "serving", targetTempC: 8 },
          { fromRow: split + 1, toRow: 8, purpose: "storage", targetTempC: 12 },
        ],
      },
      appearance: { v: 1, material: "metal", color: "graphite", lighting: "warm", door: "glass" },
    });
    for (let round = 0; round < 5; round++) {
      const results = await Promise.all([
        call("put", `/smart-cellar/storage/${cooler}/layout`, layout(2)),
        call("put", `/smart-cellar/storage/${cooler}/layout`, layout(6)),
      ]);
      for (const r of results) expect([200, 409]).toContain(r.status);
      const zones = await zoneRows(cooler);
      expect([
        [2, 3],
        [6, 7],
      ]).toContainEqual([zones[0]!.to_row, zones[1]!.from_row]);
      expect(zones).toHaveLength(2);
    }
  });

  test("another household's place: not found here, and not written through the API", async ({
    page,
    request,
    browser,
  }) => {
    const owner = await browser.newPage({ baseURL: PREVIEW_URL });
    const { email: ownerEmail } = await arrive(owner, "bowner");
    const { call: ownerCall } = await apiClient(request, ownerEmail);
    const theirs = await addPlace(ownerCall, "Their rack", "rack", 3, 3);
    await owner.close();
    const before = await placeRow(theirs);

    const { email } = await arrive(page, "bother");
    const { token } = await apiClient(request, email);
    await page.goto(`/cellar/builder/${theirs}`);
    await expect(page.getByTestId("builder-failed")).toContainText("We couldn't find that place");
    const put = await request.put(`/api/v1/smart-cellar/storage/${theirs}/layout`, {
      headers: bearer(token),
      data: {
        structure: { template: "rack_classic", rows: 3, cols: 3, cellCapacity: 1, zones: [] },
        appearance: { v: 1, material: "wood", color: "oak", lighting: "none", door: "none" },
      },
    });
    expect(put.status()).toBe(404);
    expect(await placeRow(theirs)).toEqual(before);
  });

  test("signed out: the builder sends you to sign in, and the API answers 401", async ({
    page,
    request,
  }) => {
    await page.goto("/cellar/builder");
    await expect(page).not.toHaveURL(/\/cellar\/builder/);
    expect(
      (
        await request.put(
          "/api/v1/smart-cellar/storage/00000000-0000-4000-8000-000000000000/layout",
          {
            headers: { origin: PREVIEW_URL },
            data: {},
          },
        )
      ).status(),
    ).toBe(401);
  });

  test("unsaved changes: kept across a reload, undone, reset only after asking, and leaving asks first", async ({
    page,
  }) => {
    await debugOn(page);
    await arrive(page, "bunsaved");
    await page.goto("/cellar/builder");
    await drawn(page);
    await page.getByTestId("template-wall_pegs").click();
    await step(page, "rows", "up", 2);
    expect(await value(page, "rows")).toBe(8);
    await expect(builder(page)).toHaveAttribute("data-dirty", "true");
    // a reload (or the browser's back and forward) finds the draft as it was
    // after a reload the builder loads again (a picture drawn in software): give it the time
    await page.reload();
    await expect(page.getByTestId("builder-restored")).toBeVisible({ timeout: 30_000 });
    await expect(builder(page)).toHaveAttribute("data-template", "wall_pegs");
    expect(await value(page, "rows")).toBe(8);
    // undo, step by step
    await step(page, "rows", "up", 1);
    await page.getByTestId("builder-undo").click();
    expect(await value(page, "rows")).toBe(8);
    // leaving asks
    await page.getByTestId("builder-back").click();
    await expect(page.getByTestId("builder-discard")).toBeVisible();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(/\/cellar\/builder$/);
    // reset asks too, and then goes back to what is saved (a new place: the default rack)
    await page.getByTestId("builder-reset").click();
    await page.getByTestId("builder-discard-confirm").click();
    await expect(builder(page)).toHaveAttribute("data-template", "rack_classic");
    await expect(builder(page)).toHaveAttribute("data-dirty", "false");
    await page.reload();
    // once loaded again, there is nothing to restore
    await expect(builder(page)).toHaveAttribute("data-mode", "new", { timeout: 30_000 });
    await expect(page.getByTestId("builder-restored")).toHaveCount(0);
  });

  test("the look: a material keeps its colour where it can, and the preview follows every choice", async ({
    page,
  }) => {
    await debugOn(page);
    await arrive(page, "blook");
    await page.goto("/cellar/builder");
    await page.getByTestId("template-rack_generic").click();
    await drawn(page);
    const canvas = stage(page).locator("canvas[data-engine]");
    const azimuth = Number(await canvas.getAttribute("data-azimuth"));
    await page.getByTestId("builder-material").getByRole("radio", { name: "Metal" }).click();
    await expect(page.getByTestId("builder-reconciled")).toContainText("The colour changed");
    await expect(stage(page)).toHaveAttribute("data-material", "metal");
    await page
      .getByRole("radiogroup", { name: "Colour" })
      .getByRole("radio", { name: "Black" })
      .click();
    await page.getByTestId("builder-material").getByRole("radio", { name: "Lacquer" }).click();
    // black comes in lacquer too: kept
    await expect(page.getByTestId("builder-color")).toHaveAttribute("data-value", "black");
    await expect(page.getByTestId("builder-reconciled")).toHaveCount(0);
    // the same canvas all along, and the camera where it was (a look is not a new place)
    await expect(page.locator("canvas[data-engine]")).toHaveCount(1);
    expect(Number(await canvas.getAttribute("data-azimuth"))).toBe(azimuth);
  });

  test("preview only: where the server does not save, there is no Save button, and it says why", async ({
    page,
  }) => {
    await arrive(page, "bpreview");
    await page.route("**/api/v1/smart-cellar", async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as Record<string, unknown>;
      return route.fulfill({ response: res, json: { ...body, writes: false } });
    });
    await page.goto("/cellar/builder");
    await expect(page.getByTestId("builder-preview-only")).toBeVisible();
    await expect(saveButton(page)).toHaveCount(0);
    await expect(builder(page)).toHaveAttribute("data-can-save", "false");
  });

  test("a database without the Smart Cellar step: said plainly, no builder", async ({ page }) => {
    await arrive(page, "bschema");
    await page.route("**/api/v1/smart-cellar", (route) =>
      route.fulfill({
        json: {
          version: 1,
          reads: true,
          writes: false,
          depthPlacement: false,
          schema: { reads: "missing", writes: "missing" },
          catalogVersion: 1,
          appearanceVersion: 1,
          exportVersions: [1, 2],
        },
      }),
    );
    await page.goto("/cellar/builder");
    await expect(page.getByTestId("builder-not-set-up")).toBeVisible();
    await expect(page.getByTestId("builder-stage")).toHaveCount(0);
  });

  test("without WebGL: the flat plan of the same place, and the builder still works", async ({
    page,
  }) => {
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
    await arrive(page, "bflat");
    await page.goto("/cellar/builder");
    await expect(page.getByTestId("builder-flat")).toBeVisible();
    await expect(page.locator("canvas[data-engine]")).toHaveCount(0);
    await step(page, "rows", "up", 1);
    await expect(stage(page)).toHaveAttribute("data-rows", "6");
  });

  test("the browser takes the graphics memory back: said, and the preview starts again", async ({
    page,
  }) => {
    await debugOn(page);
    await arrive(page, "blost");
    await page.goto("/cellar/builder");
    await drawn(page);
    await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(
        '[data-testid="builder-stage"] canvas[data-engine]',
      )!;
      (c.getContext("webgl2") ?? c.getContext("webgl"))!
        .getExtension("WEBGL_lose_context")!
        .loseContext();
    });
    await expect(page.getByTestId("builder-lost")).toBeVisible();
    await page.getByRole("button", { name: "Show 3D again" }).click();
    await drawn(page);
    await expect(page.locator("canvas[data-engine]")).toHaveCount(1);
  });

  test("with the keyboard and a screen reader: named groups, arrow keys through the catalogue, no violations", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "keyboard: desktop");
    await debugOn(page);
    await arrive(page, "bkeys");
    await page.goto("/cellar/builder");
    await drawn(page);
    const first = page.getByTestId("template-rack_classic");
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("template-rack_double_depth")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(stage(page)).toHaveAttribute("data-template", "rack_double_depth");
    await expect(page.getByRole("group", { name: /Live 3D preview/ })).toBeVisible();
    await expect(page.getByRole("group", { name: "Shelves" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Colour" })).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });

  test("with reduced motion: the builder works the same", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await debugOn(page);
    await arrive(page, "breduced");
    await page.goto("/cellar/builder");
    await drawn(page);
    await page.getByTestId("template-wall_rails").click();
    await expect(stage(page)).toHaveAttribute("data-template", "wall_rails");
  });

  test("on a phone: the picture stays in view while choosing, the save bar is reachable, nothing is wider than the screen", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone layout");
    await debugOn(page);
    await arrive(page, "bphone");
    await page.goto("/cellar/builder");
    await drawn(page);
    const width = await page.evaluate(() => window.innerWidth);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    // scroll to the look: the picture is still on screen
    await page.getByTestId("builder-color").scrollIntoViewIfNeeded();
    const box = (await stage(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual((await page.viewportSize())!.height);
    // the save bar sits above the bottom navigation, and a tap on a swatch still changes the picture
    const bar = (await page.getByTestId("builder-savebar").boundingBox())!;
    const nav = (await page.getByRole("navigation").last().boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(nav.y + 1);
    await page
      .getByRole("radiogroup", { name: "Colour" })
      .getByRole("radio", { name: "Oak" })
      .tap();
    await expect(stage(page)).toHaveAttribute("data-color", "oak");
    await expect(saveButton(page)).toBeVisible();
  });
});
