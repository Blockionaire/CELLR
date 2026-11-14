import { expect, test, type Page } from "@playwright/test";
import { APP_URL, PREVIEW_URL, audit } from "./helpers";

/**
 * The template gallery of Smart Cellar 3D (/design/cellar-3d, sprint 2A): every storage template drawn by the new
 * layout-driven 3D view, next to the flat picture of the same place. No account and no database: the gallery makes
 * its places and bottles up from numbers, so these tests need nothing but the page.
 *
 * They run against the test server that declares itself a Vercel preview: the gallery is closed on any other
 * production build (the last tests of this file are about exactly that).
 */
test.use({ baseURL: PREVIEW_URL });
const TEMPLATES: Array<[id: string, renderer: "grid" | "bins" | "wall"]> = [
  ["rack_classic", "grid"],
  ["rack_double_depth", "grid"],
  ["rack_metal", "grid"],
  ["shelving_open", "grid"],
  ["cabinet_closed", "grid"],
  ["rack_generic", "grid"],
  ["cooler_single", "grid"],
  ["cooler_dual", "grid"],
  ["cooler_undercounter", "grid"],
  ["cube_modular", "bins"],
  ["diamond_bins", "bins"],
  ["crate_storage", "bins"],
  ["wall_pegs", "wall"],
  ["wall_rails", "wall"],
];

const canvasOf = (page: Page) => page.locator('[data-testid="gallery-stage"] canvas');
const num = async (page: Page, name: string) =>
  Number(await canvasOf(page).getAttribute(`data-${name}`));

/** Opens a picture of the gallery and waits until the 3D view has drawn it. */
async function show(page: Page, query: string) {
  await page.goto(`/design/cellar-3d?${query}`);
  await expect(canvasOf(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 30_000 });
}

/** Where a bottle is on the page, from the view's own camera. */
async function whereIs(page: Page, id: string) {
  const at = await page.evaluate(
    (bottle) =>
      (
        window as unknown as {
          __cellrStorage3d: { locate(id: string): { x: number; y: number } | null };
        }
      ).__cellrStorage3d.locate(bottle),
    id,
  );
  expect(at, `bottle ${id} is in the picture`).not.toBeNull();
  // on a phone the 3D view is below the controls
  await canvasOf(page).scrollIntoViewIfNeeded();
  const box = (await canvasOf(page).boundingBox())!;
  return { x: box.x + at!.x, y: box.y + at!.y };
}
/** A tap: a finger on a phone, the mouse elsewhere. */
async function tap(page: Page, at: { x: number; y: number }, touch: boolean) {
  if (touch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}
const bottleIds = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __cellrStorage3d: { ids(): string[] } }).__cellrStorage3d.ids(),
  );

test.describe("every template is drawn", () => {
  for (const [id, renderer] of TEMPLATES)
    test(`${id} by the ${renderer} renderer, and flat`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await show(page, `template=${id}`);
      const canvas = canvasOf(page);
      await expect(canvas).toHaveAttribute("data-renderer", renderer);
      await expect(canvas).toHaveAttribute("data-template", id);
      await expect(canvas).toHaveAttribute("data-stranded", "0");
      expect(await num(page, "triangles")).toBeGreaterThan(0);
      // furniture is a handful of merged meshes and bottles are instanced: never a draw call per bottle or per board
      expect(await num(page, "calls")).toBeLessThanOrEqual(30);
      // the 3D view and the flat picture show the same number of bottles
      const summary = await page.getByTestId("layout-map-summary").innerText();
      expect(Number(summary.match(/^(\d+) of/)![1])).toBe(await num(page, "bottles"));
      expect(errors).toEqual([]);
    });
});

test("stands still: nothing is drawn while nothing changes", async ({ page }) => {
  await show(page, "template=rack_classic");
  await page.waitForTimeout(1200); // the first pictures, and the readout's first look
  const before = await num(page, "frames");
  await page.waitForTimeout(2000);
  expect(await num(page, "frames")).toBe(before);
});

test("a tap chooses the bottle under it, in 3D and flat alike", async ({ page, hasTouch }) => {
  await show(page, "template=rack_double_depth&rows=3&cols=4&fill=full");
  const picked = page.getByTestId("gallery-picked");
  await expect(picked).toHaveText("No bottle chosen.");
  // a front bottle
  const at = await whereIs(page, "b-2:3:1");
  await tap(page, at, hasTouch);
  await expect(picked).toContainText("shelf 2, position 3, at the front");
  await expect(page.locator('[data-cell="2:3"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[aria-pressed="true"]')).toHaveCount(1);
  // a tap beside the place lets go of it
  const box = (await canvasOf(page).boundingBox())!;
  await tap(page, { x: box.x + 6, y: box.y + 6 }, hasTouch);
  await expect(picked).toHaveText("No bottle chosen.");
});

test("a tap on a position with a bottle in front never takes the one behind", async ({
  page,
  hasTouch,
}) => {
  await show(page, "template=rack_double_depth&rows=2&cols=3&fill=full");
  for (const id of ["b-1:1:1", "b-1:3:1", "b-2:2:1"]) {
    const at = await whereIs(page, id);
    await tap(page, at, hasTouch);
    await expect(page.getByTestId("gallery-picked")).toContainText("at the front");
  }
});

/**
 * Regression (sprint 2A review): a deep position whose front is free while a bottle lies behind it. The flat
 * picture shows the front as free and says so; pressing it must not quietly choose the bottle behind.
 */
test("flat: a position with a free front and a bottle behind it chooses nothing", async ({
  page,
}) => {
  await show(page, "template=rack_double_depth&rows=4&cols=6");
  const grid = page.getByRole("grid");
  const picked = page.getByTestId("gallery-picked");
  // every such position of this (made-up, always the same) rack
  const freeFronts = grid.getByRole("button", { name: /: front: free; back: (?!free)/ });
  const count = await freeFronts.count();
  expect(count, "the fixture has positions with a free front and a taken back").toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await freeFronts.nth(i).click();
    await expect(picked).toHaveText("No bottle chosen.");
    await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(grid.locator("[data-chosen-place]")).toHaveCount(0);
  }
  // the keyboard is the same press
  await freeFronts.first().focus();
  await page.keyboard.press("Enter");
  await expect(picked).toHaveText("No bottle chosen.");
  await page.keyboard.press("Space");
  await expect(picked).toHaveText("No bottle chosen.");

  // with another bottle chosen first, pressing a free front lets go of it and still does not take the one behind
  const taken = grid.getByRole("button", { name: /: front: (?!free)/ }).first();
  await taken.click();
  await expect(picked).toContainText("at the front");
  await freeFronts.first().click();
  await expect(picked).toHaveText("No bottle chosen.");
});

/**
 * The bottle behind a free front CAN be chosen where it can be pointed at: in the 3D view, with nothing before
 * it. The flat picture then says which place it is, the cell is still not "pressed" (its front is free), and
 * pressing the cell lets go of it. A rack one position wide, so no neighbour stands before the bottle.
 */
test("flat: a rear bottle chosen in 3D is marked as the rear one, and its position still chooses nothing", async ({
  page,
  hasTouch,
}) => {
  await show(page, "template=rack_double_depth&rows=8&cols=1");
  const grid = page.getByRole("grid");
  const picked = page.getByTestId("gallery-picked");
  const button = grid.locator('[data-cell="7:1"]');
  await expect(button).toHaveAttribute(
    "aria-label",
    /^Shelf 7, position 1: front: free; back: (?!free).+/,
  );

  await tap(page, await whereIs(page, "b-7:1:2"), hasTouch);
  await expect(picked).toContainText("shelf 7, position 1, at the back");
  await expect(button).toHaveAttribute("data-chosen-place", "2");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toHaveAttribute("aria-label", /front: free; back: .+ \(chosen\)$/);
  await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(grid.locator("[data-chosen-place]")).toHaveCount(1);

  // pressing that position lets go; it does not, now or on a second press, choose the rear bottle itself
  await button.click();
  await expect(picked).toHaveText("No bottle chosen.");
  await button.click();
  await expect(picked).toHaveText("No bottle chosen.");
  await expect(grid.locator("[data-chosen-place]")).toHaveCount(0);
});

test("flat: a position with both places taken chooses its front bottle, says which, and lets go again", async ({
  page,
}) => {
  await show(page, "template=rack_double_depth&rows=1&cols=2&fill=full");
  const picked = page.getByTestId("gallery-picked");
  const button = page.locator('[data-cell="1:1"]');
  await button.click();
  await expect(picked).toContainText("shelf 1, position 1, at the front");
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveAttribute("data-chosen-place", "1");
  await expect(button).toHaveAttribute("aria-label", /front: .+ \(chosen\); back: [^()]+$/);
  await expect(page.locator("[data-chosen-place]")).toHaveCount(1);
  await button.click();
  await expect(picked).toHaveText("No bottle chosen.");
  await expect(page.locator("[data-chosen-place]")).toHaveCount(0);
});

test("a glass door does not get in the way of choosing a bottle", async ({ page, hasTouch }) => {
  await show(page, "template=cooler_single&door=glass&fill=full");
  const ids = await bottleIds(page);
  for (const id of [ids[0]!, ids[Math.floor(ids.length / 2)]!, ids.at(-1)!]) {
    const [row, col] = id.slice(2).split(":");
    const at = await whereIs(page, id);
    await tap(page, at, hasTouch);
    await expect(page.getByTestId("gallery-picked")).toContainText(`shelf ${row}, position ${col}`);
  }
});

test("a pile says which compartment, and does not claim a place in it", async ({
  page,
  hasTouch,
}) => {
  await show(page, "template=diamond_bins&fill=full");
  const ids = await bottleIds(page);
  const at = await whereIs(page, ids[0]!);
  await tap(page, at, hasTouch);
  const picked = page.getByTestId("gallery-picked");
  await expect(picked).toContainText(/in compartment \d+·\d+/);
  await expect(picked).toContainText("Where in the compartment it lies is not recorded.");
  await expect(page.getByTestId("layout-map")).toHaveAttribute("data-mode", "count");
});

test("the camera turns and zooms, within limits, and a drag is not a tap", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "mouse gestures; touch is the same controls");
  test.setTimeout(120_000); // software WebGL draws every step of a drag slowly
  await show(page, "template=rack_classic&rows=3&cols=4&fill=full");
  const canvas = canvasOf(page);
  const box = (await canvas.boundingBox())!;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  const azimuth = Number(await canvas.getAttribute("data-azimuth"));
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 160, cy, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-azimuth")))
    .not.toBe(azimuth);
  // ended on a bottle or not: a drag chose nothing
  await expect(page.getByTestId("gallery-picked")).toHaveText("No bottle chosen.");
  // turning has an end: the back of the place is never shown
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 500, cy, { steps: 3 });
    await page.mouse.up();
  }
  await expect
    .poll(async () => Math.abs(Number(await canvas.getAttribute("data-azimuth"))))
    .toBeLessThanOrEqual(1.11);
  const far = Number(await canvas.getAttribute("data-distance"));
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-distance")))
    .toBeLessThan(far);
  // and zooming in stops before the camera is inside the furniture
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(500);
  expect(Number(await canvas.getAttribute("data-distance"))).toBeGreaterThan(far * 0.2);
});

test("changing template gives back what the last one took", async ({ page }) => {
  test.setTimeout(120_000);
  await show(page, "template=rack_classic");
  const template = page.getByLabel("Template", { exact: true });
  const settle = async (id: string) => {
    await template.selectOption(id);
    await expect(canvasOf(page)).toHaveAttribute("data-template", id);
    await page.waitForTimeout(250);
  };
  await settle("cooler_dual");
  await settle("rack_classic");
  const base = { geometries: await num(page, "geometries"), textures: await num(page, "textures") };
  for (let round = 0; round < 2; round++) for (const [id] of TEMPLATES) await settle(id);
  await settle("rack_classic");
  expect({
    geometries: await num(page, "geometries"),
    textures: await num(page, "textures"),
  }).toEqual(base);
});

test("the flat picture works from the keyboard and reads well", async ({ page, isMobile }) => {
  test.skip(isMobile, "a keyboard");
  await show(page, "template=rack_double_depth&rows=3&cols=4&fill=full");
  const grid = page.getByRole("grid", { name: "Double-depth rack" });
  await expect(grid.getByRole("button")).toHaveCount(12);
  const first = grid.locator('[data-cell="1:1"]');
  await first.focus();
  await expect(first).toHaveAttribute("aria-label", /^Shelf 1, position 1: front: .+; back: .+/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(grid.locator('[data-cell="2:2"]')).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp"); // already at the top: stays
  await expect(grid.locator('[data-cell="1:2"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("gallery-picked")).toContainText(
    "shelf 1, position 2, at the front",
  );
  // one stop for Tab
  await expect(grid.locator('button[tabindex="0"]')).toHaveCount(1);
});

test("the gallery has no accessibility violations, for a rack and for bins", async ({ page }) => {
  for (const id of ["rack_double_depth", "crate_storage"]) {
    await show(page, `template=${id}`);
    expect(await audit(page), id).toEqual([]);
  }
});

test("a place whose arrangement is not known gets the neutral picture and says so", async ({
  page,
}) => {
  for (const unknown of ["unknown-template", "kind-mismatch", "pegs-three-each", "bins-as-depth"]) {
    await show(page, `sample=unknown&unknown=${unknown}`);
    await expect(canvasOf(page)).toHaveAttribute("data-renderer", "neutral");
    await expect(canvasOf(page)).toHaveAttribute("data-template", "");
    await expect(page.getByTestId("layout-map-unknown")).toBeVisible();
    await expect(page.getByTestId("layout-map")).toHaveAttribute("data-mode", "count");
  }
});

test("a place from before templates is drawn by the existing 3D view", async ({ page }) => {
  await page.goto("/design/cellar-3d?sample=legacy&rows=4&cols=6");
  await expect(page.getByTestId("fact-renderer")).toHaveText("legacy");
  const canvas = canvasOf(page);
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  // the new view writes its name on its canvas; the existing one does not, and this is the existing one
  await expect(canvas).not.toHaveAttribute("data-renderer", /.*/);
  await expect(page.getByText("This is the existing 3D view, unchanged.")).toBeVisible();
  await expect(page.getByRole("grid").getByRole("button")).toHaveCount(24);
});

test("when the browser takes the graphics memory back, the gallery says so and can start again", async ({
  page,
}) => {
  await show(page, "template=rack_metal");
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="gallery-stage"] canvas',
    )!;
    (canvas.getContext("webgl2") ?? canvas.getContext("webgl"))!
      .getExtension("WEBGL_lose_context")!
      .loseContext();
  });
  await expect(page.getByText("The browser took the graphics memory back.")).toBeVisible();
  // the flat picture is still there
  await expect(page.getByRole("grid")).toBeVisible();
  await page.getByRole("button", { name: "Show 3D again" }).click();
  await expect(canvasOf(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 30_000 });
});

test("fits a narrow phone: the page does not scroll sideways, a wide place scrolls in its own box", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await show(page, "template=rack_classic&rows=4&cols=20");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const grid = page.getByRole("grid");
  expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  // cells stay big enough for a thumb
  const cell = (await grid.locator('[data-cell="1:1"]').boundingBox())!;
  expect(Math.min(cell.width, cell.height)).toBeGreaterThanOrEqual(44);
});

test("what is typed into the address stays inside what a template allows", async ({ page }) => {
  await show(
    page,
    "template=wall_pegs&rows=9999&cols=9999&cap=7&material=plutonium&door=portcullis",
  );
  await expect(canvasOf(page)).toHaveAttribute("data-renderer", "wall");
  expect(await num(page, "bottles")).toBeLessThanOrEqual(1200);
  await page.goto("/design/cellar-3d?template=..%2F..%2Fetc");
  await expect(page.getByLabel("Template", { exact: true })).toHaveValue("rack_classic");
});

/**
 * The gallery's gate, in a browser. The ordinary test server is a production build with DESIGN_GALLERY=1 and
 * nothing that says where it runs: the app cannot tell it from a production host, so it shows no gallery.
 */
test.describe("where the gallery is closed", () => {
  test("a production build with no Vercel marker shows nothing of it, with DESIGN_GALLERY=1 set", async ({
    page,
  }) => {
    for (const address of [
      "/design/cellar-3d",
      "/design/cellar-3d?template=diamond_bins&fill=full",
    ]) {
      await page.goto(APP_URL + address);
      await expect(
        page.getByRole("heading", { name: "We couldn't find that page." }),
      ).toBeVisible();
      await expect(page.getByTestId("cellar-gallery")).toHaveCount(0);
      await expect(page.getByTestId("gallery-stage")).toHaveCount(0);
      await expect(page.getByTestId("layout-map")).toHaveCount(0);
      await expect(page.locator("canvas")).toHaveCount(0);
      expect(await page.title()).not.toContain("Storage templates");
      await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
        "content",
        /noindex/,
      );
    }
  });

  test("the design-system page on that same server is open, as it always was", async ({ page }) => {
    await page.goto(APP_URL + "/design");
    await expect(page.getByRole("heading", { name: "Design system", level: 1 })).toBeVisible();
  });

  test("the preview server shows it, and is not for search engines either", async ({ page }) => {
    await page.goto("/design/cellar-3d");
    await expect(page.getByTestId("cellar-gallery")).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  });
});
