import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, wineBody } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

async function tallRack(call: Call, rows = 14, cols = 5) {
  const unit = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Big rack", kind: "rack", rows, cols },
      201,
    )
  ).body;
  const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
  // At most 36 bottles go in at once.
  for (let left = rows * cols; left > 0; left -= 30)
    await call(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2019, quantity: Math.min(30, left), locationId: unit.id },
      201,
    );
  return unit;
}

const open3D = async (page: Page) => {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  const scene = page.getByTestId("cellar-3d");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  return scene;
};

const view = async (page: Page) => {
  const el = page.locator("canvas").first();
  const [x, y] = ((await el.getAttribute("data-target")) ?? "0,0").split(",").map(Number);
  return { x: x!, y: y!, distance: Number((await el.getAttribute("data-distance")) ?? 0) };
};

test.describe("zooming into a big rack", () => {
  for (const where of ["top", "bottom"] as const) {
    test(`zoom goes towards where you point: the ${where} of a big rack can be reached`, async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000);
      const { email } = await arrive(page, `zoom${where}`);
      const { call } = await apiClient(request, email);
      await tallRack(call);
      const scene = await open3D(page);
      // On a phone the picture is taller than the screen: bring the part we point at into view.
      await page.evaluate(
        (end) => window.scrollTo(0, end ? document.body.scrollHeight : 0),
        where === "bottom",
      );
      await page.waitForTimeout(300);
      const box = (await scene.boundingBox())!;
      // (and the very bottom lies under the tab bar: stay clear of it)
      const y =
        where === "top"
          ? box.y + box.height * 0.12
          : Math.min(box.y + box.height * 0.88, page.viewportSize()!.height - 140);
      await page.mouse.move(box.x + box.width / 2, y);
      for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -300);
      if (where === "top")
        await expect.poll(async () => (await view(page)).y, { timeout: 8000 }).toBeGreaterThan(1);
      else {
        await expect.poll(async () => (await view(page)).y, { timeout: 8000 }).toBeLessThan(-1);
      }
      await page.screenshot({ path: shot(`zoom-${where}-${project()}`) });
    });
  }

  test("the view can be slid, and never leaves the rack", async ({ page, request }) => {
    test.setTimeout(120_000);
    const { email } = await arrive(page, "slide");
    const { call } = await apiClient(request, email);
    await tallRack(call);
    const scene = await open3D(page);
    const box = (await scene.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -300);
    // Right button drag = slide, a long way up
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.2);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 12 });
    await page.mouse.up({ button: "right" });
    const { y } = await view(page);
    expect(Math.abs(y)).toBeLessThanOrEqual(14 / 2 + 0.15 + 0.01); // half the rack's height, frame included
  });
});

test.describe("the rack holds still behind the bottle", () => {
  test("a still of the rack, blurred and dimmed, takes its place; turning the bottle moves nothing else", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const { email } = await arrive(page, "still");
    const { call } = await apiClient(request, email);
    await tallRack(call, 4, 4);
    const scene = await open3D(page);
    await page
      .getByRole("list", { name: /Bottles in Big rack/i })
      .getByRole("button")
      .first()
      .focus();
    await page.keyboard.press("Enter");
    await expect(scene).toHaveAttribute("data-showcase", "open");
    const backdrop = page.getByTestId("rack-backdrop");
    await expect(backdrop).toBeVisible();
    await expect(backdrop).toHaveCSS("filter", /blur/);
    await page.waitForTimeout(2000); // let the bottle come out and the picture settle

    // Drag across the picture: the bottle turns; the camera, and with it the rack's picture, stay as they were.
    const before = await view(page);
    const box = (await scene.boundingBox())!;
    const corner = { x: box.x + 6, y: box.y + 6, width: 90, height: 60 };
    const stillBefore = await page.screenshot({ clip: corner });
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.55, { steps: 10 });
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.45, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    expect(await view(page)).toEqual(before);
    expect((await page.screenshot({ clip: corner })).equals(stillBefore)).toBe(true);
    // a scroll wheel does not zoom the rack either, while a bottle is on display
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(300);
    expect(await view(page)).toEqual(before);
    await page.screenshot({ path: shot(`still-rack-${project()}`) });

    // Put it back: the live rack takes over, and the picture is gone.
    await page.keyboard.press("Escape");
    await expect(scene).toHaveAttribute("data-showcase", "closed");
    await expect(page.getByTestId("rack-backdrop")).toHaveCount(0, { timeout: 5000 });
  });
});

test.describe("several places", () => {
  test("a second fridge is its own place, not a clash: it gets a number, and any number of places can be made", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "places");
    const { call } = await apiClient(request, email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await call(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2019, quantity: 1, locationId: null },
      201,
    );

    await page.goto("/cellar");
    await page.getByRole("radio", { name: "Racks" }).click();
    const create = async (kind?: string) => {
      await page.getByRole("button", { name: "New place" }).first().click();
      const sheet = page.getByRole("dialog");
      if (kind) await sheet.getByRole("button", { name: kind, exact: true }).click();
      await sheet.getByRole("button", { name: "Create place" }).click();
      await expect(sheet).toBeHidden();
    };
    await create(); // Wine fridge
    await create(); // Wine fridge again: no clash
    await create("Rack");
    await create("Wine fridge"); // and a fourth, another fridge

    const names = (await call<Array<{ label: string }>>("get", "/storage", undefined, 200)).body
      .map((u) => u.label)
      .sort();
    expect(names).toEqual(["Rack", "Wine fridge", "Wine fridge 2", "Wine fridge 3"]);
    await page.screenshot({ path: shot(`places-${project()}`), fullPage: true });

    // Typing a name that is taken is explained instead of failing.
    await page.getByRole("button", { name: "New place" }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Name").fill("rack");
    await sheet.getByRole("button", { name: "Create place" }).click();
    await expect(sheet.getByRole("alert")).toContainText("already have a place called");
  });
});
