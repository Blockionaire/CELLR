import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, bearer, makeJpeg, sql, wineBody } from "./helpers";

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

test.describe("the bottle on display", () => {
  test("carries the photo of its back label; turning it right across the rack keeps it out", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const { email } = await arrive(page, "backlabel");
    const { call, token } = await apiClient(request, email);
    const vintageId = await stock(call);
    const scene = await open3D(page);

    // No back photo yet: a plain drawn stand-in, never made-up text.
    await takeOut(page);
    await expect(scene).toHaveAttribute("data-back-label", "drawn");
    await page.keyboard.press("Escape");
    await expect(scene).toHaveAttribute("data-showcase", "closed");

    const photo = await makeJpeg(page, { words: "Back label" });
    const res = await request.post("/api/v1/images", {
      headers: bearer(token),
      multipart: {
        photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: photo },
        thumb: { name: "t.jpg", mimeType: "image/jpeg", buffer: photo },
        side: "back",
        blurColor: "#e8dcc2",
      },
    });
    expect(res.status()).toBe(201);
    const { id } = (await res.json()) as { id: string };
    await call("put", `/cellar/${vintageId}/photo`, { imageId: id, side: "back" }, 200);

    await page.reload();
    await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    await expect(page.getByTestId("rack-backdrop")).toHaveCount(0, { timeout: 5000 });
    await takeOut(page);
    await expect(scene).toHaveAttribute("data-back-label", "photo");
    await page.waitForTimeout(1500);

    // A long drag that ends over the (hidden) rack turns the bottle; only a tap puts it back.
    const box = (await scene.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await expect(scene).toHaveAttribute("data-showcase", "open");
    await expect(page.getByTestId("bottle-showcase")).toHaveAttribute("data-open", "true");
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
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="cellar-3d"] canvas')!;
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

  test("tapping the unit already shown keeps the view (it used to go blank)", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "rechip");
    const { call } = await apiClient(request, email);
    await stock(call);
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 2, cols: 2 }, 201);
    const scene = await open3D(page);
    await page.getByRole("button", { name: "Walnut rack", exact: true }).click();
    await page.waitForTimeout(500);
    await expect(scene).toHaveAttribute("data-ready", "true");
  });
});
