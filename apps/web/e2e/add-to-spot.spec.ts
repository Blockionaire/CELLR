import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { api, apiClient, arrive, makeJpeg, sessionToken, sql, STACK, wineBody } from "./helpers";

/**
 * "Add a bottle here": an empty spot tapped in a rack opens the add flow with that place, shelf and position
 * already chosen, and the new bottle lands exactly there (the others, if more, on the next free spots).
 */
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

/** A 4×5 "Stellingkast" with two bottles (1:1, 1:2) and an empty 2×2 "Fridge"; every bottle has a place. */
async function furnish(call: Call) {
  const rack = (
    await call(
      "post",
      "/storage",
      { label: "Stellingkast", kind: "shelving", rows: 4, cols: 5 },
      201,
    )
  ).body as { id: string };
  const fridge = (
    await call("post", "/storage", { label: "Fridge", kind: "fridge", rows: 2, cols: 2 }, 201)
  ).body as { id: string };
  const wine = (await call("post", "/wines", wineBody, 201)).body as { id: string };
  await call(
    "post",
    "/bottles",
    { wineId: wine.id, year: 2019, quantity: 2, locationId: rack.id },
    201,
  );
  return { rack: rack.id, fridge: fridge.id, wine: wine.id };
}

/** Every bottle of this household, as "Place row:col" (or "unplaced"), per wine name. */
const spots = async (householdId: string, wineName: string) =>
  (
    await sql<{ place: string | null; row: number | null; col: number | null }>(
      `select l.label as place, b.loc_row as row, b.loc_col as col
         from public.bottles b
         join public.wine_vintages v on v.id = b.vintage_id
         join public.wines w on w.id = v.wine_id
         left join public.cellar_locations l on l.id = b.location_id
        where b.household_id = $1 and w.name = $2 and b.status = 'in_cellar'
        order by b.created_at, b.loc_row nulls last, b.loc_col nulls last`,
      [householdId, wineName],
    )
  ).map((r) => (r.place ? `${r.place} ${r.row}:${r.col}` : "unplaced"));

const openRacks = async (page: Page) => {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "Racks" }).click();
  await expect(page.getByRole("heading", { name: "Stellingkast" })).toBeVisible();
  const folded = page.getByTestId("place").getByRole("button", { expanded: false });
  while ((await folded.count()) > 0) await folded.first().click();
};

const place = (page: Page, name: string) =>
  page.getByRole("radio", { name: new RegExp(`^${name}`) });

test.describe("adding a bottle on the spot you tapped", () => {
  test("the spot travels from the rack to the form, survives choosing or creating a wine, and the bottles land on it", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "addspot");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    await openRacks(page);

    // 1. the empty spot carries its place, shelf and position
    await page
      .getByRole("region", { name: "Stellingkast" })
      .getByRole("button", { name: "Shelf 2, position 3, empty" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Place a bottle here" })).toBeVisible();
    const link = dialog.getByRole("link", { name: "Add a bottle" });
    await expect(link).toHaveAttribute("href", `/cellar/add?place=${ids.rack}&row=2&col=3`);
    await link.click();
    await expect(page).toHaveURL(/\/cellar\/add\?place=.*&row=2&col=3$/);

    // the scanner offered from here keeps the spot too
    await expect(page.getByRole("link", { name: /Scan wine/ })).toHaveAttribute(
      "href",
      `/scan?place=${ids.rack}&row=2&col=3`,
    );

    // 2. an existing wine: the place and the exact spot are chosen and shown
    await page
      .getByRole("button", { name: /Chablis Premier Cru/ })
      .first()
      .click();
    await expect(place(page, "Stellingkast")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("add-spot")).toContainText("Stellingkast · Shelf 2 · Position 3");

    // switching to a new wine keeps the spot
    await page.getByRole("button", { name: "Change" }).click();
    await page.getByLabel("Search your wines, or add a new one").fill("Cuvée Exacte");
    await page.getByRole("button", { name: /as a new wine/ }).click();
    await page.getByLabel("Producer").fill("Domaine Spot");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("add-spot")).toContainText("Stellingkast · Shelf 2 · Position 3");

    // 6. three bottles: the first keeps the spot, the others take the next free ones (1:3, 1:4)
    await page.getByLabel("Vintage").fill("2020");
    await page.getByRole("button", { name: "One more" }).click();
    await page.getByRole("button", { name: "One more" }).click();
    await expect(page.getByTestId("add-spot")).toContainText(
      "The first bottle goes here; the other 2 take the next free spots.",
    );
    await page.screenshot({
      path: `test-results/shots/add-spot-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Add 3 bottles" }).click();
    await expect(
      page.getByText("In Stellingkast. The first is on Shelf 2 · Position 3."),
    ).toBeVisible();

    // 3. saved on that spot, not on the first free one (1:3)
    // (one insert: the database keeps no order among them, so compare as a set; the service test pins the order)
    expect((await spots(householdId, "Cuvée Exacte")).sort()).toEqual([
      "Stellingkast 1:3",
      "Stellingkast 1:4",
      "Stellingkast 2:3",
    ]);
    expect(await spots(householdId, "Chablis Premier Cru")).toEqual([
      "Stellingkast 1:1",
      "Stellingkast 1:2",
    ]);

    // "Add another" goes back to choosing, with no spot any more (it is taken)
    await page.getByRole("button", { name: "Add another" }).click();
    await page
      .getByRole("button", { name: /Chablis Premier Cru/ })
      .first()
      .click();
    await expect(page.getByTestId("add-spot")).toBeHidden();
  });

  test("one bottle on the spot; choosing another place clears the spot; a taken spot is refused and another chosen", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "addspot2");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);

    // one bottle: the last screen says exactly where
    await page.goto(`/cellar/add?place=${ids.rack}&row=3&col=5`);
    await page
      .getByRole("button", { name: /Chablis Premier Cru/ })
      .first()
      .click();
    await page.getByLabel("Vintage").fill("2021");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText("In Stellingkast · Shelf 3 · Position 5.")).toBeVisible();

    // 5. another place, then back: the spot is gone, and the bottle takes the first free spot as before
    await page.goto(`/cellar/add?place=${ids.rack}&row=4&col=4`);
    await page
      .getByRole("button", { name: /Chablis Premier Cru/ })
      .first()
      .click();
    await expect(page.getByTestId("add-spot")).toContainText("Shelf 4 · Position 4");
    await place(page, "Fridge").click();
    await expect(page.getByTestId("add-spot")).toBeHidden();
    await place(page, "Stellingkast").click();
    await expect(page.getByTestId("add-spot")).toBeHidden();
    await page.getByLabel("Vintage").fill("2022");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText("In Stellingkast.", { exact: true })).toBeVisible();

    // …and "Not placed yet" clears it too
    await page.goto(`/cellar/add?place=${ids.rack}&row=4&col=4`);
    await page
      .getByRole("button", { name: /Chablis Premier Cru/ })
      .first()
      .click();
    await page.getByRole("radio", { name: /Not placed yet/ }).click();
    await expect(page.getByTestId("add-spot")).toBeHidden();

    // 4. the spot is taken while the form is open: refused with a clear message, nothing added anywhere
    await page.goto(`/cellar/add?place=${ids.rack}&row=4&col=4`);
    await page
      .getByRole("button", { name: /Chablis Premier Cru/ })
      .first()
      .click();
    await page.getByLabel("Vintage").fill("2023");
    await call(
      "post",
      "/bottles",
      { wineId: ids.wine, year: 2018, quantity: 1, locationId: ids.rack, slot: { row: 4, col: 4 } },
      201,
    );
    const before = await spots(householdId, "Chablis Premier Cru");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText("That spot was just taken. Pick another.")).toHaveAttribute(
      "role",
      "alert",
    );
    expect(await spots(householdId, "Chablis Premier Cru")).toEqual(before);

    // …then another spot is chosen in the rack itself, and the bottle goes there
    await page.getByTestId("add-spot").getByRole("button", { name: "Another spot" }).click();
    const picker = page.getByRole("dialog");
    await expect(picker.getByRole("heading", { name: "Choose a spot" })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Shelf 4, position 4, empty" })).toHaveCount(0);
    await picker.getByRole("button", { name: "Shelf 4, position 2, empty" }).click();
    await expect(page.getByTestId("add-spot")).toContainText("Shelf 4 · Position 2");
    await expect(page.getByText("That spot was just taken. Pick another.")).toBeHidden();
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText("In Stellingkast · Shelf 4 · Position 2.")).toBeVisible();
    const [last] = await sql<{ row: number; col: number }>(
      `select b.loc_row as row, b.loc_col as col from public.bottles b
         join public.wine_vintages v on v.id = b.vintage_id
        where b.household_id = $1 and v.year = 2023`,
      [householdId],
    );
    expect(last).toEqual({ row: 4, col: 2 });
  });

  test("bad spots are refused by the API, ignored in the URL, and direct entry is unchanged", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "addspot3");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
    const add = (body: object) =>
      call("post", "/bottles", { wineId: ids.wine, year: 2019, quantity: 1, ...body });

    expect((await add({ locationId: ids.rack, slot: { row: 5, col: 1 } })).status).toBe(422);
    expect((await add({ locationId: ids.rack, slot: { row: 1, col: 6 } })).status).toBe(422);
    expect((await add({ locationId: ids.rack, slot: { row: 0, col: 1 } })).status).toBe(422);
    expect((await add({ locationId: null, slot: { row: 1, col: 1 } })).status).toBe(422);
    const taken = await add({ locationId: ids.rack, slot: { row: 1, col: 1 } });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({
      error: { code: "CONFLICT", message: "That spot was just taken. Pick another." },
    });
    // without a spot: exactly as before (the next free spot)
    const plain = await add({ locationId: ids.rack });
    expect(plain.status).toBe(201);
    expect(plain.body).not.toHaveProperty("firstSlot");

    // a spot past the last shelf, or a malformed one, in the URL: the form opens as it always did
    for (const q of [
      `place=${ids.rack}&row=9&col=1`,
      `place=nope&row=1&col=1`,
      `place=${ids.rack}&row=x`,
    ]) {
      await page.goto(`/cellar/add?${q}`);
      await page
        .getByRole("button", { name: /Chablis Premier Cru/ })
        .first()
        .click();
      await expect(page.getByLabel("Vintage")).toBeVisible();
      await expect(page.getByTestId("add-spot")).toBeHidden();
    }
    // direct entry: no spot, the first place with room is chosen, the scanner link is plain
    await page.goto("/cellar/add");
    await expect(page.getByRole("link", { name: /Scan wine/ })).toHaveAttribute("href", "/scan");
    await page
      .getByRole("button", { name: /Chablis Premier Cru/ })
      .first()
      .click();
    await expect(place(page, "Stellingkast")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("add-spot")).toBeHidden();
  });

  test("another household cannot use the spot: not found over the API, and no spot in their form", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "spotowner");
    const { call } = await apiClient(request, owner.email);
    const ids = await furnish(call);

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "spotother");
    const otherToken = await sessionToken(other.email);
    const theirWine = (await (
      await api(request, otherToken, "post", "/wines", wineBody)
    ).json()) as {
      id: string;
    };
    const into = await api(request, otherToken, "post", "/bottles", {
      wineId: theirWine.id,
      year: 2019,
      quantity: 1,
      locationId: ids.rack,
      slot: { row: 3, col: 3 },
    });
    expect(into.status()).toBe(404);
    const owners = await sql<{ n: string }>(
      "select count(*) as n from public.bottles where location_id = $1",
      [ids.rack],
    );
    expect(owners[0]!.n).toBe("2");

    await otherPage.goto(`/cellar/add?place=${ids.rack}&row=3&col=3`);
    await otherPage
      .getByRole("button", { name: /Chablis Premier Cru/ })
      .first()
      .click();
    await expect(otherPage.getByLabel("Vintage")).toBeVisible();
    await expect(otherPage.getByTestId("add-spot")).toBeHidden();
    await expect(otherPage.getByRole("radio", { name: /^Stellingkast/ })).toHaveCount(0);
    await context.close();
  });

  test("scanning from the spot: the scanned bottle goes on it", async ({ page, request }) => {
    const { email, householdId } = await arrive(page, "spotscan");
    const { call } = await apiClient(request, email);
    const ids = await furnish(call);
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
    // the fake model in the local stack knows this photo by its size (no real AI call)
    const size = {
      width: 433 + test.info().parallelIndex * 41 + (Date.now() % 89),
      height: 611 + test.info().parallelIndex * 13,
    };
    const res = await fetch(`${STACK}/__test/openai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...size,
        content: {
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
        },
      }),
    });
    expect(res.ok).toBe(true);

    await page.goto(`/scan?place=${ids.rack}&row=3&col=2`);
    await expect(page.getByRole("heading", { level: 1, name: "Scan a label" })).toBeVisible();
    const photo = await makeJpeg(page, { ...size, words: "Margaux" });
    // a photo chosen before the page has hydrated is never seen: choose it again until it is read
    await expect(async () => {
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: photo });
      await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible({
        timeout: 4_000,
      });
    }).toPass({ timeout: 30_000 });
    await page.getByRole("button", { name: "Yes, add bottles" }).click();
    await expect(place(page, "Stellingkast")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("add-spot")).toContainText("Stellingkast · Shelf 3 · Position 2");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText("In Stellingkast · Shelf 3 · Position 2.")).toBeVisible();
    expect(await spots(householdId, "Pavillon Rouge")).toEqual(["Stellingkast 3:2"]);
  });
});
