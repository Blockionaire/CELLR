import { expect, type Page } from "@playwright/test";

/**
 * Shared by the specs of the template gallery (/design/cellar-3d): opening a picture, finding a bottle on the
 * screen from the view's own camera, tapping it, and reading what the view wrote about itself.
 */

/** The 3D view's own canvas (a picture of the place, also a canvas, stands behind it while a bottle is out). */
export const canvasOf = (page: Page) =>
  page.locator('[data-testid="gallery-stage"] canvas[data-engine]');
export const storageOf = (page: Page) => page.getByTestId("inspectable-storage");
export const stillOf = (page: Page) => page.getByTestId("storage-still");

/** A number the view wrote on its canvas (NaN when it is not there). */
export const num = async (page: Page, name: string) =>
  Number((await canvasOf(page).getAttribute(`data-${name}`)) ?? NaN);

/**
 * Waits until the view has stopped drawing: after a turn, when its glide has come to rest. It draws only when
 * something changes, so its frame count standing still for a while means the camera stands still too (a bottle
 * read from the camera before then would be tapped where it no longer is). The glide lasts about a second at any
 * frame rate (src/features/cellar/three/damping.ts).
 */
export async function atRest(page: Page, quietMs = 1_500) {
  const until = Date.now() + 30_000;
  let before = await num(page, "frames");
  for (;;) {
    await page.waitForTimeout(quietMs);
    const now = await num(page, "frames");
    if (now === before) return;
    expect(Date.now(), "the view comes to rest after a turn").toBeLessThan(until);
    before = now;
  }
}

/** Opens a picture of the gallery and waits until the 3D view has drawn it and warmed its shaders up. */
export async function show(page: Page, query: string, opts: { prewarmed?: boolean } = {}) {
  await page.goto(`/design/cellar-3d?${query}`);
  await expect(canvasOf(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 60_000 });
  if (opts.prewarmed !== false)
    await expect(canvasOf(page)).toHaveAttribute("data-prewarmed", /^\d+$/, { timeout: 60_000 });
}

type Hooks = {
  locate(id: string): { x: number; y: number } | null;
  ids(): string[];
  probe(x: number, y: number): string[];
};
const hooks = "__cellrStorage3d";

/** Where a bottle is on the page, from the view's own camera. */
export async function whereIs(page: Page, id: string) {
  await canvasOf(page).scrollIntoViewIfNeeded();
  const at = await page.evaluate(
    ([name, bottle]) => (window as unknown as Record<string, Hooks>)[name!]!.locate(bottle!),
    [hooks, id],
  );
  expect(at, `bottle ${id} is in the picture`).not.toBeNull();
  const box = (await canvasOf(page).boundingBox())!;
  return { x: box.x + at!.x, y: box.y + at!.y };
}
export const bottleIds = (page: Page) =>
  page.evaluate((name) => (window as unknown as Record<string, Hooks>)[name]!.ids(), hooks);

/** A tap: a finger on a phone, the mouse elsewhere. */
export async function tap(page: Page, at: { x: number; y: number }, touch: boolean) {
  if (touch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}

export const phaseIs = (page: Page, phase: "idle" | "extracting" | "inspecting" | "returning") =>
  expect(storageOf(page)).toHaveAttribute("data-showcase", phase, { timeout: 45_000 });

/** Takes a bottle out by tapping it in the 3D view, and waits until it is on display. */
export async function takeOut(page: Page, id: string, touch: boolean) {
  await tap(page, await whereIs(page, id), touch);
  await expect(storageOf(page)).toHaveAttribute("data-showcase-bottle", id, { timeout: 15_000 });
  await phaseIs(page, "inspecting");
}

/** Puts the bottle back with Escape and waits until it is home and the picture of the place is gone. */
export async function putBack(page: Page) {
  await page.keyboard.press("Escape");
  await phaseIs(page, "idle");
  await expect(stillOf(page).locator("canvas")).toHaveCount(0, { timeout: 15_000 });
}

/** What the view wrote about the last hand-over: how far the bottle landed from its place, in space and on screen. */
export async function handOff(page: Page) {
  return {
    pose: await num(page, "handoff-pose"),
    drift: await num(page, "handoff-drift"),
  };
}

/**
 * What the view holds on the graphics card. The view writes these when it draws a picture, so after a change they
 * are read until they stand still (the picture that follows a bottle's return may not have been drawn yet).
 */
export async function held(page: Page) {
  const read = async () => ({
    geometries: await num(page, "geometries"),
    textures: await num(page, "textures"),
    programs: await num(page, "programs"),
  });
  let before = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const now = await read();
    if (JSON.stringify(now) === JSON.stringify(before)) return now;
    before = now;
  }
  return before;
}
