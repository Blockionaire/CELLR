import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiClient, arrive, askExample, audit, sql } from "./helpers";

/**
 * UX sprint: a compact Sommelier (two example questions on a phone, the rest behind "More ideas") and the exact
 * place of a wine's bottles on its page, with a read-only view of the real rack.
 */

type Call = Awaited<ReturnType<typeof apiClient>>["call"];
const isPhone = () => test.info().project.name === "phone";

async function addAt(
  call: Call,
  wine: { producer: string; name: string },
  year: number,
  spots: Array<{ locationId: string; row: number; col: number } | null>,
) {
  const w = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { type: "red", countryCode: "FR", region: "Bordeaux", ...wine },
      201,
    )
  ).body;
  const bottleIds: string[] = [];
  for (const spot of spots) {
    const { bottleIds: ids } = (
      await call<{ bottleIds: string[] }>(
        "post",
        "/bottles",
        { wineId: w.id, year, quantity: 1, locationId: spot?.locationId ?? null },
        201,
      )
    ).body;
    const id = ids[0]!;
    if (spot) await call("patch", `/bottles/${id}`, { action: "move", to: spot }, 200);
    bottleIds.push(id);
  }
  const [v] = await sql<{ vintage_id: string }>(
    "select vintage_id from public.bottles where id = $1",
    [bottleIds[0]],
  );
  return { vintageId: v!.vintage_id, bottleIds };
}

/** A cellar with one exactly placed bottle, and a wine spread over two places, one shelf twice, and no place. */
async function seed(page: Page, request: APIRequestContext, who: string) {
  const { email, householdId } = await arrive(page, who);
  const { call } = await apiClient(request, email);
  const storage = async (label: string, kind: string, rows: number, cols: number) =>
    (await call<{ id: string }>("post", "/storage", { label, kind, rows, cols }, 201)).body;
  const cellar = await storage("Wijnkelder", "rack", 6, 8);
  const fridge = await storage("Wine fridge", "fridge", 3, 4);
  const single = await addAt(call, { producer: "Domaine Single", name: "Clos Seul" }, 2018, [
    { locationId: cellar.id, row: 4, col: 1 },
  ]);
  const spread = await addAt(call, { producer: "Château Spread", name: "Grand Vin" }, 2016, [
    { locationId: cellar.id, row: 1, col: 2 },
    { locationId: cellar.id, row: 2, col: 5 },
    { locationId: fridge.id, row: 3, col: 4 },
    null,
  ]);
  const loose = await addAt(call, { producer: "Domaine Loose", name: "Sans Place" }, 2020, [null]);
  return { email, householdId, call, cellar, fridge, single, spread, loose };
}

const positions = async (householdId: string) =>
  sql<{ id: string; spot: string }>(
    `select id, coalesce(location_id::text, '-') || ':' || coalesce(loc_row, 0) || ':' || coalesce(loc_col, 0) || ':' || status as spot
       from public.bottles where household_id = $1 order by id`,
    [householdId],
  );

/** Opens the "Where" sheet once the page is live. */
async function openWhere(page: Page) {
  const trigger = page.getByTestId("where-trigger");
  await expect(async () => {
    await trigger.click();
    await expect(page.getByTestId("where-sheet")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return trigger;
}

test.describe("a compact Sommelier", () => {
  test("two example questions on a phone, the rest one tap away and working; the Koopcheck stays", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "somcompact");
    const { call } = await apiClient(request, email);
    await addAt(call, { producer: "Château Margaux", name: "Pavillon Rouge" }, 2015, [null]);
    await page.goto("/sommelier");
    await expect(page.getByTestId("purchase-check-entry")).toBeVisible();
    await expect(
      page.getByText("Ask what to open and why, or check a bottle before you buy it."),
    ).toBeVisible();
    const examples = page.getByTestId("example-questions");
    // personal (3) + general (6) examples
    if (isPhone()) {
      await expect(examples.getByRole("button", { name: /\?$|try$|dinner$|over$/ })).toHaveCount(2);
      await expect(page.getByTestId("more-ideas")).toHaveText("More ideas (7)");
      // The question box stays in view, above the tab bar.
      const box = (await page.getByRole("textbox", { name: "Your question" }).boundingBox())!;
      const nav = (await page.getByRole("navigation", { name: "Main" }).last().boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y + 1);
      await page.screenshot({ path: "test-results/shots/ux-sommelier-phone.png" });
      // The rest, in a small sheet; closing it changes nothing.
      await page.getByTestId("more-ideas").click();
      const list = page.getByTestId("more-ideas-list");
      await expect(list.getByRole("button")).toHaveCount(7);
      await expect(list.getByRole("button", { name: "What is at its peak?" })).toBeVisible();
      expect(await audit(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(list).toBeHidden();
      await expect(page.getByTestId("more-ideas")).toBeFocused();
    } else {
      // A wide screen has room: all of them, and no "More ideas".
      await expect(examples.getByRole("button")).toHaveCount(9);
      await expect(page.getByTestId("more-ideas")).toBeHidden();
    }
    // Any of them asks, from wherever it is; then the examples make way for the conversation.
    await askExample(page, "What is at its peak?");
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByText("What is at its peak?")).toBeVisible();
    await expect(page.getByTestId("example-questions")).toHaveCount(0);
  });

  test("an empty cellar keeps its two questions, and Tonight its dishes", async ({ page }) => {
    await arrive(page, "somcompactempty");
    await page.goto("/sommelier");
    await expect(page.getByRole("button", { name: "How many bottles do I have?" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "How much storage space is available?" }),
    ).toBeVisible();
    await expect(page.getByTestId("more-ideas")).toHaveCount(0);
    await page.goto("/tonight");
    await expect(page.getByRole("button", { name: "Just a glass on the sofa" })).toBeVisible();
    await expect(page.getByTestId("more-ideas")).toHaveCount(0);
  });
});

test.describe("exactly where the bottles are", () => {
  test("one bottle: its exact spot, and the real rack with that spot ringed; read only", async ({
    page,
    request,
  }) => {
    const s = await seed(page, request, "whereone");
    const before = await positions(s.householdId);
    await page.goto(`/cellar/${s.single.vintageId}`);
    const trigger = page.getByTestId("where-trigger");
    await expect(trigger).toContainText("Wijnkelder");
    await expect(page.getByTestId("where-detail")).toHaveText("Shelf 4 · Position 1");

    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/") && r.method() !== "GET")
        writes.push(`${r.method()} ${r.url()}`);
    });
    await openWhere(page);
    const sheet = page.getByTestId("where-sheet");
    const unit = sheet.getByTestId("where-unit");
    await expect(unit).toHaveCount(1);
    await expect(unit).toHaveAttribute("data-location-id", s.cellar.id);
    await expect(unit.getByRole("heading", { name: "Wijnkelder" })).toBeVisible();
    // The whole rack: 6 × 8 spots, this one ringed.
    await expect(unit.getByRole("img", { name: /shelf \d, position \d/i })).toHaveCount(48);
    const ringed = unit.locator("[data-highlighted]");
    await expect(ringed).toHaveCount(1);
    await expect(ringed).toHaveAttribute("aria-label", /shelf 4, position 1, this wine$/);
    await expect(ringed).toHaveAttribute("data-bottle-id", s.single.bottleIds[0]!);
    await expect(sheet.getByTestId("where-spots")).toHaveText("Shelf 4 · Position 1");
    // Nothing in it can be tapped to move, swap, open or remove.
    await expect(unit.getByRole("button")).toHaveCount(0);
    expect(await audit(page)).toEqual([]);
    if (isPhone()) await page.screenshot({ path: "test-results/shots/ux-where-one-phone.png" });

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(writes).toEqual([]);
    expect(await positions(s.householdId)).toEqual(before);
  });

  test("several bottles over two places and none: every spot, every place by its id, nothing merged", async ({
    page,
    request,
  }) => {
    const s = await seed(page, request, "wheremany");
    const before = await positions(s.householdId);
    await page.goto(`/cellar/${s.spread.vintageId}`);
    const trigger = page.getByTestId("where-trigger");
    // Not one spot for all four bottles: the places, and how many spots.
    await expect(trigger).toContainText("Wijnkelder +2");
    await expect(page.getByTestId("where-detail")).toHaveText("3 spots, 1 not placed");

    await openWhere(page);
    const sheet = page.getByTestId("where-sheet");
    const units = sheet.getByTestId("where-unit");
    await expect(units).toHaveCount(2);
    await expect(units.nth(0)).toHaveAttribute("data-location-id", s.cellar.id);
    await expect(units.nth(1)).toHaveAttribute("data-location-id", s.fridge.id);
    // Two in the cellar rack (shelf 1 and 2), one in the fridge (3 × 4 = 12 spots).
    await expect(units.nth(0).locator("[data-highlighted]")).toHaveCount(2);
    await expect(units.nth(0).getByTestId("where-spots").getByRole("listitem")).toHaveText([
      "Shelf 1 · Position 2",
      "Shelf 2 · Position 5",
    ]);
    await expect(units.nth(1).getByRole("img", { name: /shelf \d, position \d/i })).toHaveCount(12);
    await expect(units.nth(1).locator("[data-highlighted]")).toHaveAttribute(
      "data-bottle-id",
      s.spread.bottleIds[2]!,
    );
    await expect(sheet.getByTestId("where-unplaced")).toHaveText("1 bottle has no place yet.");
    // The other wine in the same rack is shown, but not ringed.
    await expect(
      units
        .nth(0)
        .getByRole("img", { name: /Domaine Single Clos Seul 2018, shelf 4, position 1$/ }),
    ).toBeVisible();
    if (isPhone()) await page.screenshot({ path: "test-results/shots/ux-where-many-phone.png" });

    await sheet.page().getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await positions(s.householdId)).toEqual(before);
  });

  test("a bottle without a place says so, and opens nothing", async ({ page, request }) => {
    const s = await seed(page, request, "whereloose");
    await page.goto(`/cellar/${s.loose.vintageId}`);
    const glance = page.getByTestId("at-a-glance");
    await expect(glance).toContainText("Not placed yet");
    await expect(page.getByTestId("where-trigger")).toHaveCount(0);
  });

  test("moved since the page loaded: the sheet shows where it is now, and the page catches up", async ({
    page,
    request,
  }) => {
    const s = await seed(page, request, "wheremoved");
    await page.goto(`/cellar/${s.single.vintageId}`);
    await expect(page.getByTestId("where-detail")).toHaveText("Shelf 4 · Position 1");
    // Moved on another phone.
    await s.call(
      "patch",
      `/bottles/${s.single.bottleIds[0]}`,
      { action: "move", to: { locationId: s.fridge.id, row: 2, col: 2 } },
      200,
    );
    await openWhere(page);
    const sheet = page.getByTestId("where-sheet");
    await expect(
      sheet.getByText("Updated: a bottle was moved since this page loaded."),
    ).toBeVisible();
    await expect(sheet.getByTestId("where-unit")).toHaveAttribute("data-location-id", s.fridge.id);
    await expect(sheet.getByTestId("where-spots")).toHaveText("Shelf 2 · Position 2");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("where-detail")).toHaveText("Shelf 2 · Position 2");
    await expect(page.getByTestId("where-trigger")).toContainText("Wine fridge");
  });

  test("in Dutch, in the dark", async ({ page, request }) => {
    const s = await seed(page, request, "wherenl");
    await sql(
      "update public.profiles set locale = 'nl' where id = (select id from auth.users where email = $1)",
      [s.email],
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/cellar/${s.spread.vintageId}`);
    await expect(page.getByTestId("where-detail")).toHaveText("3 plekken, 1 zonder plek");
    await openWhere(page);
    const sheet = page.getByTestId("where-sheet");
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: "Waar hij ligt" }),
    ).toBeVisible();
    await expect(sheet.getByTestId("where-spots").first().getByRole("listitem").first()).toHaveText(
      "Plank 1 · Positie 2",
    );
    await expect(sheet.getByTestId("where-unplaced")).toHaveText("1 fles heeft nog geen plek.");
    expect(await audit(page)).toEqual([]);
    if (isPhone())
      await page.screenshot({ path: "test-results/shots/ux-where-many-phone-dark-nl.png" });
    await page.goto(`/cellar/${s.single.vintageId}`);
    await expect(page.getByTestId("where-detail")).toHaveText("Plank 4 · Positie 1");
  });
});
