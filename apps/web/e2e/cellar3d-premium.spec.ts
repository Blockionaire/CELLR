import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, bearer, sql, wineBody } from "./helpers";

/** Sprint C: the bottle on display shows both of its labels, turns freely, and the 3D view survives iOS. */

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

async function stock(call: Call) {
  const rack = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Walnut rack", kind: "rack", rows: 3, cols: 4 },
      201,
    )
  ).body;
  const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
  const added = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2019, quantity: 6, locationId: rack.id },
      201,
    )
  ).body;
  const [v] = await sql<{ vintage_id: string }>(
    "select vintage_id from public.bottles where id = $1",
    [added.bottleIds[0]],
  );
  return v!.vintage_id;
}

const open3D = async (page: Page) => {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  const scene = page.getByTestId("cellar-3d");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  return scene;
};

const takeOut = async (page: Page) => {
  await page
    .getByRole("list", { name: /Bottles in Walnut rack/i })
    .getByRole("button")
    .first()
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cellar-3d")).toHaveAttribute("data-showcase", "open");
};

/** A label photo in one loud colour, so it can be found on the rendered bottle (a test image, not a real label). */
async function flat(page: Page, colour: string) {
  const base64 = await page.evaluate((fill) => {
    const c = document.createElement("canvas");
    c.width = 500;
    c.height = 640;
    const x = c.getContext("2d")!;
    x.fillStyle = fill;
    x.fillRect(0, 0, 500, 640);
    return c.toDataURL("image/jpeg", 0.95).split(",")[1]!;
  }, colour);
  return Buffer.from(base64, "base64");
}

async function attach(
  request: Parameters<typeof apiClient>[0],
  token: string,
  call: Call,
  vintageId: string,
  side: "front" | "back",
  photo: Buffer,
) {
  const res = await request.post("/api/v1/images", {
    headers: bearer(token),
    multipart: {
      photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: photo },
      thumb: { name: "t.jpg", mimeType: "image/jpeg", buffer: photo },
      side,
      blurColor: "#e8dcc2",
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await call("put", `/cellar/${vintageId}/photo`, { imageId: id, side }, 200);
  return id;
}

/** How many pixels of the 3D view are clearly blue (the front photo) and clearly magenta (the back photo). */
async function labelPixels(page: Page) {
  const png = (await page.getByTestId("cellar-3d").locator("canvas[data-engine]").screenshot()).toString(
    "base64",
  );
  return page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const probe = document.createElement("canvas");
    probe.width = bitmap.width;
    probe.height = bitmap.height;
    const ctx = probe.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let blue = 0;
    let magenta = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = [px[i]!, px[i + 1]!, px[i + 2]!];
      if (b > 110 && b > r + 60 && b > g + 50) blue++;
      if (r > 110 && b > 70 && r > g + 70 && b > g + 40) magenta++;
    }
    return { blue, magenta };
  }, png);
}

/** Where the bottle stands on display: left of the panel on a wide screen, in the middle on a phone. */
async function bottleSpot(page: Page) {
  const box = (await page.getByTestId("cellar-3d").boundingBox())!;
  const wide = box.width >= 720;
  return {
    x: box.x + box.width * (wide ? 0.28 : 0.5),
    y: box.y + box.height * (wide ? 0.5 : 0.25),
  };
}

test.describe("the bottle on display", () => {
  test("wears both label photos for real: the front faces you, half a turn shows the back", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const { email } = await arrive(page, "labelsreal");
    const { call, token } = await apiClient(request, email);
    const vintageId = await stock(call);
    await attach(request, token, call, vintageId, "front", await flat(page, "#1f3fff"));
    await attach(request, token, call, vintageId, "back", await flat(page, "#ff1fb4"));
    const scene = await open3D(page);
    const canvas = scene.locator("canvas[data-engine]");

    await takeOut(page);
    // The photos were fetched, decoded and turned into the textures the bottle wears.
    await expect(canvas).toHaveAttribute("data-front-label", "photo", { timeout: 15_000 });
    await expect(canvas).toHaveAttribute("data-back-label", "photo", { timeout: 15_000 });
    await page.waitForTimeout(2500); // on display, standing still

    // Facing you: plenty of the front photo on the glass, the back one out of sight.
    const front = await labelPixels(page);
    expect(front.blue).toBeGreaterThan(1500);
    expect(front.magenta).toBeLessThan(front.blue / 20);

    // Half a turn (0.012 rad a pixel), held still before letting go so it stays there.
    const at = await bottleSpot(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) await page.mouse.move(at.x + i * 10.9, at.y);
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    await expect(scene).toHaveAttribute("data-showcase", "open");

    // Now the back photo faces you and the front one has gone round.
    const back = await labelPixels(page);
    expect(back.magenta).toBeGreaterThan(1000);
    expect(back.blue).toBeLessThan(back.magenta / 5);
  });

  test("without a back photo, or when it fails to load, the back wears the drawn stand-in and nothing breaks", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const { email } = await arrive(page, "labelsfail");
    const { call, token } = await apiClient(request, email);
    const vintageId = await stock(call);
    const scene = await open3D(page);
    const canvas = scene.locator("canvas[data-engine]");

    // No back photo: the drawn stand-in (producer and plain lines, never made-up text).
    await takeOut(page);
    await expect(canvas).toHaveAttribute("data-back-label", "drawn", { timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(scene).toHaveAttribute("data-showcase", "closed");

    // A back photo that cannot be fetched: the same stand-in, the bottle still comes out, the front still loads.
    await attach(request, token, call, vintageId, "front", await flat(page, "#1f3fff"));
    const backId = await attach(
      request,
      token,
      call,
      vintageId,
      "back",
      await flat(page, "#ff1fb4"),
    );
    await page.route(`**/api/v1/images/${backId}**`, (route) => route.abort());
    await page.reload();
    await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect(page.getByTestId("rack-backdrop")).toHaveCount(0, { timeout: 5000 });
    await takeOut(page);
    await expect(canvas).toHaveAttribute("data-front-label", "photo", { timeout: 15_000 });
    await expect(canvas).toHaveAttribute("data-back-label", "drawn", { timeout: 15_000 });
    await expect(page.getByTestId("bottle-showcase")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("cellar-3d-lost")).toHaveCount(0);

    // A long drag that ends over the (hidden) rack turns the bottle; only a tap puts it back.
    await page.waitForTimeout(1500);
    const box = (await scene.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await expect(scene).toHaveAttribute("data-showcase", "open");
  });
});

test.describe("staying up", () => {
  test("when the phone takes the graphics memory back, the view says so and comes back on a tap", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const { email } = await arrive(page, "ctxlost");
    const { call } = await apiClient(request, email);
    await stock(call);
    const scene = await open3D(page);
    await takeOut(page);

    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="cellar-3d"] canvas[data-engine]')!;
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      gl!.getExtension("WEBGL_lose_context")!.loseContext();
    });
    const lost = page.getByTestId("cellar-3d-lost");
    await expect(lost).toBeVisible();
    await expect(lost.getByText("The 3D view has paused")).toBeVisible();
    // The bottle went back: nothing is left half-open behind the message.
    await expect(scene).toHaveAttribute("data-showcase", "closed");
    // The accessible list keeps working all the while.
    await expect(
      page.getByRole("list", { name: /Bottles in Walnut rack/i }).getByRole("button"),
    ).toHaveCount(6);

    await lost.getByRole("button", { name: "Show 3D again" }).click();
    await expect(lost).toHaveCount(0);
    await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await takeOut(page);
  });

  test("tapping the unit already shown keeps the view; going to another one is not a loss", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const { email } = await arrive(page, "rechip");
    const { call } = await apiClient(request, email);
    await stock(call);
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 2, cols: 2 }, 201);
    const scene = await open3D(page);
    await page.getByRole("button", { name: "Walnut rack", exact: true }).click();
    await page.waitForTimeout(500);
    await expect(scene).toHaveAttribute("data-ready", "true");
    // Going to another unit lets the old picture go on purpose: no "paused" message for that.
    await page.getByRole("button", { name: "Wine fridge", exact: true }).click();
    await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("cellar-3d-lost")).toHaveCount(0);
  });
});
