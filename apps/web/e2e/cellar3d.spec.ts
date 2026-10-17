import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiClient, arrive, audit, sql, wineBody } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const RED = {
  producer: "Château Margaux",
  name: "Pavillon Rouge",
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
};
const CUVEE = {
  producer: "Bollinger",
  name: "Special Cuvée",
  type: "sparkling",
  countryCode: "FR",
  region: "Champagne",
};

async function addUnit(call: Call, label: string, kind: string, rows: number, cols: number) {
  return ((await call("post", "/storage", { label, kind, rows, cols }, 201)).body as { id: string })
    .id;
}

async function addBottles(
  call: Call,
  wine: object,
  year: number,
  quantity: number,
  locationId: string | null,
) {
  const w = (await call("post", "/wines", wine, 201)).body as { id: string };
  await call("post", "/bottles", { wineId: w.id, year, quantity, locationId }, 201);
}

const open3D = async (page: Page) => {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  const scene = page.getByTestId("cellar-3d");
  await expect(scene).toBeVisible({ timeout: 20_000 });
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  return scene;
};

/**
 * How many pixels the 3D picture adds to the card: the card is photographed with and without the canvas
 * and the two are compared. (Reading a WebGL canvas directly gives a blank buffer outside the frame.)
 */
async function drawnPixels(page: Page, scene: Locator): Promise<number> {
  const canvas = scene.locator("canvas");
  const withScene = await scene.screenshot();
  await canvas.evaluate((el) => (el.style.visibility = "hidden"));
  const without = await scene.screenshot();
  await canvas.evaluate((el) => (el.style.visibility = ""));
  return page.evaluate(
    async ([a, b]) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const probe = document.createElement("canvas");
        probe.width = bitmap.width;
        probe.height = bitmap.height;
        const ctx = probe.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, probe.width, probe.height).data;
      };
      const [x, y] = await Promise.all([decode(a!), decode(b!)]);
      let changed = 0;
      for (let i = 0; i < x.length; i += 4) {
        const delta =
          Math.abs(x[i]! - y[i]!) +
          Math.abs(x[i + 1]! - y[i + 1]!) +
          Math.abs(x[i + 2]! - y[i + 2]!);
        if (delta > 24) changed++;
      }
      return changed;
    },
    [withScene.toString("base64"), without.toString("base64")] as const,
  );
}

test.describe("the 3D cellar", () => {
  // The test browser draws WebGL in software; on a phone-sized, high-density screen that is slow.
  test.setTimeout(120_000);

  test("a unit with bottles is drawn; pick a bottle from the accessible list; open it", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "cellar3d");
    const { call } = await apiClient(request, email);
    const fridge = await addUnit(call, "Wine fridge", "fridge", 4, 5);
    await addUnit(call, "Cellar rack", "rack", 3, 4);
    await addBottles(call, wineBody, 2019, 3, fridge);
    await addBottles(call, RED, 2015, 2, fridge);
    await addBottles(call, CUVEE, 2017, 1, fridge);

    const scene = await open3D(page);
    const canvas = scene.locator("canvas");
    await expect(canvas).toBeVisible();
    // Something is actually on screen (not a blank WebGL context).
    await expect.poll(() => drawnPixels(page, scene)).toBeGreaterThan(4000);
    await page.screenshot({ path: shot(`3d-fridge-${project()}`), fullPage: true });

    // Not a native control: the canvas is hidden from assistive tech, the list stands in for it.
    const list = page.getByRole("list", { name: /Bottles in Wine fridge/i });
    await expect(list.getByRole("button")).toHaveCount(6);
    // …reached and used with the keyboard alone, and it shows itself while it has focus.
    const wine = list.getByRole("button", { name: /Château Margaux Pavillon Rouge 2015/ }).first();
    await wine.focus();
    await expect(wine).toBeInViewport();
    await page.keyboard.press("Enter");

    // The bottle comes out of the rack and its details open: everything there is to know about it.
    const panel = page.getByRole("dialog", { name: /Pavillon Rouge 2015/ });
    await expect(panel).toHaveAttribute("data-open", "true", { timeout: 20_000 }); // software WebGL on a CI runner is slow
    await expect(panel.getByRole("heading", { name: "Pavillon Rouge" })).toBeVisible();
    await expect(panel.getByText("Château Margaux", { exact: true })).toBeVisible();
    await expect(panel.getByText("2015 · Bordeaux, France")).toBeVisible();
    await expect(panel.getByText("Wine fridge · Shelf 1 · Position 4")).toBeVisible();
    await expect(panel.getByText("2 bottles of this vintage in your cellar")).toBeVisible();
    await expect(panel.getByText("Average price per bottle")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Move", exact: true })).toBeEnabled();
    await expect(panel.getByRole("link", { name: "Full page" })).toHaveAttribute(
      "href",
      /\/cellar\/[0-9a-f-]{36}/,
    );
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot(`3d-showcase-${project()}`) });

    await panel.getByRole("button", { name: "Open this bottle" }).click();
    await expect(page.getByText("Enjoy! 1 bottle left.")).toBeVisible();
    await expect(panel).toHaveAttribute("data-open", "false");
    await expect
      .poll(async () =>
        sql<{ n: string }>(
          `select count(*)::text as n from public.bottles b
             join public.wine_vintages v on v.id = b.vintage_id
             join public.wines w on w.id = v.wine_id
            where b.household_id = $1 and w.name = 'Pavillon Rouge' and b.status = 'opened'`,
          [householdId],
        ).then((r) => r[0]?.n),
      )
      .toBe("1");
  });

  test("tapping a bottle in the picture selects it; switching units redraws", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "cellar3dpick");
    const { call } = await apiClient(request, email);
    // A single spot: the bottle sits in the middle of the picture, so a tap in the middle must hit it.
    const solo = await addUnit(call, "Single spot", "rack", 1, 1);
    await addBottles(call, RED, 2015, 1, solo);
    await addUnit(call, "Empty rack", "rack", 3, 3);

    const scene = await open3D(page);
    // On a phone the picture can be taller than the screen: bring its middle clear of the bars first.
    await page.evaluate(() => {
      const c = document.querySelector("canvas")!.getBoundingClientRect();
      const over = c.top + c.height / 2 - (window.innerHeight - 160);
      if (over > 0) window.scrollBy(0, over);
    });
    await page.waitForTimeout(300);
    const box = (await scene.locator("canvas").boundingBox())!;
    const panel = page.getByRole("dialog", { name: /Pavillon Rouge 2015/ });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(panel).toHaveAttribute("data-open", "true");
    await expect(panel.getByRole("heading", { name: "Pavillon Rouge" })).toBeVisible();
    await expect(scene).toHaveAttribute("data-showcase", "open");

    // Put it back with the button, with Escape, and by tapping away from it.
    await panel.getByRole("button", { name: "Put it back" }).click();
    await expect(panel).toHaveAttribute("data-open", "false");
    await expect(scene).toHaveAttribute("data-showcase", "closed");

    await page.waitForTimeout(1500); // it slides home first
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(panel).toHaveAttribute("data-open", "true");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveAttribute("data-open", "false");

    await page.waitForTimeout(1500);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(panel).toHaveAttribute("data-open", "true");
    await page.waitForTimeout(2500); // it has settled on display
    // (on a phone the picture now fills the screen, so measure it again)
    const out = (await scene.boundingBox())!;
    await page.mouse.click(out.x + 6, out.y + 6);
    await expect(panel).toHaveAttribute("data-open", "false");

    // A tap on empty background with nothing on display does nothing.
    await page.waitForTimeout(1500);
    await page.mouse.click(box.x + 6, box.y + 6);
    await expect(panel).toHaveAttribute("data-open", "false");

    // The other unit is empty: it still draws its frame, and it is a different scene.
    await page.getByRole("button", { name: "Empty rack" }).click();
    await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect(page.getByText("Rack · 0 of 9 · 9 free")).toBeVisible();
    await expect.poll(() => drawnPixels(page, scene)).toBeGreaterThan(500);
    await expect(
      page.getByRole("list", { name: /Bottles in Empty rack/i }).getByRole("button"),
    ).toHaveCount(0);
  });

  test("dragging turns the unit and the picture changes", async ({ page, request }) => {
    const { email } = await arrive(page, "cellar3ddrag");
    const { call } = await apiClient(request, email);
    const fridge = await addUnit(call, "Wine fridge", "fridge", 4, 5);
    await addBottles(call, wineBody, 2019, 6, fridge);
    await addBottles(call, RED, 2015, 4, fridge);

    const scene = await open3D(page);
    const canvas = scene.locator("canvas");
    const before = await canvas.screenshot();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 12 });
    await page.mouse.up();
    // Orbiting is event-driven (the loop only renders on demand); the new frame must still arrive.
    await expect
      .poll(async () => !(await canvas.screenshot()).equals(before), { timeout: 20_000 })
      .toBe(true);
    await page.screenshot({ path: shot(`3d-turned-${project()}`), fullPage: true });
  });

  test("from the panel you can move this very bottle to another spot", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "cellar3dmove");
    const { call } = await apiClient(request, email);
    const fridge = await addUnit(call, "Wine fridge", "fridge", 4, 5);
    await addBottles(call, RED, 2015, 2, fridge);

    await open3D(page);
    const list = page.getByRole("list", { name: /Bottles in Wine fridge/i });
    await list.getByRole("button", { name: /shelf 1, position 2/ }).focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: /Pavillon Rouge 2015/ });
    await expect(panel.getByText("Wine fridge · Shelf 1 · Position 2")).toBeVisible();
    await panel.getByRole("button", { name: "Move", exact: true }).click();

    const sheet = page.getByRole("dialog", { name: "Move a bottle" });
    await sheet.getByRole("button", { name: "Shelf 4, position 3, empty" }).click();
    await expect(page.getByText("Moved to Wine fridge · Shelf 4 · Position 3.")).toBeVisible();
    // The bottle the person pointed at (position 2) moved, not the other one.
    await expect
      .poll(async () =>
        (
          await sql<{ spot: string }>(
            `select b.loc_row || ':' || b.loc_col as spot from public.bottles b
               join public.wine_vintages v on v.id = b.vintage_id
               join public.wines w on w.id = v.wine_id
              where b.household_id = $1 and w.name = 'Pavillon Rouge' order by 1`,
            [householdId],
          )
        ).map((r) => r.spot),
      )
      .toEqual(["1:1", "4:3"]);
  });

  test("the details are accessible with a bottle out, in both themes", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "cellar3dshow");
    const { call } = await apiClient(request, email);
    const fridge = await addUnit(call, "Wine fridge", "fridge", 4, 5);
    await addBottles(call, wineBody, 2019, 3, fridge);
    await addBottles(call, CUVEE, 2017, 2, fridge);

    // Reduced motion: the bottle takes its place at once and the scene stops redrawing while it waits.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open3D(page);
    const list = page.getByRole("list", { name: /Bottles in Wine fridge/i });
    const panel = page.getByRole("dialog", { name: /Special Cuvée 2017/ });

    for (const scheme of ["light", "dark"] as const) {
      // The rack fades towards the card's colour, so take the bottle out again in each theme.
      await page.emulateMedia({ colorScheme: scheme });
      await list
        .getByRole("button", { name: /Special Cuvée 2017/ })
        .first()
        .focus();
      await page.keyboard.press("Enter");
      await expect(panel).toHaveAttribute("data-open", "true");
      await expect(panel.getByRole("button", { name: "Move", exact: true })).toBeEnabled();
      // Focus lands in the panel for keyboard and screen-reader users.
      await expect(panel).toBeFocused();
      await expect.poll(() => audit(page), { timeout: 20_000 }).toEqual([]);
      await page.screenshot({ path: shot(`3d-showcase-${scheme}-${project()}`) });

      await page.keyboard.press("Escape");
      await expect(panel).toHaveAttribute("data-open", "false");
    }
  });

  test("no storage yet: a clear way forward, not an empty canvas", async ({ page, request }) => {
    const { email } = await arrive(page, "cellar3dempty");
    const { call } = await apiClient(request, email);
    await addBottles(call, wineBody, 2019, 1, null);
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    await expect(page.getByTestId("cellar-3d")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show racks" })).toBeVisible();
    await page.getByRole("button", { name: "Show racks" }).click();
    await expect(page.getByRole("radio", { name: "Racks" })).toBeChecked();
  });

  test("the view is remembered; the page is accessible in both themes", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "cellar3da11y");
    const { call } = await apiClient(request, email);
    const fridge = await addUnit(call, "Wine fridge", "fridge", 4, 5);
    await addBottles(call, wineBody, 2019, 2, fridge);

    await open3D(page);
    await page.reload();
    await expect(page.getByRole("radio", { name: "3D" })).toBeChecked();
    await expect(page.getByTestId("cellar-3d")).toHaveAttribute("data-ready", "true", {
      timeout: 20_000,
    });

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
      await page.screenshot({ path: shot(`3d-${scheme}-${project()}`), fullPage: true });
    }
  });

  test("without WebGL the cellar still works: the racks are one tap away", async ({
    browser,
    baseURL,
    request,
  }) => {
    const context = await browser.newContext({ baseURL: baseURL ?? "" });
    await context.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        kind: string,
        ...rest: unknown[]
      ) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl") return null;
        return (original as (...args: unknown[]) => unknown).call(this, kind, ...rest);
      } as typeof original;
    });
    const page = await context.newPage();
    try {
      const { email } = await arrive(page, "cellar3dnogl");
      const { call } = await apiClient(request, email);
      const fridge = await addUnit(call, "Wine fridge", "fridge", 4, 5);
      await addBottles(call, wineBody, 2019, 2, fridge);
      await page.goto("/cellar");
      await page.getByRole("radio", { name: "3D" }).click();
      await expect(page.getByText(/3D isn.t available/i)).toBeVisible();
      await expect(page.getByTestId("cellar-3d")).toHaveCount(0);
      await page.getByRole("button", { name: "Show racks" }).click();
      await expect(page.getByRole("heading", { name: "Wine fridge" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
