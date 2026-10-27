import {
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  api,
  apiClient,
  arrive,
  bearer,
  makeJpeg,
  sessionToken,
  sql,
  STACK,
  wineBody,
} from "./helpers";

/**
 * Sprint K, part A, on a phone: zooming the label frame, a back label photographed during the scan, and friend
 * activity on Home that shows everything waiting at once.
 */

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

/** Fires touch pointer events on an element (Playwright has no multi-touch): what a pinch is made of. */
async function touch(target: Locator, type: string, id: number, x: number, y: number) {
  await target.evaluate(
    (el, e) => {
      const box = el.getBoundingClientRect();
      el.dispatchEvent(
        new PointerEvent(e.type, {
          bubbles: true,
          cancelable: true,
          pointerId: e.id,
          pointerType: "touch",
          isPrimary: e.id === 1,
          clientX: box.left + e.x,
          clientY: box.top + e.y,
        }),
      );
    },
    { type, id, x, y },
  );
}
const at = async (corner: Locator) => (await corner.getAttribute("data-at"))!;

test.describe("zooming the label frame", () => {
  test("pinch to zoom, a pinch never moves a corner, pan, place a corner while zoomed, back to the whole photo", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "kzoom");
    const { call } = await apiClient(request, email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    const added = (
      await call<{ vintageId: string }>(
        "post",
        "/bottles",
        { wineId: wine.id, year: 2019, quantity: 1 },
        201,
      )
    ).body;
    await page.goto(`/cellar/${added.vintageId}`);
    await page.waitForLoadState("networkidle");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "front.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, { width: 900, height: 1200, words: "Domaine Test" }),
      });
    const dialog = page.getByRole("dialog", { name: "Show us where the label is" });
    const framer = dialog.getByTestId("framer");
    await expect(framer).toHaveAttribute("data-zoom", "1.00");
    const box = (await framer.boundingBox())!;
    const tl = dialog.getByTestId("corner-tl");
    const tlBefore = await at(tl);
    const tlBox = (await tl.boundingBox())!;
    const onCorner = {
      x: tlBox.x - box.x + tlBox.width / 2,
      y: tlBox.y - box.y + tlBox.height / 2,
    };

    // Two fingers, the first one landing on a corner: it zooms, and the corner stays exactly where it was.
    const mid = { x: box.width / 2, y: box.height / 2 };
    await touch(framer, "pointerdown", 1, onCorner.x, onCorner.y);
    await touch(framer, "pointerdown", 2, mid.x + 40, mid.y + 40);
    await touch(framer, "pointermove", 1, onCorner.x - 30, onCorner.y - 30);
    await touch(framer, "pointermove", 2, mid.x + 120, mid.y + 120);
    await touch(framer, "pointerup", 2, mid.x + 120, mid.y + 120);
    await touch(framer, "pointerup", 1, onCorner.x - 30, onCorner.y - 30);
    const zoom = Number(await framer.getAttribute("data-zoom"));
    expect(zoom).toBeGreaterThan(1.3);
    expect(await at(tl)).toBe(tlBefore);

    // One finger away from the corners pans the zoomed photo; corners keep their place on the photo.
    const all = await Promise.all(
      ["tl", "tr", "br", "bl"].map((c) => at(dialog.getByTestId(`corner-${c}`))),
    );
    const before = await dialog
      .getByTestId("corner-br")
      .evaluate((el) => (el as HTMLElement).style.left);
    await touch(framer, "pointerdown", 3, mid.x, mid.y);
    await touch(framer, "pointermove", 3, mid.x - 60, mid.y);
    await touch(framer, "pointerup", 3, mid.x - 60, mid.y);
    expect(
      await dialog.getByTestId("corner-br").evaluate((el) => (el as HTMLElement).style.left),
    ).not.toBe(before);
    expect(
      await Promise.all(["tl", "tr", "br", "bl"].map((c) => at(dialog.getByTestId(`corner-${c}`)))),
    ).toEqual(all);

    // While zoomed, the arrow keys still move a corner by the same amount of the photo.
    await tl.focus();
    await page.keyboard.press("ArrowRight");
    const [x0] = tlBefore.split(",").map(Number);
    const [x1] = (await at(tl)).split(",").map(Number);
    expect(x1! - x0!).toBeCloseTo(0.01, 4);

    // The buttons work too, and "Show all" goes back to the whole photo.
    await dialog.getByRole("button", { name: "Zoom in" }).click();
    await dialog.getByRole("button", { name: "Show all" }).click();
    await expect(framer).toHaveAttribute("data-zoom", "1.00");
    await dialog.getByRole("button", { name: "Use this frame" }).click();
    await expect(page.getByText("Photo saved.")).toBeVisible();
  });
});

const label = {
  is_wine_label: true,
  producer: "Domaine Kappa",
  wine_name: "Les Deux Faces",
  vintage: 2020,
  non_vintage: false,
  wine_type: "red",
  country_code: "FR",
  region: "Bourgogne",
  appellation: null,
  grapes: [],
  abv_percent: null,
  volume_ml: 750,
  text_seen: "DOMAINE KAPPA LES DEUX FACES 2020",
  confidence: { producer: "high", wine_name: "high", vintage: "high" },
};
async function program(size: { width: number; height: number }) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...size, content: label }),
  });
  expect(res.ok).toBe(true);
}
const sizeFor = (n: number) => ({
  width: 431 + test.info().parallelIndex * 37 + n * 5 + (Date.now() % 71),
  height: 577 + n * 3,
});
async function scanToDetails(page: Page, call: Call, n: number) {
  await call("post", "/storage", { label: "Fridge", kind: "fridge", rows: 3, cols: 4 }, 201);
  const size = sizeFor(n);
  await program(size);
  await page.goto("/scan");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "front.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg(page, { ...size, words: "Kappa" }),
    });
  await expect(page.getByLabel("Producer")).toHaveValue("Domaine Kappa");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How many, and where?" })).toBeVisible();
  await expect(page.getByTestId("scan-labels")).toBeVisible();
}
const backPhoto = async (page: Page) =>
  page
    .getByTestId("scan-labels")
    .locator('input[type="file"]')
    .setInputFiles({
      name: "back.jpg",
      mimeType: "image/jpeg",
      buffer: await makeJpeg(page, { width: 600, height: 800, words: "Back" }),
    });
const images = (householdId: string) =>
  sql<{ front: string | null; back: string | null }>(
    "select front_image_id as front, back_image_id as back from public.bottles where household_id = $1",
    [householdId],
  );

test.describe("a back label while scanning", () => {
  test("front, then the back, then add: both go on the bottles; a failed save is retried", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "kback");
    const { call } = await apiClient(request, email);
    await scanToDetails(page, call, 1);
    await backPhoto(page);
    await expect(
      page.getByTestId("scan-labels").getByRole("img", { name: "Back label" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("scan-labels").getByRole("img", { name: "Front label" }),
    ).toBeVisible();

    // The first attempt to put it on the wine fails: the bottles are in anyway, and it can be tried again.
    let failed = false;
    await page.route("**/api/v1/cellar/*/photo", async (route) => {
      if (!failed) {
        failed = true;
        return route.fulfill({ status: 503, body: "{}" });
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    const result = page.getByTestId("back-label-result");
    await expect(result).toHaveAttribute("data-state", "failed");
    expect(await images(householdId)).toHaveLength(1);
    await result.getByRole("button", { name: "Try again" }).click();
    await expect(result).toHaveAttribute("data-state", "saved");
    // The retry reused the photo already uploaded: one back photo kept, not two.
    expect(
      await sql("select 1 from public.bottle_images where household_id = $1 and side = 'back'", [
        householdId,
      ]),
    ).toHaveLength(1);
    const [row] = await images(householdId);
    expect(row!.front).toBeTruthy();
    expect(row!.back).toBeTruthy();
    expect(row!.back).not.toBe(row!.front);
  });

  test("leaving the scan with a back photo taken uploads nothing", async ({ page, request }) => {
    const { email, householdId } = await arrive(page, "kcancel");
    const { call } = await apiClient(request, email);
    await scanToDetails(page, call, 2);
    await backPhoto(page);
    await page.goto("/");
    expect(
      await sql("select 1 from public.bottle_images where household_id = $1 and side = 'back'", [
        householdId,
      ]),
    ).toHaveLength(0);
  });
});

test.describe("friend activity on Home", () => {
  test("an invitation and a recommendation both show; answering one leaves the other; seeing it clears Home", async ({
    page,
    browser,
    request,
  }) => {
    const anna = await arrive(page, "kanna");
    const uid = async (email: string) =>
      (await sql<{ id: string }>("select id from auth.users where email = $1", [email]))[0]!.id;
    const annaId = await uid(anna.email);
    const others: Array<{ email: string; call: Call; close: () => Promise<void> }> = [];
    for (const who of ["kbram", "kcas"]) {
      const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
      const p = await context.newPage();
      const me = await arrive(p, who);
      others.push({
        email: me.email,
        call: (await apiClient(request, me.email)).call,
        close: () => context.close(),
      });
    }
    const [bram, cas] = others as [(typeof others)[0], (typeof others)[0]];
    const { call: annaCall } = await apiClient(request, anna.email);

    // Cas becomes Anna's friend and recommends her a wine; Bram asks to be her friend.
    await cas.call("post", "/friends", { userId: annaId }, 200).catch(() => undefined);
    await annaCall("post", "/friends", { userId: await uid(cas.email) });
    const wine = (await cas.call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    const added = (
      await cas.call<{ vintageId: string }>(
        "post",
        "/bottles",
        { wineId: wine.id, year: 2019, quantity: 1 },
        201,
      )
    ).body;
    await cas.call("post", "/recommendations", {
      vintageId: added.vintageId,
      friendIds: [annaId],
      note: "",
    });
    await bram.call("post", "/friends", { userId: annaId });

    await page.goto("/");
    const activity = page.getByTestId("friend-activity");
    await expect(activity).toBeVisible();
    await expect(activity).toContainText("wants to be friends");
    await expect(activity).toContainText("recommends Domaine Test Chablis Premier Cru 2019");
    await expect(activity.getByRole("heading")).toContainText("2");

    // Accept right here: the invitation goes, the recommendation stays.
    await activity.getByRole("button", { name: "Accept" }).click();
    await expect(activity).not.toContainText("wants to be friends");
    await expect(activity).toContainText("recommends");

    // Opening it marks it seen: back on Home, nothing is left.
    await activity.getByTestId("new-recommendations").click();
    await expect(page).toHaveURL(/\/friends#recommendations/);
    await expect(page.getByTestId("recommendations")).toContainText("Chablis Premier Cru");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("friend-activity")).toHaveCount(0);
    for (const o of others) await o.close();
  });
});

test.describe("a back label is never silently replaced", () => {
  test("two members saving one at the same moment: exactly one goes on, the other is told there is one", async ({
    page,
    browser,
    request,
  }) => {
    const anna = await arrive(page, "kbackrace");
    const annaToken = await sessionToken(anna.email);
    const { call } = await apiClient(request, anna.email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    const { vintageId } = (
      await call<{ vintageId: string }>(
        "post",
        "/bottles",
        { wineId: wine.id, year: 2019, quantity: 2 },
        201,
      )
    ).body;
    const invite = (await (
      await api(request, annaToken, "post", `/households/${anna.householdId}/invites`, {})
    ).json()) as { code: string };
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const bram = await arrive(await context.newPage(), "kbackrace2");
    const bramToken = await sessionToken(bram.email);
    expect(
      (await api(request, bramToken, "post", "/households/join", { code: invite.code })).ok(),
    ).toBe(true);
    await api(request, bramToken, "put", "/households/active", { householdId: anna.householdId });

    const upload = async (token: string, words: string) => {
      const photo = await makeJpeg(page, { width: 500, height: 700, words });
      const res = await request.post("/api/v1/images", {
        headers: bearer(token),
        multipart: {
          photo: { name: "b.jpg", mimeType: "image/jpeg", buffer: photo },
          thumb: { name: "t.jpg", mimeType: "image/jpeg", buffer: photo },
          side: "back",
        },
      });
      expect(res.ok()).toBe(true);
      return ((await res.json()) as { id: string }).id;
    };
    const [a, b] = [await upload(annaToken, "Anna"), await upload(bramToken, "Bram")];
    const put = (token: string, imageId: string) =>
      api(request, token, "put", `/cellar/${vintageId}/photo`, {
        imageId,
        side: "back",
        onlyIfEmpty: true,
      }).then(async (r) => ((await r.json()) as { attached: boolean }).attached);
    const results = await Promise.all([put(annaToken, a), put(bramToken, b)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const backs = await sql<{ back: string }>(
      "select distinct back_image_id as back from public.bottles where vintage_id = $1",
      [vintageId],
    );
    expect(backs).toEqual([{ back: results[0] ? a : b }]);

    // Replacing it on purpose (after "Replace it") still works.
    const replaced = await api(request, bramToken, "put", `/cellar/${vintageId}/photo`, {
      imageId: results[0] ? b : a,
      side: "back",
    });
    expect(((await replaced.json()) as { attached: boolean }).attached).toBe(true);
    await context.close();
  });
});

test.describe("a back label in a series", () => {
  test("a failed save stays listed with its own wine and can be retried after the next bottle", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "kbackseries");
    const { call } = await apiClient(request, email);
    await call("post", "/storage", { label: "Fridge", kind: "fridge", rows: 3, cols: 4 }, 201);
    await call(
      "post",
      "/wines",
      {
        producer: "Domaine Kappa",
        name: "Les Deux Faces",
        type: "red",
        countryCode: "FR",
        region: "Bourgogne",
      },
      201,
    );
    const sizes = [sizeFor(7), sizeFor(8)];
    for (const [i, size] of sizes.entries())
      await fetch(`${STACK}/__test/openai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...size, content: { ...label, vintage: i === 0 ? 2018 : 2019 } }),
      });

    await page.goto("/scan");
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: "Batch" }).click();
    await page.locator('input[type="file"]:not([capture])').setInputFiles([
      {
        name: "a.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, { ...sizes[0]!, words: "A" }),
      },
      {
        name: "b.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, { ...sizes[1]!, words: "B" }),
      },
    ]);
    const tray = page.getByTestId("series");
    await expect(tray.locator('li[data-status="ready"]')).toHaveCount(2, { timeout: 15_000 });

    // First bottle (2018) with a back label whose save fails once.
    let failed = false;
    await page.route("**/api/v1/cellar/*/photo", async (route) => {
      if (!failed) {
        failed = true;
        return route.fulfill({ status: 503, body: "{}" });
      }
      return route.continue();
    });
    await tray.getByRole("button", { name: "Add", exact: true }).first().click();
    await backPhoto(page);
    await page.getByRole("button", { name: /^Add 1 bottle/ }).click();
    const retries = page.getByTestId("back-retries");
    await expect(retries.getByTestId("back-retry")).toHaveCount(1);
    await expect(retries).toContainText("Les Deux Faces 2018");

    // The series goes on: the next bottle (2019) is added without a back label.
    await page.getByRole("button", { name: /^Add 1 bottle/ }).click();
    await expect(page.getByTestId("series-counts")).toHaveText(/2 added/);

    // Retried now, it goes on the 2018 bottles, never the 2019 ones.
    await retries.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("back-retries")).toHaveCount(0);
    const rows = await sql<{ year: number; back: boolean }>(
      `select v.year, b.back_image_id is not null as back from public.bottles b
        join public.wine_vintages v on v.id = b.vintage_id where b.household_id = $1 order by v.year`,
      [householdId],
    );
    expect(rows).toEqual([
      { year: 2018, back: true },
      { year: 2019, back: false },
    ]);
  });
});
