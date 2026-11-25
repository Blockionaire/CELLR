import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  APP_URL,
  FEATURES_URL,
  PREVIEW_URL,
  apiClient,
  arrive,
  audit,
  bearer,
  makeJpeg,
  sql,
} from "./helpers";

/**
 * Smart Cellar 3D, sprint 2B.3: the new storage view in the PRODUCT's 3D cellar, with real data: a signed-in person,
 * a household, places and bottles in the local stack's database, read through the app's own API.
 *
 * The three test servers (playwright.config.ts) are the three states of the renderer's gate:
 *   3100  nothing set                                       OFF: the existing 3D view, nothing new asked for
 *   3101  CELLR_SMART_CELLAR_3D=1 on an unmarked production build   must stay CLOSED (fail closed)
 *   3102  CELLR_SMART_CELLAR_3D=1 on a Vercel preview        ON: places with a template use the new view
 */
test.setTimeout(150_000);

const RED = {
  producer: "Château Margaux",
  name: "Pavillon Rouge",
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
};
const WHITE = {
  producer: "Domaine Test",
  name: "Chablis Premier Cru",
  type: "white",
  countryCode: "FR",
  region: "Burgundy",
};

type Call = Awaited<ReturnType<typeof apiClient>>["call"];
interface Placement {
  bottleId: string;
  row: number;
  col: number;
  index: number;
  vintageId: string;
  wineName: string;
  image: { id: string } | null;
}

/** A place, made through the old API as every place is today. */
const addPlace = async (call: Call, label: string, kind: string, rows: number, cols: number) =>
  ((await call("post", "/storage", { label, kind, rows, cols }, 201)).body as { id: string }).id;

/**
 * Gives a place a template, as the database owner (no product screen can yet, and layout writes are closed on two
 * of the three servers): exactly the columns migration 0043 added, nothing else.
 */
const giveTemplate = (placeId: string, template: string, semantics: string) =>
  sql("update public.cellar_locations set template = $2, slot_semantics = $3 where id = $1", [
    placeId,
    template,
    semantics,
  ]);

async function addBottles(
  call: Call,
  wine: object,
  year: number,
  quantity: number,
  locationId: string | null,
) {
  const w = (await call("post", "/wines", wine, 201)).body as { id: string };
  return (await call("post", "/bottles", { wineId: w.id, year, quantity, locationId }, 201))
    .body as { bottleIds: string[]; vintageId: string };
}

/** A label photo of the household's own, given to every bottle of a vintage (what "take a photo" does). */
async function givePhoto(
  page: Page,
  request: APIRequestContext,
  token: string,
  call: Call,
  vintageId: string,
) {
  const photo = await makeJpeg(page, { width: 600, height: 800, words: "PAVILLON" });
  const stored = (await (
    await request.post("/api/v1/images", {
      headers: bearer(token),
      multipart: {
        photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
        side: "front",
        blurColor: "#7d2234",
      },
    })
  ).json()) as { id: string };
  await call("put", `/cellar/${vintageId}/photo`, { imageId: stored.id, side: "front" }, 200);
  return stored.id;
}

/** A household with a rack that has a template (new view), and a fridge from before templates (existing view). */
async function mixedCellar(page: Page, request: APIRequestContext, label: string) {
  const { email, householdId } = await arrive(page, label);
  const { call, token } = await apiClient(request, email);
  const rack = await addPlace(call, "Oak rack", "rack", 3, 4);
  await giveTemplate(rack, "rack_classic", "depth");
  const fridge = await addPlace(call, "Old fridge", "fridge", 3, 4);
  const red = await addBottles(call, RED, 2015, 3, rack);
  const white = await addBottles(call, WHITE, 2019, 2, rack);
  const old = await addBottles(call, { ...RED, name: "Grand Vin" }, 2010, 2, fridge);
  return { email, householdId, call, token, rack, fridge, red, white, old };
}

// ---- driving the new view ---------------------------------------------------------------------------------------
const view = (page: Page) => page.getByTestId("smart-3d");
const stage = (page: Page) => page.getByTestId("smart-3d-stage");
const canvas = (page: Page) => stage(page).locator("canvas[data-engine]");
const storage = (page: Page) => stage(page).getByTestId("inspectable-storage");
const panel = (page: Page) => page.getByTestId("inspection-panel");
const legacyStage = (page: Page) => page.getByTestId("cellar-3d");
const num = async (page: Page, name: string) =>
  Number((await canvas(page).getAttribute(`data-${name}`)) ?? NaN);
const phase = (page: Page, value: "idle" | "extracting" | "inspecting" | "returning") =>
  expect(storage(page)).toHaveAttribute("data-showcase", value, { timeout: 45_000 });

/** The view's own readout (where a bottle is on the screen, its counters): asked for by this tab only. */
const withReadout = (page: Page) =>
  page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));

type Hooks = { locate(id: string): { x: number; y: number } | null; ids(): string[] };
const hooks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cellrStorage3d: Hooks }).__cellrStorage3d.ids());
async function whereIs(page: Page, id: string) {
  await canvas(page).scrollIntoViewIfNeeded();
  const at = await page.evaluate(
    (bottle) => (window as unknown as { __cellrStorage3d: Hooks }).__cellrStorage3d.locate(bottle),
    id,
  );
  expect(at, `bottle ${id} is in the picture`).not.toBeNull();
  const box = (await canvas(page).boundingBox())!;
  return { x: box.x + at!.x, y: box.y + at!.y };
}
async function tapBottle(page: Page, id: string, touch: boolean) {
  const at = await whereIs(page, id);
  if (touch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

/** Takes a bottle out through the list the 3D views keep for the keyboard and screen readers. */
async function viaTheList(page: Page, name: RegExp) {
  await page.getByRole("button", { name }).focus();
  await page.keyboard.press("Enter");
}

/** The cellar's 3D view, opened as a person does: the cellar, then "3D". */
async function open3D(page: Page) {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
}
async function openSmart(page: Page) {
  await open3D(page);
  await expect(view(page)).toHaveAttribute("data-mode", "ready", { timeout: 30_000 });
}
/**
 * How long a place's first picture may take here. Building a scene compiles its shaders on the main thread, and
 * software rendering on a loaded runner can hold that thread for several seconds: a trace showed the new stage painted
 * at once and the page not answering a query for 5.2 s (sprint 10, review S-D1). So everything that is first seen
 * when a place opens (after `openSmart` or a change of place) gets this budget, not the default 5 s.
 */
const FIRST_PICTURE = 60_000;
const drawn = (page: Page) =>
  expect(canvas(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: FIRST_PICTURE });
/** The stage of the place that has just opened, once the page answers again (see FIRST_PICTURE). */
const stageShows = (page: Page, name: string, value: string) =>
  expect(stage(page)).toHaveAttribute(name, value, { timeout: FIRST_PICTURE });
const placementsOf = async (call: Call, placeId: string) =>
  (
    (await call("get", `/smart-cellar/storage/${placeId}/bottles`, undefined, 200)).body as {
      placements: Placement[];
    }
  ).placements;

/** Every request the page makes to the Smart Cellar API, and every script it downloads. */
function watch(page: Page) {
  const api: string[] = [];
  const scripts: Array<Promise<string>> = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/smart-cellar")) api.push(new URL(r.url()).pathname);
  });
  page.on("response", (r) => {
    if (r.request().resourceType() === "script" && r.url().includes("/_next/"))
      scripts.push(r.text().catch(() => ""));
  });
  return {
    api,
    /** Whether any downloaded script holds the new view's code (a string only it has). */
    hasNewView: async () => (await Promise.all(scripts)).some((s) => s.includes("smart-3d-stage")),
  };
}

// =================================================================================================================
test.describe("gate OFF (the default): the cellar's 3D view is the existing one", () => {
  test.use({ baseURL: APP_URL });

  test("nothing of the new view is shown, asked for or downloaded, even for a place with a template", async ({
    page,
    request,
  }) => {
    const seen = watch(page);
    await mixedCellar(page, request, "off");
    await open3D(page);
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await expect(view(page)).toHaveCount(0);
    await expect(stage(page)).toHaveCount(0);
    // the place with a template is drawn as every place is today: by the existing view, from the old API
    await expect(page.getByRole("button", { name: "Oak rack" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Old fridge" }).click();
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    expect(seen.api).toEqual([]);
    expect(await seen.hasNewView()).toBe(false);
    // the view mode is the same "3d" it always was
    expect((await page.context().cookies()).find((c) => c.name === "cellr-view")?.value).toBe("3d");
  });
});

test.describe("gate asked for on a production build: it stays CLOSED", () => {
  test.use({ baseURL: FEATURES_URL });

  test("CELLR_SMART_CELLAR_3D=1 changes nothing there: the existing view, no new request, no new code", async ({
    page,
    request,
  }) => {
    const seen = watch(page);
    await mixedCellar(page, request, "closed");
    await open3D(page);
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await expect(view(page)).toHaveCount(0);
    expect(seen.api).toEqual([]);
    expect(await seen.hasNewView()).toBe(false);
  });
});

// =================================================================================================================
test.describe("gate ON (an internal preview)", () => {
  test.use({ baseURL: PREVIEW_URL });
  test.beforeEach(async ({ page }) => {
    await withReadout(page);
  });

  test("a mixed cellar: the place with a template in the new view, the one from before in the existing view, one scene at a time", async ({
    page,
    request,
  }) => {
    const seen = watch(page);
    const { call, rack } = await mixedCellar(page, request, "mixed");
    await openSmart(page);
    await expect(view(page)).toHaveAttribute("data-unit-renderer", "smart");
    await stageShows(page, "data-renderer", "grid");
    await expect(stage(page)).toHaveAttribute("data-template", "rack_classic");
    await drawn(page);
    // what is drawn is what the API says is there: the same bottles, each with its whole spot
    const placements = await placementsOf(call, rack);
    expect(placements.map((p) => [p.row, p.col, p.index])).toEqual([
      [1, 1, 1],
      [1, 2, 1],
      [1, 3, 1],
      [1, 4, 1],
      [2, 1, 1],
    ]);
    await expect(stage(page)).toHaveAttribute("data-bottles", "5");
    await expect(stage(page)).toHaveAttribute("data-stranded", "0");
    expect((await hooks(page)).sort()).toEqual(placements.map((p) => p.bottleId).sort());
    await expect(page.getByTestId("smart-3d-meta")).toContainText("5 of 12 · 7 free");
    await expect(legacyStage(page)).toHaveCount(0);
    await expect(page.locator("canvas[data-engine]")).toHaveCount(1);

    // the fridge from before templates: the existing view, with its own bottles; the new scene is gone
    await page.getByRole("button", { name: "Old fridge" }).click();
    await expect(view(page)).toHaveAttribute("data-unit-renderer", "legacy");
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await expect(stage(page)).toHaveCount(0);
    await expect(page.locator("canvas[data-engine]")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /Grand Vin 2010, shelf 1, position 1/ }),
    ).toBeAttached();
    // no bottles of the legacy place were asked of the new API, and nothing made up a template for it
    expect(seen.api.filter((p) => p.endsWith("/bottles"))).toEqual([
      `/api/v1/smart-cellar/storage/${rack}/bottles`,
    ]);
    const [fridgeRow] = await sql<{ template: string | null }>(
      "select template from public.cellar_locations where label = 'Old fridge' and household_id = (select household_id from public.cellar_locations where id = $1)",
      [rack],
    );
    expect(fridgeRow!.template).toBeNull();

    // and back: the new view again
    await page.getByRole("button", { name: "Oak rack" }).click();
    await stageShows(page, "data-renderer", "grid");
    await drawn(page);
    await expect(page.locator("canvas[data-engine]")).toHaveCount(1);
  });

  test("a cellar with only places from before templates: the existing view for all of them", async ({
    page,
    request,
  }) => {
    const seen = watch(page);
    const { email } = await arrive(page, "legacyonly");
    const { call } = await apiClient(request, email);
    const a = await addPlace(call, "Fridge", "fridge", 3, 4);
    await addPlace(call, "Rack", "rack", 2, 3);
    await addBottles(call, RED, 2015, 2, a);
    await openSmart(page);
    await expect(view(page)).toHaveAttribute("data-unit-renderer", "legacy");
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await expect(stage(page)).toHaveCount(0);
    // the existing view's own bottle panel, with its actions, as it always was
    await viaTheList(page, /Pavillon Rouge 2015, shelf 1, position 1/);
    const legacyPanel = page.getByTestId("bottle-showcase");
    await expect(legacyPanel).toHaveAttribute("data-open", "true");
    await expect(legacyPanel.getByRole("button", { name: "Open this bottle" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Rack", exact: true }).click();
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    expect(seen.api.some((p) => p.endsWith("/bottles"))).toBe(false);
  });

  test("bottles but no place for them yet: the existing invitation to build a cellar", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "empty3d");
    const { call } = await apiClient(request, email);
    await addBottles(call, RED, 2015, 2, null);
    await open3D(page);
    await expect(view(page)).toHaveAttribute("data-mode", "empty", { timeout: 30_000 });
    await expect(page.getByText("Build your cellar first")).toBeVisible();
  });

  test("a bottle is taken out, shows what it really is, turns, and goes back exactly where it was; nothing is written", async ({
    page,
    request,
    hasTouch,
  }) => {
    const { call, rack, red } = await mixedCellar(page, request, "inspect");
    const before = await sql(
      "select id, location_id, loc_row, loc_col, loc_index, status, updated_at::text from public.bottles where location_id = $1 order by id",
      [rack],
    );
    const details: string[] = [];
    page.on("request", (r) => {
      if (/\/api\/v1\/cellar\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname))
        details.push(r.url());
    });
    await openSmart(page);
    await drawn(page);
    // nothing of any wine's details was asked for up front
    expect(details).toEqual([]);
    const placements = await placementsOf(call, rack);
    const first = placements.find((p) => p.row === 1 && p.col === 1)!;
    expect(red.bottleIds).toContain(first.bottleId);

    await tapBottle(page, first.bottleId, hasTouch);
    await expect(storage(page)).toHaveAttribute("data-showcase-bottle", first.bottleId);
    await phase(page, "inspecting");
    await expect(stage(page)).toHaveAttribute("data-selected", first.bottleId);
    await expect(storage(page)).toHaveAttribute("data-showcase-reason", "clear_path");
    await expect(panel(page)).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("inspection-how")).toHaveText("Taken out of its place.");
    await expect(page.getByTestId("inspection-title")).toHaveText("Pavillon Rouge");
    await expect(panel(page)).toContainText("Château Margaux · 2015");
    await expect(panel(page)).toContainText("Red");
    await expect(panel(page)).toContainText("Bordeaux, France");
    await expect(page.getByTestId("inspection-where")).toHaveText(
      "Oak rack · Shelf 1 · Position 1",
    );
    // the wine's own details arrive once it is out (how many there are of it), and only once
    await expect(panel(page)).toContainText("3 bottles of this vintage");
    expect(details).toHaveLength(1);
    // no photo of its label: a drawn label from its own names (never a made-up picture)
    await expect(canvas(page)).toHaveAttribute("data-front-label", "drawn");
    // the way to the wine's own page is a real link
    await expect(page.getByTestId("smart-3d-wine-link")).toHaveAttribute(
      "href",
      `/cellar/${first.vintageId}`,
    );

    if (!hasTouch) {
      // turning the bottle is not turning the place
      const azimuth = await num(page, "azimuth");
      const [cx, top, bottom] = (await canvas(page).getAttribute("data-showcase-box"))!
        .split(",")
        .map(Number);
      const box = (await canvas(page).boundingBox())!;
      const y = box.y + (top! + bottom!) / 2;
      await page.mouse.move(box.x + cx! - 20, y);
      await page.mouse.down();
      await page.mouse.move(box.x + cx! + 80, y, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => num(page, "showcase-yaw")).not.toBe(0);
      expect(await num(page, "azimuth")).toBe(azimuth);
    }

    await page.keyboard.press("Escape");
    await phase(page, "idle");
    expect(await num(page, "handoff-pose")).toBeLessThanOrEqual(1e-9);
    expect(await num(page, "handoff-drift")).toBeLessThanOrEqual(0.5);
    // it stays the chosen bottle, and a second look at another bottle of the same wine asks nothing more
    await expect(stage(page)).toHaveAttribute("data-selected", first.bottleId);
    const second = placements.find((p) => p.row === 1 && p.col === 2)!;
    await tapBottle(page, second.bottleId, hasTouch);
    await phase(page, "inspecting");
    await expect(panel(page)).toContainText("3 bottles of this vintage");
    expect(details).toHaveLength(1);
    await page.keyboard.press("Escape");
    await phase(page, "idle");

    // looking changed nothing in the database: every bottle on its spot, untouched
    expect(
      await sql(
        "select id, location_id, loc_row, loc_col, loc_index, status, updated_at::text from public.bottles where location_id = $1 order by id",
        [rack],
      ),
    ).toEqual(before);
  });

  test("a bottle with a photo of its label wears that photo; one without is drawn; no picture is asked of anyone else", async ({
    page,
    request,
    hasTouch,
  }) => {
    const { call, token, rack, red, white } = await mixedCellar(page, request, "labels");
    const imageId = await givePhoto(page, request, token, call, red.vintageId);
    const images: string[] = [];
    const elsewhere: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      // (the cellar's grid shows thumbnails of its own; the 3D view asks for the photo or the straightened label)
      if (url.pathname.startsWith("/api/v1/images/") && !url.search.includes("size=thumb"))
        images.push(url.pathname + url.search);
      if (!["localhost", "127.0.0.1"].includes(url.hostname)) elsewhere.push(r.url());
    });
    await openSmart(page);
    await drawn(page);
    const placements = await placementsOf(call, rack);
    const withPhoto = placements.find((p) => red.bottleIds.includes(p.bottleId))!;
    const without = placements.find((p) => white.bottleIds.includes(p.bottleId))!;
    expect(withPhoto.image?.id).toBe(imageId);
    expect(without.image).toBeNull();
    // no label photo is fetched before a bottle is taken out
    expect(images).toEqual([]);

    await tapBottle(page, withPhoto.bottleId, hasTouch);
    await phase(page, "inspecting");
    await expect(canvas(page)).toHaveAttribute("data-front-label", "photo");
    expect(images).toEqual([`/api/v1/images/${imageId}?size=photo`]);
    await page.keyboard.press("Escape");
    await phase(page, "idle");

    await tapBottle(page, without.bottleId, hasTouch);
    await phase(page, "inspecting");
    await expect(canvas(page)).toHaveAttribute("data-front-label", "drawn");
    await expect(page.getByTestId("inspection-title")).toHaveText("Chablis Premier Cru");
    await expect(panel(page)).toContainText("Burgundy, France");
    // still the one photo, asked for once
    expect(images).toEqual([`/api/v1/images/${imageId}?size=photo`]);
    // nothing was asked of any other server while drawing or looking (no AI, no image service)
    expect(elsewhere).toEqual([]);
    await page.keyboard.press("Escape");
    await phase(page, "idle");
  });

  test("changing place: the chosen bottle and what is known about it stay with their own place", async ({
    page,
    request,
    hasTouch,
  }) => {
    const { email } = await arrive(page, "units");
    const { call } = await apiClient(request, email);
    const a = await addPlace(call, "Rack A", "rack", 2, 3);
    const b = await addPlace(call, "Rack B", "rack", 2, 3);
    await giveTemplate(a, "rack_classic", "depth");
    await giveTemplate(b, "rack_metal", "depth");
    await addBottles(call, RED, 2015, 2, a);
    await addBottles(call, WHITE, 2019, 2, b);
    await openSmart(page);
    await drawn(page);
    const inA = await placementsOf(call, a);
    await tapBottle(page, inA[0]!.bottleId, hasTouch);
    await phase(page, "inspecting");
    await expect(page.getByTestId("inspection-title")).toHaveText("Pavillon Rouge");

    // another place while a bottle is out: the inspection is over, and nothing of it comes along
    await page.getByRole("button", { name: "Rack B" }).click();
    await stageShows(page, "data-template", "rack_metal");
    await drawn(page);
    await phase(page, "idle");
    await expect(stage(page)).toHaveAttribute("data-selected", "");
    await expect(panel(page)).toHaveAttribute("data-open", "false");
    await expect(page.locator("canvas[data-engine]")).toHaveCount(1);
    const inB = await placementsOf(call, b);
    expect((await hooks(page)).sort()).toEqual(inB.map((p) => p.bottleId).sort());
    await tapBottle(page, inB[0]!.bottleId, hasTouch);
    await phase(page, "inspecting");
    await expect(page.getByTestId("inspection-title")).toHaveText("Chablis Premier Cru");
    await expect(page.getByTestId("inspection-where")).toHaveText("Rack B · Shelf 1 · Position 1");
    await page.keyboard.press("Escape");
    await phase(page, "idle");

    // back in the first place: its own bottles, and no bottle of the other one chosen
    await page.getByRole("button", { name: "Rack A" }).click();
    await stageShows(page, "data-template", "rack_classic");
    await drawn(page);
    await expect(stage(page)).toHaveAttribute("data-selected", "");
    expect((await hooks(page)).sort()).toEqual(inA.map((p) => p.bottleId).sort());
  });

  test("to the wine's page and back: the same place, the same chosen bottle", async ({
    page,
    request,
    hasTouch,
  }) => {
    const { call, rack } = await mixedCellar(page, request, "back");
    await openSmart(page);
    await page.getByRole("button", { name: "Old fridge" }).click();
    await page.getByRole("button", { name: "Oak rack" }).click();
    await drawn(page);
    const placements = await placementsOf(call, rack);
    const chosen = placements[1]!;
    await tapBottle(page, chosen.bottleId, hasTouch);
    await phase(page, "inspecting");
    await page.getByTestId("smart-3d-wine-link").click();
    await page.waitForURL(`**/cellar/${chosen.vintageId}`);
    await expect(page.getByRole("heading", { name: "Pavillon Rouge" }).first()).toBeVisible();
    await page.goBack();
    await expect(view(page)).toHaveAttribute("data-mode", "ready", { timeout: 30_000 });
    await expect(view(page)).toHaveAttribute("data-unit", rack);
    await drawn(page);
    // chosen, and in its place: it is not taken out again by coming back
    await expect(stage(page)).toHaveAttribute("data-selected", chosen.bottleId);
    await phase(page, "idle");
  });

  test("refreshed while a bottle is out: nothing changed, so it stays out; then the bottle is opened elsewhere, and it is simply gone", async ({
    page,
    request,
    hasTouch,
  }) => {
    const { call, rack } = await mixedCellar(page, request, "stale");
    await openSmart(page);
    await drawn(page);
    const placements = await placementsOf(call, rack);
    const out = placements[0]!;
    await tapBottle(page, out.bottleId, hasTouch);
    await phase(page, "inspecting");
    const refreshes = () =>
      page.waitForResponse(
        (r) => r.url().endsWith(`/smart-cellar/storage/${rack}/bottles`) && r.status() === 200,
      );
    const comeBack = () => page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));

    // the person comes back to the tab: the place is read again, and it is as it was
    const [same] = await Promise.all([refreshes(), comeBack()]);
    expect(((await same.json()) as { placements: unknown[] }).placements).toHaveLength(5);
    await page.waitForTimeout(500);
    await phase(page, "inspecting");
    await expect(page.getByTestId("inspection-title")).toHaveText("Pavillon Rouge");

    // someone else in the household opens that very bottle
    await call("patch", `/bottles/${out.bottleId}`, { action: "open" }, 200);
    await Promise.all([refreshes(), comeBack()]);
    await phase(page, "idle");
    await expect(stage(page)).toHaveAttribute("data-bottles", "4");
    await expect(stage(page)).toHaveAttribute("data-selected", "");
    await expect(panel(page)).toHaveAttribute("data-open", "false");
    expect(await hooks(page)).not.toContain(out.bottleId);
    // and the next bottle can be taken out as usual
    await tapBottle(page, placements[1]!.bottleId, hasTouch);
    await phase(page, "inspecting");
    await page.keyboard.press("Escape");
    await phase(page, "idle");
  });

  test("a change made in the app refreshes what the new view knows (opening a bottle in the existing view)", async ({
    page,
    request,
  }) => {
    const seen = watch(page);
    await mixedCellar(page, request, "invalidate");
    await openSmart(page);
    await page.getByRole("button", { name: "Old fridge" }).click();
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await viaTheList(page, /Grand Vin 2010, shelf 1, position 1/);
    const legacyPanel = page.getByTestId("bottle-showcase");
    await expect(legacyPanel).toHaveAttribute("data-open", "true");
    const listed = seen.api.filter((p) => p === "/api/v1/smart-cellar/storage").length;
    await legacyPanel.getByRole("button", { name: "Open this bottle" }).click();
    // the list of places is read again because the cellar changed
    await expect
      .poll(() => seen.api.filter((p) => p === "/api/v1/smart-cellar/storage").length)
      .toBeGreaterThan(listed);
    await page.getByRole("button", { name: "Oak rack" }).click();
    await expect(page.getByTestId("smart-3d-meta")).toContainText("5 of 12", {
      timeout: FIRST_PICTURE,
    });
  });

  test("a place whose arrangement is not known: the neutral picture, said plainly, and a bottle is shown, not 'taken from a spot'", async ({
    page,
    request,
    hasTouch,
  }) => {
    const { email } = await arrive(page, "unknown3d");
    const { call } = await apiClient(request, email);
    const place = await addPlace(call, "Newer rack", "rack", 2, 3);
    await giveTemplate(place, "hex_rack_2031", "depth");
    await addBottles(call, RED, 2015, 2, place);
    const before = await sql(
      "select template, slot_semantics, updated_at::text from public.cellar_locations where id = $1",
      [place],
    );
    await openSmart(page);
    await stageShows(page, "data-renderer", "neutral");
    await expect(page.getByTestId("smart-3d-not-known")).toBeVisible();
    await drawn(page);
    const placements = await placementsOf(call, place);
    await tapBottle(page, placements[0]!.bottleId, hasTouch);
    await phase(page, "inspecting");
    await expect(storage(page)).toHaveAttribute("data-showcase-reason", "unknown_arrangement");
    await expect(page.getByTestId("inspection-where")).toHaveText(
      "Newer rack · Shelf 1 · Position 1. CELLR doesn't know how this place is arranged.",
    );
    await page.keyboard.press("Escape");
    await phase(page, "idle");
    // reading it rewrote nothing
    expect(
      await sql(
        "select template, slot_semantics, updated_at::text from public.cellar_locations where id = $1",
        [place],
      ),
    ).toEqual(before);
  });

  test("a bottle on a spot the place does not have is listed, never drawn elsewhere and never dropped", async ({
    page,
    request,
  }) => {
    const { call, rack } = await mixedCellar(page, request, "stranded");
    // a place that became narrower than a bottle in it (only a write around every check can do this)
    await sql(`begin;
      set local session_replication_role = replica;
      update public.cellar_locations set grid_cols = 3 where id = '${rack}';
      commit;`);
    await openSmart(page);
    await drawn(page);
    await expect(stage(page)).toHaveAttribute("data-bottles", "5");
    await expect(stage(page)).toHaveAttribute("data-stranded", "1");
    const note = page.getByTestId("smart-3d-stranded");
    await expect(note).toContainText("1 bottle is stored on a spot this place no longer has");
    await expect(note.getByRole("link")).toHaveText(
      "Domaine Test Chablis Premier Cru 2019, shelf 1, position 4, place 1",
    );
    const placements = await placementsOf(call, rack);
    expect(await hooks(page)).toHaveLength(placements.length - 1);
  });

  test("a database without the Smart Cellar step: the existing 3D view, whole, and nothing is said about it", async ({
    page,
    request,
  }) => {
    await mixedCellar(page, request, "noschema");
    // what the app's own API answers on such a database (sprint 1C; unit- and integration-tested there)
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
    await page.route("**/api/v1/smart-cellar/storage", (route) =>
      route.fulfill({
        status: 404,
        json: {
          error: {
            code: "NOT_FOUND",
            message: "The Smart Cellar isn't set up on this server yet.",
            retryable: false,
          },
        },
      }),
    );
    await open3D(page);
    await expect(view(page)).toHaveAttribute("data-mode", "schema-missing", { timeout: 30_000 });
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await expect(page.getByTestId("smart-3d-failed")).toHaveCount(0);
    await expect(page.getByText("couldn't load")).toHaveCount(0);
    // every place, the one with a template too, in the existing view
    await page.getByRole("button", { name: "Old fridge" }).click();
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await expect(stage(page)).toHaveCount(0);
  });

  test("no connection to the new API: said, with a way to try again, and the existing view stays usable", async ({
    page,
    request,
  }) => {
    await mixedCellar(page, request, "offline");
    await page.route("**/api/v1/smart-cellar**", (route) => route.abort("connectionrefused"));
    await open3D(page);
    await expect(view(page)).toHaveAttribute("data-mode", "failed", { timeout: 60_000 });
    const failed = page.getByTestId("smart-3d-failed");
    await expect(failed).toHaveRole("alert");
    await expect(failed).toContainText("The new 3D view couldn't load");
    await expect(failed).toContainText("We couldn't reach CELLR");
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    // the connection is back
    await page.unroute("**/api/v1/smart-cellar**");
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(view(page)).toHaveAttribute("data-mode", "ready", { timeout: 30_000 });
    await expect(stage(page)).toHaveAttribute("data-renderer", "grid");
  });

  test("not allowed, or a server error: said as what it is, never taken for 'not set up'", async ({
    page,
    request,
  }) => {
    await mixedCellar(page, request, "refused");
    let answer: { status: number; code: string } = { status: 401, code: "UNAUTHENTICATED" };
    await page.route("**/api/v1/smart-cellar**", (route) =>
      route.fulfill({
        status: answer.status,
        json: { error: { code: answer.code, message: "", retryable: false } },
      }),
    );
    await open3D(page);
    const failed = page.getByTestId("smart-3d-failed");
    await expect(failed).toContainText("Please sign in to continue.", { timeout: 30_000 });
    await expect(view(page)).toHaveAttribute("data-mode", "failed");
    answer = { status: 500, code: "INTERNAL" };
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(failed).toContainText("Something went wrong", { timeout: 30_000 });
    await expect(view(page)).toHaveAttribute("data-mode", "failed");
  });

  test("one place cannot be read: said for that place, the others still open, and trying again works", async ({
    page,
    request,
  }) => {
    const { rack } = await mixedCellar(page, request, "unitfail");
    await page.route(`**/api/v1/smart-cellar/storage/${rack}/bottles`, (route) =>
      route.fulfill({
        status: 500,
        json: { error: { code: "INTERNAL", message: "", retryable: false } },
      }),
    );
    await open3D(page);
    const failed = page.getByTestId("smart-3d-unit-failed");
    await expect(failed).toBeVisible({ timeout: 30_000 });
    await expect(failed).toHaveRole("alert");
    await page.getByRole("button", { name: "Old fridge" }).click();
    await expect(legacyStage(page)).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await page.getByRole("button", { name: "Oak rack" }).click();
    await page.unroute(`**/api/v1/smart-cellar/storage/${rack}/bottles`);
    await page
      .getByTestId("smart-3d-unit-failed")
      .getByRole("button", { name: "Try again" })
      .click();
    await expect(stage(page)).toHaveAttribute("data-renderer", "grid", { timeout: 30_000 });
    await drawn(page);
  });

  test("the browser takes the graphics memory back: said, and the view starts again with the same bottles", async ({
    page,
    request,
    hasTouch,
  }) => {
    const { call, rack } = await mixedCellar(page, request, "lost");
    await openSmart(page);
    await drawn(page);
    const placements = await placementsOf(call, rack);
    await tapBottle(page, placements[0]!.bottleId, hasTouch);
    await phase(page, "inspecting");
    await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(
        '[data-testid="smart-3d-stage"] canvas[data-engine]',
      )!;
      (c.getContext("webgl2") ?? c.getContext("webgl"))!
        .getExtension("WEBGL_lose_context")!
        .loseContext();
    });
    const lost = page.getByTestId("smart-3d-lost");
    await expect(lost).toBeVisible();
    await expect(lost).toContainText("The 3D view has paused");
    await expect(page.locator("canvas[data-engine]")).toHaveCount(0);
    await lost.getByRole("button", { name: "Show 3D again" }).click();
    await drawn(page);
    await phase(page, "idle");
    expect((await hooks(page)).sort()).toEqual(placements.map((p) => p.bottleId).sort());
    await tapBottle(page, placements[0]!.bottleId, hasTouch);
    await phase(page, "inspecting");
    await page.keyboard.press("Escape");
    await phase(page, "idle");
  });

  test("with the keyboard and a screen reader: every bottle is in a list, the panel is read, Escape gives the focus back", async ({
    page,
    request,
    isMobile,
  }) => {
    test.skip(isMobile, "a keyboard: the desktop project");
    await mixedCellar(page, request, "keys");
    await openSmart(page);
    await drawn(page);
    expect(await audit(page)).toEqual([]);
    const list = page.getByRole("list", { name: "Bottles in Oak rack" });
    await expect(list.getByRole("button")).toHaveCount(5);
    await expect(page.getByRole("group", { name: "3D view of Oak rack" })).toBeVisible();
    const bottle = list.getByRole("button", {
      name: "Château Margaux Pavillon Rouge 2015, shelf 1, position 2",
    });
    await bottle.focus();
    await page.keyboard.press("Enter");
    await phase(page, "inspecting");
    const dialog = page.getByRole("dialog", { name: "Pavillon Rouge" });
    await expect(dialog).toBeFocused();
    await expect(dialog.getByRole("link", { name: "Wine details" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Put it back" })).toBeVisible();
    expect(await audit(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await phase(page, "idle");
    await expect(bottle).toBeFocused();
  });

  test("with reduced motion: simply out, and simply back on the same spot", async ({
    page,
    request,
    hasTouch,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { call, rack } = await mixedCellar(page, request, "reduced");
    await openSmart(page);
    await drawn(page);
    const placements = await placementsOf(call, rack);
    await tapBottle(page, placements[2]!.bottleId, hasTouch);
    await phase(page, "inspecting");
    await page.keyboard.press("Escape");
    await phase(page, "idle");
    expect(await num(page, "handoff-pose")).toBeLessThanOrEqual(1e-9);
  });

  test("on a phone: the picture fits, the panel sits right under it, a finger takes a bottle out and puts it back", async ({
    page,
    request,
    hasTouch,
    isMobile,
  }) => {
    test.skip(!isMobile || !hasTouch, "a phone");
    const { call, rack } = await mixedCellar(page, request, "phone3d");
    await openSmart(page);
    await drawn(page);
    const noSideways = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await noSideways()).toBeLessThanOrEqual(0);
    const placements = await placementsOf(call, rack);
    await tapBottle(page, placements[0]!.bottleId, true);
    await phase(page, "inspecting");
    await expect(storage(page)).toHaveAttribute("data-layout", "stacked");
    const slot = page.getByTestId("smart-3d-panel-slot");
    await expect(slot.getByTestId("inspection-panel")).toHaveAttribute("data-open", "true");
    const box = (await stage(page).boundingBox())!;
    const below = (await slot.boundingBox())!;
    expect(below.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
    expect(below.y - (box.y + box.height)).toBeLessThan(32);
    // the bottle is whole and large in the picture
    const [, top, bottom] = (await canvas(page).getAttribute("data-showcase-box"))!
      .split(",")
      .map(Number);
    expect(top!).toBeGreaterThanOrEqual(0);
    expect(bottom!).toBeLessThanOrEqual(box.height);
    expect(bottom! - top!).toBeGreaterThan(box.height * 0.6);
    // the close button is a thumb's size, the link is in reach
    const close = (await page.getByTestId("inspection-close").boundingBox())!;
    expect(Math.min(close.width, close.height)).toBeGreaterThanOrEqual(44);
    await page.getByTestId("smart-3d-wine-link").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("smart-3d-wine-link")).toBeVisible();
    expect(await noSideways()).toBeLessThanOrEqual(0);
    await page.getByTestId("inspection-close").scrollIntoViewIfNeeded();
    await page.getByTestId("inspection-close").tap();
    await phase(page, "idle");
    expect(await num(page, "handoff-pose")).toBeLessThanOrEqual(1e-9);
  });

  test("a cooler with two zones behind glass: drawn as that cooler, and a bottle is shown through the door", async ({
    page,
    request,
    hasTouch,
  }) => {
    const { email } = await arrive(page, "cooler3d");
    const { call } = await apiClient(request, email);
    const cooler = await addPlace(call, "Cooler", "fridge", 8, 4);
    // through the app's own layout API (writes are open on this preview server): template, look and zones in one go
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
    await addBottles(call, WHITE, 2019, 6, cooler);
    await openSmart(page);
    await stageShows(page, "data-template", "cooler_dual");
    await drawn(page);
    // a temperature is a setting someone typed in: the 3D view shows none of them as a reading. Since sprint 4 (on
    // this preview the placement gate is open) the zone legend shows each zone's SET temperature, said as a setting;
    // nowhere else is there a temperature
    const legend = page.getByTestId("zone-legend");
    await expect(legend).toContainText("set to 12.0 °C");
    await expect(legend).toContainText("set to 7.5 °C");
    await expect(legend).toContainText("Set temperatures are settings, not readings.");
    expect(
      await view(page).evaluate((el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('[data-testid="zone-legend"]').forEach((n) => n.remove());
        return copy.textContent ?? "";
      }),
    ).not.toContain("°");
    const placements = await placementsOf(call, cooler);
    await tapBottle(page, placements[0]!.bottleId, hasTouch);
    await phase(page, "inspecting");
    await expect(storage(page)).toHaveAttribute("data-showcase-reason", "behind_door");
    await expect(page.getByTestId("inspection-how")).toHaveText(
      "Shown without drawing it out: the door in front of it stays closed.",
    );
    await page.keyboard.press("Escape");
    await phase(page, "idle");
  });
});
