import { expect, test, type BrowserContextOptions } from "@playwright/test";
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

interface Wish {
  id: string;
  wineId: string;
  wineName: string;
  year: number | null;
  note: string | null;
  maxPriceCents: number | null;
  inCellar: number;
}

test.describe("the wishlist", () => {
  test("an empty list invites you; a new wine goes on it with a vintage, a price and a note", async ({
    page,
  }) => {
    await arrive(page, "wishnew");
    await page.goto("/wishlist");
    await expect(page.getByRole("heading", { name: "Nothing on your wishlist yet" })).toBeVisible();
    await page.screenshot({ path: shot(`wishlist-empty-${project()}`), fullPage: true });

    await page.getByRole("link", { name: "Add a wine" }).first().click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Which wine do you want?" }),
    ).toBeVisible();
    await page.getByLabel("Search your wines, or add a new one").fill("Barolo Riserva");
    await page.getByRole("button", { name: /as a new wine/ }).click();
    await page.getByLabel("Producer").fill("Cascina Bella");
    await page.getByLabel("Country").selectOption({ label: "Italy" });
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "About this wish" })).toBeVisible();
    await page.getByLabel("Vintage (optional)").fill("2016");
    await page.getByLabel(/Most you would pay per bottle/).fill("45,50");
    await page.getByLabel("Note (optional)").fill("Ask at the shop on Main Street");
    await page.screenshot({ path: shot(`wishlist-details-${project()}`), fullPage: true });
    await page.getByRole("button", { name: "Add to wishlist" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "On your wishlist" })).toBeVisible();

    await page.getByRole("link", { name: "See your wishlist" }).click();
    const card = page.getByRole("article").filter({ hasText: "Barolo Riserva" });
    await expect(card.getByText("Cascina Bella")).toBeVisible();
    await expect(card.getByText(/2016/)).toBeVisible();
    await expect(card.getByText(/Up to €45,50|Up to €45\.50/)).toBeVisible();
    await expect(card.getByText("Ask at the shop on Main Street")).toBeVisible();
    await page.screenshot({ path: shot(`wishlist-${project()}`), fullPage: true });
  });

  test("a wine you already have says so, so you do not buy a fourth by accident", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "wishhave");
    const { call } = await apiClient(request, email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await call(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2019, quantity: 3, locationId: null },
      201,
    );

    await page.goto("/wishlist/add");
    await page.getByRole("button", { name: /Chablis Premier Cru/ }).click();
    await page.getByRole("button", { name: "Add to wishlist" }).click();
    await page.getByRole("link", { name: "See your wishlist" }).click();
    const card = page.getByRole("article").filter({ hasText: "Chablis Premier Cru" });
    await expect(card.getByText("Any vintage")).toBeVisible();
    await expect(card.getByText("You already have 3 bottles")).toBeVisible();
  });

  test("the same wine twice is explained, not a crash", async ({ page, request }) => {
    const { email } = await arrive(page, "wishdup");
    const { call } = await apiClient(request, email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await call("post", "/wishlist", { wineId: wine.id, year: 2019 }, 201);
    await page.goto("/wishlist/add");
    await page.getByRole("button", { name: /Chablis Premier Cru/ }).click();
    await page.getByLabel("Vintage (optional)").fill("2019");
    await page.getByRole("button", { name: "Add to wishlist" }).click();
    await expect(page.getByText("That wine is already on your wishlist.")).toBeVisible();
    // Still on the same step: nothing was lost.
    await expect(page.getByLabel("Vintage (optional)")).toHaveValue("2019");
  });

  test("edit a wish, with a check on what you type", async ({ page, request }) => {
    const { email } = await arrive(page, "wishedit");
    const { call } = await apiClient(request, email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await call("post", "/wishlist", { wineId: wine.id, note: "first" }, 201);
    await page.goto("/wishlist");
    await page.getByRole("button", { name: "Edit" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit this wish" });
    await expect(sheet.getByLabel("Note (optional)")).toHaveValue("first");
    await sheet.getByLabel("Vintage (optional)").fill("2");
    await sheet.getByLabel(/Most you would pay/).fill("abc");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(
      sheet.getByText("Enter a year between 1800 and 2100, or leave it empty."),
    ).toBeVisible();
    await expect(sheet.getByText("Enter a price like 24,50, or leave it empty.")).toBeVisible();
    await sheet.getByLabel("Vintage (optional)").fill("2018");
    await sheet.getByLabel(/Most you would pay/).fill("30");
    await sheet.getByLabel("Note (optional)").fill("second");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Wish updated.")).toBeVisible();
    const card = page.getByRole("article");
    await expect(card.getByText("second")).toBeVisible();
    await expect(card.getByText(/2018/)).toBeVisible();
  });

  test("removing one can be undone", async ({ page, request }) => {
    const { email } = await arrive(page, "wishundo");
    const { call } = await apiClient(request, email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await call(
      "post",
      "/wishlist",
      { wineId: wine.id, year: 2020, note: "keep me", maxPriceCents: 2500 },
      201,
    );
    await page.goto("/wishlist");
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("Removed from your wishlist.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing on your wishlist yet" })).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    const card = page.getByRole("article");
    await expect(card.getByText("keep me")).toBeVisible();
    await expect(card.getByText(/2020/)).toBeVisible();
    expect(
      (await call<{ items: Wish[] }>("get", "/wishlist", undefined, 200)).body.items[0],
    ).toMatchObject({
      year: 2020,
      note: "keep me",
      maxPriceCents: 2500,
    });
  });

  test("'Bought it' leads to the add flow with the wine chosen, and the wish goes once the bottles are in", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "wishbuy");
    const { call } = await apiClient(request, email);
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 3, cols: 4 }, 201);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await call("post", "/wishlist", { wineId: wine.id, year: 2019 }, 201);
    await page.goto("/wishlist");
    await page.getByRole("link", { name: "Bought it" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "How many, and where?" }),
    ).toBeVisible();
    await expect(page.getByLabel("Vintage")).toHaveValue("2019");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText(/1 bottle of Domaine Test Chablis Premier Cru 2019/)).toBeVisible();
    await expect(page.getByText("Taken off your wishlist.")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await call<{ items: Wish[] }>("get", "/wishlist", undefined, 200)).body.items.length,
      )
      .toBe(0);
  });

  test("from a scan, a wine can be saved for later instead of added to the cellar", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "wishscan");
    const { call } = await apiClient(request, email);
    const size = {
      width: 433 + test.info().parallelIndex * 29,
      height: 577 + Math.floor(Math.random() * 40),
    };
    const res = await fetch(`${STACK}/__test/openai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...size,
        content: {
          is_wine_label: true,
          producer: "Bollinger",
          wine_name: "Special Cuvée",
          vintage: null,
          non_vintage: true,
          wine_type: "sparkling",
          country_code: "FR",
          region: "Champagne",
          appellation: null,
          grapes: [],
          abv_percent: 12,
          volume_ml: 750,
          text_seen: "BOLLINGER",
          confidence: { producer: "high", wine_name: "high", vintage: "high" },
        },
      }),
    });
    expect(res.ok).toBe(true);
    await page.goto("/scan");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "shop.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, size),
      });
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Not buying it? Save to wishlist" }).click();
    await expect(page.getByText("Added to your wishlist.")).toBeVisible();
    // Back at the camera, ready for the next bottle on the shelf.
    await expect(page.getByRole("button", { name: /Take a photo/ })).toBeVisible();
    const items = (await call<{ items: Wish[] }>("get", "/wishlist", undefined, 200)).body.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ wineName: "Special Cuvée", year: null, inCellar: 0 });
    // Nothing went into the cellar.
    expect(
      (await call<{ items: unknown[] }>("get", "/cellar", undefined, 200)).body.items,
    ).toHaveLength(0);
  });

  test("the API: validation, and a household's list is its own", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "wishapi");
    const { call, token } = await apiClient(request, owner.email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    const wish = (
      await call<Wish>("post", "/wishlist", { wineId: wine.id, year: 2019, note: "  tidy  " }, 201)
    ).body;
    expect(wish).toMatchObject({ note: "tidy", year: 2019, inCellar: 0 });

    const post = (data: unknown) => api(request, token, "post", "/wishlist", data);
    expect((await post({})).status()).toBe(422);
    expect((await post({ wineId: "nope" })).status()).toBe(422);
    expect((await post({ wineId: wine.id, year: 1700 })).status()).toBe(422);
    expect((await post({ wineId: wine.id, year: 2020, maxPriceCents: -5 })).status()).toBe(422);
    expect((await post({ wineId: wine.id, year: 2019 })).status()).toBe(409); // doubled
    expect((await post({ wineId: "22222222-2222-4222-8222-222222222222" })).status()).toBe(404); // no such wine
    expect((await api(request, token, "patch", `/wishlist/${wish.id}`, {})).status()).toBe(422);
    expect(
      (await api(request, token, "patch", `/wishlist/not-an-id`, { note: "x" })).status(),
    ).toBe(404);
    expect((await request.get("/api/v1/wishlist", { headers: bearer("nope") })).status()).toBe(401);

    // Another household sees an empty list and can neither change nor remove ours, nor add our private wine.
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "wishoth");
    const otherToken = await sessionToken(other.email);
    expect(
      ((await (await api(request, otherToken, "get", "/wishlist")).json()) as { items: unknown[] })
        .items,
    ).toEqual([]);
    expect(
      (await api(request, otherToken, "patch", `/wishlist/${wish.id}`, { note: "mine" })).status(),
    ).toBe(404);
    expect((await api(request, otherToken, "delete", `/wishlist/${wish.id}`)).status()).toBe(404);
    expect(
      (await api(request, otherToken, "post", "/wishlist", { wineId: wine.id })).status(),
    ).toBe(404);
    const rows = await sql<{ note: string }>(
      "select note from public.wishlist_items where id = $1",
      [wish.id],
    );
    expect(rows[0]!.note).toBe("tidy");
    await context.close();
  });

  test("the wishlist screens are accessible in both themes", async ({ page, request }) => {
    const { email } = await arrive(page, "wisha11y");
    const { call } = await apiClient(request, email);
    const wine = (await call<{ id: string }>("post", "/wines", wineBody, 201)).body;
    await call(
      "post",
      "/wishlist",
      { wineId: wine.id, year: 2019, note: "n", maxPriceCents: 3000 },
      201,
    );
    for (const path of ["/wishlist", "/wishlist/add"]) {
      await page.goto(path);
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await expect.poll(() => audit(page)).toEqual([]);
      }
    }
    await page.goto("/wishlist");
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
  });
});
