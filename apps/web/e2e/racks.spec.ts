import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { api, apiClient, arrive, audit, PUBLISHABLE_KEY, sql, STACK, wineBody } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const CUVEE = {
  producer: "Bollinger",
  name: "Special Cuvée",
  type: "sparkling",
  countryCode: "FR",
  region: "Champagne",
};

/**
 * A 5×4 fridge with 3 bottles of the Chablis, a small 2×3 rack with 1 bottle of a red, and 2 bottles
 * of a champagne that have no place yet.
 */
async function furnish(call: Call) {
  const fridge = (
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 5, cols: 4 }, 201)
  ).body as { id: string };
  const rack = (
    await call("post", "/storage", { label: "Small rack", kind: "rack", rows: 2, cols: 3 }, 201)
  ).body as { id: string };
  const make = async (wine: object, year: number, quantity: number, locationId: string | null) => {
    const w = (await call("post", "/wines", wine, 201)).body as { id: string };
    await call("post", "/bottles", { wineId: w.id, year, quantity, locationId }, 201);
    return w.id;
  };
  const chablis = await make(wineBody, 2019, 3, fridge.id);
  await make(
    {
      producer: "Château Margaux",
      name: "Pavillon Rouge",
      type: "red",
      countryCode: "FR",
      region: "Bordeaux",
    },
    2015,
    1,
    rack.id,
  );
  await make(CUVEE, 2017, 2, null);
  return { fridgeId: fridge.id, rackId: rack.id, chablis };
}

/** With several places they start folded: open the one asked for (or all). */
const unfold = async (page: Page, name?: string) => {
  const folded = page
    .getByTestId("place")
    .getByRole("button", { expanded: false, ...(name ? { name, exact: true } : {}) });
  while ((await folded.count()) > 0) await folded.first().click();
};

const open = async (page: Page) => {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "Racks" }).click();
  await expect(page.getByRole("heading", { name: "Wine fridge" })).toBeVisible();
  await unfold(page);
};

const slotOf = async (householdId: string, wineName: string, year: number) =>
  (
    await sql<{ place: string | null; row: number | null; col: number | null; status: string }>(
      `select l.label as place, b.loc_row as row, b.loc_col as col, b.status
         from public.bottles b
         join public.wine_vintages v on v.id = b.vintage_id
         join public.wines w on w.id = v.wine_id
         left join public.cellar_locations l on l.id = b.location_id
        where b.household_id = $3 and w.name = $1 and v.year = $2
        order by b.loc_row nulls last, b.loc_col nulls last`,
      [wineName, year, householdId],
    )
  ).map((r) =>
    r.status !== "in_cellar" ? r.status : r.place ? `${r.place} ${r.row}:${r.col}` : "unplaced",
  );

test.describe("the racks view", () => {
  test("every bottle in its spot; tap a bottle, choose Move, tap a free spot; Undo; place the unplaced ones", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "racks");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await open(page);

    await expect(page.getByText("Wine fridge").first()).toBeVisible();
    await expect(page.getByText("3 of 20 · 17 free")).toBeVisible();
    await expect(page.getByText("Rack · 1 of 6 · 5 free")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Not placed yet/ })).toContainText("2");
    await page.screenshot({ path: shot(`racks-${project()}`), fullPage: true });

    // Tap a bottle → its options → Move → tap any free spot.
    await page
      .getByRole("button", { name: /Chablis Premier Cru 2019, shelf 1, position 1/i })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Wine fridge · Shelf 1 · Position 1")).toBeVisible();
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByText("Moving Chablis Premier Cru 2019. Tap a free spot.")).toBeVisible();
    await page
      .getByRole("region", { name: "Wine fridge" })
      .getByRole("button", { name: "Shelf 4, position 3, empty" })
      .click();
    await expect(page.getByText("Moved to Wine fridge · Shelf 4 · Position 3.")).toBeVisible();
    await expect(page.getByText(/Moving Chablis/)).toBeHidden();
    expect(await slotOf(householdId, "Chablis Premier Cru", 2019)).toEqual([
      "Wine fridge 1:2",
      "Wine fridge 1:3",
      "Wine fridge 4:3",
    ]);

    // …and Undo puts it back.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(() => slotOf(householdId, "Chablis Premier Cru", 2019))
      .toEqual(["Wine fridge 1:1", "Wine fridge 1:2", "Wine fridge 1:3"]);

    // Unplaced bottles: pick one from the tray, then tap a free spot in ANY place.
    await page.getByRole("button", { name: "Special Cuvée 2017" }).first().click();
    await expect(page.getByText("Moving Special Cuvée 2017. Tap a free spot.")).toBeVisible();
    await page
      .getByRole("region", { name: "Small rack" })
      .getByRole("button", { name: "Shelf 2, position 3, empty" })
      .click();
    await expect(page.getByText("Moved to Small rack · Shelf 2 · Position 3.")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Not placed yet/ })).toContainText("1");

    // Tap a free spot with nothing selected: choose which unplaced bottle goes there.
    await page
      .getByRole("region", { name: "Wine fridge" })
      .getByRole("button", { name: "Shelf 5, position 1, empty" })
      .click();
    await expect(dialog.getByRole("heading", { name: "Place a bottle here" })).toBeVisible();
    await dialog.getByRole("button", { name: /Special Cuvée 2017/ }).click();
    await expect(page.getByText("Moved to Wine fridge · Shelf 5 · Position 1.")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Not placed yet/ })).toBeHidden();
    expect(await slotOf(householdId, "Special Cuvée", 2017)).toEqual([
      "Small rack 2:3",
      "Wine fridge 5:1",
    ]);

    // Tapping a free spot when EVERY bottle has a place offers to add one.
    await page
      .getByRole("region", { name: "Wine fridge" })
      .getByRole("button", { name: "Shelf 3, position 3, empty" })
      .click();
    await expect(dialog.getByText("Every bottle already has a place.")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Add a bottle" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Open a bottle straight from the rack, then look at its page.
    await page.getByRole("button", { name: /Pavillon Rouge 2015, shelf 1, position 1/i }).click();
    await dialog.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByText("Enjoy! That was your last one.")).toBeVisible();
    expect(await slotOf(householdId, "Pavillon Rouge", 2015)).toEqual(["opened"]);
    await expect(
      page.getByText("Rack · 0 of 6 · 6 free").or(page.getByText("Rack · 1 of 6 · 5 free")),
    ).toBeVisible();

    await page
      .getByRole("button", { name: /Chablis Premier Cru 2019, shelf 1, position 2/i })
      .click();
    await dialog.getByRole("link", { name: "Details" }).click();
    await expect(page).toHaveURL(/\/cellar\/[0-9a-f-]{36}$/);
  });
});

test.describe("managing places", () => {
  test("rename, resize, the database's guard against shrinking over bottles, and deleting only when empty", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "manage");
    const { call } = await apiClient(request, email);
    const { rackId, chablis } = await furnish(call);
    void chablis;
    await open(page);

    const manage = async (name: string) => {
      await expect(page.getByRole("heading", { name })).toBeVisible();
      await unfold(page, name);
      await page.getByRole("region", { name }).getByRole("button", { name: "Manage" }).click();
    };
    const dialog = page.getByRole("dialog");

    // Rename and make it bigger.
    await manage("Small rack");
    await dialog.getByLabel("Name").fill("Cellar rack");
    await dialog
      .getByRole("group", { name: "Shelves" })
      .getByRole("button", { name: "One more" })
      .click();
    await expect(dialog.getByText("Room for 9 bottles")).toBeVisible();
    await page.screenshot({ path: shot(`manage-place-${project()}`) });
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cellar rack" })).toBeVisible();
    await expect(page.getByText("Rack · 1 of 9 · 8 free")).toBeVisible();

    // Shrinking past the bottle standing at shelf 1 position 1 is refused in words.
    await manage("Cellar rack");
    await dialog
      .getByRole("group", { name: "Positions per shelf" })
      .getByRole("button", { name: "One fewer" })
      .click();
    await dialog
      .getByRole("group", { name: "Positions per shelf" })
      .getByRole("button", { name: "One fewer" })
      .click();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible(); // it fit: the bottle is in column 1

    // Put a bottle in the last column, then try to remove that column.
    const rows = await sql<{ id: string }>(`select id from public.cellar_locations where id = $1`, [
      rackId,
    ]);
    expect(rows).toHaveLength(1);
    const res = await call("patch", `/storage/${rackId}`, { cols: 3 }, 200);
    expect((res.body as { cols: number }).cols).toBe(3);
    const cuvee = (await call<Array<{ id: string; name: string }>>("get", "/wines")).body;
    const cuveeId = cuvee.find((w) => w.name === "Special Cuvée")!.id;
    await call(
      "post",
      "/bottles",
      { wineId: cuveeId, year: 2017, quantity: 8, locationId: rackId },
      201,
    ); // fills the rack
    const shrink = await call<{ error: { message: string } }>("patch", `/storage/${rackId}`, {
      rows: 1,
    });
    expect(shrink.status).toBe(409);
    expect(shrink.body.error.message).toBe(
      "There are still bottles in the part you're removing. Move them first.",
    );

    // Deleting a place that still holds bottles is refused (two taps: it asks to be sure).
    await page.reload();
    await page.getByRole("radio", { name: "Racks" }).click();
    await manage("Cellar rack");
    await dialog.getByRole("button", { name: "Delete this place" }).click();
    await dialog.getByRole("button", { name: "Tap again to delete it" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "There are still bottles in it. Move them out first.",
    );
    await page.keyboard.press("Escape");

    // Empty it (open every bottle), then delete.
    const inRack = await sql<{ id: string }>(
      `select id from public.bottles where location_id = $1`,
      [rackId],
    );
    for (const b of inRack) await call("patch", `/bottles/${b.id}`, { action: "open" }, 200);
    await page.reload();
    await page.getByRole("radio", { name: "Racks" }).click();
    await manage("Cellar rack");
    await dialog.getByRole("button", { name: "Delete this place" }).click();
    await dialog.getByRole("button", { name: "Tap again to delete it" }).click();
    await expect(page.getByText("Place deleted.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cellar rack" })).toBeHidden();
    expect(await sql(`select 1 from public.cellar_locations where id = $1`, [rackId])).toHaveLength(
      0,
    );
  });

  test("a member may arrange the bottles but only the owner can delete a place", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "boss");
    const { call: ownerCall } = await apiClient(request, owner.email);
    const place = (
      await ownerCall(
        "post",
        "/storage",
        { label: "Owner's fridge", kind: "fridge", rows: 2, cols: 2 },
        201,
      )
    ).body as { id: string };

    // A second person joins the household with an invite code.
    const invite = await ownerCall<{ code: string }>(
      "post",
      `/households/${owner.householdId}/invites`,
      {},
      201,
    );
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const memberPage = await context.newPage();
    const member = await arrive(memberPage, "member");
    const { call: memberCall, token: memberToken } = await apiClient(request, member.email);
    await memberCall("post", "/households/join", { code: invite.body.code }, 200);
    // Work inside the owner's household (joining may already have switched to it; this makes sure).
    expect(
      (
        await api(request, memberToken, "put", "/households/active", {
          householdId: owner.householdId,
        })
      ).ok(),
    ).toBe(true);

    const asMember = await memberCall<{ error: { code: string } }>(
      "delete",
      `/storage/${place.id}`,
    );
    expect(asMember.status).toBe(403); // sees the place (it is their household too) but may not delete it
    expect(asMember.body.error.code).toBe("FORBIDDEN");
    expect(
      await sql(`select 1 from public.cellar_locations where id = $1`, [place.id]),
    ).toHaveLength(1);
    await ownerCall("delete", `/storage/${place.id}`, undefined, 204);
    expect(
      await sql(`select 1 from public.cellar_locations where id = $1`, [place.id]),
    ).toHaveLength(0);
    await context.close();
  });

  test("another household cannot rename or delete your places, not even straight at the database", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "own");
    const { call: ownerCall } = await apiClient(request, owner.email);
    const { rackId } = await furnish(ownerCall);

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "oth");
    const { call, token } = await apiClient(request, other.email);
    expect((await call("patch", `/storage/${rackId}`, { label: "Mine" })).status).toBe(404);
    expect((await call("delete", `/storage/${rackId}`)).status).toBe(404);

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
      await touched(await rest("PATCH", `cellar_locations?id=eq.${rackId}`, { label: "Hacked" })),
    ).toBe(0);
    expect(await touched(await rest("DELETE", `cellar_locations?id=eq.${rackId}`))).toBe(0);
    const [still] = await sql<{ label: string }>(
      `select label from public.cellar_locations where id = $1`,
      [rackId],
    );
    expect(still!.label).toBe("Small rack");
    // The other person's own racks view shows nothing of the owner's.
    await otherPage.goto("/cellar");
    await expect(
      otherPage.getByRole("heading", { name: "Your cellar starts here." }),
    ).toBeVisible();
    await context.close();
  });
});

test.describe("the racks view is accessible in both themes", () => {
  for (const scheme of ["dark", "light"] as const) {
    test(scheme, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const { email } = await arrive(page, "a11y3");
      const { call } = await apiClient(request, email);
      await furnish(call);
      await open(page);
      expect(await audit(page), "racks").toEqual([]);
      await page.screenshot({ path: shot(`racks-${scheme}-${project()}`), fullPage: true });

      await page
        .getByRole("button", { name: /Chablis Premier Cru 2019, shelf 1, position 1/i })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await audit(page), "peek").toEqual([]);
      await page.keyboard.press("Escape");

      await page
        .getByRole("region", { name: "Wine fridge" })
        .getByRole("button", { name: "Manage" })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await audit(page), "manage").toEqual([]);
      await page.keyboard.press("Escape");

      await page
        .getByRole("region", { name: "Wine fridge" })
        .getByRole("button", { name: "Shelf 5, position 4, empty" })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await audit(page), "place here").toEqual([]);
    });
  }
});
