import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, sql, wineBody } from "./helpers";

/**
 * Sprint C.1: a bottle goes home to exactly where the rack draws it, however the rack was turned, zoomed or slid
 * before it was taken out. The showcase measures itself as it lands (see `measureHandOff`): the gap to the rack's
 * own matrix, and the gap on screen to the still picture of the rack it lands in.
 */

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

/**
 * A 4 × 5 rack, full, so corner and middle slots exist. Filled in order: reds on shelf 1 and the start of 2, whites
 * to the start of 3, rosés to the start of 4, sparkling at the end.
 */
async function fullRack(call: Call) {
  const rack = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Test rack", kind: "rack", rows: 4, cols: 5 },
      201,
    )
  ).body;
  for (const [type, n] of [
    ["red", 6],
    ["white", 6],
    ["rose", 4],
    ["sparkling", 4],
  ] as const) {
    const wine = (
      await call<{ id: string }>(
        "post",
        "/wines",
        { ...wineBody, name: `${type} ${Date.now()}`, type },
        201,
      )
    ).body;
    await call(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2019, quantity: n, locationId: rack.id },
      201,
    );
  }
  return rack.id;
}

async function open3D(page: Page) {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  const scene = page.getByTestId("cellar-3d");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  return scene;
}

/** Takes out the bottle on that shelf and position, waits for it to stand on display, and puts it back. */
async function outAndHome(page: Page, row: number, col: number) {
  const scene = page.getByTestId("cellar-3d");
  const canvas = scene.locator("canvas[data-engine]");
  await canvas.evaluate((el) => {
    delete el.dataset.handoffDrift;
    delete el.dataset.handoffPose;
  });
  await page
    .getByRole("list", { name: /Bottles in Test rack/ })
    .getByRole("button", { name: new RegExp(`shelf ${row}, position ${col}$`) })
    .focus();
  await page.keyboard.press("Enter");
  await expect(scene).toHaveAttribute("data-showcase", "open");
  await page.waitForTimeout(2200);
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute("data-handoff-pose", /.+/, { timeout: 10_000 });
  await expect(page.getByTestId("rack-backdrop")).toHaveCount(0, { timeout: 10_000 });
  return {
    pose: Number(await canvas.getAttribute("data-handoff-pose")),
    drift: Number(await canvas.getAttribute("data-handoff-drift")),
  };
}

const expectExact = (r: { pose: number; drift: number }) => {
  // The same matrix as the rack's own (floating-point noise only), and on screen within half a pixel of the still.
  expect(r.pose).toBeLessThan(1e-5);
  expect(r.drift).toBeLessThan(0.5);
};

test.describe("a bottle goes home exactly", () => {
  test.beforeEach(async ({ page, request }) => {
    const { email } = await arrive(page, "precise");
    const { call } = await apiClient(request, email);
    await fullRack(call);
  });

  test("seen straight on: corner and middle slots", async ({ page }) => {
    test.setTimeout(240_000);
    await open3D(page);
    for (const [row, col] of [
      [1, 1],
      [4, 5],
      [2, 3],
    ] as const)
      expectExact(await outAndHome(page, row, col));
  });

  test("right after the rack was flung round to an angle (it is still turning)", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const scene = await open3D(page);
    for (const [row, col] of [
      [1, 5],
      [3, 2],
    ] as const) {
      // A quick swipe, let go mid-movement: the rack keeps turning for a moment (damping)…
      const box = (await scene.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
      await page.mouse.down();
      for (let i = 1; i <= 4; i++)
        await page.mouse.move(box.x + box.width * (0.3 + i * 0.08), box.y + box.height * 0.55);
      await page.mouse.up();
      // …and the bottle is taken while it still is.
      expectExact(await outAndHome(page, row, col));
    }
  });

  test("after zooming into a corner and sliding the view", async ({ page }) => {
    test.setTimeout(240_000);
    const scene = await open3D(page);
    const box = (await scene.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.3);
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(400);
    // two-finger slide = right mouse button
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.42, { steps: 3 });
    await page.mouse.up({ button: "right" });
    expectExact(await outAndHome(page, 1, 1));
    expectExact(await outAndHome(page, 2, 3));
  });
});

test("the slot list matches what was stocked", async ({ page, request }) => {
  // Guards the helper above: every slot of the 4 × 5 rack is filled, so any shelf/position can be taken out.
  const { email, householdId } = await arrive(page, "precisecount");
  const { call } = await apiClient(request, email);
  await fullRack(call);
  const rows = await sql<{ n: string }>(
    "select count(*)::text n from public.bottles where household_id = $1 and loc_row is not null",
    [householdId],
  );
  expect(rows[0]?.n).toBe("20");
});

test.describe("the bottle on display always stands in the same place", () => {
  test("whatever the slot and however the rack was turned, fully visible and clear of the panel", async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const { email } = await arrive(page, "showspot");
    const { call } = await apiClient(request, email);
    await fullRack(call);
    const scene = await open3D(page);
    const canvas = scene.locator("canvas[data-engine]");
    const boxes: number[][] = [];
    const views: Array<{ x: number; y: number; width: number; height: number }> = [];
    const panels: typeof views = [];
    for (const [row, col, turn] of [
      [1, 1, 0],
      [4, 5, 0.25],
      [2, 3, -0.2],
      [3, 1, 0.15],
    ] as const) {
      if (turn) {
        // turn the rack (and let it settle) before taking the bottle
        const box = (await scene.boundingBox())!;
        await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * (0.5 + turn), box.y + box.height * 0.45, {
          steps: 8,
        });
        await page.mouse.up();
        await page.waitForTimeout(1200);
      }
      await canvas.evaluate((el) => delete el.dataset.showcaseBox);
      await page
        .getByRole("list", { name: /Bottles in Test rack/ })
        .getByRole("button", { name: new RegExp(`shelf ${row}, position ${col}$`) })
        .focus();
      await page.keyboard.press("Enter");
      await expect(canvas).toHaveAttribute("data-showcase-box", /.+/, { timeout: 15_000 });
      boxes.push((await canvas.getAttribute("data-showcase-box"))!.split(",").map(Number));
      // the view (full screen on a phone) and the panel, as they are while the bottle is on display
      views.push((await scene.boundingBox())!);
      panels.push((await page.getByTestId("bottle-showcase").boundingBox())!);
      if (row === 1 && col === 1)
        await page.screenshot({
          path: `test-results/shots/showspot-${test.info().project.name}.png`,
        });
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("rack-backdrop")).toHaveCount(0, { timeout: 10_000 });
    }
    // The same place on the screen every time (within a pixel)…
    for (const b of boxes.slice(1))
      for (let i = 0; i < 3; i++) expect(Math.abs(b[i]! - boxes[0]![i]!)).toBeLessThan(1);
    // …the whole bottle in view, and not under the details panel.
    const [cx, top, bottom] = boxes[0] as [number, number, number];
    const view = views[0]!;
    const panel = panels[0]!;
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeLessThan(view.height);
    expect(cx).toBeGreaterThan(0);
    if (view.width >= 720) expect(view.x + cx).toBeLessThan(panel.x);
    else expect(view.y + bottom).toBeLessThan(panel.y);
    // On a phone it is large: well over 40% of the screen's height (it was 37%).
    if (view.width < 720) expect((bottom - top) / view.height).toBeGreaterThan(0.4);
  });
});

/** Mean colour difference (0–255) between two PNG crops of the same size. */
async function difference(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([x, y]) => {
      const pixels = async (data: string) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const c = document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [p, q] = await Promise.all([pixels(x!), pixels(y!)]);
      let sum = 0;
      for (let i = 0; i < p.length; i += 4)
        sum +=
          (Math.abs(p[i]! - q[i]!) +
            Math.abs(p[i + 1]! - q[i + 1]!) +
            Math.abs(p[i + 2]! - q[i + 2]!)) /
          3;
      return sum / (p.length / 4);
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );
}

test.describe("the hand-over from the bottle on display to the rack", () => {
  test("is the same picture before and after: no colour jump for red, white, rosé or sparkling", async ({
    page,
    request,
  }) => {
    test.skip(test.info().project.name !== "desktop", "one size is enough for the colour");
    test.setTimeout(300_000);
    const { email } = await arrive(page, "handover");
    const { call } = await apiClient(request, email);
    await fullRack(call);
    fs.mkdirSync("test-results/shots", { recursive: true });
    const scene = await open3D(page);
    const canvas = scene.locator("canvas[data-engine]");
    for (const [kind, row, col] of [
      ["red", 1, 2],
      ["white", 2, 4],
      ["rose", 3, 4],
      ["sparkling", 4, 4],
    ] as const) {
      await canvas.evaluate((el) => delete el.dataset.handoffSlot);
      await page
        .getByRole("list", { name: /Bottles in Test rack/ })
        .getByRole("button", { name: new RegExp(`shelf ${row}, position ${col}$`) })
        .focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2500); // on display
      // Hold the bottle a hair before the hand-over (lying in its slot, as the rack will draw it)…
      await page.evaluate(
        () => ((globalThis as { __cellrHoldReturn?: number }).__cellrHoldReturn = 0.0005),
      );
      await page.keyboard.press("Escape");
      await page.waitForTimeout(2000);
      const before = await canvas.screenshot();
      // …then let it go: the rack takes over.
      await page.evaluate(
        () => delete (globalThis as { __cellrHoldReturn?: number }).__cellrHoldReturn,
      );
      await expect(canvas).toHaveAttribute("data-handoff-slot", /.+/, { timeout: 10_000 });
      const slot = (await canvas.getAttribute("data-handoff-slot"))!.split(",").map(Number);
      await expect(page.getByTestId("rack-backdrop")).toHaveCount(0, { timeout: 10_000 });
      await page.waitForTimeout(600);
      const after = await canvas.screenshot();
      const crop = async (png: Buffer) => {
        const box = (await canvas.boundingBox())!;
        const half = 14;
        const x = Math.round(slot[0]! - half);
        const y = Math.round(slot[1]! - half);
        // Re-render the stored frame at the slot by cropping through the browser.
        return page.evaluate(
          async ([data, cx, cy, size, w]) => {
            const bytes = Uint8Array.from(atob(data!), (c) => c.charCodeAt(0));
            const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
            const scale = bitmap.width / (w as number);
            const c = document.createElement("canvas");
            c.width = c.height = size as number;
            c.getContext("2d")!.drawImage(
              bitmap,
              (cx as number) * scale,
              (cy as number) * scale,
              (size as number) * scale,
              (size as number) * scale,
              0,
              0,
              size as number,
              size as number,
            );
            return c.toDataURL("image/png").split(",")[1]!;
          },
          [png.toString("base64"), x, y, half * 2, box.width] as const,
        );
      };
      const [a, b] = await Promise.all([crop(before), crop(after)]);
      fs.mkdirSync("test-results/shots", { recursive: true });
      fs.writeFileSync(`test-results/shots/handover-${kind}-before.png`, before);
      fs.writeFileSync(`test-results/shots/handover-${kind}-after.png`, after);
      const diff = await difference(page, Buffer.from(a, "base64"), Buffer.from(b, "base64"));
      test.info().annotations.push({ type: `hand-over ${kind}`, description: diff.toFixed(2) });
      expect(diff, `${kind}: colour change at the hand-over`).toBeLessThan(6);
    }
  });
});
