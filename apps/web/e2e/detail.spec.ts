import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import {
  api,
  apiClient,
  arrive,
  audit,
  PUBLISHABLE_KEY,
  sessionToken,
  sql,
  stamp,
  STACK,
  wineBody,
} from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

type Api = Awaited<ReturnType<typeof apiClient>>["call"];

/** A fridge (5 shelves × 4 positions) and `quantity` bottles of one 2019 wine in it. */
async function stock(call: Api, quantity = 3, extra: { name?: string; year?: number | null } = {}) {
  const fridge = (
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 5, cols: 4 }, 201)
  ).body as {
    id: string;
  };
  const wine = (
    await call("post", "/wines", { ...wineBody, ...(extra.name ? { name: extra.name } : {}) }, 201)
  ).body as {
    id: string;
  };
  await call(
    "post",
    "/bottles",
    {
      wineId: wine.id,
      year: extra.year === undefined ? 2019 : extra.year,
      quantity,
      locationId: fridge.id,
      priceCents: 2450,
    },
    201,
  );
  const cellar = (await call("get", "/cellar")).body as { items: Array<{ vintageId: string }> };
  return { fridgeId: fridge.id, wineId: wine.id, vintageId: cellar.items[0]!.vintageId };
}

async function bottlesOf(vintageId: string) {
  return sql<{
    id: string;
    status: string;
    location_id: string | null;
    loc_row: number | null;
    loc_col: number | null;
    opened_at: string | null;
  }>(
    `select id, status, location_id, loc_row, loc_col, opened_at from public.bottles
      where vintage_id = $1 order by created_at, id`,
    [vintageId],
  );
}

/** id → "row:col" ("-" when not placed), for asserting where each specific bottle ended up. */
async function slotsById(vintageId: string) {
  const rows = await bottlesOf(vintageId);
  return Object.fromEntries(
    rows.map((r) => [r.id, r.loc_row === null ? "-" : `${r.loc_row}:${r.loc_col}`]),
  ) as Record<string, string>;
}

/** Bottles of a freshly stocked vintage, ordered by their spot (so "first" is the one at 1:1). */
async function bottlesBySlot(vintageId: string) {
  return (await bottlesOf(vintageId)).sort(
    (a, b) => (a.loc_row ?? 99) - (b.loc_row ?? 99) || (a.loc_col ?? 99) - (b.loc_col ?? 99),
  );
}

const count = (page: Page) => page.getByTestId("bottle-count");

test.describe("a wine's page and opening a bottle", () => {
  test("from the cellar to the wine, open one of three: counts drop everywhere, Undo brings it back, the last one leaves a calm page", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "open");
    const { call } = await apiClient(request, email);
    const { vintageId } = await stock(call, 3);

    const before = await bottlesOf(vintageId);
    const atSlot12 = before.find((r) => r.loc_row === 1 && r.loc_col === 2)!.id;

    // Cellar → the wine's page.
    await page.goto("/cellar");
    await expect(page.getByRole("article")).toContainText("×3");
    await page.getByRole("link", { name: "Chablis Premier Cru" }).click();
    await expect(page).toHaveURL(new RegExp(`/cellar/${vintageId}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Chablis Premier Cru" }),
    ).toBeVisible();
    await expect(page.getByText("Domaine Test", { exact: true })).toBeVisible();
    await expect(page.getByText("2019 · Burgundy, France")).toBeVisible();
    await expect(count(page)).toHaveText("3");
    // The bottles are grouped by place, each with its exact shelf and position.
    const fridge = page.getByTestId("bottle-places").getByRole("region", { name: "Wine fridge" });
    await expect(fridge).toContainText("×3");
    await expect(fridge.getByRole("listitem")).toHaveCount(3);
    await expect(fridge.getByText(/^Shelf \d+ · Position \d+$/)).toHaveCount(3);
    await expect(page.getByText("€24.50").first()).toBeVisible(); // average price
    await expect(page.getByText("3 bottles added")).toBeVisible();
    await page.screenshot({ path: shot(`detail-${project()}`), fullPage: true });

    // Open one: the sheet asks WHICH bottle; the easiest to reach is already chosen.
    await page.getByRole("button", { name: "Open a bottle" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio")).toHaveCount(3);
    await expect(dialog.getByRole("radio").first()).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByText("Easiest to reach")).toBeVisible();
    await dialog.getByRole("radio").nth(1).click(); // …but take the second one
    await page.screenshot({ path: shot(`open-sheet-${project()}`) });
    await dialog.getByRole("button", { name: "Open it" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Enjoy! 2 bottles left.")).toBeVisible();
    await expect(count(page)).toHaveText("2");
    await expect(page.getByText("1 bottle opened", { exact: true }).first()).toBeVisible();

    let rows = await bottlesOf(vintageId);
    const opened = rows.find((r) => r.id === atSlot12);
    expect(rows.filter((r) => r.status === "opened")).toHaveLength(1);
    expect(opened).toMatchObject({
      status: "opened",
      location_id: null,
      loc_row: null,
      loc_col: null,
    });
    expect(opened!.opened_at).not.toBeNull();
    expect(
      rows
        .filter((r) => r.status === "in_cellar")
        .map((r) => `${r.loc_row}:${r.loc_col}`)
        .sort(),
    ).toEqual(["1:1", "1:3"]);

    // Everywhere else agrees: the cellar card and the summary.
    await page.goto("/cellar");
    await expect(page.getByRole("article")).toContainText("×2");
    await expect(page.getByText("2 bottles · 1 wine")).toBeVisible();

    // Undo (on the wine's page, right after opening): back in its old spot.
    await page.goBack();
    await expect(count(page)).toHaveText("2");
    await page.getByRole("button", { name: "Open a bottle" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Open it" }).click();
    await expect(count(page)).toHaveText("1");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Back in your cellar.")).toBeVisible();
    await expect(count(page)).toHaveText("2");
    rows = await bottlesOf(vintageId);
    expect(rows.filter((r) => r.status === "in_cellar")).toHaveLength(2);

    // The last bottles: a calm "no bottles left" page with a way to add more, vintage pre-filled.
    for (const left of [1, 0]) {
      await page.getByRole("button", { name: "Open a bottle" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Open it" }).click();
      if (left > 0) await expect(count(page)).toHaveText(String(left));
    }
    await expect(page.getByText("No bottles left")).toBeVisible();
    await expect(page.getByText("That was your last one.")).toBeVisible();
    await page.screenshot({ path: shot(`detail-empty-${project()}`), fullPage: true });
    await page.getByRole("link", { name: "Add more" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "How many, and where?" }),
    ).toBeVisible();
    await expect(page.getByLabel("Vintage")).toHaveValue("2019");
    await expect(page.getByText("Chablis Premier Cru")).toBeVisible();

    // …and the cellar no longer lists it.
    await page.goto("/cellar");
    await expect(page.getByRole("heading", { name: "Your cellar starts here." })).toBeVisible();
  });

  test("a bottle that is already open cannot be opened again, and removing one leaves the rest alone", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "twice");
    const { call } = await apiClient(request, email);
    const { vintageId } = await stock(call, 2);
    const [first, second] = await bottlesOf(vintageId);

    expect(
      (await call("patch", `/bottles/${first!.id}`, { action: "open" }, 200)).body,
    ).toMatchObject({
      bottle: { status: "opened" },
    });
    const again = await call<{ error: { code: string } }>("patch", `/bottles/${first!.id}`, {
      action: "open",
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CONFLICT");

    await call("patch", `/bottles/${second!.id}`, { action: "remove" }, 200);
    const rows = await bottlesOf(vintageId);
    expect(rows.map((r) => r.status)).toEqual(["opened", "removed"]);
  });
});

test.describe("moving a bottle", () => {
  test("tap a free spot to move it; Undo moves it back; taking it out leaves it without a place", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "move");
    const { call } = await apiClient(request, email);
    const { vintageId } = await stock(call, 2);
    const [first, second] = await bottlesBySlot(vintageId);

    await page.goto(`/cellar/${vintageId}`);
    await page.getByRole("button", { name: "Move", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("img", { name: /shelf 1, position 1/i })).toBeVisible(); // a bottle, drawn in its spot
    await expect(dialog.getByRole("button", { name: "Shelf 3, position 2, empty" })).toBeVisible();
    await page.screenshot({ path: shot(`move-sheet-${project()}`) });
    await dialog.getByRole("button", { name: "Shelf 3, position 2, empty" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Moved to Wine fridge · Shelf 3 · Position 2.")).toBeVisible();
    await expect(page.getByText("Shelf 3 · Position 2").first()).toBeVisible();
    expect(await slotsById(vintageId)).toEqual({ [first!.id]: "3:2", [second!.id]: "1:2" });

    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(() => slotsById(vintageId))
      .toEqual({ [first!.id]: "1:1", [second!.id]: "1:2" });
    // …and wait until the page itself shows it back, so the next step starts from what the person sees.
    await expect(page.getByText("Shelf 1 · Position 1").first()).toBeVisible();
    await expect(page.getByText("Shelf 3 · Position 2")).toHaveCount(0);

    // Take the first bottle out of its place.
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Take it out of its place" })
      .click();
    await expect(page.getByText("Taken out of its place.")).toBeVisible();
    await expect(page.getByText("Not placed yet").first()).toBeVisible();
    await expect
      .poll(() => slotsById(vintageId))
      .toEqual({ [first!.id]: "-", [second!.id]: "1:2" });
  });

  test("two people grabbing the same spot: the second gets a plain message and nothing is overwritten", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "clash");
    const { call } = await apiClient(request, email);
    const { vintageId } = await stock(call, 2);
    const [a, b] = await bottlesBySlot(vintageId);
    const fridge = a!.location_id!;

    expect(
      (
        await call("patch", `/bottles/${a!.id}`, {
          action: "move",
          to: { locationId: fridge, row: 5, col: 4 },
        })
      ).status,
    ).toBe(200);
    const clash = await call<{ error: { code: string; message: string } }>(
      "patch",
      `/bottles/${b!.id}`,
      {
        action: "move",
        to: { locationId: fridge, row: 5, col: 4 },
      },
    );
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toBe("That spot was just taken. Pick another.");
    expect(await slotsById(vintageId)).toEqual({ [a!.id]: "5:4", [b!.id]: "1:2" });

    // A spot that does not exist is refused too.
    const outside = await call("patch", `/bottles/${b!.id}`, {
      action: "move",
      to: { locationId: fridge, row: 6, col: 1 },
    });
    expect(outside.status).toBe(422);
  });
});

test.describe("editing", () => {
  test("rename the wine, correct the region, set what you paid: the page and the database agree", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "edit");
    const { call } = await apiClient(request, email);
    const { vintageId, wineId } = await stock(call, 2);

    await page.goto(`/cellar/${vintageId}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Wine name")).toHaveValue("Chablis Premier Cru");
    await expect(dialog.getByLabel("Price per bottle (€)")).toHaveValue("24.50");
    await dialog.getByLabel("Wine name").fill("Chablis Grand Cru");
    await dialog.getByLabel("Region").fill("Chablis");
    await dialog.getByLabel("Price per bottle (€)").fill("31,00");
    await dialog.getByLabel("Purchase date").fill("2026-09-15");
    await dialog.getByLabel("Bought at").fill("Wijnhandel Test");
    await page.screenshot({ path: shot(`edit-sheet-${project()}`) });
    await dialog.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Chablis Grand Cru" })).toBeVisible();
    await expect(page.getByText("2019 · Chablis, France")).toBeVisible();
    await expect(page.getByText("€31.00").first()).toBeVisible();
    await expect(page.getByText(/Sep(t)?\.? 15, 2026|15 Sep(t)?\.? 2026/)).toBeVisible();

    const [wine] = await sql<{ name: string; region: string }>(
      "select name, region from public.wines where id = $1",
      [wineId],
    );
    expect(wine).toEqual({ name: "Chablis Grand Cru", region: "Chablis" });
    const paid = await sql<{
      purchase_price_cents: number;
      currency: string;
      purchased_from: string;
      purchased_at: string;
    }>(
      `select purchase_price_cents, currency, purchased_from, purchased_at::text from public.bottles where household_id = $1`,
      [householdId],
    );
    expect(paid).toHaveLength(2);
    expect(
      paid.every(
        (p) =>
          p.purchase_price_cents === 3100 &&
          p.currency === "EUR" &&
          p.purchased_from === "Wijnhandel Test" &&
          p.purchased_at === "2026-09-15",
      ),
    ).toBe(true);
  });

  test("a name that already exists under the same producer is refused in words; shared-catalogue wines are read-only", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "dupe");
    const { call } = await apiClient(request, email);
    const { wineId } = await stock(call, 1);
    const other = (await call("post", "/wines", { ...wineBody, name: "Chablis Grand Cru" }, 201))
      .body as { id: string };
    const clash = await call<{ error: { message: string } }>("patch", `/wines/${wineId}`, {
      name: "chablis GRAND cru",
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toBe(
      "You already have a wine with that name from this producer.",
    );
    expect(other.id).not.toBe(wineId);

    // A wine from the shared catalogue (owner = nobody) can be owned in bottles but not rewritten.
    const [{ id: producerId }] = (await sql<{ id: string }>(
      `insert into public.producers (name, status, origin) values ($1, 'canonical', 'verified') returning id`,
      [`Catalogue Producer ${stamp()}`],
    )) as [{ id: string }];
    const [{ id: canonId }] = (await sql<{ id: string }>(
      `insert into public.wines (producer_id, name, wine_type, status, origin)
         values ($1, 'Catalogue Wine', 'red', 'canonical', 'verified') returning id`,
      [producerId],
    )) as [{ id: string }];
    await sql(`insert into public.wine_vintages (wine_id, year) values ($1, 2010)`, [canonId]);
    await call("post", "/bottles", { wineId: canonId, year: 2010, quantity: 1 }, 201);
    const forbidden = await call<{ error: { code: string } }>("patch", `/wines/${canonId}`, {
      name: "Hacked",
    });
    expect(forbidden.status).toBe(403);
    const [still] = await sql<{ name: string }>("select name from public.wines where id = $1", [
      canonId,
    ]);
    expect(still!.name).toBe("Catalogue Wine");
  });
});

test.describe("another household", () => {
  test("cannot see, open, move, edit or reprice anything of yours, not even straight at the database", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "owner");
    const { call: ownerCall } = await apiClient(request, owner.email);
    const { vintageId, wineId, fridgeId } = await stock(ownerCall, 2);
    const [bottle] = await bottlesOf(vintageId);

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "other");
    const { call, token } = await apiClient(request, other.email);

    // Through the app: everything is simply "not found" (never a hint that it exists).
    for (const [method, path, body] of [
      ["get", `/cellar/${vintageId}`, undefined],
      ["patch", `/bottles/${bottle!.id}`, { action: "open" }],
      ["patch", `/bottles/${bottle!.id}`, { action: "move", to: { locationId: null } }],
      ["patch", `/bottles/${bottle!.id}`, { action: "remove" }],
      ["patch", `/wines/${wineId}`, { name: "Mine now" }],
      ["patch", `/cellar/${vintageId}/purchase`, { priceCents: 1 }],
    ] as const) {
      const res = await call(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // …and the owner's page shows "not found" to them too.
    await otherPage.goto(`/cellar/${vintageId}`);
    await expect(
      otherPage.getByRole("heading", { name: "We couldn't find that page." }),
    ).toBeVisible();

    // Straight at the database's public API with their token: no rows change.
    const rest = (method: string, path: string, body?: unknown) =>
      fetch(`${STACK}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: PUBLISHABLE_KEY,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          prefer: "return=representation",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const touched = async (res: Response) =>
      res.ok ? ((await res.json()) as unknown[]).length : 0;
    expect(
      await touched(await rest("PATCH", `bottles?id=eq.${bottle!.id}`, { status: "opened" })),
    ).toBe(0);
    expect(
      await touched(
        await rest("PATCH", `bottles?household_id=eq.${owner.householdId}`, {
          purchase_price_cents: 1,
        }),
      ),
    ).toBe(0);
    expect(await touched(await rest("PATCH", `wines?id=eq.${wineId}`, { name: "Hacked" }))).toBe(0);
    expect(
      await touched(await rest("PATCH", `cellar_locations?id=eq.${fridgeId}`, { label: "Hacked" })),
    ).toBe(0);
    expect(await touched(await rest("DELETE", `bottles?id=eq.${bottle!.id}`))).toBe(0);

    const after = await bottlesOf(vintageId);
    expect(after.every((r) => r.status === "in_cellar")).toBe(true);
    const [wine] = await sql<{ name: string }>("select name from public.wines where id = $1", [
      wineId,
    ]);
    expect(wine!.name).toBe("Chablis Premier Cru");
    const [price] = await sql<{ purchase_price_cents: number }>(
      "select purchase_price_cents from public.bottles where id = $1",
      [bottle!.id],
    );
    expect(price!.purchase_price_cents).toBe(2450);
    await sessionToken(owner.email); // the owner still signs in fine
    await context.close();
  });
});

test.describe("the wine's page and its sheets are accessible in both themes", () => {
  for (const scheme of ["dark", "light"] as const) {
    test(scheme, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const { email } = await arrive(page, "a11y2");
      const { call } = await apiClient(request, email);
      const { vintageId } = await stock(call, 3);

      await page.goto(`/cellar/${vintageId}`);
      await expect(page.getByTestId("bottle-count")).toHaveText("3");
      expect(await audit(page), "page").toEqual([]);
      await page.screenshot({ path: shot(`detail-${scheme}-${project()}`), fullPage: true });

      for (const [button, name] of [
        ["Open a bottle", "open"],
        ["Move", "move"],
        ["Edit", "edit"],
      ] as const) {
        await page.getByRole("button", { name: button, exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        if (name === "move")
          await expect(
            page.getByRole("dialog").getByRole("img", { name: /shelf 1, position 1/i }),
          ).toBeVisible();
        await page.waitForTimeout(450); // let the sheet finish fading in: contrast is measured on settled colours
        expect(await audit(page), name).toEqual([]);
        await page.screenshot({ path: shot(`${name}-sheet-${scheme}-${project()}`) });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden();
      }
    });
  }
});

// Referenced so an unused-import lint stays quiet when a test above is skipped locally.
void api;
