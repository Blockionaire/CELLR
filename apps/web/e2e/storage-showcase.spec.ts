import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, audit } from "./helpers";
import {
  bottleIds,
  canvasOf,
  handOff,
  held,
  num,
  phaseIs,
  putBack,
  show,
  stillOf,
  storageOf,
  takeOut,
  tap,
  whereIs,
} from "./storage3d";

/**
 * Taking a bottle out to look at it, in the new storage view (Smart Cellar 3D, sprint 2B.1), in the template
 * gallery with its made-up bottles. No account, no database, no request to anywhere while a bottle is looked at.
 */
test.use({ baseURL: PREVIEW_URL });
// software WebGL draws every frame of a movement slowly
test.setTimeout(120_000);

const panel = (page: Page) => page.getByTestId("inspection-panel");

test.describe("out, looked at, back", () => {
  test("a tap takes the bottle out, shows what it is, and Escape puts it back exactly where it was", async ({
    page,
    hasTouch,
  }) => {
    await show(page, "template=rack_classic&fill=full&quality=high");
    const before = { azimuth: await num(page, "azimuth"), distance: await num(page, "distance") };
    await expect(panel(page)).toHaveAttribute("data-open", "false");

    await tap(page, await whereIs(page, "b-2:3:1"), hasTouch);
    await expect(storageOf(page)).toHaveAttribute("data-showcase-bottle", "b-2:3:1");
    await expect(storageOf(page)).toHaveAttribute("data-showcase-mode", "physical");
    await phaseIs(page, "inspecting");
    // what it is, and where it is kept: its own spot, unchanged
    await expect(panel(page)).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("inspection-title")).not.toBeEmpty();
    await expect(page.getByTestId("inspection-where")).toHaveText("shelf 2, position 3.");
    await expect(page.getByTestId("inspection-how")).toHaveText("Taken out of its place.");
    await expect(canvasOf(page)).toHaveAttribute("data-front-label", "drawn");
    // the place has stepped back as a picture, and only the bottle is drawn
    await expect(stillOf(page).locator("canvas")).toHaveCount(1);
    expect(await num(page, "calls")).toBeLessThanOrEqual(10);

    await putBack(page);
    await expect(panel(page)).toHaveAttribute("data-open", "false");
    const { pose, drift } = await handOff(page);
    expect(pose, "the bottle landed on its own pose").toBeLessThanOrEqual(1e-9);
    expect(drift, "and on the same pixel of the picture of the place").toBeLessThanOrEqual(0.5);
    // the camera is where it was
    expect({ azimuth: await num(page, "azimuth"), distance: await num(page, "distance") }).toEqual(
      before,
    );
    // and it is still the chosen bottle
    await expect(page.getByTestId("gallery-picked")).toContainText("shelf 2, position 3");
  });

  test("the bottle that is taken out is the bottle that was tapped", async ({ page, hasTouch }) => {
    await show(page, "template=rack_double_depth&rows=3&cols=4&fill=full");
    for (const [id, where] of [
      ["b-1:1:1", "shelf 1, position 1, at the front."],
      ["b-3:4:1", "shelf 3, position 4, at the front."],
      ["b-2:2:1", "shelf 2, position 2, at the front."],
    ] as const) {
      await takeOut(page, id, hasTouch);
      await expect(page.getByTestId("inspection-where")).toHaveText(where);
      // the flat picture marks the same spot
      const cell = id.slice(2, -2);
      await expect(page.locator(`[data-cell="${cell}"]`)).toHaveAttribute("data-chosen-place", "1");
      await expect(page.locator("[data-chosen-place]")).toHaveCount(1);
      await putBack(page);
    }
  });

  test("it stands at the same place on the screen whatever the place and however it was turned", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "turning the place with the mouse");
    const boxes: string[] = [];
    for (const query of [
      "template=rack_classic&fill=full",
      "template=wall_pegs&fill=full",
      "template=diamond_bins&fill=full",
    ]) {
      await show(page, query);
      const canvas = (await canvasOf(page).boundingBox())!;
      // turn the place first
      await page.mouse.move(canvas.x + 60, canvas.y + 40);
      await page.mouse.down();
      await page.mouse.move(canvas.x + 200, canvas.y + 60, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(800);
      const ids = await bottleIds(page);
      await takeOut(page, ids[0]!, false);
      boxes.push((await canvasOf(page).getAttribute("data-showcase-box"))!);
      await putBack(page);
      expect((await handOff(page)).pose).toBeLessThanOrEqual(1e-9);
    }
    expect(new Set(boxes).size, boxes.join(" | ")).toBe(1);
  });
});

test.describe("turning the bottle is not turning the place", () => {
  test("a drag turns the bottle; the camera of the place does not move, and is as it was when the bottle is back", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "a mouse drag; the touch drag has its own test");
    await show(page, "template=rack_classic&fill=full");
    const camera = async () => [await num(page, "azimuth"), await num(page, "distance")];
    const before = await camera();
    await takeOut(page, "b-2:3:1", false);
    const box = (await canvasOf(page).boundingBox())!;
    await page.mouse.move(box.x + 140, box.y + 260);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 260, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => num(page, "showcase-yaw")).toBeGreaterThan(1);
    expect(await camera()).toEqual(before);
    // a drag that ends beside the bottle is not a tap beside it: the bottle stays out
    await page.waitForTimeout(400);
    await phaseIs(page, "inspecting");
    // nor does the wheel zoom the place behind it
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(300);
    expect(await camera()).toEqual(before);

    await putBack(page);
    expect(await camera()).toEqual(before);
    // however far it was turned, it lies in its place as it lay
    expect((await handOff(page)).pose).toBeLessThanOrEqual(1e-9);
    // and the place can be turned again
    await page.mouse.move(box.x + 60, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 220, box.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => num(page, "azimuth")).not.toBe(before[0]);
  });

  test("on a phone: a finger takes it out, turns it, and a tap beside it puts it back", async ({
    page,
    hasTouch,
    isMobile,
  }) => {
    test.skip(!isMobile || !hasTouch, "a phone");
    await show(page, "template=rack_classic&rows=4&cols=4&fill=full");
    await expect(storageOf(page)).toHaveAttribute("data-layout", "stacked");
    const azimuth = await num(page, "azimuth");
    await takeOut(page, "b-2:2:1", true);
    // large enough to look at: most of the picture's height
    const stage = (await canvasOf(page).boundingBox())!;
    const [, top, bottom] = (await canvasOf(page).getAttribute("data-showcase-box"))!
      .split(",")
      .map(Number);
    expect(bottom! - top!).toBeGreaterThan(stage.height * 0.8);
    expect(top!).toBeGreaterThanOrEqual(0);
    expect(bottom!).toBeLessThanOrEqual(stage.height);
    // the panel is below the picture, not over the bottle
    const slot = page.getByTestId("inspection-slot");
    await expect(slot.getByTestId("inspection-panel")).toHaveAttribute("data-open", "true");
    expect((await slot.boundingBox())!.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1);

    // a finger across the bottle turns it
    const cdp = await page.context().newCDPSession(page);
    const y = Math.round(stage.y + stage.height / 2);
    const finger = (type: string, x: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type: type as "touchStart",
        touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(stage.x + x), y }],
      });
    await finger("touchStart", 90);
    for (const x of [120, 150, 180, 210, 240]) await finger("touchMove", x);
    await finger("touchEnd", 240);
    await expect.poll(() => num(page, "showcase-yaw")).toBeGreaterThan(0.8);
    expect(await num(page, "azimuth")).toBe(azimuth);
    await phaseIs(page, "inspecting");

    // a tap beside the bottle puts it back
    await page.touchscreen.tap(stage.x + 14, stage.y + stage.height - 14);
    await phaseIs(page, "idle");
    expect((await handOff(page)).pose).toBeLessThanOrEqual(1e-9);
    expect(await num(page, "azimuth")).toBe(azimuth);
    // nothing sticks out of a narrow screen
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });

  test("on a 320 px phone the bottle is whole and large, and the page does not scroll sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await show(page, "template=shelving_open&fill=full&inspect=b-2:2:1", { prewarmed: false });
    await phaseIs(page, "inspecting");
    const stage = (await canvasOf(page).boundingBox())!;
    const [cx, top, bottom] = (await canvasOf(page).getAttribute("data-showcase-box"))!
      .split(",")
      .map(Number);
    expect(bottom! - top!).toBeGreaterThan(300);
    expect(Math.abs(cx! - stage.width / 2)).toBeLessThan(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
    // the close button is a thumb's size and inside the picture
    const close = (await page.getByTestId("inspection-close").boundingBox())!;
    expect(Math.min(close.width, close.height)).toBeGreaterThanOrEqual(44);
  });
});

test.describe("keyboard and focus", () => {
  test("chosen in the flat picture, taken out with a button, read in the panel, put back with Escape", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "a keyboard");
    await show(page, "template=rack_classic&rows=3&cols=4&fill=full");
    await page.locator('[data-cell="2:3"]').focus();
    await page.keyboard.press("Enter");
    const button = page.getByTestId("gallery-inspect");
    await expect(button).toHaveText("Take it out");
    await button.focus();
    await page.keyboard.press("Enter");
    await phaseIs(page, "inspecting");
    // the panel has the focus and says what it is
    await expect(panel(page)).toBeFocused();
    await expect(panel(page)).toHaveAttribute("role", "dialog");
    await expect(panel(page)).toHaveAttribute("aria-label", /.+/);
    // its close button can be reached and used from the keyboard
    await page.getByTestId("inspection-back").focus();
    await page.keyboard.press("Enter");
    await phaseIs(page, "idle");
    // the focus is back where it came from
    await expect(button).toBeFocused();
    await expect(button).toHaveText("Take it out");
    await expect(panel(page)).toHaveAttribute("data-open", "false");
    // closed, the panel is out of the way of the keyboard and of a screen reader
    expect(await panel(page).evaluate((el) => (el as HTMLElement).inert)).toBe(true);

    // Escape does the same, from anywhere on the page
    await page.keyboard.press("Enter");
    await phaseIs(page, "inspecting");
    await page.keyboard.press("Escape");
    await phaseIs(page, "idle");
    await expect(button).toBeFocused();
  });

  test("the close button in the picture puts it back, by mouse and by keyboard", async ({
    page,
    hasTouch,
  }) => {
    await show(page, "template=rack_metal&fill=full");
    await takeOut(page, "b-2:2:1", hasTouch);
    await page.getByTestId("inspection-close").click();
    await phaseIs(page, "idle");
    await expect(page.getByTestId("inspection-close")).toHaveCount(0);
  });

  test("a bottle on display has no accessibility violations", async ({ page }) => {
    await show(page, "template=rack_classic&fill=full&inspect=b-2:3:1", { prewarmed: false });
    await phaseIs(page, "inspecting");
    expect(await audit(page)).toEqual([]);
  });

  test("with reduced motion it is simply out, and simply back, on the same spot", async ({
    page,
    hasTouch,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await show(page, "template=rack_double_depth&fill=full");
    await takeOut(page, "b-2:3:1", hasTouch);
    await expect(stillOf(page).locator("canvas")).toHaveCount(1);
    await putBack(page);
    const { pose, drift } = await handOff(page);
    expect(pose).toBeLessThanOrEqual(1e-9);
    expect(drift).toBeLessThanOrEqual(0.5);
  });
});

test.describe("what cannot go wrong", () => {
  test("taps in quick succession take one bottle out, not several, and nothing is left half done", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "a burst of mouse clicks");
    await show(page, "template=rack_classic&fill=full");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const spots = [];
    for (const id of ["b-1:1:1", "b-3:5:1", "b-2:7:1", "b-4:2:1"])
      spots.push(await whereIs(page, id));
    // four bottles, one after the other, as fast as the mouse goes. A tap while a bottle is out puts that one
    // back (it is a tap beside it), so the taps take turns: out, back, out, back. Never two bottles out.
    const tapped = ["b-1:1:1", "b-3:5:1", "b-2:7:1", "b-4:2:1"];
    for (const at of spots) await page.mouse.click(at.x, at.y);
    const out = await storageOf(page).getAttribute("data-showcase-bottle");
    if (out !== null) {
      expect(tapped).toContain(out);
      // the bottle that is out is the chosen bottle, in words and in the flat picture
      const [row, col] = out.slice(2).split(":");
      await expect(page.getByTestId("gallery-picked")).toContainText(
        `shelf ${row}, position ${col}.`,
      );
      await expect(page.locator("[data-chosen-place]")).toHaveCount(1);
      await expect(page.locator(`[data-cell="${row}:${col}"]`)).toHaveAttribute(
        "data-chosen-place",
        "1",
      );
    }
    // a burst of Escape and taps while it moves
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Escape");
      await page.mouse.click(spots[i % 4]!.x, spots[i % 4]!.y);
    }
    // whatever came of that: it settles, with at most one bottle out
    await expect
      .poll(async () => (await storageOf(page).getAttribute("data-showcase")) ?? "", {
        timeout: 60_000,
      })
      .toMatch(/^(idle|inspecting)$/);
    if ((await storageOf(page).getAttribute("data-showcase")) === "inspecting") await putBack(page);
    await phaseIs(page, "idle");
    await expect(stillOf(page).locator("canvas")).toHaveCount(0, { timeout: 15_000 });
    expect((await handOff(page)).pose).toBeLessThanOrEqual(1e-9);
    // the place is drawn again, whole
    await expect.poll(() => num(page, "calls")).toBeGreaterThan(10);
    // and a bottle can be taken out again as if nothing had happened
    await takeOut(page, "b-3:5:1", false);
    await putBack(page);
    expect(errors).toEqual([]);
  });

  test("the same bottle asked for again on its way home turns round; another is refused until it is home", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "held on its way home with the mouse");
    await show(page, "template=rack_classic&fill=full");
    await takeOut(page, "b-2:3:1", false);
    // held just before it is home (a test hook of the view)
    await page.evaluate(
      () => ((window as unknown as { __cellrHoldReturn: number }).__cellrHoldReturn = 0.5),
    );
    await page.keyboard.press("Escape");
    await phaseIs(page, "returning");
    // another bottle: refused, the one on its way home stays the one
    const other = await whereIs(page, "b-4:6:1");
    await page.mouse.click(other.x, other.y);
    await page.waitForTimeout(300);
    await expect(storageOf(page)).toHaveAttribute("data-showcase-bottle", "b-2:3:1");
    await phaseIs(page, "returning");
    // the same bottle, from the button: it turns round and comes out again
    await page.getByTestId("gallery-inspect").click();
    await phaseIs(page, "returning"); // the button reads "Put it back" while a bottle is out: it dismisses
    await page.evaluate(
      () => ((window as unknown as { __cellrHoldReturn: number }).__cellrHoldReturn = 0),
    );
    await phaseIs(page, "idle");
    expect((await handOff(page)).pose).toBeLessThanOrEqual(1e-9);
  });

  test("changing the place while a bottle is on its way out ends the inspection cleanly", async ({
    page,
    hasTouch,
  }) => {
    await show(page, "template=rack_classic&fill=full");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await tap(page, await whereIs(page, "b-2:3:1"), hasTouch);
    await expect(storageOf(page)).toHaveAttribute("data-showcase", /extracting|inspecting/);
    await page.getByLabel("Template", { exact: true }).selectOption("diamond_bins");
    await phaseIs(page, "idle");
    await expect(canvasOf(page)).toHaveAttribute("data-template", "diamond_bins");
    await expect(stillOf(page).locator("canvas")).toHaveCount(0);
    await expect(panel(page)).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("gallery-picked")).toHaveText("No bottle chosen.");
    // the new place is drawn whole, and one of its bottles can be taken out
    await expect.poll(() => num(page, "calls")).toBeGreaterThanOrEqual(8);
    const ids = await bottleIds(page);
    await takeOut(page, ids[0]!, hasTouch);
    await expect(storageOf(page)).toHaveAttribute("data-showcase-mode", "lift");
    // changing its look while a bottle is on display ends that one as cleanly
    await page.getByLabel("Bottles", { exact: true }).selectOption("partial");
    await phaseIs(page, "idle");
    await expect(stillOf(page).locator("canvas")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the picture of the place follows the view when it changes size, and the bottle still lands on its spot", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "resizing a desktop window");
    await show(page, "template=rack_classic&fill=full");
    await takeOut(page, "b-2:3:1", false);
    const sizeOf = async () => {
      const el = canvasOf(page);
      return `${await el.evaluate((c: HTMLCanvasElement) => c.width)}x${await el.evaluate((c: HTMLCanvasElement) => c.height)}`;
    };
    const first = await sizeOf();
    expect(await canvasOf(page).getAttribute("data-still")).toBe(first);
    for (const viewport of [
      { width: 1000, height: 700 },
      { width: 700, height: 900 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      // the picture is taken again at the new size, from the same camera
      await expect
        .poll(async () => (await canvasOf(page).getAttribute("data-still")) === (await sizeOf()))
        .toBe(true);
      await expect(stillOf(page).locator("canvas")).toHaveCount(1);
      await phaseIs(page, "inspecting");
      // the bottle is whole and inside the picture
      const stage = (await canvasOf(page).boundingBox())!;
      await expect
        .poll(async () => {
          await page.mouse.move(stage.x + 5, stage.y + 5);
          const frames = await num(page, "frames");
          return frames > 0;
        })
        .toBe(true);
    }
    // narrow: the panel went below the picture; wide again: beside the bottle
    await expect(storageOf(page)).toHaveAttribute("data-layout", "side");
    await putBack(page);
    const { pose, drift } = await handOff(page);
    expect(pose).toBeLessThanOrEqual(1e-9);
    expect(drift).toBeLessThanOrEqual(0.5);
  });

  test("when the browser takes the graphics memory back while a bottle is out, the inspection ends and can start again", async ({
    page,
    hasTouch,
  }) => {
    await show(page, "template=rack_classic&fill=full");
    await takeOut(page, "b-2:3:1", hasTouch);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="gallery-stage"] canvas[data-engine]',
      )!;
      (canvas.getContext("webgl2") ?? canvas.getContext("webgl"))!
        .getExtension("WEBGL_lose_context")!
        .loseContext();
    });
    await expect(page.getByText("The browser took the graphics memory back.")).toBeVisible();
    await expect(page.getByTestId("inspection-panel")).toHaveCount(0);
    await expect(page.getByTestId("storage-still")).toHaveCount(0);
    await page.getByRole("button", { name: "Show 3D again" }).click();
    await expect(canvasOf(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 60_000 });
    await phaseIs(page, "idle");
    // the bottle that was out is in its place, chosen; and it can be taken out again
    await expect(page.getByTestId("gallery-picked")).toContainText("shelf 2, position 3");
    await takeOut(page, "b-2:3:1", hasTouch);
    await putBack(page);
    expect((await handOff(page)).pose).toBeLessThanOrEqual(1e-9);
  });
});

test.describe("looking at bottles does not cost more each time", () => {
  test("after one bottle of each shape, any number of inspections leaves the same geometries, textures and shaders", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "the same code on the desktop profile; this is the slow one");
    test.setTimeout(300_000);
    await show(page, "template=rack_double_depth&rows=4&cols=6&fill=full");
    // a first round with one bottle of each shape (still, burgundy-shaped, sparkling), so that each shape's
    // geometry exists; the ring of the chosen bottle and the pool of shadow are there after the first as well
    for (const id of ["b-1:1:1", "b-1:6:1", "b-3:4:1", "b-2:5:1"]) {
      await takeOut(page, id, false);
      await putBack(page);
    }
    const base = await held(page);
    for (let round = 0; round < 2; round++)
      for (const id of ["b-4:3:1", "b-1:2:1", "b-2:1:1", "b-2:6:1", "b-3:3:1", "b-4:6:1"]) {
        await takeOut(page, id, false);
        // on display: the bottle's own two label pictures, and nothing else that was not there before
        const during = await held(page);
        expect(during.textures).toBeLessThanOrEqual(base.textures + 2);
        expect(during.programs).toBe(base.programs);
        await putBack(page);
        expect(await held(page), `after ${id}`).toEqual(base);
      }
  });

  test("the first bottle taken out compiles no shader: they were warmed up while nothing was happening", async ({
    page,
    hasTouch,
  }) => {
    await show(page, "template=rack_classic&fill=full&quality=high");
    const warmed = await num(page, "prewarmed");
    expect(warmed).toBeGreaterThan(0);
    await takeOut(page, "b-2:3:1", hasTouch);
    expect(await num(page, "programs")).toBe(warmed);
    await putBack(page);
    expect(await num(page, "programs")).toBe(warmed);
  });

  test("nothing is drawn while a bottle stands still on display, and nothing is asked of any server", async ({
    page,
    hasTouch,
  }) => {
    await show(page, "template=rack_classic&fill=full");
    const requests: string[] = [];
    page.on("request", (r) => requests.push(`${r.method()} ${new URL(r.url()).pathname}`));
    await takeOut(page, "b-2:3:1", hasTouch);
    await page.waitForTimeout(1500);
    const frames = await num(page, "frames");
    await page.waitForTimeout(2000);
    expect(await num(page, "frames")).toBe(frames);
    await putBack(page);
    await page.waitForTimeout(1200);
    const after = await num(page, "frames");
    await page.waitForTimeout(1500);
    expect(await num(page, "frames")).toBe(after);
    expect(requests).toEqual([]);
  });
});

test.describe("the hard cases", () => {
  const CASES: Array<{
    name: string;
    query: string;
    bottle: string;
    mode: string;
    reason: string;
    how: RegExp;
    where: string | RegExp;
  }> = [
    {
      name: "the rear bottle of a double-depth rack, front taken",
      query: "template=rack_double_depth&fill=full&inspect=b-2:3:2",
      bottle: "b-2:3:2",
      mode: "emerge",
      reason: "behind_bottle",
      how: /another bottle lies in front of it/,
      where: "shelf 2, position 3, at the back.",
    },
    {
      name: "the rear bottle of a double-depth rack, front free",
      query: "template=rack_double_depth&rows=8&cols=1&inspect=b-7:1:2",
      bottle: "b-7:1:2",
      mode: "physical",
      reason: "clear_path",
      how: /Taken out of its place/,
      where: "shelf 7, position 1, at the back.",
    },
    {
      name: "a bottle of a diamond bin",
      query: "template=diamond_bins&fill=full&inspect=b-1:2:3",
      bottle: "b-1:2:3",
      mode: "lift",
      reason: "pile",
      how: /Where it lies in the pile is not recorded/,
      where: /^in compartment 1·2\. Where in the compartment it lies is not recorded\.$/,
    },
    {
      name: "a bottle on a wall rail",
      query: "template=wall_rails&rows=6&cols=2&fill=full&inspect=b-3:1:1",
      bottle: "b-3:1:1",
      mode: "physical",
      reason: "clear_path",
      how: /Taken out of its place/,
      where: "shelf 3, position 1.",
    },
    {
      name: "the rear bottle of a rail three deep",
      query: "template=wall_rails&rows=4&cols=2&cap=3&fill=full&inspect=b-2:1:3",
      bottle: "b-2:1:3",
      mode: "emerge",
      reason: "behind_bottle",
      how: /another bottle lies in front of it/,
      where: "shelf 2, position 1, at the back.",
    },
    {
      name: "a cabinet behind a glass door",
      query: "template=cabinet_closed&door=glass&fill=full&inspect=b-2:3:1",
      bottle: "b-2:3:1",
      mode: "emerge",
      reason: "behind_door",
      how: /the door in front of it stays closed/,
      where: "shelf 2, position 3.",
    },
    {
      name: "a cabinet with its doors open",
      query: "template=cabinet_closed&door=solid&fill=full&inspect=b-2:3:1",
      bottle: "b-2:3:1",
      mode: "physical",
      reason: "clear_path",
      how: /Taken out of its place/,
      where: "shelf 2, position 3.",
    },
    {
      name: "a dual-zone cooler",
      query: "template=cooler_dual&fill=full&inspect=b-6:2:1",
      bottle: "b-6:2:1",
      mode: "emerge",
      reason: "behind_door",
      how: /the door in front of it stays closed/,
      where: "shelf 6, position 2.",
    },
    {
      name: "a place whose arrangement is not known",
      query: "sample=unknown&unknown=bins-as-depth&fill=full&inspect=b-1:2:1",
      bottle: "b-1:2:1",
      mode: "emerge",
      reason: "unknown_arrangement",
      how: /CELLR does not know how this place is arranged/,
      where: /^in compartment 1·2\. Where in the compartment it lies is not recorded\.$/,
    },
  ];

  for (const c of CASES)
    test(`${c.name}: ${c.mode}, and back on its own spot`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await show(page, c.query, { prewarmed: false });
      await expect(storageOf(page)).toHaveAttribute("data-showcase-bottle", c.bottle, {
        timeout: 30_000,
      });
      await expect(storageOf(page)).toHaveAttribute("data-showcase-mode", c.mode);
      await expect(storageOf(page)).toHaveAttribute("data-showcase-reason", c.reason);
      await phaseIs(page, "inspecting");
      // said in words: whether it was drawn out or only shown, and where it is kept
      await expect(page.getByTestId("inspection-how")).toHaveText(c.how);
      await expect(page.getByTestId("inspection-where")).toHaveText(c.where);
      // the flat picture agrees with the 3D view about which bottle, and keeps its index
      const [row, col, index] = c.bottle.slice(2).split(":");
      const cell = page.locator(`[data-cell="${row}:${col}"]`);
      if (c.reason === "pile" || c.reason === "unknown_arrangement") {
        await expect(cell).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("[data-chosen-place]")).toHaveCount(0); // no place in a pile is claimed
      } else await expect(cell).toHaveAttribute("data-chosen-place", index!);
      await expect(page.getByTestId("gallery-picked")).toContainText(
        typeof c.where === "string" ? c.where : "in compartment",
      );

      await putBack(page);
      const { pose } = await handOff(page);
      expect(pose).toBeLessThanOrEqual(1e-9);
      // the same bottle is still the chosen one, on the same spot
      if (!(c.reason === "pile" || c.reason === "unknown_arrangement"))
        await expect(cell).toHaveAttribute("data-chosen-place", index!);
      expect(errors).toEqual([]);
    });

  test("the bottle before a rear bottle is still there while the rear one is looked at, and afterwards", async ({
    page,
  }) => {
    await show(page, "template=rack_double_depth&rows=1&cols=1&fill=full&inspect=b-1:1:2", {
      prewarmed: false,
    });
    await phaseIs(page, "inspecting");
    await putBack(page);
    // both are in the place; a tap on the position takes the front one, as before
    expect(await num(page, "bottles")).toBe(2);
    await takeOut(page, "b-1:1:1", false);
    await expect(page.getByTestId("inspection-where")).toHaveText(
      "shelf 1, position 1, at the front.",
    );
    await putBack(page);
  });

  test("every template lets a bottle be taken out and put back on its spot", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "the same code on the desktop profile; this is the slow one");
    test.setTimeout(600_000);
    const modes: Record<string, string> = {};
    for (const template of [
      "rack_classic",
      "rack_double_depth",
      "rack_metal",
      "shelving_open",
      "cabinet_closed",
      "rack_generic",
      "cube_modular",
      "diamond_bins",
      "crate_storage",
      "wall_pegs",
      "wall_rails",
      "cooler_single",
      "cooler_dual",
      "cooler_undercounter",
    ]) {
      await show(page, `template=${template}&fill=full`, { prewarmed: false });
      const ids = await bottleIds(page);
      const id = ids[Math.floor(ids.length / 3)]!;
      await page.getByTestId("layout-map").scrollIntoViewIfNeeded();
      // chosen from outside the picture, so that this does not depend on what can be tapped
      await page.evaluate((bottle) => {
        const url = new URL(window.location.href);
        url.searchParams.set("inspect", bottle);
        window.history.replaceState(null, "", url);
      }, id);
      await page.reload();
      await expect(storageOf(page)).toHaveAttribute("data-showcase-bottle", id, {
        timeout: 60_000,
      });
      await phaseIs(page, "inspecting");
      modes[template] = (await storageOf(page).getAttribute("data-showcase-mode"))!;
      await expect(canvasOf(page)).toHaveAttribute("data-front-label", "drawn");
      await putBack(page);
      expect((await handOff(page)).pose, template).toBeLessThanOrEqual(1e-9);
    }
    expect(modes).toEqual({
      rack_classic: "physical",
      rack_double_depth: "physical",
      rack_metal: "physical",
      shelving_open: "physical",
      cabinet_closed: "physical",
      rack_generic: "physical",
      cube_modular: "lift",
      diamond_bins: "lift",
      crate_storage: "lift",
      wall_pegs: "physical",
      wall_rails: "physical",
      cooler_single: "emerge",
      cooler_dual: "emerge",
      cooler_undercounter: "emerge",
    });
  });
});
