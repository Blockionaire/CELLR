import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { apiClient, arrive, codeFor, sql, uniqueEmail, wineBody } from "./helpers";

/**
 * Not a test: a photographer for the journeys a beta tester takes first. A brand-new person from the sign-in page
 * to an empty Home, the add and scan screens, and a filled account's profile, insights, friends and history; on a
 * small phone, a phone and a desktop, in both themes (and Dutch on a phone).
 *   JOURNEY_REVIEW=1 SHOTS_DIR=/some/dir pnpm exec playwright test journey-review --project=desktop
 * SIZES=iphone and THEMES=light narrow it down.
 */
test.skip(!process.env.JOURNEY_REVIEW, "only when asked for (JOURNEY_REVIEW=1)");

const OUT = process.env.SHOTS_DIR ?? "test-results/journeys";
const SIZES = [
  { name: "se", width: 375, height: 667, mobile: true },
  { name: "iphone", width: 393, height: 852, mobile: true },
  { name: "desktop", width: 1280, height: 800, mobile: false },
] as const;
const only = (list: string | undefined) => (list ? list.split(",") : null);

async function context(
  browser: Browser,
  size: (typeof SIZES)[number],
  scheme: "light" | "dark",
  locale: "en" | "nl",
  storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>,
) {
  const ctx = await browser.newContext({
    ...(storageState ? { storageState } : {}),
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    colorScheme: scheme,
    locale: locale === "nl" ? "nl-NL" : "en-GB",
  });
  if (locale === "nl")
    await ctx.addCookies([{ name: "locale", value: "nl", url: "http://localhost:3100" }]);
  return ctx;
}

/** A brand-new person, photographed at every step to an empty Home. */
async function firstRun(page: Page, shot: (n: string) => Promise<void>, nl: boolean) {
  const email = uniqueEmail("firstrun");
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
  await shot("01-sign-in");
  await page.getByLabel(nl ? "E-mail" : "Email").fill(email);
  await page.getByRole("button", { name: nl ? /code/i : "Send me a code" }).click();
  await page.waitForTimeout(800);
  await shot("02-code");
  await page.getByLabel(/6/).fill(await codeFor(email));
  await page.waitForFunction(
    () =>
      !location.pathname.startsWith("/sign-in") ||
      document.querySelector('[data-testid="pin-offer"]') !== null,
  );
  await page.waitForTimeout(600);
  if (new URL(page.url()).pathname.startsWith("/sign-in")) {
    await shot("03-pin-offer");
    await page.getByTestId("pin-offer").getByRole("button").last().click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  await page.waitForTimeout(800);
  await shot("04-household");
  await page.getByRole("textbox").first().fill("Prins");
  await page
    .getByRole("button")
    .filter({ hasText: nl ? /aan/i : /Create/ })
    .first()
    .click();
  await page.waitForTimeout(800);
  await shot("05-name");
  await page.getByRole("textbox").first().fill("Joost");
  await page.getByRole("button").last().click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(900);
  await shot("06-home-empty");
  await page.screenshot({ path: path.join(OUT, `last-full.png`), fullPage: true });
  await page.goto("/cellar");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  await shot("07-cellar-empty");
  await page.goto("/cellar/add");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  await shot("08-add");
  await page.goto("/scan");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);
  await shot("09-scan");
  await page.goto("/insights");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  await shot("10-insights-empty");
  await page.goto("/profile");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  await shot("11-profile");
}

async function seedFilled(page: Page, request: Parameters<typeof apiClient>[0]) {
  const { email, householdId } = await arrive(page, "journeyfull");
  const { call } = await apiClient(request, email);
  const fridge = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Wine fridge", kind: "fridge", rows: 4, cols: 6 },
      201,
    )
  ).body;
  const wines = [
    { ...wineBody, name: "Chablis Premier Cru", type: "white" },
    {
      ...wineBody,
      producer: "Château Musar",
      name: "Château Musar Rouge",
      type: "red",
      countryCode: "LB",
      region: "Bekaa Valley",
    },
    {
      ...wineBody,
      producer: "Bollinger",
      name: "Special Cuvée",
      type: "sparkling",
      region: "Champagne",
    },
  ];
  const bottles: string[] = [];
  for (const [i, w] of wines.entries()) {
    const wine = (await call<{ id: string }>("post", "/wines", w, 201)).body;
    const added = (
      await call<{ bottleIds: string[] }>(
        "post",
        "/bottles",
        {
          wineId: wine.id,
          year: 2016 + i,
          quantity: 3,
          locationId: fridge.id,
          priceCents: 2800 + i * 900,
        },
        201,
      )
    ).body;
    bottles.push(...added.bottleIds);
  }
  await call("patch", `/bottles/${bottles[0]}`, { action: "open" }, 200);
  await call(
    "put",
    `/bottles/${bottles[0]}/tasting`,
    { score: 8.5, note: "Flint and lemon, long." },
    200,
  );
  await call("patch", `/bottles/${bottles[3]}`, { action: "open" }, 200);
  return { email, householdId };
}

test("photograph the first-run and main journeys", async ({ browser, page, request }) => {
  test.setTimeout(1_200_000);
  fs.mkdirSync(OUT, { recursive: true });
  const sizes = only(process.env.SIZES);
  const themes = (only(process.env.THEMES) ?? ["light", "dark"]) as Array<"light" | "dark">;
  const { householdId } = await seedFilled(page, request);
  expect(householdId).toBeTruthy();
  const filled = await page.context().storageState();
  const runs: Array<[(typeof SIZES)[number], "light" | "dark", "en" | "nl"]> = [];
  for (const size of SIZES.filter((s) => !sizes || sizes.includes(s.name)))
    for (const scheme of themes) runs.push([size, scheme, "en"]);
  if (!sizes || sizes.includes("iphone")) runs.push([SIZES[1], "light", "nl"]);
  for (const [size, scheme, locale] of runs) {
    const tag = `${size.name}-${scheme}${locale === "nl" ? "-nl" : ""}`;
    // A brand-new person.
    const ctx = await context(browser, size, scheme, locale);
    const p = await ctx.newPage();
    const shot = async (n: string) => {
      await p.screenshot({ path: path.join(OUT, `${n}-${tag}.png`) });
    };
    await firstRun(p, shot, locale === "nl");
    await ctx.close();
    // A filled account.
    const filledCtx = await context(browser, size, scheme, locale, filled);
    const q = await filledCtx.newPage();
    for (const [name, url] of [
      ["20-home", "/"],
      ["21-cellar", "/cellar"],
      ["22-insights", "/insights"],
      ["23-history", "/cellar/history"],
      ["24-friends", "/friends"],
      ["25-profile", "/profile"],
      ["26-add", "/cellar/add"],
    ] as const) {
      await q.goto(url);
      await q.waitForLoadState("networkidle");
      await q.waitForTimeout(800);
      await q.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) });
      if (size.name === "iphone" && scheme === "light" && locale === "en")
        await q.screenshot({ path: path.join(OUT, `${name}-${tag}-full.png`), fullPage: true });
    }
    await filledCtx.close();
  }
  // Keep the household count honest for later runs (nothing else to clean: every run makes its own people).
  await sql("select 1");
});
