import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, audit, makeJpeg, sql } from "./helpers";
import { makeBottlePng, publishArt } from "./hero-art";

/**
 * Home's Tonight hero: compact, one action ("Help me choose" → Tonight), no question chips, and beside it only the
 * cellar's own published 2D bottle pictures (never a photo). Without a picture it keeps an empty place for one when
 * the server invites bottle photos for a wine (opening the same photo sheet), and nothing otherwise.
 */
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const project = () => test.info().project.name;
const shot = (name: string) => `test-results/shots/home-hero-${name}-${project()}.png`;

/** A wine of the household with one bottle; returns its ids. */
async function wine(call: Call, name: string, type = "red") {
  const w = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { producer: `Domaine ${name}`, name, type, countryCode: "FR", region: "Bordeaux" },
      201,
    )
  ).body;
  await call("post", "/bottles", { wineId: w.id, year: 2018, quantity: 1, locationId: null }, 201);
  const [v] = await sql<{ id: string }>("select id from public.wine_vintages where wine_id = $1", [
    w.id,
  ]);
  return { wineId: w.id, vintageId: v!.id };
}

/** No wine of this household is invited for photos any more ("Not now", as the card's button does). */
const dismissInvite = (call: Call) => call("delete", "/bottle-photos/invite");

/** The hero's essentials: no chip row, the one link to Tonight, nothing overlapping the text or the button. */
async function expectCompactHero(page: Page) {
  const hero = page.getByTestId("tonight-hero");
  await expect(hero.getByRole("heading", { name: "What should we drink tonight?" })).toBeVisible();
  await expect(hero.getByRole("navigation")).toHaveCount(0);
  await expect(
    hero.getByRole("link", { name: /Steak tonight|Pasta with tomato sauce/ }),
  ).toHaveCount(0);
  const links = hero.getByRole("link");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "/tonight");
  return hero;
}

/** Two boxes overlap (by more than a hair). */
const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  a.x < b.x + b.width - 1 &&
  b.x < a.x + a.width - 1 &&
  a.y < b.y + b.height - 1 &&
  b.y < a.y + a.height - 1;

test.describe("Home's Tonight hero", () => {
  test("one 2D bottle of the cellar on a phone, two on a wide screen; never a photo; the CTA opens Tonight", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const { email } = await arrive(page, "heroart");
    const { call, token } = await apiClient(request, email);
    // the oldest wine has a label photo but no picture: it must never appear in the hero
    const photoWine = await wine(call, "Photo Only");
    const photo = await makeJpeg(page, { width: 600, height: 800, words: "PHOTO" });
    const stored = (await (
      await request.post("/api/v1/images", {
        headers: { authorization: `Bearer ${token}` },
        multipart: {
          photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
          thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: photo },
          side: "front",
          blurColor: "#7d2234",
        },
      })
    ).json()) as { id: string };
    await call("put", `/cellar/${photoWine.vintageId}/photo`, { imageId: stored.id }, 200);
    const older = await wine(call, "Older Art");
    const newer = await wine(call, "Newer Art", "white");
    const artOlder = await publishArt(
      older.wineId,
      await makeBottlePng(page, "#1d2a1e", "#e8dcc4"),
    );
    const artNewer = await publishArt(
      newer.wineId,
      await makeBottlePng(page, "#c9b46a", "#f2ead8"),
    );

    await page.goto("/");
    const hero = await expectCompactHero(page);
    // no window of their own: the newest with a picture is the one in front
    const bottles = hero.getByTestId("hero-bottle");
    await expect(bottles).toHaveCount(2);
    await expect(bottles.last()).toHaveAttribute("data-vintage-id", newer.vintageId);
    await expect(bottles.last().locator("img")).toHaveAttribute(
      "src",
      `/api/v1/bottle-art/${artNewer}`,
    );
    await expect(bottles.first().locator("img")).toHaveAttribute(
      "src",
      `/api/v1/bottle-art/${artOlder}`,
    );
    const wide = project() === "desktop";
    await expect(bottles.last()).toBeVisible();
    await expect(bottles.first()).toBeVisible({ visible: wide });
    // never a photo, never the drawn fallback, no photo frame
    await expect(hero.locator(`img[src*="/api/v1/images/"]`)).toHaveCount(0);
    await expect(hero.locator('[data-photo="true"], [data-art="true"]')).toHaveCount(0);
    await expect(hero.getByTestId("hero-photo-slot")).toHaveCount(0);

    // the bottle stands whole beside the text and the button, never over them
    await expect(bottles.last().locator("img")).toHaveJSProperty("complete", true);
    const bottle = (await bottles.last().boundingBox())!;
    const heroBox = (await hero.boundingBox())!;
    for (const part of [
      hero.getByRole("heading", { name: "What should we drink tonight?" }),
      hero.getByText("Tell me what you're eating and I'll choose from your own cellar."),
      hero.getByTestId("tonight-cta"),
    ])
      expect(overlaps(bottle, (await part.boundingBox())!)).toBe(false);
    expect(bottle.y).toBeGreaterThanOrEqual(heroBox.y);
    expect(bottle.y + bottle.height).toBeLessThanOrEqual(heroBox.y + heroBox.height);
    expect(bottle.x + bottle.width).toBeLessThanOrEqual(heroBox.x + heroBox.width);
    // compact: the hero is well under its old height (341px on a phone, 321px on a desktop, with the chips)
    const height = heroBox.height;
    console.log(`${project()} hero height with art: ${height}px`);
    expect(height).toBeLessThanOrEqual(project() === "phone" ? 270 : 330);
    await hero.screenshot({ path: shot("art") });
    expect(await audit(page)).toEqual([]);

    // the one action: Tonight
    await hero.getByTestId("tonight-cta").click();
    await expect(page).toHaveURL(/\/tonight$/);
    // and the rest of the card leads there too (it is the same link, stretched)
    await page.goto("/");
    await expect(page.getByTestId("tonight-hero")).toBeVisible();
    const box = (await page.getByTestId("tonight-hero").boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + 14);
    await expect(page).toHaveURL(/\/tonight$/);
  });

  test("no picture yet, a wine invited for photos: an empty bottle place opens the same photo sheet, and the card steps aside", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const { email } = await arrive(page, "heroslot");
    const { call } = await apiClient(request, email);
    await wine(call, "Waiting Picture");

    await page.goto("/");
    const hero = await expectCompactHero(page);
    await expect(hero.getByTestId("hero-bottle")).toHaveCount(0);
    const slot = hero.getByRole("button", {
      name: "Add bottle photos of Domaine Waiting Picture Waiting Picture",
    });
    await expect(slot).toBeVisible();
    // the invitation is not shown twice
    await expect(page.getByTestId("bottle-photo-invite")).toHaveCount(0);
    const slotBox = (await slot.boundingBox())!;
    expect(slotBox.width).toBeGreaterThanOrEqual(44);
    expect(slotBox.height).toBeGreaterThanOrEqual(44);
    expect(overlaps(slotBox, (await hero.getByTestId("tonight-cta").boundingBox())!)).toBe(false);
    await hero.screenshot({ path: shot("slot") });
    expect(await audit(page)).toEqual([]);

    // its own action: the photo sheet for that wine, not Tonight
    await slot.click();
    const sheet = page.getByRole("dialog", { name: "A photo of the bottle" });
    await expect(sheet).toContainText("Domaine Waiting Picture Waiting Picture");
    await expect(page).toHaveURL(/\/$/);
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    // by keyboard too
    await slot.focus();
    await page.keyboard.press("Enter");
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");

    // "Not now" (from anywhere) is respected: no invitation, no empty place, the hero stays clean
    await dismissInvite(call);
    await page.reload();
    const clean = await expectCompactHero(page);
    await expect(clean.getByTestId("hero-photo-slot")).toHaveCount(0);
    await expect(clean.getByTestId("hero-bottles")).toHaveCount(0);
    await expect(page.getByTestId("bottle-photo-invite")).toHaveCount(0);
    await clean.screenshot({ path: shot("clean") });
  });

  test("with pictures in the cellar, the photo invitation stays the card below (once), never in the hero", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "herocard");
    const { call } = await apiClient(request, email);
    await wine(call, "No Picture");
    const pictured = await wine(call, "Has Picture");
    await publishArt(pictured.wineId, await makeBottlePng(page, "#4a1020", "#efe4cc"));
    await page.goto("/");
    const hero = await expectCompactHero(page);
    await expect(hero.getByTestId("hero-bottle")).toHaveCount(1);
    await expect(hero.getByTestId("hero-photo-slot")).toHaveCount(0);
    await expect(page.getByTestId("bottle-photo-invite")).toHaveCount(1);
    await expect(page.getByTestId("bottle-photo-invite")).toContainText("No Picture");
  });

  test("an empty cellar keeps its own hero: no bottles, no photo place", async ({ page }) => {
    await arrive(page, "heroempty");
    await page.goto("/");
    const hero = await expectCompactHero(page);
    await expect(
      hero.getByText("Add a few bottles and I'll help you decide what to open."),
    ).toBeVisible();
    await expect(hero.getByTestId("hero-bottles")).toHaveCount(0);
    await expect(hero.getByTestId("hero-photo-slot")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your cellar starts here." })).toBeVisible();
    await expect(page.getByTestId("bottle-photo-invite")).toHaveCount(0);
    await hero.screenshot({ path: shot("empty") });
  });
});
