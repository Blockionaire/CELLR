import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  PREVIEW_URL,
  STACK,
  apiClient,
  arrive,
  audit,
  bearer,
  chooseFile,
  makeJpeg,
  sql,
  wineChoice,
} from "./helpers";

/**
 * Smart Cellar 3D, sprint 7: 3D QUICK ADD. "Add bottle" in the 3D cellar marks the free spots of the place; a tap on
 * one opens what can go there: a bottle without a place, a bottle from another spot (the Sprint 4 move), a new bottle
 * scanned or added by hand (the existing flows, which come back to the 3D cellar). Real signed-in households on the
 * local stack (real Postgres, PostgREST and RLS), the preview server where placement is open and writes.
 */
test.setTimeout(150_000);
test.use({ baseURL: PREVIEW_URL });
const expect = baseExpect.configure({ timeout: 15_000 });

type Call = Awaited<ReturnType<typeof apiClient>>["call"];
const RED = { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" };
const WHITE = { producer: "Domaine Test", name: "Chablis", type: "white", countryCode: "FR" };
const OAK = { v: 1, material: "wood", color: "oak", lighting: "none", door: "none" };
const COOLER = { v: 1, material: "metal", color: "graphite", lighting: "warm", door: "glass" };

async function addPlace(call: Call, label: string, kind: string, rows: number, cols: number) {
  return ((await call("post", "/storage", { label, kind, rows, cols }, 201)).body as { id: string })
    .id;
}
async function giveLayout(call: Call, id: string, template: string, rows: number, cols: number) {
  await call(
    "put",
    `/smart-cellar/storage/${id}/layout`,
    {
      structure: { template, rows, cols, cellCapacity: 1, zones: [] },
      appearance: template.startsWith("cooler") ? COOLER : OAK,
    },
    200,
  );
}
async function addBottles(call: Call, wine: object, quantity: number, locationId: string | null) {
  const w = (await call("post", "/wines", wine, 201)).body as { id: string };
  const b = (
    await call("post", "/bottles", { wineId: w.id, year: 2015, quantity, locationId }, 201)
  ).body as { bottleIds: string[] };
  return { wineId: w.id, bottleIds: b.bottleIds };
}
const spotOf = (bottleId: string) =>
  sql<{ location_id: string | null; loc_row: number | null; loc_col: number | null }>(
    "select location_id, loc_row, loc_col from public.bottles where id = $1",
    [bottleId],
  ).then((r) => r[0]!);
const onSpot = (locationId: string, row: number, col: number) =>
  sql<{ id: string }>(
    "select id from public.bottles where location_id = $1 and loc_row = $2 and loc_col = $3 and status = 'in_cellar'",
    [locationId, row, col],
  );

/** A household with an oak rack (3 × 4, two red bottles on 1:1 and 1:2), a cooler (2 × 3, one white on 1:1), two
 * white bottles without a place. */
async function household(page: Page, request: APIRequestContext, label: string) {
  const { email, householdId } = await arrive(page, label);
  const { call, token } = await apiClient(request, email);
  const rack = await addPlace(call, "Oak rack", "rack", 3, 4);
  await giveLayout(call, rack, "rack_classic", 3, 4);
  const cooler = await addPlace(call, "Wine cooler", "fridge", 2, 3);
  await giveLayout(call, cooler, "cooler_single", 2, 3);
  const red = await addBottles(call, RED, 2, rack);
  const coolerWine = await addBottles(call, { ...WHITE, name: "Chablis Cooler" }, 1, cooler);
  const loose = await addBottles(call, WHITE, 2, null);
  return {
    email,
    householdId,
    call,
    token,
    rack,
    cooler,
    placed: red.bottleIds,
    inCooler: coolerWine.bottleIds[0]!,
    loose: loose.bottleIds,
    looseWine: loose.wineId,
  };
}

const view = (page: Page) => page.getByTestId("smart-3d");
const canvas = (page: Page) => page.getByTestId("smart-3d-stage").locator("canvas[data-engine]");
const sheet = (page: Page) => page.getByTestId("quick-sheet");
const panel = (page: Page) => page.getByTestId("placement-panel");
const quickSheet = (page: Page) => page.getByRole("dialog", { name: "Add a bottle here" });
const debugOn = (page: Page) =>
  page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
const drawn = (page: Page) =>
  expect(canvas(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 60_000 });

async function open3D(page: Page) {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(view(page)).toHaveAttribute("data-mode", "ready");
}
async function startQuick(page: Page) {
  await page.getByTestId("quick-add-start").click();
  await expect(view(page)).toHaveAttribute("data-quick", "placing");
}
/** Where a free spot's marker is on the page (CSS px), from the view's own readout. */
async function markerAt(page: Page, row: number, col: number) {
  await expect(canvas(page)).toHaveAttribute("data-spots", /^[1-9]/);
  // the whole picture on screen (it fits on every screen tested): a tap at a point below the fold would land nowhere
  await canvas(page).scrollIntoViewIfNeeded();
  const at = await page.evaluate(
    ([r, c]) =>
      (
        window as unknown as {
          __cellrStorage3d: {
            locateSpot: (r: number, c: number) => { x: number; y: number } | null;
          };
        }
      ).__cellrStorage3d.locateSpot(r!, c!),
    [row, col],
  );
  expect(at, `marker ${row}:${col}`).not.toBeNull();
  const box = (await canvas(page).boundingBox())!;
  return { x: box.x + at!.x, y: box.y + at!.y };
}
async function tapSpot(page: Page, row: number, col: number, touch: boolean) {
  const at = await markerAt(page, row, col);
  if (touch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}
/** The placeholders as the picture draws them (the readout), or null when none are drawn. */
const ghosts = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __cellrStorage3d: {
          ghosts: () => {
            count: number;
            triangles: number;
            attributes: string[];
            materials: number;
            objects: number;
            length: number;
            width: number;
          } | null;
        };
      }
    ).__cellrStorage3d.ghosts(),
  );
const spotsOnOffer = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __cellrStorage3d: { spots: () => string[] } }).__cellrStorage3d.spots(),
  );
const locateBottle = (page: Page, id: string) =>
  page.evaluate(
    (bottleId) =>
      (
        window as unknown as { __cellrStorage3d: { locate: (id: string) => unknown } }
      ).__cellrStorage3d.locate(bottleId),
    id,
  );

// =================================================================================================================
test.describe("3D Quick Add", () => {
  test("the marked spots are exactly the free ones (domain eligibility), and a tap opens that spot's sheet", async ({
    page,
    request,
    hasTouch,
  }) => {
    await debugOn(page);
    await household(page, request, "qaspots");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    // 3 × 4 = 12 spots, two taken (1:1, 1:2): ten markers, none on a taken spot, none past index 1
    expect((await spotsOnOffer(page)).sort()).toEqual(
      [
        "1:3:1",
        "1:4:1",
        "2:1:1",
        "2:2:1",
        "2:3:1",
        "2:4:1",
        "3:1:1",
        "3:2:1",
        "3:3:1",
        "3:4:1",
      ].sort(),
    );
    await expect(page.getByTestId("quick-placing")).toContainText("10 empty spots in Oak rack");
    await expect(page.getByTestId("smart-3d-stage")).toHaveAttribute("data-offering", "3d");
    await tapSpot(page, 3, 4, hasTouch);
    await expect(sheet(page)).toBeVisible();
    await expect(quickSheet(page)).toContainText("Oak rack · shelf 3 · spot 4");
    await expect(view(page)).toHaveAttribute("data-quick", "spot");
    await page.screenshot({
      path: `test-results/shots/quick-add-sheet-${test.info().project.name}.png`,
    });
    // another spot from the sheet: back to the markers
    await page.getByTestId("quick-other-spot").click();
    await expect(view(page)).toHaveAttribute("data-quick", "placing");
    await tapSpot(page, 2, 1, hasTouch);
    await expect(quickSheet(page)).toContainText("Oak rack · shelf 2 · spot 1");
  });

  test("sprint 7.2: Add bottle at the top, the instruction in view without scrolling, the sheet's words, Cancel", async ({
    page,
    request,
    hasTouch,
  }) => {
    await debugOn(page);
    await household(page, request, "qatop");
    await open3D(page);
    await drawn(page);
    const add = page.getByTestId("quick-add-start");
    const stage = page.getByTestId("smart-3d-stage");
    // the primary action of the place, above its picture, on the first screen
    await expect(add).toHaveText("Add bottle");
    await expect(add).toBeInViewport();
    expect((await add.boundingBox())!.y).toBeLessThan((await stage.boundingBox())!.y);
    await page.evaluate(() => window.scrollTo(0, 0));
    await startQuick(page);
    // what a tap does now, and the way out: at the top, above the picture, seen without scrolling
    const bar = page.getByTestId("quick-placing");
    await expect(page.getByTestId("quick-instruction")).toHaveText(
      "Tap an empty spot to add a bottle.",
    );
    await expect(page.getByTestId("quick-instruction")).toBeInViewport();
    await expect(page.getByTestId("quick-close")).toHaveText("Cancel");
    await expect(page.getByTestId("quick-close")).toBeInViewport();
    expect((await bar.boundingBox())!.y).toBeLessThan((await stage.boundingBox())!.y);
    // adding brings the instruction to the top of the screen: the whole picture is under it, on the first screen
    const card = (await stage.boundingBox())!;
    expect(card.y).toBeGreaterThan(0);
    expect(card.y + card.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    // the empty spots are bottles and nothing else: one instanced mesh of see-through bottles, no plus, no icon,
    // no second part in front of them (a bottle's length and width, a lit glass: normals, no per-vertex colours)
    const placeholders = (await ghosts(page))!;
    expect(placeholders).toMatchObject({ count: 10, materials: 1, objects: 1 });
    expect(placeholders.attributes).toEqual(["normal", "position"]);
    expect(placeholders.length).toBeCloseTo(3.4, 1);
    expect(placeholders.width).toBeLessThanOrEqual(0.9);
    expect(placeholders.triangles).toBeLessThan(400);
    // the sheet: one title, four choices, two ways out, in the same words everywhere; none of them cut off
    await tapSpot(page, 2, 2, hasTouch);
    await expect(quickSheet(page)).toBeVisible();
    await expect(page.getByTestId("quick-unplaced")).toContainText(
      "Choose a bottle without a spot",
    );
    await expect(page.getByTestId("quick-move")).toHaveText("Move an existing bottle");
    await expect(page.getByTestId("quick-scan")).toHaveText("Scan a new bottle");
    await expect(page.getByTestId("quick-manual")).toHaveText("Add a new bottle manually");
    await expect(page.getByTestId("quick-other-spot")).toHaveText("Choose another spot");
    await expect(page.getByTestId("quick-cancel")).toHaveText("Cancel");
    for (const id of ["quick-unplaced", "quick-move", "quick-scan", "quick-manual"]) {
      const cut = await page
        .getByTestId(id)
        .evaluate(
          (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
        );
      expect(cut, `${id} is cut off`).toBe(false);
    }
    await page.screenshot({
      path: `test-results/shots/quick-add-72-sheet-${test.info().project.name}.png`,
    });
    // Cancel in the sheet: out of adding altogether, the cellar as it was, "Add bottle" back at the top
    await page.getByTestId("quick-cancel").click();
    await expect(quickSheet(page)).toBeHidden();
    await expect(view(page)).toHaveAttribute("data-quick", "view");
    await expect(canvas(page)).not.toHaveAttribute("data-spots", /^[1-9]/);
    // out of adding: no placeholder is drawn at all
    await expect.poll(() => ghosts(page)).toBeNull();
    await expect(add).toBeVisible();
    // Cancel in the bar does the same
    await startQuick(page);
    await page.getByTestId("quick-close").click();
    await expect(view(page)).toHaveAttribute("data-quick", "view");
    await expect(add).toBeVisible();
  });

  test("while adding, two fingers zoom the picture and choose nothing", async ({
    page,
    request,
    hasTouch,
  }) => {
    test.skip(!hasTouch, "a phone");
    await debugOn(page);
    await household(page, request, "qapinch");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    const box = (await canvas(page).boundingBox())!;
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    const before = await canvas(page).getAttribute("data-distance");
    const cdp = await page.context().newCDPSession(page);
    const fingers = (type: string, apart: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type: type as "touchStart",
        touchPoints:
          type === "touchEnd"
            ? []
            : [
                { x: cx - apart, y: cy, id: 1 },
                { x: cx + apart, y: cy, id: 2 },
              ],
      });
    // fingers apart: the camera comes closer
    await fingers("touchStart", 30);
    for (const apart of [45, 60, 75, 90, 105, 120]) await fingers("touchMove", apart);
    await fingers("touchEnd", 120);
    await expect
      .poll(async () => Number((await canvas(page).getAttribute("data-distance")) ?? NaN))
      .toBeLessThan(before === null ? Infinity : Number(before));
    await expect(canvas(page)).toHaveAttribute("data-distance", /\d/);
    // and nothing was chosen: still choosing a spot, no sheet, every placeholder still there
    await page.waitForTimeout(400);
    await expect(sheet(page)).toBeHidden();
    await expect(view(page)).toHaveAttribute("data-quick", "placing");
    expect((await ghosts(page))!.count).toBe(10);
  });

  test("dragging the camera across a marker chooses nothing; taps on bottles take nothing out meanwhile", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    await household(page, request, "qadrag");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    const at = await markerAt(page, 2, 2);
    const before = await canvas(page).getAttribute("data-azimuth");
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(at.x + i * 12, at.y + i * 2);
    await page.mouse.up();
    await expect(canvas(page)).not.toHaveAttribute("data-azimuth", before ?? "");
    await page.waitForTimeout(500);
    await expect(sheet(page)).toBeHidden();
    await expect(view(page)).toHaveAttribute("data-quick", "placing");
    // a bottle under the finger is not taken out while spots are on offer
    await expect(page.getByTestId("inspection-panel")).not.toHaveAttribute("data-open", "true");
  });

  test("a bottle without a place goes on exactly the tapped spot; shown there after the server says so; Undo; it stays after a reload", async ({
    page,
    request,
    hasTouch,
  }) => {
    await debugOn(page);
    const { rack, loose } = await household(page, request, "qaloose");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    await tapSpot(page, 3, 4, hasTouch);
    await page.getByTestId("quick-unplaced").click();
    await expect(panel(page)).toHaveAttribute("data-choice", "move:3:4:1");
    // the chosen spot stays marked in the picture (one disc, on it), and follows a change of spot in the panel
    await expect(canvas(page)).toHaveAttribute("data-spots", "1");
    expect(await spotsOnOffer(page)).toEqual(["3:4:1"]);
    await page.getByTestId("spot-picker").locator('[data-spot="3:3:1"]').click();
    await expect.poll(() => spotsOnOffer(page)).toEqual(["3:3:1"]);
    await page.getByTestId("spot-picker").locator('[data-spot="3:4:1"]').click();
    await expect.poll(() => spotsOnOffer(page)).toEqual(["3:4:1"]);
    // the place is fixed: no other place is offered in this panel
    await expect(page.getByTestId("placement-units")).toHaveCount(0);
    await page.getByTestId("placement-which").getByRole("radio").first().check();
    // nothing moved yet
    expect((await onSpot(rack, 3, 4)).length).toBe(0);
    await page.getByTestId("placement-confirm").click();
    await expect(
      page.getByText(/Chablis 2015 is now at Oak rack · shelf 3 · spot 4/),
    ).toBeVisible();
    await expect(view(page)).toHaveAttribute("data-quick", "view");
    const there = await onSpot(rack, 3, 4);
    expect(there).toHaveLength(1);
    expect(loose).toContain(there[0]!.id);
    // the picture has it (refreshed from the server), and it is the chosen bottle
    await expect.poll(() => locateBottle(page, there[0]!.id)).not.toBeNull();
    await expect(page.getByTestId("smart-3d-stage")).toHaveAttribute("data-selected", there[0]!.id);
    // Undo: back to no place
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Moved back.")).toBeVisible();
    expect((await spotOf(there[0]!.id)).location_id).toBeNull();
    // again, and reload: it is still there
    await startQuick(page);
    await tapSpot(page, 3, 4, hasTouch);
    await page.getByTestId("quick-unplaced").click();
    await page.getByTestId("placement-which").getByRole("radio").first().check();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/is now at Oak rack · shelf 3 · spot 4/)).toBeVisible();
    const placedNow = (await onSpot(rack, 3, 4))[0]!.id;
    await page.reload();
    await page.getByRole("radio", { name: "3D" }).click();
    await drawn(page);
    await expect.poll(() => locateBottle(page, placedNow)).not.toBeNull();
  });

  test("a bottle from another place: searched, moved whole by the Sprint 4 move, the source freed", async ({
    page,
    request,
    hasTouch,
  }) => {
    await debugOn(page);
    const { rack, cooler, inCooler } = await household(page, request, "qamove");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    await tapSpot(page, 2, 3, hasTouch);
    await page.getByTestId("quick-move").click();
    const which = page.getByTestId("placement-which-placed");
    await expect(which).toContainText("Wine cooler · shelf 1 · spot 1");
    await which.getByTestId("placement-search").fill("cooler 2015");
    await expect(which.getByRole("radio")).toHaveCount(1);
    await which.getByTestId("placement-search").fill("nothing like this");
    await expect(which).toContainText("No bottle matches.");
    await which.getByTestId("placement-search").fill("Chablis Cooler");
    const moves: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/move")) moves.push(r.postData() ?? "");
    });
    await which.getByRole("radio").first().check();
    await page.getByTestId("placement-confirm").click();
    await expect(
      page.getByText(/Chablis Cooler 2015 is now at Oak rack · shelf 2 · spot 3/),
    ).toBeVisible();
    // one request, from the spot it was seen on to the spot chosen in the picture
    expect(moves).toHaveLength(1);
    expect(JSON.parse(moves[0]!)).toEqual({
      from: { locationId: cooler, row: 1, col: 1, index: 1 },
      to: { locationId: rack, row: 2, col: 3, index: 1 },
    });
    expect(await spotOf(inCooler)).toMatchObject({ location_id: rack, loc_row: 2, loc_col: 3 });
    expect(await onSpot(cooler, 1, 1)).toHaveLength(0);
  });

  test("one write per tap: a double tap on confirm sends one move", async ({
    page,
    request,
    hasTouch,
  }) => {
    await debugOn(page);
    const { rack } = await household(page, request, "qadouble");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    await tapSpot(page, 3, 1, hasTouch);
    await page.getByTestId("quick-unplaced").click();
    await page.getByTestId("placement-which").getByRole("radio").first().check();
    let moves = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/move")) moves += 1;
    });
    await page.getByTestId("placement-confirm").dblclick();
    await expect(page.getByText(/is now at Oak rack · shelf 3 · spot 1/)).toBeVisible();
    expect(moves).toBe(1);
    expect(await onSpot(rack, 3, 1)).toHaveLength(1);
  });

  test("the spot taken by someone else meanwhile: refused, said, nothing placed elsewhere", async ({
    page,
    request,
    hasTouch,
  }) => {
    await debugOn(page);
    const { rack, token, loose, call } = await household(page, request, "qataken");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    await tapSpot(page, 3, 2, hasTouch);
    await page.getByTestId("quick-unplaced").click();
    await page.getByTestId("placement-which").getByRole("radio").first().check();
    // a bottle made only now (so it is not one in the panel), which someone puts on that spot meanwhile
    const other = (await addBottles(call, { ...RED, name: "Interloper" }, 1, null)).bottleIds[0]!;
    const busy = await request.post(`/api/v1/smart-cellar/bottles/${other}/move`, {
      headers: bearer(token),
      data: { from: null, to: { locationId: rack, row: 3, col: 2, index: 1 } },
    });
    expect(busy.status()).toBe(200);
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByTestId("placement-problem")).toContainText("just taken");
    await expect(view(page)).toHaveAttribute("data-quick", "conflict");
    await expect(page.getByText(/is now at/)).toHaveCount(0);
    expect(await onSpot(rack, 3, 2)).toEqual([{ id: other }]);
    // neither bottle of the panel went anywhere else
    for (const id of loose) expect((await spotOf(id)).location_id).toBeNull();
  });

  test("a lost answer to the move: a fresh read decides; said as done without Undo", async ({
    page,
    request,
    hasTouch,
  }) => {
    await debugOn(page);
    const { rack } = await household(page, request, "qalost");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    await tapSpot(page, 2, 2, hasTouch);
    await page.getByTestId("quick-unplaced").click();
    await page.getByTestId("placement-which").getByRole("radio").first().check();
    await page.route("**/api/v1/smart-cellar/bottles/*/move", async (route) => {
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/is now at Oak rack · shelf 2 · spot 2/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
    expect(await onSpot(rack, 2, 2)).toHaveLength(1);
  });

  test("a new bottle by hand: the spot travels to the add flow and back; it lands on it and is shown there", async ({
    page,
    request,
    hasTouch,
  }) => {
    await debugOn(page);
    const { rack, householdId } = await household(page, request, "qamanual");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    await tapSpot(page, 3, 3, hasTouch);
    await expect(page.getByTestId("quick-scan")).toHaveAttribute(
      "href",
      `/scan?place=${rack}&row=3&col=3&from=3d`,
    );
    await page.getByTestId("quick-manual").click();
    await expect(page).toHaveURL(new RegExp(`/cellar/add\\?place=${rack}&row=3&col=3&from=3d$`));
    await wineChoice(page, /Pavillon Rouge/)
      .first()
      .click();
    await expect(page.getByTestId("add-spot")).toContainText("Oak rack · Shelf 3 · Position 3");
    await page.getByLabel("Vintage").fill("2016");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await page.getByTestId("added-back-3d").click();
    await expect(page).toHaveURL(/\/cellar$/);
    await expect(
      page.getByText(/Pavillon Rouge 2016 is now at Oak rack · shelf 3 · spot 3/),
    ).toBeVisible();
    const there = await onSpot(rack, 3, 3);
    expect(there).toHaveLength(1);
    await drawn(page);
    await expect.poll(() => locateBottle(page, there[0]!.id)).not.toBeNull();
    // it is this household's bottle
    expect(
      await sql("select 1 from public.bottles where id = $1 and household_id = $2", [
        there[0]!.id,
        householdId,
      ]),
    ).toHaveLength(1);
  });

  test("scanning a new bottle into the tapped spot: the scan keeps the spot, the bottle lands on it, back in 3D", async ({
    page,
    request,
    hasTouch,
  }) => {
    await debugOn(page);
    const { rack } = await household(page, request, "qascan");
    // the fake model in the local stack knows this photo by its size (no real AI call)
    const size = {
      width: 437 + test.info().parallelIndex * 43 + (Date.now() % 83),
      height: 613 + test.info().parallelIndex * 11,
    };
    const res = await fetch(`${STACK}/__test/openai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...size,
        content: {
          is_wine_label: true,
          producer: "Château Margaux",
          wine_name: "Pavillon Rouge",
          vintage: 2014,
          non_vintage: false,
          wine_type: "red",
          country_code: "FR",
          region: "Bordeaux",
          appellation: "Margaux",
          grapes: [],
          abv_percent: 13.5,
          volume_ml: 750,
          text_seen: "CHATEAU MARGAUX PAVILLON ROUGE 2014",
          confidence: { producer: "high", wine_name: "high", vintage: "high" },
        },
      }),
    });
    expect(res.ok).toBe(true);
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    await tapSpot(page, 2, 2, hasTouch);
    await page.getByTestId("quick-scan").click();
    await expect(page).toHaveURL(new RegExp(`/scan\\?place=${rack}&row=2&col=2&from=3d$`));
    const photo = await makeJpeg(page, { ...size, words: "Margaux" });
    await expect(async () => {
      await chooseFile(page.locator('input[type="file"]').first(), {
        name: "IMG_0002.jpg",
        mimeType: "image/jpeg",
        buffer: photo,
      });
      await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible({
        timeout: 4_000,
      });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByTestId("add-spot")).toContainText("Oak rack · Shelf 2 · Position 2");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await page.getByTestId("added-back-3d").click();
    await expect(
      page.getByText(/Pavillon Rouge 2014 is now at Oak rack · shelf 2 · spot 2/),
    ).toBeVisible();
    const there = await onSpot(rack, 2, 2);
    expect(there).toHaveLength(1);
    await drawn(page);
    await expect.poll(() => locateBottle(page, there[0]!.id)).not.toBeNull();
  });

  test("by hand, the spot taken before the save: refused and said; no bottle is added anywhere", async ({
    page,
    request,
  }) => {
    const { rack, token, loose, householdId } = await household(page, request, "qamtaken");
    await page.goto(`/cellar/add?place=${rack}&row=2&col=4&from=3d`);
    await wineChoice(page, /Pavillon Rouge/)
      .first()
      .click();
    await page.getByLabel("Vintage").fill("2017");
    await request.post(`/api/v1/smart-cellar/bottles/${loose[0]}/move`, {
      headers: bearer(token),
      data: { from: null, to: { locationId: rack, row: 2, col: 4, index: 1 } },
    });
    const count = () =>
      sql<{ n: number }>("select count(*)::int as n from public.bottles where household_id = $1", [
        householdId,
      ]).then((r) => r[0]!.n);
    const before = await count();
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByTestId("add-error")).toContainText("That spot was just taken");
    expect(await count()).toBe(before);
  });

  test("by hand, the answer to the save is lost: never saved twice; checking the spot decides", async ({
    page,
    request,
  }) => {
    const { rack, householdId } = await household(page, request, "qamlost");
    const count = () =>
      sql<{ n: number }>("select count(*)::int as n from public.bottles where household_id = $1", [
        householdId,
      ]).then((r) => r[0]!.n);
    const before = await count();
    // 1. the save happened, its answer was lost
    await page.goto(`/cellar/add?place=${rack}&row=3&col=1&from=3d`);
    await wineChoice(page, /Pavillon Rouge/)
      .first()
      .click();
    await page.getByLabel("Vintage").fill("2018");
    await page.route("**/api/v1/bottles", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByTestId("add-error")).toContainText("We couldn't confirm the save");
    // saving again is not offered; checking is
    await expect(page.getByRole("button", { name: "Add 1 bottle" })).toHaveCount(0);
    await page.getByTestId("add-check-spot").click();
    await expect(page.getByTestId("add-saved-after-all")).toContainText("It was saved");
    expect(await count()).toBe(before + 1);
    expect(await onSpot(rack, 3, 1)).toHaveLength(1);
    await expect(page.getByTestId("add-saved-after-all-link")).toHaveAttribute(
      "href",
      `/cellar?unit=${rack}`,
    );
    // 2. the request never arrived: the check says so, and saving is offered again
    await page.unroute("**/api/v1/bottles");
    await page.goto(`/cellar/add?place=${rack}&row=3&col=2&from=3d`);
    await wineChoice(page, /Pavillon Rouge/)
      .first()
      .click();
    await page.getByLabel("Vintage").fill("2018");
    await page.route("**/api/v1/bottles", (route) =>
      route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
    );
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await page.getByTestId("add-check-spot").click();
    await expect(page.getByTestId("add-error")).toContainText("It wasn't saved");
    await page.unroute("**/api/v1/bottles");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByTestId("added-back-3d")).toBeVisible();
    expect(await onSpot(rack, 3, 2)).toHaveLength(1);
    expect(await count()).toBe(before + 2);
  });

  test("another household: none of its bottles offered, its bottle can't be moved onto my spot, and a hint to its place is ignored", async ({
    page,
    request,
    browser,
  }) => {
    await debugOn(page);
    // theirs first (in a context of its own)
    const otherPage = await (await browser.newContext({ baseURL: PREVIEW_URL })).newPage();
    const theirs = await household(otherPage, request, "qathem");
    await otherPage.context().close();
    const mine = await household(page, request, "qame");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    await tapSpot(page, 3, 4, false);
    await page.getByTestId("quick-move").click();
    const which = page.getByTestId("placement-which-placed");
    // my three placed bottles, none of theirs (they have the same wines, in their own places)
    await expect(which.getByRole("radio")).toHaveCount(3);
    await expect(which).not.toContainText(theirs.rack);
    const res = await request.post(`/api/v1/smart-cellar/bottles/${theirs.placed[0]}/move`, {
      headers: bearer(mine.token),
      data: {
        from: { locationId: theirs.rack, row: 1, col: 1, index: 1 },
        to: { locationId: mine.rack, row: 3, col: 4, index: 1 },
      },
    });
    expect(res.status()).toBe(404);
    expect(await spotOf(theirs.placed[0]!)).toMatchObject({ location_id: theirs.rack, loc_row: 1 });
    // their place in the URL: not opened, nothing named
    await page.goto(`/cellar?unit=${theirs.rack}&added=${theirs.placed[0]}`);
    await expect(view(page)).toHaveAttribute("data-mode", "ready");
    await expect(view(page)).not.toHaveAttribute("data-unit", theirs.rack);
    await expect(page.getByText(/is now at/)).toHaveCount(0);
    // and their place in the add flow's URL is no spot at all
    await page.goto(`/cellar/add?place=${theirs.rack}&row=3&col=4&from=3d`);
    await wineChoice(page, /Pavillon Rouge/)
      .first()
      .click();
    await expect(page.getByTestId("add-spot")).toHaveCount(0);
  });

  test("fallbacks: a place from before templates and a place whose arrangement is unknown use the list; without WebGL the list", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { call } = await household(page, request, "qafall");
    const legacy = await addPlace(call, "Old fridge", "fridge", 2, 2);
    const unknown = await addPlace(call, "Hex rack", "rack", 2, 2);
    await sql(
      "update public.cellar_locations set template = 'hex_rack_2031', slot_semantics = 'single' where id = $1",
      [unknown],
    );
    await open3D(page);
    await drawn(page);
    // the place from before templates
    await page.getByTestId("smart-3d-units").getByRole("button", { name: "Old fridge" }).click();
    await expect(view(page)).toHaveAttribute("data-unit-renderer", "legacy");
    await startQuick(page);
    await expect(page.getByTestId("quick-spot-list")).toBeVisible();
    await page.getByTestId("spot-picker").locator('[data-spot="2:2:1"]').click();
    await expect(quickSheet(page)).toContainText("Old fridge · shelf 2 · spot 2");
    await page.keyboard.press("Escape");
    await page.getByTestId("quick-close").click();
    // the unknown arrangement: said, nothing to point at
    await page.getByTestId("smart-3d-units").getByRole("button", { name: "Hex rack" }).click();
    await startQuick(page);
    await expect(page.getByTestId("quick-unknown")).toBeVisible();
    await expect(page.getByTestId("smart-3d-stage")).toHaveAttribute("data-offering", "list");
    expect(legacy).toBeTruthy();
  });

  test("without WebGL: the flat place, the list of free spots, the sheet", async ({
    page,
    request,
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
    await household(page, request, "qaflat");
    await open3D(page);
    await expect(page.getByTestId("smart-3d-flat")).toBeVisible();
    await startQuick(page);
    await expect(page.getByTestId("quick-spot-list")).toBeVisible();
    await page.getByTestId("spot-picker").locator('[data-spot="3:3:1"]').click();
    await expect(quickSheet(page)).toContainText("Oak rack · shelf 3 · spot 3");
  });

  test("the graphics memory is taken back while choosing: said, the list stands in, the markers come back", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    await household(page, request, "qalostgl");
    await open3D(page);
    await drawn(page);
    await startQuick(page);
    await expect(canvas(page)).toHaveAttribute("data-spots", "10");
    await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(
        '[data-testid="smart-3d-stage"] canvas[data-engine]',
      )!;
      (c.getContext("webgl2") ?? c.getContext("webgl"))!
        .getExtension("WEBGL_lose_context")!
        .loseContext();
    });
    await expect(page.getByTestId("smart-3d-lost")).toBeVisible();
    await expect(page.getByTestId("quick-spot-list")).toBeVisible();
    await expect(view(page)).toHaveAttribute("data-quick", "placing");
    await page.getByRole("button", { name: "Show 3D again" }).click();
    await drawn(page);
    await expect(canvas(page)).toHaveAttribute("data-spots", "10");
  });

  test("with the keyboard and reduced motion: in, a spot from the list, the sheet, Escape out; no accessibility violations", async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await debugOn(page);
    await household(page, request, "qakeys");
    await open3D(page);
    await drawn(page);
    await page.getByTestId("quick-add-start").focus();
    await page.keyboard.press("Enter");
    await expect(view(page)).toHaveAttribute("data-quick", "placing");
    await page.getByTestId("quick-list-toggle").focus();
    await page.keyboard.press("Enter");
    const spot = page.getByTestId("spot-picker").locator('[data-spot="2:4:1"]');
    await spot.focus();
    await page.keyboard.press("Enter");
    await expect(quickSheet(page)).toContainText("Oak rack · shelf 2 · spot 4");
    expect(await audit(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("quick-placing")).toHaveCount(0);
    await expect(view(page)).toHaveAttribute("data-quick", "view");
  });

  test("no regression: taking a bottle out and moving it as before; read-only shows no Add bottle", async ({
    page,
    request,
    hasTouch,
  }) => {
    await debugOn(page);
    const { placed } = await household(page, request, "qareg");
    await open3D(page);
    await drawn(page);
    await page.getByRole("button", { name: /Pavillon Rouge 2015, shelf 1, position 1/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspection-panel")).toHaveAttribute("data-open", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("quick-add-start")).toBeVisible();
    expect(placed).toHaveLength(2);
    expect(hasTouch === true || hasTouch === false).toBe(true);
  });
});

// =================================================================================================================
// Not a test: the screenshots of sprint 7.2 (SHOTS72=1), on every size the acceptance names. On each: the place as it
// is, adding (the instruction at the top, the placeholders), and a chosen spot with its sheet. It also checks, on
// each size, that the instruction and the way out are on the first screen.
test.describe("3D Quick Add screenshots (sprint 7.2)", () => {
  test.skip(!process.env.SHOTS72, "only when asked for (SHOTS72=1)");
  test("normal, adding, a chosen spot and its sheet", async ({ page, request, hasTouch }, info) => {
    test.setTimeout(300_000);
    const sizes = hasTouch
      ? [
          { name: "iphone-se", width: 375, height: 667 },
          { name: "iphone-13", width: 390, height: 844 },
          { name: "pixel-7", width: 412, height: 915 },
        ]
      : [{ name: "desktop", width: 1280, height: 800 }];
    await debugOn(page);
    const h = await household(page, request, `qashots${info.project.name}`);
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await open3D(page);
      await drawn(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      const shot = (state: string) =>
        page.screenshot({ path: `test-results/shots72/${size.name}-${state}.png` });
      await expect(page.getByTestId("quick-add-start")).toBeInViewport();
      await page.waitForTimeout(800);
      await shot("1-normal");
      await startQuick(page);
      await expect(page.getByTestId("quick-instruction")).toBeInViewport();
      await expect(page.getByTestId("quick-close")).toBeInViewport();
      await expect(page.getByTestId("smart-3d-stage")).toBeInViewport({ ratio: 0.75 });
      await page.waitForTimeout(800);
      await shot("2-adding");
      await tapSpot(page, 2, 2, hasTouch);
      await expect(quickSheet(page)).toBeVisible();
      await page.waitForTimeout(800);
      await shot("3-sheet");
      // the chosen spot itself, held while a bottle is chosen for it (only its placeholder, larger and warmer)
      await page.getByTestId("quick-unplaced").click();
      await expect(panel(page)).toBeVisible();
      await expect(canvas(page)).toHaveAttribute("data-spots", "1");
      await canvas(page).scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await shot("4-chosen");
      await page.getByTestId("placement-cancel").click();
      await expect(view(page)).toHaveAttribute("data-quick", "view");
      if (!hasTouch) {
        // a mouse over a placeholder warms it (a finger has no hover)
        await startQuick(page);
        const at = await markerAt(page, 2, 3);
        await page.mouse.move(at.x, at.y);
        await page.waitForTimeout(800);
        await shot("5-hover");
        await page.getByTestId("quick-close").click();
      }
    }
    // the placeholders on a dark and on a light piece of furniture: seen on both, dominant on neither
    const size = sizes[0]!;
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const [name, template, appearance] of [
      [
        "dark",
        "rack_classic",
        { v: 1, material: "wood", color: "ebony", lighting: "none", door: "none" },
      ],
      [
        "light",
        "rack_generic",
        { v: 1, material: "lacquer", color: "white", lighting: "none", door: "none" },
      ],
    ] as const) {
      await h.call(
        "put",
        `/smart-cellar/storage/${h.rack}/layout`,
        { structure: { template, rows: 3, cols: 4, cellCapacity: 1, zones: [] }, appearance },
        200,
      );
      await open3D(page);
      await drawn(page);
      await startQuick(page);
      await expect(canvas(page)).toHaveAttribute("data-spots", "10");
      await page.waitForTimeout(800);
      await page.screenshot({ path: `test-results/shots72/${size.name}-6-${name}.png` });
      await page.getByTestId("quick-close").click();
    }
  });
});
