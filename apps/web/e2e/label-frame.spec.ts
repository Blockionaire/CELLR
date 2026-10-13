import { expect, test, type BrowserContextOptions } from "@playwright/test";
import {
  api,
  apiClient,
  arrive,
  audit,
  bearer,
  makeJpeg,
  sessionToken,
  sql,
  STACK,
  wineBody,
} from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

async function furnish(
  page: Parameters<typeof arrive>[0],
  request: Parameters<typeof apiClient>[0],
  who: string,
) {
  const { email, householdId } = await arrive(page, who);
  const { call, token } = await apiClient(request, email);
  const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
  await call("post", "/bottles", { wineId: wine.id, year: 2019, quantity: 2 }, 201);
  const [v] = await sql<{ id: string }>("select id from public.wine_vintages where wine_id = $1", [
    wine.id,
  ]);
  return { email, householdId, token, vintageId: v!.id };
}

const post = (
  request: Parameters<typeof api>[0],
  token: string,
  photo: Buffer,
  extra: Record<string, string> = {},
) =>
  request.post("/api/v1/images", {
    headers: bearer(token),
    multipart: {
      photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: photo },
      thumb: { name: "t.jpg", mimeType: "image/jpeg", buffer: photo },
      side: "front",
      ...extra,
    },
  });
const putTexture = (
  request: Parameters<typeof api>[0],
  token: string,
  id: string,
  bytes: Buffer | string,
) =>
  request.put(`/api/v1/images/${id}/texture`, {
    headers: bearer(token),
    multipart: {
      texture: {
        name: "t.jpg",
        mimeType: "image/jpeg",
        buffer: typeof bytes === "string" ? Buffer.from(bytes) : bytes,
      },
    },
  });

test.describe("the label cut out of the photo (API)", () => {
  test("is kept beside the photo, served privately, replaced, and removed", async ({
    page,
    request,
  }) => {
    const { token, householdId } = await furnish(page, request, "texapi");
    const photo = await makeJpeg(page);
    const image = (await (await post(request, token, photo)).json()) as {
      id: string;
      texture?: boolean;
    };

    // Nothing yet: there is no texture to fetch.
    expect((await api(request, token, "get", `/images/${image.id}?size=texture`)).status()).toBe(
      404,
    );

    const flat = await makeJpeg(page, { width: 300, height: 380, words: "Label only" });
    const stored = await putTexture(request, token, image.id, flat);
    expect(stored.status()).toBe(200);
    expect(await stored.json()).toMatchObject({ id: image.id, texture: true });

    const served = await api(request, token, "get", `/images/${image.id}?size=texture`);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/jpeg");
    // Redone under the same address, so it is checked again every time
    expect(served.headers()["cache-control"]).toContain("no-cache");
    expect((await served.body()).length).toBeGreaterThan(500);

    const [first] = await sql<{ texture_path: string }>(
      "select texture_path from public.bottle_images where id = $1",
      [image.id],
    );
    expect(first!.texture_path.startsWith(`${householdId}/`)).toBe(true);
    await putTexture(request, token, image.id, await makeJpeg(page, { width: 320, height: 400 }));
    const [second] = await sql<{ texture_path: string }>(
      "select texture_path from public.bottle_images where id = $1",
      [image.id],
    );
    expect(second!.texture_path).not.toBe(first!.texture_path);
    expect(
      await sql("select 1 from storage.objects where name = $1", [first!.texture_path]),
    ).toHaveLength(0);

    expect((await api(request, token, "delete", `/images/${image.id}/texture`)).status()).toBe(204);
    expect((await api(request, token, "get", `/images/${image.id}?size=texture`)).status()).toBe(
      404,
    );
    expect(
      await sql("select 1 from storage.objects where name = $1", [second!.texture_path]),
    ).toHaveLength(0);
  });

  test("refuses what isn't a picture, and a label of somebody else's photo", async ({
    page,
    browser,
    request,
  }) => {
    const { token } = await furnish(page, request, "texsec");
    const image = (await (await post(request, token, await makeJpeg(page))).json()) as {
      id: string;
    };
    expect((await putTexture(request, token, image.id, "not a picture")).status()).toBe(422);
    expect(
      (
        await request.put(`/api/v1/images/${image.id}/texture`, {
          headers: bearer(token),
          multipart: {},
        })
      ).status(),
    ).toBe(422);
    expect((await api(request, token, "get", `/images/${image.id}?size=texture`)).status()).toBe(
      404,
    );

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "texother");
    const otherToken = await sessionToken(other.email);
    const flat = await makeJpeg(page, { width: 300, height: 380 });
    expect((await putTexture(request, otherToken, image.id, flat)).status()).toBe(404);
    expect((await api(request, otherToken, "delete", `/images/${image.id}/texture`)).status()).toBe(
      404,
    );
    await context.close();
    expect(
      await sql(
        "select texture_path from public.bottle_images where id = $1 and texture_path is not null",
        [image.id],
      ),
    ).toHaveLength(0);
  });

  test("goes with the household when it is deleted", async ({ page, request }) => {
    const { token, householdId } = await furnish(page, request, "texgone");
    const image = (await (await post(request, token, await makeJpeg(page))).json()) as {
      id: string;
    };
    await putTexture(request, token, image.id, await makeJpeg(page, { width: 300, height: 380 }));
    expect(
      await sql("select 1 from storage.objects where name like $1", [`${householdId}/%`]),
    ).toHaveLength(3);
    const name = (
      await sql<{ name: string }>("select name from public.households where id = $1", [householdId])
    )[0]!.name;
    void name;
    expect((await api(request, token, "delete", `/households/${householdId}`)).status()).toBe(204);
    expect(
      await sql("select 1 from storage.objects where name like $1", [`${householdId}/%`]),
    ).toHaveLength(0);
  });
});

test.describe("framing the label on the wine's page", () => {
  test("choose a photo, put the frame on the label, and the bottle gets just the label", async ({
    page,
    request,
  }) => {
    const { vintageId } = await furnish(page, request, "frame");
    await page.goto(`/cellar/${vintageId}`);
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "front.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, { width: 900, height: 1200, words: "Domaine Test" }),
      });

    const dialog = page.getByRole("dialog", { name: "Show us where the label is" });
    await expect(dialog).toBeVisible();
    const corner = dialog.getByTestId("corner-tl");
    const before = await corner.evaluate((el) => (el as HTMLElement).style.left);
    await corner.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => corner.evaluate((el) => (el as HTMLElement).style.left))
      .not.toBe(before);
    await page.screenshot({ path: shot(`framer-${project()}`) });
    expect(await audit(page)).toEqual([]);

    await dialog.getByRole("button", { name: "Use this frame" }).click();
    await expect(page.getByText("Photo saved.")).toBeVisible();
    const rows = await sql<{ texture_path: string | null }>(
      "select i.texture_path from public.bottle_images i join public.bottles b on b.front_image_id = i.id where b.vintage_id = $1",
      [vintageId],
    );
    expect(rows.length).toBe(2);
    expect(rows[0]!.texture_path).toMatch(/texture-[0-9a-f-]+\.jpg$/);

    // Adjusting later: the whole photo again takes the texture away.
    await page.getByRole("button", { name: "Adjust label frame" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Use the whole photo" }).click();
    await expect(page.getByText("Label updated.")).toBeVisible();
    expect(
      await sql(
        "select 1 from public.bottle_images i join public.bottles b on b.front_image_id = i.id where b.vintage_id = $1 and i.texture_path is not null",
        [vintageId],
      ),
    ).toHaveLength(0);
  });

  test("a frame that isn't a label is explained and nothing is sent", async ({ page, request }) => {
    const { vintageId } = await furnish(page, request, "framebad");
    await page.goto(`/cellar/${vintageId}`);
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "front.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page),
      });
    const dialog = page.getByRole("dialog", { name: "Show us where the label is" });
    await expect(dialog).toBeVisible();
    // Push the top-left corner right past the top-right one: the frame folds over itself.
    await dialog.getByTestId("corner-tl").focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press("Shift+ArrowRight");
    await dialog.getByRole("button", { name: "Use this frame" }).click();
    await expect(dialog.getByRole("alert")).toContainText("doesn't look like a label");
    expect(
      await sql(
        "select 1 from public.bottle_images where texture_path is not null and household_id = (select household_id from public.bottles where vintage_id = $1 limit 1)",
        [vintageId],
      ),
    ).toHaveLength(0);
  });

  test("the back label has its own place", async ({ page, request }) => {
    const { vintageId } = await furnish(page, request, "back");
    await page.goto(`/cellar/${vintageId}`);
    await expect(page.getByText("Back label", { exact: true })).toBeVisible();
    await page
      .locator('input[type="file"]')
      .nth(1)
      .setInputFiles({
        name: "back.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, { words: "Importer BV" }),
      });
    await expect(page.getByText("Photo saved.")).toBeVisible();
    await expect(page.getByRole("img", { name: /Back label of/ })).toBeVisible();
    const rows = await sql<{ back_image_id: string | null; front_image_id: string | null }>(
      "select back_image_id, front_image_id from public.bottles where vintage_id = $1",
      [vintageId],
    );
    expect(rows.every((r) => r.back_image_id !== null && r.front_image_id === null)).toBe(true);
    await page.screenshot({ path: shot(`back-label-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);

    await page.getByRole("button", { name: "Remove back label" }).click();
    await expect(page.getByRole("img", { name: /Back label of/ })).toHaveCount(0);
    expect(
      (
        await sql<{ n: string }>(
          "select count(*) n from public.bottles where vintage_id = $1 and back_image_id is not null",
          [vintageId],
        )
      )[0]!.n,
    ).toBe("0");
  });
});

test.describe("the 3D bottle and the scan", () => {
  test("a framed label is what the bottle wears in 3D", async ({ page, request }) => {
    test.setTimeout(90_000);
    const { vintageId, token } = await furnish(page, request, "tex3d");
    const fridge = (await (
      await api(request, token, "post", "/storage", {
        label: "Wine fridge",
        kind: "fridge",
        rows: 3,
        cols: 4,
      })
    ).json()) as { id: string };
    const image = (await (
      await post(request, token, await makeJpeg(page, { words: "Domaine Test" }))
    ).json()) as { id: string };
    await putTexture(
      request,
      token,
      image.id,
      await makeJpeg(page, { width: 300, height: 380, words: "Label" }),
    );
    await api(request, token, "put", `/cellar/${vintageId}/photo`, { imageId: image.id });
    // Put a bottle in the fridge so it can be seen in 3D.
    const bottle = (
      await sql<{ id: string }>("select id from public.bottles where vintage_id = $1 limit 1", [
        vintageId,
      ])
    )[0]!;
    expect(
      (
        await api(request, token, "patch", `/bottles/${bottle.id}`, {
          action: "move",
          to: { locationId: fridge.id, row: 1, col: 1 },
        })
      ).ok(),
    ).toBe(true);

    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    await expect(page.getByTestId("cellar-3d")).toHaveAttribute("data-ready", "true", {
      timeout: 20_000,
    });
    const asked = page.waitForRequest((r) =>
      r.url().includes(`/api/v1/images/${image.id}?size=texture`),
    );
    await page
      .getByRole("list", { name: /Bottles in Wine fridge/i })
      .getByRole("button")
      .first()
      .focus();
    await page.keyboard.press("Enter");
    await asked; // the bottle fetched the cut-out label, not the whole photo
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot(`texture-3d-${project()}`) });
  });

  test("scanning with a located label straightens it in the background", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "texscan");
    const { call } = await apiClient(request, email);
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 3, cols: 4 }, 201);
    const size = {
      width: 433 + test.info().parallelIndex * 17 + (Date.now() % 53),
      height: 577 + (Date.now() % 31),
    };
    await fetch(`${STACK}/__test/openai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...size,
        content: {
          is_wine_label: true,
          producer: "Texture Estate",
          wine_name: "Scan Cuvée",
          vintage: 2014,
          non_vintage: false,
          wine_type: "red",
          country_code: "FR",
          region: "Rhône",
          appellation: null,
          grapes: [],
          abv_percent: null,
          volume_ml: null,
          text_seen: "TEXTURE ESTATE",
          label_corners: [0.15, 0.12, 0.85, 0.12, 0.85, 0.88, 0.15, 0.88],
          confidence: { producer: "high", wine_name: "high", vintage: "high" },
        },
      }),
    });
    await page.goto("/scan");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "IMG.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, { ...size, words: "Texture" }),
      });
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await sql("select 1 from public.bottle_images where texture_path is not null")).length,
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);
  });
});
