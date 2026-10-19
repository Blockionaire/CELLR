import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, bearer, sql } from "./helpers";

/**
 * Not a test: a photographer for the 3D cellar. Fills three kinds of storage (a wooden rack, a wine fridge, a
 * cabinet) with a mix of wines, some with photos of their front and back labels, and takes each unit, a bottle on
 * display, and the same bottle turned round, on a phone, a tablet and a desktop in both themes.
 *   VISUAL_3D=1 SHOTS_DIR=/some/dir pnpm exec playwright test visual-3d --project=desktop
 * SIZES=iphone,desktop and THEMES=dark narrow it down.
 */
test.skip(!process.env.VISUAL_3D, "only when asked for (VISUAL_3D=1)");

const OUT = process.env.SHOTS_DIR ?? "test-results/review-3d";
const SIZES = [
  { name: "iphone", width: 393, height: 852, mobile: true },
  { name: "ipad", width: 820, height: 1180, mobile: true },
  { name: "desktop", width: 1440, height: 900, mobile: false },
] as const;
const only = (list: string | undefined) => (list ? list.split(",") : null);

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const WINES = [
  {
    producer: "Château Musar",
    name: "Château Musar Rouge",
    type: "red",
    region: "Bekaa Valley",
    countryCode: "LB",
    year: 2016,
    label: ["#efe6d2", "#2b1b14", "CHÂTEAU MUSAR"],
    back: true,
  },
  {
    producer: "Domaine William Fèvre",
    name: "Chablis 1er Cru",
    type: "white",
    region: "Burgundy",
    countryCode: "FR",
    year: 2021,
    label: ["#f6f2e8", "#1d2a3a", "WILLIAM FÈVRE"],
    back: false,
  },
  {
    producer: "Bollinger",
    name: "Special Cuvée",
    type: "sparkling",
    region: "Champagne",
    countryCode: "FR",
    year: null,
    label: ["#1b1b1b", "#d9b56b", "BOLLINGER"],
    back: false,
  },
  {
    producer: "Marchesi Antinori",
    name: "Tignanello",
    type: "red",
    region: "Tuscany",
    countryCode: "IT",
    year: 2018,
    label: null,
    back: false,
  },
  {
    producer: "Château d'Esclans",
    name: "Whispering Angel",
    type: "rose",
    region: "Provence",
    countryCode: "FR",
    year: 2024,
    label: null,
    back: false,
  },
  {
    producer: "Domaine Weinbach",
    name: "Riesling Grand Cru",
    type: "white",
    region: "Alsace",
    countryCode: "FR",
    year: 2019,
    label: null,
    back: false,
  },
] as const;

/** A plain test picture of a label: clearly a test image, never a real one. */
async function picture(page: Page, bg: string, ink: string, lines: string[]) {
  const base64 = await page.evaluate(
    ([bgc, inkc, text]) => {
      const c = document.createElement("canvas");
      c.width = 600;
      c.height = 720;
      const x = c.getContext("2d")!;
      x.fillStyle = bgc;
      x.fillRect(0, 0, 600, 720);
      x.strokeStyle = inkc;
      x.lineWidth = 4;
      x.strokeRect(30, 30, 540, 660);
      x.fillStyle = inkc;
      x.textAlign = "center";
      (text as string[]).forEach((t, i) => {
        x.font = i === 0 ? "italic 40px serif" : i === 1 ? "bold 52px serif" : "34px serif";
        x.fillText(t, 300, 200 + i * 120);
      });
      return c.toDataURL("image/jpeg", 0.9).split(",")[1]!;
    },
    [bg, ink, lines] as const,
  );
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
}

async function seed(page: Page, request: Parameters<typeof apiClient>[0]) {
  const { email } = await arrive(page, "review3d");
  const { call, token } = await apiClient(request, email);
  const unit = async (label: string, kind: string, rows: number, cols: number) =>
    (await call<{ id: string }>("post", "/storage", { label, kind, rows, cols }, 201)).body.id;
  const rack = await unit("Walnut rack", "rack", 5, 7);
  const fridge = await unit("Wine fridge", "fridge", 6, 5);
  const cabinet = await unit("Dining cabinet", "cabinet", 3, 4);
  const plan: Array<[string, number]> = [
    [rack, 4],
    [rack, 3],
    [rack, 2],
    [rack, 5],
    [rack, 4],
    [rack, 3],
    [fridge, 3],
    [fridge, 2],
    [fridge, 4],
    [fridge, 1],
    [fridge, 3],
    [fridge, 2],
    [cabinet, 2],
    [cabinet, 1],
    [cabinet, 2],
    [cabinet, 0],
    [cabinet, 1],
    [cabinet, 1],
  ];
  const vintages: string[] = [];
  for (const [i, w] of WINES.entries()) {
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
    for (const [u, n] of [plan[i]!, plan[i + 6]!, plan[i + 12]!]) {
      if (n === 0) continue;
      const added = (
        await call<{ bottleIds: string[] }>(
          "post",
          "/bottles",
          { wineId: wine.id, year: w.year, quantity: n, locationId: u },
          201,
        )
      ).body;
      if (vintages.length === i) {
        const [v] = await sql<{ vintage_id: string }>(
          "select vintage_id from public.bottles where id = $1",
          [added.bottleIds[0]],
        );
        vintages.push(v!.vintage_id);
      }
    }
    if (w.label)
      await attach(
        request,
        token,
        call,
        vintages[i]!,
        "front",
        await picture(page, w.label[0], w.label[1], [
          "Grand Vin",
          w.label[2],
          String(w.year ?? "NV"),
        ]),
      );
    if (w.back)
      await attach(
        request,
        token,
        call,
        vintages[i]!,
        "back",
        await picture(page, "#f3ecdc", "#3a2a22", [
          "Test back label",
          "Bekaa Valley",
          "14% vol · 750 ml",
          "Imported by Test BV",
        ]),
      );
  }
}

async function open3D(page: Page, unit: string) {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  const scene = page.getByTestId("cellar-3d");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await page.getByRole("button", { name: unit, exact: true }).click();
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await page.waitForTimeout(1200);
  return scene;
}

test("photograph the 3D cellar", async ({ page, request, browser }) => {
  test.skip(!!process.env.FILM, "FILM=1 films the movement instead");
  test.setTimeout(900_000);
  await seed(page, request);
  const state = await page.context().storageState();
  fs.mkdirSync(OUT, { recursive: true });
  const sizes = only(process.env.SIZES);
  const themes = only(process.env.THEMES) ?? ["light", "dark"];
  for (const size of SIZES.filter((s) => !sizes || sizes.includes(s.name))) {
    for (const scheme of themes as Array<"light" | "dark">) {
      const context = await browser.newContext({
        storageState: state,
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 2,
        isMobile: size.mobile,
        hasTouch: size.mobile,
        colorScheme: scheme,
      });
      const p = await context.newPage();
      const file = (n: string) => path.join(OUT, `${n}-${size.name}-${scheme}.png`);
      for (const [unit, name] of [
        ["Walnut rack", "rack"],
        ["Wine fridge", "fridge"],
        ["Dining cabinet", "cabinet"],
      ] as const) {
        const scene = await open3D(p, unit);
        await scene.screenshot({ path: file(name) });
      }
      // A bottle with both labels, on display, then turned round to its back.
      const scene = await open3D(p, "Walnut rack");
      const list = p.getByRole("list", { name: /Bottles in Walnut rack/ });
      await list
        .getByRole("button", { name: /Château Musar Rouge 2016/ })
        .first()
        .focus();
      await p.keyboard.press("Enter");
      await expect(p.getByTestId("bottle-showcase")).toHaveAttribute("data-open", "true", {
        timeout: 30_000,
      });
      await p.waitForTimeout(3500);
      await p.screenshot({ path: file("showcase") });
      const box = (await scene.locator("canvas").boundingBox())!;
      const y = box.y + box.height * (size.name === "desktop" ? 0.5 : 0.25);
      const x = box.x + box.width * (size.name === "desktop" ? 0.27 : 0.5);
      await p.mouse.move(x, y);
      await p.mouse.down();
      // Half a turn (0.012 rad a pixel), held still before letting go so it stops with its back to you.
      for (let i = 1; i <= 24; i++) await p.mouse.move(x + i * 10.9, y, { steps: 1 });
      await p.waitForTimeout(200);
      await p.mouse.up();
      await p.waitForTimeout(3000);
      await p.screenshot({ path: file("showcase-back") });
      await context.close();
    }
  }
});

/** FILM=1: frames of a bottle coming out and going back, at a phone and a desktop size, for filmstrips. */
test("film the bottle coming out and going back", async ({ page, request, browser }) => {
  test.skip(!process.env.FILM, "only with FILM=1");
  test.setTimeout(900_000);
  await seed(page, request);
  const state = await page.context().storageState();
  fs.mkdirSync(OUT, { recursive: true });
  for (const size of SIZES.filter((s) => s.name !== "ipad")) {
    const context = await browser.newContext({
      storageState: state,
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
      isMobile: size.mobile,
      hasTouch: size.mobile,
    });
    const p = await context.newPage();
    // The browser's clock is ours: each frame is a fixed step of the animation, however slow a screenshot is.
    await p.clock.install();
    await open3D(p, "Walnut rack");
    const frames = async (name: string, n: number, step: number) => {
      for (let i = 0; i < n; i++) {
        await p.screenshot({ path: path.join(OUT, `${name}-${size.name}-${i}.png`) });
        await p.clock.runFor(step);
        await p.waitForTimeout(150);
      }
    };
    const list = p.getByRole("list", { name: /Bottles in Walnut rack/ });
    await list
      .getByRole("button", { name: /Château Musar Rouge 2016/ })
      .first()
      .focus();
    await p.clock.pauseAt(new Date(Date.now() + 60_000));
    await p.keyboard.press("Enter");
    await frames("out", 10, 180);
    await p.clock.runFor(1500);
    await p.keyboard.press("Escape");
    await frames("back", 8, 130);
    await context.close();
  }
});
