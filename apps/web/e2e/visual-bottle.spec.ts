import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, bearer, sql } from "./helpers";

/**
 * Not a test: a photographer for the three bottle screens (the quick preview in the racks view, the bottle on
 * display in 3D, the full wine page), on an iPhone-sized screen, in Dutch, with wines that stretch them: a short
 * name, a long one, a champagne without a vintage, with and without a label photo.
 *   VISUAL_BOTTLE=1 SHOTS_DIR=/some/dir pnpm exec playwright test visual-bottle --project=phone
 * THEMES=dark narrows it down.
 */
test.skip(!process.env.VISUAL_BOTTLE, "only when asked for (VISUAL_BOTTLE=1)");

const OUT = process.env.SHOTS_DIR ?? "test-results/review-bottle";
const THEMES = (process.env.THEMES ?? "dark,light").split(",") as Array<"dark" | "light">;

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const WINES = [
  {
    key: "long",
    producer: "Capichera",
    name: "Vign'Angena Vermentino di Gallura Superiore",
    type: "white",
    region: "Vermentino di Gallura Superiore DOCG",
    countryCode: "IT",
    year: 2025,
    label: ["#f1ead8", "#4a3b28", "VIGN'ANGENA"],
    spot: [2, 3],
  },
  {
    key: "short",
    producer: "Fratelli Giuliari",
    name: "Nemm",
    type: "red",
    region: "Veneto",
    countryCode: "IT",
    year: 2023,
    label: null,
    spot: [1, 1],
  },
  {
    key: "champagne",
    producer: "Louis Roederer",
    name: "Collection 246",
    type: "sparkling",
    region: "Champagne",
    countryCode: "FR",
    year: null,
    label: ["#1d1d1b", "#d6b46a", "COLLECTION"],
    spot: [1, 2],
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

async function seed(page: Page, request: Parameters<typeof apiClient>[0]) {
  const { email } = await arrive(page, "reviewbottle");
  await sql(
    "update public.profiles set locale = 'nl' where id = (select id from auth.users where email = $1)",
    [email],
  );
  const { call, token } = await apiClient(request, email);
  const rack = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Rack", kind: "rack", rows: 5, cols: 5 },
      201,
    )
  ).body.id;
  const vintages: Record<string, string> = {};
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
        { wineId: wine.id, year: w.year, quantity: 2, locationId: null, priceCents: 3450 },
        201,
      )
    ).body;
    const [v] = await sql<{ vintage_id: string }>(
      "select vintage_id from public.bottles where id = $1",
      [added.bottleIds[0]],
    );
    vintages[w.key] = v!.vintage_id;
    // The first bottle goes to the spot from the screenshots, the second to the bottom shelf.
    const place =
      "update public.bottles set location_id = $2, loc_row = $3, loc_col = $4 where id = $1";
    await sql(place, [added.bottleIds[0], rack, w.spot[0], w.spot[1]]);
    await sql(place, [added.bottleIds[1], rack, 5, WINES.indexOf(w) + 1]);
    if (w.label) await attach(page, request, token, call, v!.vintage_id, w.label, w.year);
  }
  return vintages;
}

async function attach(
  page: Page,
  request: Parameters<typeof apiClient>[0],
  token: string,
  call: Call,
  vintageId: string,
  label: readonly [string, string, string],
  year: number | null,
) {
  const photo = await picture(page, label[0], label[1], [
    "Test label",
    label[2],
    String(year ?? "NV"),
  ]);
  const res = await request.post("/api/v1/images", {
    headers: bearer(token),
    multipart: {
      photo: { name: "p.jpg", mimeType: "image/jpeg", buffer: photo },
      thumb: { name: "t.jpg", mimeType: "image/jpeg", buffer: photo },
      side: "front",
      blurColor: "#e8dcc2",
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await call("put", `/cellar/${vintageId}/photo`, { imageId: id, side: "front" }, 200);
}

const settle = (p: Page, ms = 700) => p.waitForTimeout(ms);

test("photograph the bottle screens", async ({ page, request, browser }) => {
  test.setTimeout(600_000);
  const vintages = await seed(page, request);
  const state = await page.context().storageState();
  fs.mkdirSync(OUT, { recursive: true });

  for (const scheme of THEMES) {
    const context = await browser.newContext({
      storageState: state,
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
      locale: "nl-NL",
    });
    const p = await context.newPage();
    const file = (n: string) => path.join(OUT, `${n}-${scheme}.png`);

    // 1. The quick preview, from the racks view.
    await p.goto("/cellar");
    await p.getByRole("radio", { name: /Rekken|Racks/ }).click();
    for (const w of WINES) {
      await p
        .getByRole("button", { name: new RegExp(`${w.name.split(" ")[0]}.*, (plank|shelf)`, "i") })
        .first()
        .click();
      await expect(p.getByRole("dialog")).toBeVisible();
      await settle(p);
      await p.screenshot({ path: file(`peek-${w.key}`) });
      await p.keyboard.press("Escape");
      await expect(p.getByRole("dialog")).toBeHidden();
    }

    // 2. A bottle on display in 3D; then the same after scrolling the details of another one first.
    await p.goto("/cellar");
    await p.getByRole("radio", { name: "3D" }).click();
    const scene = p.getByTestId("cellar-3d");
    await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await settle(p, 1200);
    const show = async (w: (typeof WINES)[number]) => {
      await p
        .getByRole("list", { name: /Flessen in Rack/ })
        .getByRole("button", { name: new RegExp(w.name.split(" ")[0]!) })
        .first()
        .focus();
      await p.keyboard.press("Enter");
      await expect(p.getByTestId("bottle-showcase")).toHaveAttribute("data-open", "true", {
        timeout: 30_000,
      });
      await settle(p, 3500);
    };
    for (const w of WINES) {
      await show(w);
      await p.screenshot({ path: file(`showcase-${w.key}`) });
      // Scroll the details down, as someone reading them would, and put the bottle back.
      await p.getByTestId("bottle-showcase").evaluate((el) => {
        el.querySelectorAll<HTMLElement>("*").forEach((n) => {
          if (n.scrollHeight > n.clientHeight + 4) n.scrollTop = n.scrollHeight;
        });
      });
      await settle(p, 300);
      await p.screenshot({ path: file(`showcase-${w.key}-scrolled`) });
      await p.keyboard.press("Escape");
      await expect(p.getByTestId("bottle-showcase")).toHaveAttribute("data-open", "false");
      await settle(p, 1800);
    }
    // The next bottle after a scrolled one: its heading must be in view.
    await show(WINES[0]);
    await p.screenshot({ path: file("showcase-long-again") });

    // 3. The full wine page: top, and further down.
    for (const w of WINES) {
      await p.goto(`/cellar/${vintages[w.key]}`);
      await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
      await settle(p, 1200);
      await p.screenshot({ path: file(`page-${w.key}`) });
      if (w.key === "long") {
        await p.screenshot({ path: file(`page-${w.key}-full`), fullPage: true });
      }
    }
    await context.close();
  }
});
