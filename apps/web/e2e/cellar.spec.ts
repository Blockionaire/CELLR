import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { api, arrive, audit, PUBLISHABLE_KEY, sessionToken, sql, STACK, wineBody } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

test.describe("the cellar loop", () => {
  test("add a new wine, three bottles into a new fridge, then find them in the grid, the list and the search", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "loop");

    // Empty state → first bottle.
    await page.goto("/cellar");
    await expect(page.getByRole("heading", { name: "Your cellar starts here." })).toBeVisible();
    await page.getByRole("link", { name: "Add your first bottle" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Which wine?" })).toBeVisible();

    // Nothing matches yet, so the typed words become the new wine's name.
    await page.getByLabel("Search your wines, or add a new one").fill("Pavillon Rouge");
    await page.getByRole("button", { name: /as a new wine/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "A new wine" })).toBeVisible();
    await expect(page.getByLabel("Wine name")).toHaveValue("Pavillon Rouge");
    await page.getByLabel("Producer").fill("Château Margaux");
    await page.getByLabel("Country").selectOption({ label: "France" });
    await page.getByLabel("Region").fill("Bordeaux");
    await page.screenshot({ path: shot(`add-new-wine-${project()}`), fullPage: true });
    await page.getByRole("button", { name: "Continue" }).click();

    // One screen for everything about these bottles.
    await expect(
      page.getByRole("heading", { level: 1, name: "How many, and where?" }),
    ).toBeVisible();
    await page.getByLabel("Vintage").fill("2015");
    const more = page.getByRole("button", { name: "One more" });
    await more.click();
    await more.click();
    await expect(
      page.getByRole("group", { name: "How many bottles?" }).locator("output"),
    ).toHaveText("3");

    await page.getByRole("button", { name: /New place/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Create place" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("radio", { name: /Wine fridge/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await page.getByLabel("Price per bottle (€)").fill("24,50");
    await page.screenshot({ path: shot(`add-details-${project()}`), fullPage: true });
    await page.getByRole("button", { name: "Add 3 bottles" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Added to your cellar." }),
    ).toBeVisible();
    await expect(page.getByText("3 bottles of Château Margaux Pavillon Rouge 2015")).toBeVisible();
    await expect(page.getByText("In Wine fridge.")).toBeVisible();
    await page.screenshot({ path: shot(`add-done-${project()}`), fullPage: true });

    // What the database holds: ONE wine, ONE vintage, THREE physical bottles with their own places.
    const bottles = await sql<{
      loc_row: number;
      loc_col: number;
      purchase_price_cents: number;
      currency: string;
      status: string;
      location_id: string;
    }>(
      `select b.loc_row, b.loc_col, b.purchase_price_cents, b.currency, b.status, b.location_id
         from public.bottles b where b.household_id = $1 order by b.loc_row, b.loc_col`,
      [householdId],
    );
    expect(bottles).toHaveLength(3);
    expect(bottles.map((b) => [b.loc_row, b.loc_col])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
    ]);
    expect(bottles.every((b) => b.purchase_price_cents === 2450 && b.currency === "EUR")).toBe(
      true,
    );
    expect(bottles.every((b) => b.status === "in_cellar")).toBe(true);
    const [counts] = await sql<{ wines: number; vintages: number; producers: number }>(
      `select (select count(*)::int from public.wines where owner_household_id = $1) as wines,
              (select count(*)::int from public.wine_vintages v join public.wines w on w.id = v.wine_id
                 where w.owner_household_id = $1) as vintages,
              (select count(*)::int from public.producers where owner_household_id = $1) as producers`,
      [householdId],
    );
    expect(counts).toEqual({ wines: 1, vintages: 1, producers: 1 });

    // See it in the cellar.
    await page.getByRole("link", { name: "See my cellar" }).click();
    await expect(page).toHaveURL(/\/cellar$/);
    const card = page.getByRole("article");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Château Margaux");
    await expect(card).toContainText("Pavillon Rouge");
    await expect(card).toContainText("2015 · Bordeaux, France");
    await expect(card).toContainText("×3");
    await expect(card).toContainText("Wine fridge");
    await expect(page.getByText("3 bottles · 1 wine")).toBeVisible();
    await page.screenshot({ path: shot(`cellar-grid-1-${project()}`), fullPage: true });

    // A second wine, added through the API the way a native app would.
    const token = await sessionToken(email);
    const wine = (await (await api(request, token, "post", "/wines", wineBody)).json()) as {
      id: string;
    };
    expect(
      (
        await api(request, token, "post", "/bottles", {
          wineId: wine.id,
          year: 2020,
          quantity: 2,
          locationId: null,
        })
      ).status(),
    ).toBe(201);

    await page.reload();
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(page.getByText("5 bottles · 2 wines")).toBeVisible();
    await page.screenshot({ path: shot(`cellar-grid-2-${project()}`), fullPage: true });

    // Instant search: any word, any order, accents optional.
    const search = page.getByLabel("Search your cellar");
    await search.fill("chablis");
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toContainText("Chablis Premier Cru");
    await search.fill("chateau 2015");
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toContainText("Château Margaux");
    await search.fill("zzz");
    await expect(page.getByRole("heading", { name: "No bottles match." })).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.getByRole("article")).toHaveCount(2);

    // The compact list, remembered across visits.
    await page.getByRole("radio", { name: "List" }).click();
    await expect(page.getByRole("article")).toHaveCount(2);
    await page.screenshot({ path: shot(`cellar-list-${project()}`), fullPage: true });
    await page.reload();
    await expect(page.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("article")).toHaveCount(2);
  });

  test("adding again reuses the wine and vintage, NV is its own vintage, spots fill in order, and a full place never loses a bottle", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "again");
    const token = await sessionToken(email);
    const post = async (path: string, body: unknown) => {
      const res = await api(request, token, "post", path, body);
      expect(res.status(), path).toBe(201);
      return (await res.json()) as Record<string, unknown>;
    };

    // A 2×2 rack (4 spots) and a wine already in the list.
    const rack = (await post("/storage", {
      label: "Small rack",
      kind: "rack",
      rows: 2,
      cols: 2,
    })) as {
      id: string;
      capacity: number;
    };
    expect(rack.capacity).toBe(4);
    const wine = (await post("/wines", wineBody)) as { id: string };
    // The same wine typed again with other case, accents and spacing is the SAME wine, not a duplicate.
    for (const variant of [
      { producer: "DOMAINE TÉST", name: "chablis premier cru" },
      { producer: "domaine test", name: "CHABLIS premier   cru" },
    ]) {
      const same = (await post("/wines", { ...wineBody, ...variant })) as { id: string };
      expect(same.id).toBe(wine.id);
    }
    // A different wine from the same producer is a new wine under that one producer.
    await post("/wines", { ...wineBody, name: "Chablis Grand Cru" });

    // Through the screen: pick the wine from the list, two bottles, the rack is preselected.
    await page.goto("/cellar/add");
    await page.getByLabel("Search your wines, or add a new one").fill("chablis");
    await page
      .getByRole("button", { name: /Chablis Premier Cru/ })
      .first()
      .click();
    await page.getByLabel("Vintage").fill("2019");
    await page.getByRole("button", { name: "One more" }).click();
    await expect(page.getByRole("radio", { name: /Small rack/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.getByRole("button", { name: "Add 2 bottles" }).click();
    await expect(page.getByText("In Small rack.")).toBeVisible();

    // Same vintage again via the API, then a non-vintage bottle, then more than the rack can hold.
    await post("/bottles", { wineId: wine.id, year: 2019, quantity: 1, locationId: rack.id });
    await post("/bottles", { wineId: wine.id, year: null, quantity: 1, locationId: rack.id });
    const overflow = (await post("/bottles", {
      wineId: wine.id,
      year: 2019,
      quantity: 3,
      locationId: rack.id,
    })) as { placed: number; unplaced: number; bottleIds: string[] };
    expect(overflow).toMatchObject({ placed: 0, unplaced: 3 });
    expect(overflow.bottleIds).toHaveLength(3);

    const [counts] = await sql<{
      wines: number;
      vintages: number;
      bottles: number;
      placed: number;
    }>(
      `select (select count(*)::int from public.wines where owner_household_id = $1) as wines,
              (select count(*)::int from public.wine_vintages v join public.wines w on w.id = v.wine_id
                 where w.owner_household_id = $1) as vintages,
              (select count(*)::int from public.bottles where household_id = $1) as bottles,
              (select count(*)::int from public.bottles where household_id = $1 and location_id is not null) as placed`,
      [householdId],
    );
    // 2 wines under 1 producer; the bottled one has 2 vintages (2019 and NV) and 7 physical bottles.
    expect(counts).toEqual({ wines: 2, vintages: 2, bottles: 7, placed: 4 });
    const slots = await sql<{ loc_row: number; loc_col: number }>(
      `select loc_row, loc_col from public.bottles
        where household_id = $1 and location_id is not null order by loc_row, loc_col`,
      [householdId],
    );
    expect(slots.map((s) => `${s.loc_row}:${s.loc_col}`)).toEqual(["1:1", "1:2", "2:1", "2:2"]);

    // The storage list tells the truth about free space.
    const storage = (await (await api(request, token, "get", "/storage")).json()) as Array<{
      label: string;
      used: number;
      free: number;
    }>;
    expect(storage).toEqual([expect.objectContaining({ label: "Small rack", used: 4, free: 0 })]);

    // And the cellar groups bottles by vintage: 2019 ×(2+1+3) incl. unplaced, NV ×1.
    const cellar = (await (await api(request, token, "get", "/cellar")).json()) as {
      bottleCount: number;
      items: Array<{ year: number | null; count: number; unplaced: number }>;
    };
    expect(cellar.bottleCount).toBe(7);
    const byYear = Object.fromEntries(cellar.items.map((i) => [String(i.year), i]));
    expect(byYear["2019"]).toMatchObject({ count: 6, unplaced: 3 });
    expect(byYear["null"]).toMatchObject({ count: 1, unplaced: 0 });
  });

  test("another household sees none of it, and cannot put bottles into it", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "owner");
    const ownerToken = await sessionToken(owner.email);
    const rack = (await (
      await api(request, ownerToken, "post", "/storage", {
        label: "Private rack",
        kind: "rack",
        rows: 3,
        cols: 3,
      })
    ).json()) as { id: string };
    const wine = (await (await api(request, ownerToken, "post", "/wines", wineBody)).json()) as {
      id: string;
    };
    expect(
      (
        await api(request, ownerToken, "post", "/bottles", {
          wineId: wine.id,
          year: 2018,
          quantity: 2,
          locationId: rack.id,
        })
      ).status(),
    ).toBe(201);

    // The other person: their own browser, their own household.
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "other");
    const otherToken = await sessionToken(other.email);

    // Through the app's API: empty, and the owner's ids are "not found", never "forbidden" (no hint they exist).
    expect(await (await api(request, otherToken, "get", "/cellar")).json()).toEqual({
      items: [],
      bottleCount: 0,
    });
    // (The shared catalogue is visible to everyone, so other tests' catalogue wines may be listed:
    // what must never appear is anything the OTHER household added privately.)
    const visible = (await (await api(request, otherToken, "get", "/wines")).json()) as Array<{
      id: string;
    }>;
    expect(visible.map((w) => w.id)).not.toContain(wine.id);
    expect(await (await api(request, otherToken, "get", "/storage")).json()).toEqual([]);
    const intoTheirWine = await api(request, otherToken, "post", "/bottles", {
      wineId: wine.id,
      year: 2018,
      quantity: 1,
      locationId: null,
    });
    expect(intoTheirWine.status()).toBe(404);
    const myWine = (await (await api(request, otherToken, "post", "/wines", wineBody)).json()) as {
      id: string;
    };
    expect(myWine.id).not.toBe(wine.id); // same name, but THEIR private wine
    const intoTheirRack = await api(request, otherToken, "post", "/bottles", {
      wineId: myWine.id,
      year: 2018,
      quantity: 1,
      locationId: rack.id,
    });
    expect(intoTheirRack.status()).toBe(404);

    // Straight at the database's public API as the attacker: the owner's rows do not exist for them…
    const rest = (method: string, path: string, body?: unknown) =>
      fetch(`${STACK}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: PUBLISHABLE_KEY,
          authorization: `Bearer ${otherToken}`,
          "content-type": "application/json",
          prefer: "return=representation",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect(
      await (await rest("GET", `bottles?household_id=eq.${owner.householdId}`)).json(),
    ).toEqual([]);
    expect(await (await rest("GET", `cellar_locations?id=eq.${rack.id}`)).json()).toEqual([]);
    expect(await (await rest("GET", `wines?id=eq.${wine.id}`)).json()).toEqual([]);
    // …and they cannot write into the owner's household even knowing every id.
    const vintageId = (
      await sql<{ id: string }>("select id from public.wine_vintages where wine_id = $1", [wine.id])
    )[0]!.id;
    const forged = await rest("POST", "bottles", {
      household_id: owner.householdId,
      vintage_id: vintageId,
      status: "in_cellar",
    });
    expect(forged.ok).toBe(false);
    const [tally] = await sql<{ n: number }>(
      "select count(*)::int as n from public.bottles where household_id = $1",
      [owner.householdId],
    );
    expect(tally?.n).toBe(2);
    await context.close();
  });
});

test.describe("the cellar screens are accessible and look right in both themes", () => {
  async function stockedCellar(page: Page, browser: Browser) {
    void browser;
    const { email } = await arrive(page, "a11y");
    const token = await sessionToken(email);
    const req = page.context().request;
    const rack = (await (
      await api(req, token, "post", "/storage", {
        label: "Wine fridge",
        kind: "fridge",
        rows: 5,
        cols: 4,
      })
    ).json()) as { id: string };
    const wines = [
      {
        producer: "Château Margaux",
        name: "Pavillon Rouge",
        type: "red",
        countryCode: "FR",
        region: "Bordeaux",
      },
      wineBody,
      {
        producer: "Bollinger",
        name: "Special Cuvée",
        type: "sparkling",
        countryCode: "FR",
        region: "Champagne",
      },
    ];
    for (const [i, w] of wines.entries()) {
      const wine = (await (await api(req, token, "post", "/wines", w)).json()) as { id: string };
      await api(req, token, "post", "/bottles", {
        wineId: wine.id,
        year: 2015 + i,
        quantity: i + 1,
        locationId: i === 2 ? null : rack.id,
      });
    }
  }

  for (const scheme of ["dark", "light"] as const) {
    test(`cellar grid, list and add flow — ${scheme}`, async ({ page, browser }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await stockedCellar(page, browser);

      await page.goto("/cellar");
      await expect(page.getByRole("article")).toHaveCount(3);
      expect(await audit(page), "grid").toEqual([]);
      await page.screenshot({ path: shot(`cellar-grid-${scheme}-${project()}`), fullPage: true });

      await page.getByRole("radio", { name: "List" }).click();
      expect(await audit(page), "list").toEqual([]);

      await page.goto("/cellar/add");
      await expect(
        page.getByRole("button", { name: /Château Margaux|Pavillon Rouge/ }),
      ).toBeVisible();
      expect(await audit(page), "choose").toEqual([]);
      await page.screenshot({ path: shot(`add-choose-${scheme}-${project()}`), fullPage: true });
      await page.getByRole("button", { name: /Pavillon Rouge/ }).click();
      await expect(page.getByLabel("Vintage")).toBeVisible();
      expect(await audit(page), "details").toEqual([]);
      await page.screenshot({ path: shot(`add-details-${scheme}-${project()}`), fullPage: true });
    });
  }
});
