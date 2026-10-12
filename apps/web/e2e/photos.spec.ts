import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
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
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

type Request = Parameters<typeof api>[0];
interface Stored {
  id: string;
  side: string;
  blurColor: string | null;
  width: number;
  height: number;
}

/** Posts a photo the way the app does: a normal copy, a small one, and the colour to show while it loads. */
async function postPhoto(
  request: Request,
  token: string,
  photo: Buffer,
  thumb: Buffer | null = photo,
  extra: Record<string, string> = {},
) {
  return request.post("/api/v1/images", {
    headers: bearer(token),
    multipart: {
      photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
      ...(thumb ? { thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: thumb } } : {}),
      side: "front",
      blurColor: "#7d2234",
      ...extra,
    },
  });
}

async function furnish(call: Call) {
  const fridge = (
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 3, cols: 4 }, 201)
  ).body as { id: string };
  const wine = (await call("post", "/wines", wineBody, 201)).body as { id: string };
  const bought = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2019, quantity: 2, locationId: fridge.id },
      201,
    )
  ).body;
  const vintage = (
    await sql<{ vintage_id: string }>("select vintage_id from public.bottles where id = $1", [
      bought.bottleIds[0],
    ])
  )[0]!.vintage_id;
  return { wineId: wine.id, vintageId: vintage, locationId: fridge.id };
}

const hasMetadata = (bytes: Buffer) => {
  const text = bytes.toString("latin1");
  return text.includes("Exif") || text.includes("GPS") || text.includes("SerialNumber");
};

test.describe("label photos at the API", () => {
  test("a photo is kept without what the phone hid in it, and comes back for the household that owns it", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "photoapi");
    const { call, token } = await apiClient(request, email);
    const { vintageId } = await furnish(call);

    const dirty = await makeJpeg(page, { exif: true, words: "Chablis" });
    expect(hasMetadata(dirty)).toBe(true);
    const small = await makeJpeg(page, { width: 150, height: 200, exif: true });
    const response = await postPhoto(request, token, dirty, small);
    expect(response.status()).toBe(201);
    const stored = (await response.json()) as Stored;
    expect(stored).toMatchObject({ side: "front", blurColor: "#7d2234", width: 600, height: 800 });

    // Both sizes come back, as JPEG, kept by the browser but never by a shared cache…
    for (const [size, want] of [
      ["photo", 600],
      ["thumb", 150],
    ] as const) {
      const image = await api(request, token, "get", `/images/${stored.id}?size=${size}`);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/jpeg");
      expect(image.headers()["cache-control"]).toContain("private");
      expect(image.headers()["cache-control"]).toContain("immutable");
      expect(image.headers()["x-content-type-options"]).toBe("nosniff");
      const bytes = await image.body();
      // …and without the position or the serial number the phone had put in.
      expect(hasMetadata(bytes)).toBe(false);
      expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      // Still a picture the browser can open, at the size that was sent.
      const width = await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return (await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }))).width;
      }, bytes.toString("base64"));
      expect(width).toBe(want);
    }
    // No size given means the photo; a made-up size is refused.
    expect((await api(request, token, "get", `/images/${stored.id}`)).status()).toBe(200);
    expect((await api(request, token, "get", `/images/${stored.id}?size=huge`)).status()).toBe(422);
    expect((await api(request, token, "get", `/images/not-an-id`)).status()).toBe(404);

    // Attached to the wine, it shows on the card and on the wine's page.
    await call("put", `/cellar/${vintageId}/photo`, { imageId: stored.id }, 200);
    const cellar = (
      await call<{ items: Array<{ image: Stored | null }> }>("get", "/cellar", undefined, 200)
    ).body;
    expect(cellar.items[0]!.image).toMatchObject({ id: stored.id, blurColor: "#7d2234" });
    const detail = (
      await call<{ image: Stored | null }>("get", `/cellar/${vintageId}`, undefined, 200)
    ).body;
    expect(detail.image?.id).toBe(stored.id);
  });

  test("things that are not photos are turned away, and nothing is kept", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "photobad");
    const { token } = await apiClient(request, email);
    const good = await makeJpeg(page);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

    // Whatever it says it is, a file is judged by what it contains.
    for (const bad of [png, svg, Buffer.from("just words"), good.subarray(0, 200)]) {
      const res = await postPhoto(request, token, bad);
      expect(res.status()).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "UPLOAD_REJECTED",
      );
    }
    expect((await postPhoto(request, token, good, svg)).status()).toBe(422); // the small copy too
    // Missing photo, wrong side, not a form at all.
    expect(
      (
        await request.post("/api/v1/images", {
          headers: bearer(token),
          multipart: { side: "front" },
        })
      ).status(),
    ).toBe(422);
    expect((await postPhoto(request, token, good, good, { side: "top" })).status()).toBe(422);
    expect((await api(request, token, "post", "/images", { photo: "x" })).status()).toBe(422);
    // Far too big: refused before it is read.
    const huge = Buffer.concat([good, Buffer.alloc(4.5 * 1024 * 1024)]);
    expect((await postPhoto(request, token, huge)).status()).toBe(422);

    expect(
      await sql("select 1 from public.bottle_images where household_id = $1", [householdId]),
    ).toHaveLength(0);
    expect(
      await sql("select 1 from storage.objects where name like $1", [`${householdId}/%`]),
    ).toHaveLength(0);
    // Signed out: nobody.
    expect(
      (
        await request.post("/api/v1/images", {
          headers: bearer("nope"),
          multipart: { photo: { name: "a.jpg", mimeType: "image/jpeg", buffer: good } },
        })
      ).status(),
    ).toBe(401);
  });

  test("a photo belongs to one household: others cannot see it, attach it, or reach it in storage", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "photoown");
    const { call, token } = await apiClient(request, owner.email);
    const { vintageId } = await furnish(call);
    const stored = (await (await postPhoto(request, token, await makeJpeg(page))).json()) as Stored;

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "photooth");
    const otherToken = await sessionToken(other.email);
    const otherCall = (await apiClient(request, other.email)).call;
    const theirs = await furnish(otherCall);

    // Not found, not "forbidden": nothing says it exists.
    expect((await api(request, otherToken, "get", `/images/${stored.id}`)).status()).toBe(404);
    expect(
      (
        await api(request, otherToken, "put", `/cellar/${theirs.vintageId}/photo`, {
          imageId: stored.id,
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await api(request, otherToken, "put", `/cellar/${vintageId}/photo`, { imageId: stored.id })
      ).status(),
    ).toBe(404);
    // …nor can their new bottles borrow it.
    const borrow = await api(request, otherToken, "post", "/bottles", {
      wineId: theirs.wineId,
      year: 2019,
      quantity: 1,
      locationId: null,
      imageId: stored.id,
    });
    expect(borrow.status()).toBe(404);

    // Going around the app, straight at Storage with a valid session of the other household.
    const [object] = await sql<{ name: string }>(
      "select name from storage.objects where name like $1 limit 1",
      [`${owner.householdId}/%`],
    );
    const read = await fetch(`${STACK}/storage/v1/object/bottle-images/${object!.name}`, {
      headers: bearer(otherToken),
    });
    expect(read.ok).toBe(false);
    const write = await fetch(
      `${STACK}/storage/v1/object/bottle-images/${owner.householdId}/mine/photo.jpg`,
      {
        method: "POST",
        headers: { ...bearer(otherToken), "content-type": "image/jpeg" },
        body: new Uint8Array(await makeJpeg(page)),
      },
    );
    expect(write.status).toBe(403);
    // A format Storage itself refuses, even in their own folder.
    const svg = await fetch(
      `${STACK}/storage/v1/object/bottle-images/${other.householdId}/x/photo.svg`,
      {
        method: "POST",
        headers: { ...bearer(otherToken), "content-type": "image/svg+xml" },
        body: "<svg/>",
      },
    );
    expect(svg.ok).toBe(false);
    await context.close();
  });

  test("new bottles of a wine share its photo; taking the photo off stops that", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "photoshare");
    const { call, token } = await apiClient(request, email);
    const { wineId, vintageId } = await furnish(call);
    const stored = (await (await postPhoto(request, token, await makeJpeg(page))).json()) as Stored;
    await call("put", `/cellar/${vintageId}/photo`, { imageId: stored.id }, 200);

    // Two more bottles of the same vintage arrive: they have the photo without being asked.
    await call("post", "/bottles", { wineId, year: 2019, quantity: 2, locationId: null }, 201);
    const withPhoto = await sql<{ n: string }>(
      "select count(*) as n from public.bottles where vintage_id = $1 and front_image_id = $2",
      [vintageId, stored.id],
    );
    expect(Number(withPhoto[0]!.n)).toBe(4);
    // A different vintage of the same wine is another picture, so it does not.
    await call("post", "/bottles", { wineId, year: 2020, quantity: 1, locationId: null }, 201);
    const cellar = (
      await call<{ items: Array<{ year: number; image: Stored | null }> }>(
        "get",
        "/cellar",
        undefined,
        200,
      )
    ).body;
    expect(cellar.items.find((i) => i.year === 2019)!.image?.id).toBe(stored.id);
    expect(cellar.items.find((i) => i.year === 2020)!.image).toBeNull();

    await call("delete", `/cellar/${vintageId}/photo`, undefined, 204);
    const after = (
      await call<{ image: Stored | null }>("get", `/cellar/${vintageId}`, undefined, 200)
    ).body;
    expect(after.image).toBeNull();
    await call("post", "/bottles", { wineId, year: 2019, quantity: 1, locationId: null }, 201);
    const fresh = await sql<{ n: string }>(
      "select count(*) as n from public.bottles where vintage_id = $1 and front_image_id is not null",
      [vintageId],
    );
    expect(Number(fresh[0]!.n)).toBe(0);
  });
});

async function furnishPage(page: Page, request: Request, label: string) {
  const { email } = await arrive(page, label);
  const { call } = await apiClient(request, email);
  return { email, ...(await furnish(call)) };
}

test.describe("label photos on screen", () => {
  test("take a photo on the wine's page: it is shrunk, kept, shown on the card, and can go again", async ({
    page,
    request,
  }) => {
    const { vintageId, email } = await furnishPage(page, request, "photoui");
    await page.goto(`/cellar/${vintageId}`);
    await expect(
      page.getByRole("heading", { name: "Chablis Premier Cru", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: /Label of/ })).toHaveCount(0);

    // A big phone photo, with its position hidden inside it.
    const big = await makeJpeg(page, {
      width: 3600,
      height: 4800,
      exif: true,
      words: "Domaine Test",
    });
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "IMG_0042.jpg", mimeType: "image/jpeg", buffer: big });
    await expect(page.getByText("Photo saved.")).toBeVisible();
    const photo = page.getByRole("img", { name: "Label of Domaine Test Chablis Premier Cru" });
    await expect(photo).toBeVisible();
    await expect
      .poll(() => photo.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    await page.screenshot({ path: shot(`photo-wine-${project()}`), fullPage: true });

    // It was shrunk on the phone before it went anywhere: 1200 × 1600 instead of 3600 × 4800.
    const token = await sessionToken(email);
    const cellar = (await (await api(request, token, "get", "/cellar")).json()) as {
      items: Array<{ image: Stored }>;
    };
    expect(cellar.items[0]!.image).toMatchObject({ width: 1200, height: 1600 });
    const bytes = await (
      await api(request, token, "get", `/images/${cellar.items[0]!.image.id}`)
    ).body();
    expect(bytes.length).toBeLessThan(600_000);
    expect(hasMetadata(bytes)).toBe(false);

    // The card in the cellar wears the small copy; the list too.
    await page.goto("/cellar");
    const card = page.locator("article").first();
    await expect(card.locator("img")).toHaveAttribute(
      "src",
      /\/api\/v1\/images\/[0-9a-f-]+\?size=thumb/,
    );
    await expect
      .poll(() => card.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
    await page.screenshot({ path: shot(`photo-card-${project()}`) });

    // Change it, then remove it: the bottle drawing comes back.
    await page.goto(`/cellar/${vintageId}`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "second.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg(page, { color: "#1f4d3a" }),
    });
    await expect(page.getByText("Photo saved.")).toBeVisible();
    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(page.getByText("Photo removed.")).toBeVisible();
    await expect(page.getByRole("img", { name: /Label of/ })).toHaveCount(0);
    await expect(page.getByText("Add a photo of the label")).toBeVisible();
  });

  test("something that is not a picture is explained, and nothing changes", async ({
    page,
    request,
  }) => {
    const { vintageId } = await furnishPage(page, request, "photonot");
    await page.goto(`/cellar/${vintageId}`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("not a picture at all"),
    });
    await expect(page.getByText("We couldn’t open that photo. Try another one.")).toBeVisible();
    await expect(page.getByRole("img", { name: /Label of/ })).toHaveCount(0);
  });

  test("the real label goes round the bottle in 3D", async ({ page, request }) => {
    test.setTimeout(60_000);
    const { vintageId, email } = await furnishPage(page, request, "photo3d");
    const token = await sessionToken(email);
    const stored = (await (
      await postPhoto(request, token, await makeJpeg(page, { words: "Domaine Test" }))
    ).json()) as Stored;
    await api(request, token, "put", `/cellar/${vintageId}/photo`, { imageId: stored.id });

    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    const scene = page.getByTestId("cellar-3d");
    await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
    const asked = page.waitForRequest((r) =>
      r.url().includes(`/api/v1/images/${stored.id}?size=photo`),
    );
    await page
      .getByRole("list", { name: /Bottles in Wine fridge/i })
      .getByRole("button")
      .first()
      .focus();
    await page.keyboard.press("Enter");
    await asked; // the bottle fetched the photo to wear as its label
    await expect(page.getByRole("dialog", { name: /Chablis Premier Cru/ })).toHaveAttribute(
      "data-open",
      "true",
    );
    await page.waitForTimeout(1500); // let the bottle come out and turn
    await page.screenshot({ path: shot(`photo-3d-${project()}`) });
  });

  test("the wine's page with a photo is accessible in both themes", async ({ page, request }) => {
    const { vintageId, email } = await furnishPage(page, request, "photoa11y");
    const token = await sessionToken(email);
    const stored = (await (await postPhoto(request, token, await makeJpeg(page))).json()) as Stored;
    await api(request, token, "put", `/cellar/${vintageId}/photo`, { imageId: stored.id });
    for (const path of [`/cellar/${vintageId}`, "/cellar"]) {
      await page.goto(path);
      await expect(page.locator("img").first()).toBeVisible();
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await expect.poll(() => audit(page)).toEqual([]);
      }
    }
  });
});
