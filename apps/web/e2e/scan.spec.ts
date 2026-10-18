import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, audit, makeJpeg, sql, STACK } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

const label = (over: Record<string, unknown> = {}) => ({
  is_wine_label: true,
  producer: "Château Margaux",
  wine_name: "Pavillon Rouge",
  vintage: 2015,
  non_vintage: false,
  wine_type: "red",
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Margaux",
  grapes: [],
  abv_percent: 13.5,
  volume_ml: 750,
  text_seen: "CHATEAU MARGAUX PAVILLON ROUGE 2015",
  confidence: { producer: "high", wine_name: "high", vintage: "high" },
  ...over,
});

/** Each test's photo has a size nobody else uses: that is how the fake model knows which answer to give. */
let counter = 0;
const uniqueSize = () => {
  counter += 1;
  const worker = test.info().parallelIndex;
  return {
    width: 410 + worker * 41 + counter * 3 + (Date.now() % 89),
    height: 540 + counter * 7 + worker * 13,
  };
};
async function program(
  size: { width: number; height: number },
  plan: { content?: unknown; sequence?: unknown[]; status?: number },
) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...size, ...plan }),
  });
  expect(res.ok).toBe(true);
}

async function furnish(page: Page, request: Parameters<typeof apiClient>[0], who: string) {
  const { email, householdId } = await arrive(page, who);
  const { call } = await apiClient(request, email);
  await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 3, cols: 4 }, 201);
  return { email, householdId, call };
}

/** Takes a photo: the first file chooser on the page is the camera one. */
const takePhoto = async (page: Page, photo: Buffer, name = "IMG_0001.jpg") =>
  page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name, mimeType: "image/jpeg", buffer: photo });

test.describe("scanning a label", () => {
  test("a wine you already have: we find it, you say how many and where, and the photo goes with the bottles", async ({
    page,
    request,
  }) => {
    const { householdId, call } = await furnish(page, request, "scanfound");
    await call(
      "post",
      "/wines",
      {
        producer: "Château Margaux",
        name: "Pavillon Rouge",
        type: "red",
        countryCode: "FR",
        region: "Bordeaux",
      },
      201,
    );
    const size = uniqueSize();
    await program(size, { content: label({ producer: "CHATEAU MARGAUX" }) });

    await page.goto("/scan");
    await expect(page.getByRole("heading", { level: 1, name: "Scan a label" })).toBeVisible();
    await expect(page.getByText(/sent to our AI partner/)).toBeVisible();
    await page.screenshot({ path: shot(`scan-capture-${project()}`), fullPage: true });

    await takePhoto(page, await makeJpeg(page, { ...size, exif: true, words: "Margaux" }));
    await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible();
    await expect(page.getByText("Pavillon Rouge", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Your photo of the label" })).toBeVisible();
    await page.screenshot({ path: shot(`scan-found-${project()}`), fullPage: true });

    await page.getByRole("button", { name: "Yes, add bottles" }).click();
    // The vintage on the label is already filled in.
    await expect(page.getByLabel("Vintage")).toHaveValue("2015");
    await page.getByRole("button", { name: "One more" }).click();
    await page.getByRole("button", { name: "Add 2 bottles" }).click();
    await expect(page.getByText(/2 bottles of Château Margaux Pavillon Rouge 2015/)).toBeVisible();
    await expect(page.getByText("In Wine fridge.")).toBeVisible();
    // The last step is the AI analysis: it ran by itself, so the card is there (written or, as here, offered again).
    await expect(page.getByTestId("added-profile")).toBeVisible();

    // The bottles carry the photo that was taken.
    const rows = await sql<{ n: string; images: string }>(
      `select count(*) as n, count(distinct front_image_id) as images from public.bottles
        where household_id = $1 and front_image_id is not null`,
      [householdId],
    );
    expect(rows[0]).toEqual({ n: "2", images: "1" });

    // …and it shows in the cellar.
    await page.goto("/cellar");
    await expect(page.locator("article img")).toHaveAttribute(
      "src",
      /\/api\/v1\/images\/[0-9a-f-]+\?size=thumb/,
    );
  });

  test("a new wine: what was read is filled in for you to check, and the kind of wine is never guessed", async ({
    page,
    request,
  }) => {
    const { householdId } = await furnish(page, request, "scannew");
    const size = uniqueSize();
    await program(size, {
      content: label({
        producer: "Bollinger",
        wine_name: "Special Cuvée",
        vintage: null,
        non_vintage: true,
        wine_type: null,
        country_code: "FR",
        region: "Champagne",
        confidence: { producer: "high", wine_name: "medium", vintage: "low" },
      }),
    });
    await page.goto("/scan");
    await takePhoto(page, await makeJpeg(page, size));
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    await expect(
      page.getByText("Parts of this label were hard to read. Please check the details."),
    ).toBeVisible();
    await expect(
      page.getByText("We couldn’t tell the kind of wine from the label. Choose it below."),
    ).toBeVisible();
    await expect(page.getByLabel("Producer")).toHaveValue("Bollinger");
    await expect(page.getByLabel("Wine name")).toHaveValue("Special Cuvée");
    await expect(page.getByLabel("Country")).toHaveValue("FR");
    await expect(page.getByLabel("Region")).toHaveValue("Champagne");
    await page.screenshot({ path: shot(`scan-new-${project()}`), fullPage: true });

    // The colour or style was not clear from the label, so the form will not go on until it is chosen.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Which kind of wine is it? Choose one above.")).toBeVisible();
    await page.getByRole("button", { name: "Sparkling" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // Non-vintage was read off the label, so the vintage step starts as "NV".
    await expect(
      page.getByRole("heading", { level: 1, name: "How many, and where?" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "NV", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText(/1 bottle of Bollinger Special Cuvée NV/)).toBeVisible();

    const [wine] = await sql<{
      name: string;
      wine_type: string;
      country_code: string;
      region: string;
    }>(
      `select w.name, w.wine_type, w.country_code, w.region from public.wines w
         join public.wine_vintages v on v.wine_id = w.id
         join public.bottles b on b.vintage_id = v.id where b.household_id = $1`,
      [householdId],
    );
    expect(wine).toEqual({
      name: "Special Cuvée",
      wine_type: "sparkling",
      country_code: "FR",
      region: "Champagne",
    });
  });

  test("when it is unsure it shows the wines it could be, and 'none of these' leads to a new wine", async ({
    page,
    request,
  }) => {
    const { call } = await furnish(page, request, "scanchoose");
    for (const [name, type] of [
      ["Pavillon Rouge", "red"],
      ["Pavillon Blanc", "white"],
    ] as const)
      await call(
        "post",
        "/wines",
        { producer: "Château Margaux", name, type, countryCode: "FR" },
        201,
      );
    const size = uniqueSize();
    await program(size, {
      content: label({ wine_name: null, appellation: null, region: null, wine_type: null }),
    });
    await page.goto("/scan");
    await takePhoto(page, await makeJpeg(page, size));
    await expect(page.getByRole("heading", { name: "Is it one of these?" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pavillon Rouge/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pavillon Blanc/ })).toBeVisible();
    await page.screenshot({ path: shot(`scan-choose-${project()}`), fullPage: true });

    await page.getByRole("button", { name: /Pavillon Blanc/ }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "How many, and where?" }),
    ).toBeVisible();
    await expect(page.getByText("Pavillon Blanc")).toBeVisible();
    // Going back to change the wine returns to the choices, not to the camera.
    await page.getByRole("button", { name: "Change" }).click();
    await expect(page.getByRole("heading", { name: "Is it one of these?" })).toBeVisible();
    await page.getByRole("button", { name: "None of these: it is a new wine" }).click();
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
  });

  test("when the AI is down the photo is still kept and the form is waiting beside it", async ({
    page,
    request,
  }) => {
    const { householdId } = await furnish(page, request, "scandown");
    const size = uniqueSize();
    await program(size, { status: 500 });
    await page.goto("/scan");
    await takePhoto(page, await makeJpeg(page, size));
    await expect(page.getByRole("heading", { name: "Fill it in yourself" })).toBeVisible();
    await expect(
      page.getByText(/We couldn’t read this label just now\. Your photo is saved/),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "Your photo of the label" })).toBeVisible();
    await expect(page.getByLabel("Producer")).toHaveValue("");
    await page.screenshot({ path: shot(`scan-down-${project()}`), fullPage: true });

    await page.getByLabel("Producer").fill("Domaine Test");
    await page.getByLabel("Wine name").fill("Cuvée Maison");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Vintage").fill("2020");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText(/1 bottle of Domaine Test Cuvée Maison 2020/)).toBeVisible();
    // Typed by hand, and still wearing the photo that was taken.
    const [row] = await sql<{ photo: boolean }>(
      "select front_image_id is not null as photo from public.bottles where household_id = $1",
      [householdId],
    );
    expect(row!.photo).toBe(true);
  });

  test("a picture that is not a label is said so; 'try another photo' starts again", async ({
    page,
    request,
  }) => {
    await furnish(page, request, "scannot");
    const size = uniqueSize();
    await program(size, {
      content: label({ is_wine_label: false, producer: null, wine_name: null }),
    });
    await page.goto("/scan");
    await takePhoto(page, await makeJpeg(page, size));
    await expect(page.getByText(/That doesn’t look like a wine label/)).toBeVisible();
    await page.getByRole("button", { name: "Try another photo" }).click();
    await expect(page.getByRole("button", { name: /Take a photo/ })).toBeVisible();
    await expect(page.getByText(/That doesn’t look like a wine label/)).toBeHidden();
  });

  test("a dropped connection keeps the photo: 'try again' sends the same one", async ({
    page,
    request,
  }) => {
    await furnish(page, request, "scannet");
    const size = uniqueSize();
    await program(size, { content: label() });
    await page.goto("/scan");
    let dropped = false;
    await page.route("**/api/v1/scans", async (route) => {
      if (!dropped) {
        dropped = true;
        return route.abort("connectionreset");
      }
      return route.continue();
    });
    await takePhoto(page, await makeJpeg(page, size));
    await expect(page.getByText(/No connection\. Your photo is still here/)).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    expect(dropped).toBe(true);
  });

  test("something that is not a picture is explained before anything is sent", async ({
    page,
    request,
  }) => {
    await furnish(page, request, "scannope");
    let sent = 0;
    await page.route("**/api/v1/scans", (route) => {
      sent += 1;
      return route.continue();
    });
    await page.goto("/scan");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "notes.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("just some words"),
      });
    await expect(page.getByText("We couldn’t open that photo. Try another one.")).toBeVisible();
    expect(sent).toBe(0);
  });

  test("a big phone photo is shrunk on the phone, and what the camera wrote into it never leaves", async ({
    page,
    request,
  }) => {
    const { householdId } = await furnish(page, request, "scanbig");
    // 4000 × 3000 becomes 1600 × 1200 before it is sent: that is the size the fake model is asked about.
    await program({ width: 1600, height: 1200 }, { content: label() });
    await page.goto("/scan");
    await takePhoto(page, await makeJpeg(page, { width: 4000, height: 3000, exif: true }));
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    const [image] = await sql<{ width: number; height: number }>(
      "select width, height from public.bottle_images where household_id = $1",
      [householdId],
    );
    expect(image).toEqual({ width: 1600, height: 1200 });
  });

  test("the scan screens are accessible in both themes", async ({ page, request }) => {
    const { call } = await furnish(page, request, "scana11y");
    await call(
      "post",
      "/wines",
      { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" },
      201,
    );
    await page.goto("/scan");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
    const size = uniqueSize();
    await program(size, { content: label() });
    await takePhoto(page, await makeJpeg(page, size));
    await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
    await page.getByRole("button", { name: "Not this one" }).click();
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
  });
});

test.describe("several bottles in a row", () => {
  test("photos are read in the background while you go on; each is added in turn, and the next one opens by itself", async ({
    page,
    request,
  }) => {
    const { householdId, call } = await furnish(page, request, "series");
    await call(
      "post",
      "/wines",
      {
        producer: "Château Margaux",
        name: "Pavillon Rouge",
        type: "red",
        countryCode: "FR",
        region: "Bordeaux",
      },
      201,
    );
    const first = uniqueSize();
    const second = uniqueSize();
    await program(first, { content: label() });
    await program(second, { content: label({ vintage: 2016 }) });

    await page.goto("/scan");
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: "Several in a row" }).click();
    // Two photos picked from the library at once.
    await page.locator('input[type="file"]:not([capture])').setInputFiles([
      { name: "a.jpg", mimeType: "image/jpeg", buffer: await makeJpeg(page, first) },
      { name: "b.jpg", mimeType: "image/jpeg", buffer: await makeJpeg(page, second) },
    ]);
    const tray = page.getByTestId("series");
    await expect(tray.locator('li[data-status="ready"]')).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText("0 of 2 done")).toBeVisible();
    await page.screenshot({ path: shot(`series-tray-${project()}`), fullPage: true });

    await tray.getByRole("button", { name: "Add" }).first().click();
    await page.getByRole("button", { name: "Yes, add bottles" }).click();
    await page.getByRole("button", { name: /^Add 1 bottle/ }).click();
    await expect(
      page.getByText(/Added 1 bottle of Château Margaux Pavillon Rouge/).first(),
    ).toBeVisible();

    // Straight on to the next photo, without going back first.
    await page.getByRole("button", { name: "Yes, add bottles" }).click();
    await page.getByRole("button", { name: /^Add 1 bottle/ }).click();
    await expect(page.getByText("2 of 2 done")).toBeVisible();

    const rows = await sql<{ year: number }>(
      `select v.year from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
        where b.household_id = $1 order by v.year`,
      [householdId],
    );
    expect(rows.map((r) => r.year)).toEqual([2015, 2016]);
    expect(await audit(page)).toEqual([]);
  });
});
