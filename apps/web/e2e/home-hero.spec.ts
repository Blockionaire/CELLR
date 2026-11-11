import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { apiClient, arrive, audit, makeJpeg, sql } from "./helpers";
import {
  makeBottlePng,
  makeRealisticBottlePng,
  publishArt,
  publishArtSized,
  webkitFriendly,
  type BottleShape,
} from "./hero-art";

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
  test.beforeEach(async ({ page }) => webkitFriendly(page));

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
    // the library's picture, made clean in this tab (a blob), never another address
    const front = bottles.last().getByTestId("hero-art");
    await expect(front).toHaveAttribute("data-art-id", artNewer);
    await expect(front).toHaveAttribute("src", /^blob:/);
    const wide = project() === "desktop";
    await expect(bottles.last()).toBeVisible();
    await expect(bottles.first()).toBeVisible({ visible: wide });
    // the second bottle is for wide screens: a phone never even fetches it
    if (wide)
      await expect(bottles.first().getByTestId("hero-art")).toHaveAttribute(
        "data-art-id",
        artOlder,
      );
    else await expect(bottles.first().getByTestId("hero-art")).toHaveCount(0);
    // never a photo, never the drawn fallback, no photo frame
    await expect(hero.locator(`img[src*="/api/v1/images/"]`)).toHaveCount(0);
    await expect(hero.locator('[data-photo="true"], [data-art="true"]')).toHaveCount(0);
    await expect(hero.getByTestId("hero-photo-slot")).toHaveCount(0);

    // the bottle stands whole beside the text and the button, never over them
    await expect(front).toHaveJSProperty("complete", true);
    const bottle = (await front.boundingBox())!;
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
    expect(height).toBeLessThanOrEqual(project() === "desktop" ? 330 : 270);
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

  for (const width of [375, 390, 430])
    test.describe(`on a ${width}px phone`, () => {
      test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
      for (const shape of ["flute", "bordeaux"] as BottleShape[])
        test(`a real-proportioned ${shape} stands large, whole and clear of the edge, in a compact hero`, async ({
          page,
          request,
        }) => {
          test.skip(project() === "desktop", "phone widths only");
          test.setTimeout(60_000);
          const { email } = await arrive(page, `hero${shape}${width}`);
          const { call } = await apiClient(request, email);
          const w = await wine(call, `Real ${shape}`, shape === "flute" ? "white" : "red");
          // a library-sized picture: a big transparent canvas, the bottle in real proportions, a shadow drawn in
          await publishArtSized(w.wineId, await makeRealisticBottlePng(page, shape), 1024, 1536);
          await page.goto("/");
          const hero = page.getByTestId("tonight-hero");
          const bottle = hero.getByTestId("hero-bottle");
          await expect(bottle).toHaveCount(1);
          const img = bottle.getByTestId("hero-art");
          await expect(img).toHaveJSProperty("complete", true);
          // measured once it has settled (the first time it fades in)
          await expect
            .poll(() =>
              hero.evaluate(
                (h) =>
                  h.getAnimations({ subtree: true }).filter((a) => a.playState === "running")
                    .length,
              ),
            )
            .toBe(0);
          const m = await hero.evaluate((h) => {
            const box = (sel: string) => h.querySelector(sel)!.getBoundingClientRect();
            const pic = h.querySelector<HTMLImageElement>('[data-testid="hero-art"]')!;
            const r = pic.getBoundingClientRect();
            return {
              hero: h.getBoundingClientRect().height,
              heroRight: h.getBoundingClientRect().right,
              heroTop: h.getBoundingClientRect().top,
              heroBottom: h.getBoundingClientRect().bottom,
              art: (({ x, y, width, height, right, bottom }) => ({
                x,
                y,
                width,
                height,
                right,
                bottom,
              }))(box('[data-testid="hero-art"]')),
              // the whole picture as drawn, against its own proportions: never stretched
              drawn: r.width / r.height,
              natural: pic.naturalWidth / pic.naturalHeight,
            };
          });
          console.log(`${width} ${shape}: ${JSON.stringify(m)}`);
          expect(Math.abs(m.drawn - m.natural) / m.natural).toBeLessThan(0.005);
          // prominent: most of the card's height, not a small sticker
          expect(m.art.height).toBeGreaterThanOrEqual(0.75 * m.hero);
          // clear of the card's edge, and inside the card
          expect(m.heroRight - m.art.right).toBeGreaterThanOrEqual(24);
          expect(m.art.y).toBeGreaterThanOrEqual(m.heroTop);
          expect(m.art.bottom).toBeLessThanOrEqual(m.heroBottom);
          // compact: about the height Sprint 002 gave it
          expect(m.hero).toBeLessThanOrEqual(250);
          // never over the words or the button
          for (const part of [
            hero.getByRole("heading", { name: "What should we drink tonight?" }),
            hero.getByText("Tell me what you're eating and I'll choose from your own cellar."),
            hero.getByTestId("tonight-cta"),
          ])
            expect(overlaps(m.art, (await part.boundingBox())!)).toBe(false);
          await hero.screenshot({ path: shot(`${shape}-${width}`) });
          await hero.getByTestId("tonight-cta").click();
          await expect(page).toHaveURL(/\/tonight$/);
        });
    });

  test("the picture is asked for once, with the page, and is back at once (no new request, no entrance) after Home → Cellar → Home five times", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const { email } = await arrive(page, "heronav");
    const { call, token } = await apiClient(request, email);
    const w = await wine(call, "Navigation Flute", "white");
    const artId = await publishArtSized(
      w.wineId,
      await makeRealisticBottlePng(page, "flute"),
      1024,
      1536,
    );
    // a household's own picture is never kept by the browser (unchanged): no-store
    const served = await request.get(`/api/v1/bottle-art/${artId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(served.status()).toBe(200);
    expect(served.headers()["cache-control"]).toBe("no-store");

    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes(`/api/v1/bottle-art/${artId}`)) asked.push(r.url());
    });
    await page.goto("/");
    const hero = page.getByTestId("tonight-hero");
    // the page itself asks for it first, ahead of other pictures
    // the page as the server sends it already asks for the picture, at high priority (a household's own picture,
    // never stored, as soon as its place is laid out: WebKit would otherwise download it twice)
    const html = await (await page.request.get("/")).text();
    const tag = html.match(/<img[^>]*data-testid="hero-art-source"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain(`src="/api/v1/bottle-art/${artId}"`);
    expect(tag).toMatch(/fetchPriority="high"|fetchpriority="high"/);
    expect(tag).toContain('loading="lazy"');
    expect(html).not.toMatch(new RegExp(`<link[^>]*rel="preload"[^>]*bottle-art/${artId}`));
    // the frame has its size before the picture is there, and keeps it after (nothing moves)
    const frame = hero.getByTestId("hero-bottle");
    await expect(frame).toBeVisible();
    const before = (await frame.boundingBox())!;
    const art = hero.getByTestId("hero-art");
    await expect(art).toBeVisible();
    await expect(art).toHaveJSProperty("complete", true);
    const after = (await frame.boundingBox())!;
    expect(after).toEqual(before);
    await page.waitForTimeout(300);
    expect(asked).toHaveLength(1);
    await hero.screenshot({ path: shot("nav-first") });

    const nav = page.getByRole("navigation", { name: "Main" });
    for (let i = 0; i < 5; i++) {
      await nav.getByRole("link", { name: "Cellar" }).click();
      await expect(page).toHaveURL(/\/cellar$/);
      await nav.getByRole("link", { name: "Home" }).click();
      await expect(page).toHaveURL(/:\d+\/$/);
      // in the very frame Home is drawn again, the bottle is there: no entrance, nothing animating, nothing asked
      const state = await page.evaluate(
        () =>
          new Promise<{ art: boolean; running: number }>((resolve) => {
            const look = () => {
              const hero = document.querySelector('[data-testid="tonight-hero"]');
              if (!hero) return requestAnimationFrame(look);
              const img = hero.querySelector<HTMLImageElement>('[data-testid="hero-art"]');
              resolve({
                art: Boolean(img && img.complete && img.naturalWidth > 0),
                running: hero
                  .getAnimations({ subtree: true })
                  .filter((a) => a.playState === "running").length,
              });
            };
            look();
          }),
      );
      expect(state).toEqual({ art: true, running: 0 });
    }
    expect(asked).toHaveLength(1);
    await hero.screenshot({ path: shot("nav-return") });

    // the same address is "not found" for anyone outside the household (nothing cached reaches them)
    const otherContext = await page
      .context()
      .browser()!
      .newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await otherContext.newPage();
    await webkitFriendly(otherPage);
    const other = await apiClient(request, (await arrive(otherPage, "heronavother")).email);
    await otherContext.close();
    expect(
      (
        await request.get(`/api/v1/bottle-art/${artId}`, {
          headers: { authorization: `Bearer ${other.token}` },
        })
      ).status(),
    ).toBe(404);
  });

  test("a picture with a faint veil over its background floats clean; an opaque one is not shown as a rectangle", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const { email } = await arrive(page, "heroveil");
    const { call } = await apiClient(request, email);
    const veiled = await wine(call, "Veiled Flute", "white");
    await publishArtSized(
      veiled.wineId,
      await makeRealisticBottlePng(page, "flute", "veil"),
      1024,
      1536,
    );
    await page.goto("/");
    const hero = page.getByTestId("tonight-hero");
    const art = hero.getByTestId("hero-art");
    await expect(art).toHaveJSProperty("complete", true);
    // the picture drawn: nothing at or below the outline's threshold is left (the veil is gone), corners empty
    const alpha = await art.evaluate(async (img: HTMLImageElement) => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let faint = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 0 && d[i]! <= 24) faint++;
      const corner = (x: number, y: number) => d[(y * c.width + x) * 4 + 3]!;
      return {
        faint,
        corners: [
          corner(0, 0),
          corner(c.width - 1, 0),
          corner(0, c.height - 1),
          corner(c.width - 1, c.height - 1),
        ],
      };
    });
    expect(alpha.faint).toBe(0);
    expect(alpha.corners).toEqual([0, 0, 0, 0]);
    // and on screen: just inside the picture's box, beside the bottle's neck, it is the card's own colour
    await page.waitForTimeout(400);
    const box = (await art.boundingBox())!;
    const shotBuf = await page.screenshot({
      clip: { x: box.x - 14, y: box.y + 4, width: 18, height: 6 },
    });
    const colours = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const px = (x: number) => [
        ...g.getImageData(x, Math.floor(c.height / 2), 1, 1).data.slice(0, 3),
      ];
      // outside the box (left) and inside it, beside the neck
      return { outside: px(1), inside: px(c.width - 3) };
    }, shotBuf.toString("base64"));
    for (let k = 0; k < 3; k++)
      expect(Math.abs(colours.inside[k]! - colours.outside[k]!)).toBeLessThanOrEqual(6);
    await hero.screenshot({ path: shot("veil") });

    // an opaque studio background cannot float: no rectangle in the hero (the text and button are as ever)
    const second = await page
      .context()
      .browser()!
      .newContext(test.info().project.use as BrowserContextOptions);
    const page2 = await second.newPage();
    await webkitFriendly(page2);
    const { email: e2 } = await arrive(page2, "heroopaque");
    const { call: c2 } = await apiClient(request, e2);
    const opaque = await wine(c2, "Opaque Flute", "white");
    await publishArtSized(
      opaque.wineId,
      await makeRealisticBottlePng(page2, "flute", "opaque"),
      1024,
      1536,
    );
    await page2.goto("/");
    const hero2 = await expectCompactHero(page2);
    await expect(hero2.getByTestId("hero-bottle")).toHaveCount(1);
    await page2.waitForTimeout(1500);
    await expect(hero2.getByTestId("hero-art")).toHaveCount(0);
    await expect(hero2.locator("img")).toHaveCount(0);
    await hero2.screenshot({ path: shot("opaque") });
    await second.close();
  });
});
