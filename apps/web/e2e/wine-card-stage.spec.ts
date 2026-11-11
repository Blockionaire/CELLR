import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, audit, makeJpeg } from "./helpers";
import { makeRealisticBottlePng, publishArtSized } from "./hero-art";

/**
 * A wine card's 2D bottle stands on CELLR's burgundy (a warm glow, darker edges), in both themes, on Home's shelves
 * and in the cellar's grid and list; a label photo and the drawn bottle keep their own look, and the card still opens
 * the wine's page.
 */
const BURGUNDY = "rgb(122, 38, 56)"; // --art-wine-hi, in the stage's gradient

async function furnish(page: Page, request: Parameters<typeof apiClient>[0], who: string) {
  const { email } = await arrive(page, who);
  const { call, token } = await apiClient(request, email);
  const add = async (name: string, type: string) => {
    const w = (
      await call<{ id: string }>(
        "post",
        "/wines",
        { producer: `Domaine ${name}`, name, type, countryCode: "FR" },
        201,
      )
    ).body;
    await call(
      "post",
      "/bottles",
      { wineId: w.id, year: 2018, quantity: 1, locationId: null },
      201,
    );
    return w.id;
  };
  const photoWine = await add("Photo Label", "red");
  const photo = await makeJpeg(page, { width: 600, height: 800, words: "LABEL" });
  const stored = (await (
    await request.post("/api/v1/images", {
      headers: { authorization: `Bearer ${token}` },
      multipart: {
        photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: photo },
        thumb: { name: "t.jpg", mimeType: "image/jpeg", buffer: photo },
        side: "front",
        blurColor: "#7d2234",
      },
    })
  ).json()) as { id: string };
  await add("Drawn Only", "rose");
  // a dark and a pale bottle, each with a library-sized 2D picture
  await publishArtSized(
    await add("Dark Bordeaux", "red"),
    await makeRealisticBottlePng(page, "bordeaux"),
    1024,
    1536,
  );
  await publishArtSized(
    await add("Pale Riesling", "white"),
    await makeRealisticBottlePng(page, "flute"),
    1024,
    1536,
  );
  const cellar = (
    await call<{ items: Array<{ vintageId: string; wineId: string; wineName: string }> }>(
      "get",
      "/cellar",
    )
  ).body;
  const photoVintage = cellar.items.find((i) => i.wineId === photoWine)!.vintageId;
  await call("put", `/cellar/${photoVintage}/photo`, { imageId: stored.id }, 200);
  return Object.fromEntries(cellar.items.map((i) => [i.wineName, i.vintageId]));
}

/** A tap in the middle of a card's picture, as a finger would (the card's link covers the picture). */
async function tap(page: Page, picture: ReturnType<Page["locator"]>) {
  await expect(picture).toBeVisible();
  const box = (await picture.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** The picture of one wine's card (by its name), wherever the card is. */
const pictureOf = (scope: ReturnType<Page["locator"]>, name: string) =>
  scope
    .locator("article")
    .filter({ hasText: name })
    .locator("[data-art], [data-photo], div")
    .first();

for (const scheme of ["dark", "light"] as const)
  test(`the 2D bottle on wine cards stands on the burgundy stage (${scheme}); photos and drawn bottles are unchanged`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    const ids = await furnish(page, request, `stage${scheme}`);

    // Home: the shelf of what was added lately
    await page.goto("/");
    const shelf = page.getByRole("region", { name: "Recently added" });
    for (const name of ["Dark Bordeaux", "Pale Riesling"]) {
      const art = shelf.locator("article").filter({ hasText: name }).locator('[data-art="true"]');
      await expect(art).toHaveAttribute("data-stage", "wine");
      expect(await art.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain(BURGUNDY);
      // the bottle whole, never stretched
      const img = art.locator("img");
      await expect(img).toHaveJSProperty("complete", true);
    }
    // a label photo and a drawn bottle keep their own look (no wine stage)
    await expect(
      shelf.locator("article").filter({ hasText: "Photo Label" }).locator('[data-photo="true"]'),
    ).toBeVisible();
    await expect(shelf.locator('[data-stage="wine"]')).toHaveCount(2);
    expect(await audit(page)).toEqual([]);
    // the card still opens the wine's page
    await tap(
      page,
      shelf.locator("article").filter({ hasText: "Dark Bordeaux" }).locator('[data-art="true"]'),
    );
    await expect(page).toHaveURL(new RegExp(`/cellar/${ids["Dark Bordeaux"]}$`));

    // the cellar's grid: same card sizes for every kind of picture (no layout change)
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "Grid" }).click();
    const grid = page.locator("main");
    const sizes: Array<{ w: number; h: number }> = [];
    for (const name of ["Dark Bordeaux", "Pale Riesling", "Photo Label", "Drawn Only"]) {
      const box = (await pictureOf(grid, name).boundingBox())!;
      sizes.push({ w: Math.round(box.width), h: Math.round(box.height) });
    }
    expect(new Set(sizes.map((s) => `${s.w}x${s.h}`)).size).toBe(1);
    await expect(grid.locator('[data-stage="wine"]')).toHaveCount(2);
    await expect(grid.locator('[data-photo="true"]')).toHaveCount(1);
    await tap(
      page,
      grid.locator("article").filter({ hasText: "Pale Riesling" }).locator('[data-art="true"]'),
    );
    await expect(page).toHaveURL(new RegExp(`/cellar/${ids["Pale Riesling"]}$`));

    // the list: the small picture too, and the row opens the page
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "List" }).click();
    const list = page.locator("main");
    await expect(list.locator('[data-stage="wine"]')).toHaveCount(2);
    expect(
      await list
        .locator('[data-stage="wine"]')
        .first()
        .evaluate((e) => getComputedStyle(e).backgroundImage),
    ).toContain(BURGUNDY);
    await list.getByRole("link", { name: "Dark Bordeaux" }).click();
    await expect(page).toHaveURL(new RegExp(`/cellar/${ids["Dark Bordeaux"]}$`));
  });
