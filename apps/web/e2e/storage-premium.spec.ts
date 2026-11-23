import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_URL } from "./helpers";
import {
  bottleIds,
  canvasOf,
  handOff,
  held,
  num,
  phaseIs,
  putBack,
  show,
  storageOf,
  takeOut,
  tap,
  whereIs,
} from "./storage3d";

/**
 * The premium look (Smart Cellar 3D, sprint 2B.2), in the template gallery: what it may change (how a place is
 * drawn) and what it may never change (which bottle is where, what a tap chooses, what it costs to look again).
 * The specs of sprints 2A and 2B.1 run against this look too, since it is the default; here is what is new.
 */
test.use({ baseURL: PREVIEW_URL });
test.setTimeout(150_000);

const TEMPLATES = [
  "rack_generic",
  "rack_classic",
  "rack_double_depth",
  "rack_metal",
  "shelving_open",
  "cabinet_closed",
  "cooler_single",
  "cooler_dual",
  "cooler_undercounter",
  "cube_modular",
  "diamond_bins",
  "crate_storage",
  "wall_pegs",
  "wall_rails",
] as const;
const REFERENCES = ["rack_classic", "cooler_dual", "wall_rails"] as const;
const stage = (page: Page) => page.getByTestId("gallery-stage");
const panel = (page: Page) => page.getByTestId("inspection-panel");

/** Where every bottle is on the screen, from the view's own camera. */
async function everyBottle(page: Page) {
  const ids = await bottleIds(page);
  const at: Record<string, string> = {};
  for (const id of ids) {
    const p = await whereIs(page, id);
    at[id] = `${Math.round(p.x)},${Math.round(p.y)}`;
  }
  return at;
}

test.describe("the look changes how a place is drawn, never what is in it", () => {
  for (const template of REFERENCES)
    test(`${template}: the same bottles on the same spots at every level of detail`, async ({
      page,
    }) => {
      await show(page, `template=${template}&fill=full&quality=high`, { prewarmed: false });
      await expect(stage(page)).toHaveAttribute("data-fidelity", "premium");
      const high = await everyBottle(page);
      expect(Object.keys(high).length).toBeGreaterThan(3);
      for (const quality of ["balanced", "low"]) {
        await show(page, `template=${template}&fill=full&quality=${quality}`, { prewarmed: false });
        expect(await num(page, "bottles")).toBe(Object.keys(high).length);
        expect(await everyBottle(page), quality).toEqual(high);
      }
      // the look before this sprint holds the same bottles (its camera frames furniture without a plinth, so
      // the screen is not compared: that every bottle lies exactly where it lay is held by the unit tests)
      await show(page, `template=${template}&fill=full&quality=high&fidelity=classic`, {
        prewarmed: false,
      });
      await expect(stage(page)).toHaveAttribute("data-fidelity", "classic");
      expect((await bottleIds(page)).sort()).toEqual(Object.keys(high).sort());
    });

  // One test per level of detail: each opens its own page, so nothing carries from one level to the next. As a
  // single test the three levels were nine take-outs in one 150 s budget: 66–120 s on a normal CI runner, over 150 s
  // on a slow one (run 45079105123: phone out of time on both attempts, desktop once).
  for (const quality of ["high", "balanced", "low"])
    test(`a tap takes the tapped bottle at the ${quality} level of detail`, async ({
      page,
      hasTouch,
    }) => {
      await show(page, `template=rack_classic&rows=4&cols=4&fill=full&quality=${quality}`);
      const ids = await bottleIds(page);
      for (const id of [ids[0]!, ids[5]!, ids.at(-1)!]) {
        await takeOut(page, id, hasTouch);
        await expect(storageOf(page)).toHaveAttribute("data-showcase-bottle", id);
        await putBack(page);
        const { pose, drift } = await handOff(page);
        expect(pose, `${quality} ${id}`).toBeLessThanOrEqual(1e-9);
        expect(drift, `${quality} ${id}`).toBeLessThanOrEqual(0.5);
      }
    });

  test("bottles behind premium glass are still chosen through it", async ({ page, hasTouch }) => {
    await show(page, "template=cooler_dual&door=glass&fill=full&quality=high");
    const ids = await bottleIds(page);
    for (const id of [ids[0]!, ids[Math.floor(ids.length / 2)]!, ids.at(-1)!]) {
      const [row, col] = id.slice(2).split(":");
      await tap(page, await whereIs(page, id), hasTouch);
      await expect(page.getByTestId("gallery-picked")).toContainText(
        `shelf ${row}, position ${col}`,
      );
      await expect(storageOf(page)).toHaveAttribute("data-showcase-reason", "behind_door");
      await putBack(page);
    }
  });
});

test.describe("every template is drawn in the premium look", () => {
  for (const template of TEMPLATES)
    test(`${template}: drawn, in a dozen or so draw calls, and stands still`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await show(page, `template=${template}&quality=high`, { prewarmed: false });
      await expect(stage(page)).toHaveAttribute("data-fidelity", "premium");
      await expect(canvasOf(page)).toHaveAttribute("data-template", template);
      // the furniture, the bottles, and at most a glow and a shadow more than before
      expect(await num(page, "calls")).toBeLessThanOrEqual(26);
      expect(await num(page, "triangles")).toBeGreaterThan(0);
      const frames = await num(page, "frames");
      await page.waitForTimeout(1200);
      expect(await num(page, "frames")).toBe(frames);
      expect(errors).toEqual([]);
    });
});

test.describe("looking again costs nothing more", () => {
  test("from one look to the other and back: the same geometries, textures and shaders as the first time", async ({
    page,
  }) => {
    await show(page, "template=cooler_dual&fill=full&quality=high");
    const look = page.getByTestId("gallery-review").getByRole("combobox").first();
    const there = async () => {
      await look.selectOption("classic");
      await expect(stage(page)).toHaveAttribute("data-fidelity", "classic");
      await expect(canvasOf(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 30_000 });
    };
    const back = async () => {
      await look.selectOption("premium");
      await expect(stage(page)).toHaveAttribute("data-fidelity", "premium");
      await expect(canvasOf(page)).toHaveAttribute("data-prewarmed", /^\d+$/, { timeout: 60_000 });
    };
    // once there and back: each look's shared pictures have been drawn (once a page, never again)
    await there();
    const classic = await held(page);
    await back();
    const first = await held(page);
    // the pictures both looks share out are a fixed handful
    expect(first.textures).toBeLessThanOrEqual(16);
    for (let round = 0; round < 3; round++) {
      await there();
      expect(await held(page), `classic, round ${round}`).toEqual(classic);
      await back();
      expect(await held(page), `premium, round ${round}`).toEqual(first);
    }
    expect(await held(page)).toEqual(first);
  });

  for (const template of REFERENCES)
    test(`${template}: the first bottle taken out compiles no shader`, async ({
      page,
      hasTouch,
    }) => {
      await show(page, `template=${template}&fill=full&quality=high`);
      const warmed = await num(page, "prewarmed");
      expect(warmed).toBeGreaterThan(0);
      expect(await num(page, "programs")).toBeLessThanOrEqual(warmed);
      const ids = await bottleIds(page);
      await takeOut(page, ids[Math.floor(ids.length / 2)]!, hasTouch);
      expect(await num(page, "programs")).toBe(warmed);
      await putBack(page);
      expect(await num(page, "programs")).toBe(warmed);
      const before = await held(page);
      // and a second look at another bottle of the same place takes nothing more
      await takeOut(page, ids[0]!, hasTouch);
      await putBack(page);
      const after = await held(page);
      expect(after.programs).toBe(before.programs);
      expect(after.textures).toBeLessThanOrEqual(before.textures + 1); // a label of a new wine at most
    });

  test("the graphics memory taken back while the premium look is up: said, and started again", async ({
    page,
  }) => {
    await show(page, "template=cooler_dual&fill=full&quality=high");
    const first = await held(page);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="gallery-stage"] canvas[data-engine]',
      )!;
      (canvas.getContext("webgl2") ?? canvas.getContext("webgl"))!
        .getExtension("WEBGL_lose_context")!
        .loseContext();
    });
    await expect(page.getByText("The browser took the graphics memory back.")).toBeVisible();
    await page.getByRole("button", { name: "Show 3D again" }).click();
    await expect(canvasOf(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 30_000 });
    await expect(canvasOf(page)).toHaveAttribute("data-prewarmed", /^\d+$/, { timeout: 60_000 });
    // the new view holds what the first one held: the shared pictures were not made twice
    const again = await held(page);
    expect(again.geometries).toBe(first.geometries);
    expect(again.textures).toBeLessThanOrEqual(first.textures);
  });
});

test.describe("the dark studio is the gallery's own", () => {
  test("it darkens the box behind the place, and nothing of the app around it", async ({
    page,
  }) => {
    await show(page, "template=rack_classic&fill=full&quality=high");
    const theme = () =>
      page.evaluate(() => ({
        cls: document.documentElement.className,
        theme: document.documentElement.getAttribute("data-theme"),
        page: getComputedStyle(document.body).backgroundColor,
      }));
    const light = await theme();
    const calls = await num(page, "calls");
    const studio = page.getByTestId("gallery-review").getByRole("combobox").nth(1);
    await studio.selectOption("dark");
    await expect(stage(page)).toHaveAttribute("data-studio", "dark");
    expect(await theme()).toEqual(light);
    // the place is the same place: nothing was built again for it
    expect(await num(page, "calls")).toBe(calls);
    await expect(page).toHaveURL(/studio=dark/);
    await studio.selectOption("light");
    await expect(stage(page)).toHaveAttribute("data-studio", "light");
    await expect(page).not.toHaveURL(/studio=/);
  });
});

test.describe("a narrow screen that gives the panel no place of its own", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the panel is a sheet inside the picture, the bottle stands whole above it, and it closes", async ({
    page,
  }) => {
    await show(page, "template=rack_classic&rows=4&cols=4&fill=full&panel=inside");
    await expect(storageOf(page)).toHaveAttribute("data-layout", "sheet");
    // nothing is put where the gallery would otherwise have put the panel
    await expect(page.getByTestId("inspection-slot").getByTestId("inspection-panel")).toHaveCount(
      0,
    );
    await tap(page, await whereIs(page, "b-2:2:1"), false);
    await phaseIs(page, "inspecting");
    await expect(panel(page)).toHaveAttribute("data-open", "true");
    await expect(panel(page)).toHaveAttribute("data-place", "sheet");
    await expect(page.getByTestId("inspection-title")).toBeVisible();
    const box = (await canvasOf(page).boundingBox())!;
    const sheet = (await panel(page).boundingBox())!;
    // inside the picture, over its lower part
    expect(sheet.x).toBeGreaterThanOrEqual(box.x);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(sheet.y).toBeGreaterThan(box.y + box.height * 0.45);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(box.y + box.height + 1);
    // the bottle is whole, and above the sheet
    const [, top, bottom] = (await canvasOf(page).getAttribute("data-showcase-box"))!
      .split(",")
      .map(Number);
    expect(top!).toBeGreaterThanOrEqual(0);
    expect(box.y + bottom!).toBeLessThanOrEqual(sheet.y + 2);
    expect(bottom! - top!).toBeGreaterThan(box.height * 0.3);
    // the way back is in reach, and works
    const back = page.getByTestId("inspection-back");
    await back.scrollIntoViewIfNeeded();
    await expect(back).toBeVisible();
    await back.click();
    await phaseIs(page, "idle");
    expect((await handOff(page)).pose).toBeLessThanOrEqual(1e-9);
    await expect(panel(page)).toHaveAttribute("data-open", "false");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });

  test("given a place below the picture, the panel goes there as before", async ({ page }) => {
    await show(page, "template=rack_classic&rows=4&cols=4&fill=full");
    await expect(storageOf(page)).toHaveAttribute("data-layout", "stacked");
    await tap(page, await whereIs(page, "b-2:2:1"), false);
    await phaseIs(page, "inspecting");
    const slot = page.getByTestId("inspection-slot");
    await expect(slot.getByTestId("inspection-panel")).toHaveAttribute("data-place", "below");
    await putBack(page);
  });
});
