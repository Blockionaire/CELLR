import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { aiWindow, apiClient, arrive, bearer, sql } from "./helpers";

/**
 * Not a test: a photographer. Fills a believable cellar (label photos, an AI window, an opened and rated bottle)
 * and takes the main screens on four screen sizes in both themes, for looking at by eye.
 *   VISUAL_REVIEW=1 SHOTS_DIR=/some/dir pnpm exec playwright test visual-review --project=desktop
 */
test.skip(!process.env.VISUAL_REVIEW, "only when asked for (VISUAL_REVIEW=1)");

const OUT = process.env.SHOTS_DIR ?? "test-results/review";
const THIS_YEAR = new Date().getFullYear();

const SIZES = [
  { name: "se", width: 375, height: 667, mobile: true },
  { name: "iphone", width: 393, height: 852, mobile: true },
  { name: "ipad", width: 820, height: 1180, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
] as const;

const WINES = [
  {
    producer: "Château Musar",
    name: "Château Musar Rouge",
    type: "red",
    countryCode: "LB",
    region: "Bekaa Valley",
    year: 2016,
    n: 3,
    label: ["#efe6d2", "#2b1b14", "CHÂTEAU MUSAR"],
  },
  {
    producer: "Domaine William Fèvre",
    name: "Chablis 1er Cru Montée de Tonnerre",
    type: "white",
    countryCode: "FR",
    region: "Burgundy",
    year: 2021,
    n: 2,
    label: ["#f6f2e8", "#1d2a3a", "WILLIAM FÈVRE"],
  },
  {
    producer: "Bollinger",
    name: "Special Cuvée Brut",
    type: "sparkling",
    countryCode: "FR",
    region: "Champagne",
    year: null,
    n: 1,
    label: ["#1b1b1b", "#d9b56b", "BOLLINGER"],
  },
  {
    producer: "Marchesi Antinori",
    name: "Tignanello",
    type: "red",
    countryCode: "IT",
    region: "Tuscany",
    year: THIS_YEAR - 9,
    n: 2,
    label: null,
  },
  {
    producer: "Château d'Esclans",
    name: "Whispering Angel",
    type: "rose",
    countryCode: "FR",
    region: "Provence",
    year: THIS_YEAR - 1,
    n: 4,
    label: null,
  },
  {
    producer: "Cloudy Bay",
    name: "Sauvignon Blanc",
    type: "white",
    countryCode: "NZ",
    region: "Marlborough",
    year: THIS_YEAR - 2,
    n: 1,
    label: ["#ffffff", "#24323d", "CLOUDY BAY"],
  },
] as const;

/** A plain test picture of a label (clearly a test image: plain fields and the producer's name). */
async function labelPhoto(page: Page, bg: string, ink: string, words: string, year: string) {
  const base64 = await page.evaluate(
    ([bgc, inkc, text, y]) => {
      const c = document.createElement("canvas");
      c.width = 600;
      c.height = 800;
      const x = c.getContext("2d")!;
      x.fillStyle = "#2a1c1e";
      x.fillRect(0, 0, 600, 800);
      x.fillStyle = bgc;
      x.fillRect(60, 120, 480, 560);
      x.strokeStyle = inkc;
      x.lineWidth = 3;
      x.strokeRect(84, 144, 432, 512);
      x.fillStyle = inkc;
      x.textAlign = "center";
      x.font = "italic 34px serif";
      x.fillText("Grand Vin", 300, 260);
      x.font = "bold 40px serif";
      x.fillText(text, 300, 380);
      x.font = "64px serif";
      x.fillText(y, 300, 500);
      return c.toDataURL("image/jpeg", 0.9).split(",")[1]!;
    },
    [bg, ink, words, year] as const,
  );
  return Buffer.from(base64, "base64");
}

async function seed(page: Page, request: Parameters<typeof apiClient>[0]) {
  const { email, householdId } = await arrive(page, "review");
  const { call, token } = await apiClient(request, email);
  const fridge = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Wijnklimaatkast", kind: "fridge", rows: 6, cols: 8 },
      201,
    )
  ).body;
  const ids: Record<string, { vintage: string; bottles: string[] }> = {};
  for (const w of WINES) {
    const wine = (
      await call<{ id: string }>(
        "post",
        "/wines",
        {
          producer: w.producer,
          name: w.name,
          type: w.type,
          countryCode: w.countryCode,
          region: w.region,
        },
        201,
      )
    ).body;
    const added = (
      await call<{ bottleIds: string[] }>(
        "post",
        "/bottles",
        { wineId: wine.id, year: w.year, quantity: w.n, locationId: fridge.id, priceCents: 3500 },
        201,
      )
    ).body;
    const [v] = await sql<{ vintage_id: string }>(
      "select vintage_id from public.bottles where id = $1",
      [added.bottleIds[0]],
    );
    ids[w.name] = { vintage: v!.vintage_id, bottles: added.bottleIds };
    if (w.label) {
      const photo = await labelPhoto(page, w.label[0], w.label[1], w.label[2], String(w.year ?? "NV"));
      const res = await request.post("/api/v1/images", {
        headers: bearer(token),
        multipart: {
          photo: { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo },
          thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: photo },
          side: "front",
          blurColor: w.label[0],
        },
      });
      expect(res.status()).toBe(201);
      const stored = (await res.json()) as { id: string };
      await call("put", `/cellar/${v!.vintage_id}/photo`, { imageId: stored.id }, 200);
    }
  }
  await aiWindow(householdId, "Château Musar Rouge", 2024, 2045);
  await aiWindow(householdId, "Tignanello", THIS_YEAR - 3, THIS_YEAR + 6);
  await aiWindow(householdId, "Whispering Angel", THIS_YEAR - 1, THIS_YEAR);
  const t = ids["Tignanello"]!;
  await call("patch", `/bottles/${t.bottles[0]}`, { action: "open" }, 200);
  await call("put", `/bottles/${t.bottles[0]}/tasting`, { score: 9 }, 200);
  await sql(
    "update public.profiles set locale = 'nl' where id = (select id from auth.users where email = $1)",
    [email],
  );
  return ids;
}

test("photograph the main screens", async ({ page, request, browser }) => {
  test.setTimeout(600_000);
  const ids = await seed(page, request);
  const state = await page.context().storageState();
  const musar = ids["Château Musar Rouge"]!.vintage;
  const plain = ids["Tignanello"]!.vintage;
  const screens: Array<[string, string]> = [
    ["home", "/"],
    ["cellar", "/cellar"],
    ["wine-photo", `/cellar/${musar}`],
    ["wine-plain", `/cellar/${plain}`],
    ["tonight", "/tonight"],
    ["sommelier", "/sommelier"],
    ["history", "/cellar/history"],
    ["wishlist", "/wishlist"],
  ];
  fs.mkdirSync(OUT, { recursive: true });
  // SCREENS=home,cellar and SIZES=iphone narrow it down while working on one screen.
  const only = (list: string | undefined) => (list ? list.split(",") : null);
  const pickScreens = only(process.env.SCREENS);
  const pickSizes = only(process.env.SIZES);
  for (const size of SIZES.filter((s) => !pickSizes || pickSizes.includes(s.name))) {
    for (const scheme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        storageState: state,
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 2,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        colorScheme: scheme,
      });
      await context.addCookies([{ name: "locale", value: "nl", url: "http://localhost:3100" }]);
      const p = await context.newPage();
      for (const [name, url] of screens.filter(([n]) => !pickScreens || pickScreens.includes(n))) {
        await p.goto(url);
        await p.waitForLoadState("networkidle");
        await p.waitForTimeout(400);
        const file = path.join(OUT, `${name}-${size.name}-${scheme}`);
        await p.screenshot({ path: `${file}.png` });
        if (size.name === "iphone") await p.screenshot({ path: `${file}-full.png`, fullPage: true });
      }
      await context.close();
    }
  }
});
