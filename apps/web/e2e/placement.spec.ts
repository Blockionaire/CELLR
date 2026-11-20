import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  APP_URL,
  FEATURES_URL,
  PREVIEW_URL,
  apiClient,
  arrive,
  audit,
  bearer,
  sql,
} from "./helpers";

/**
 * Smart Cellar 3D, sprint 4: placing, moving and swapping bottles on whole spots, and temperature zones in daily
 * use, with real signed-in households in the local stack (real Postgres, real PostgREST: the database's own rules
 * decide, nothing is mocked in the API tests).
 *
 *   3100  nothing set                                                     placement closed (404), existing view
 *   3101  CELLR_SMART_CELLAR_PLACEMENT=1 on an unmarked production build    must stay CLOSED
 *   3102  the same on a Vercel preview, on the local stack's database        open, and it writes
 */
test.setTimeout(150_000);
/** Up to 15 s for anything to appear: pictures are drawn in software on the test machine. */
const expect = baseExpect.configure({ timeout: 15_000 });

type Call = Awaited<ReturnType<typeof apiClient>>["call"];
const RED = { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" };
const WHITE = { producer: "Domaine Test", name: "Chablis", type: "white", countryCode: "FR" };
const DEFAULT_LOOK = { v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" };

async function addPlace(call: Call, label: string, kind: string, rows: number, cols: number) {
  return ((await call("post", "/storage", { label, kind, rows, cols }, 201)).body as { id: string })
    .id;
}
async function giveLayout(
  call: Call,
  id: string,
  template: string,
  rows: number,
  cols: number,
  extra: object = {},
) {
  const look = template.startsWith("cooler")
    ? { v: 1, material: "metal", color: "graphite", lighting: "warm", door: "glass" }
    : DEFAULT_LOOK;
  await call(
    "put",
    `/smart-cellar/storage/${id}/layout`,
    { structure: { template, rows, cols, cellCapacity: 1, zones: [], ...extra }, appearance: look },
    200,
  );
}
async function addBottles(call: Call, wine: object, quantity: number, locationId: string | null) {
  const w = (await call("post", "/wines", wine, 201)).body as { id: string };
  return (await call("post", "/bottles", { wineId: w.id, year: 2015, quantity, locationId }, 201))
    .body as { bottleIds: string[]; vintageId: string };
}
const spotOf = (bottleId: string) =>
  sql<{
    location_id: string | null;
    loc_row: number | null;
    loc_col: number | null;
    loc_index: number;
    status: string;
  }>("select location_id, loc_row, loc_col, loc_index, status from public.bottles where id = $1", [
    bottleId,
  ]).then((r) => r[0]!);
const spot = (locationId: string, row: number, col: number, index = 1) => ({
  locationId,
  row,
  col,
  index,
});

/** A household with a templated rack (3 × 4) holding two bottles, and two bottles without a place. */
async function household(
  page: Page,
  request: APIRequestContext,
  label: string,
  { layout = true }: { layout?: boolean } = {},
) {
  const { email, householdId } = await arrive(page, label);
  const { call, token } = await apiClient(request, email);
  const rack = await addPlace(call, "Oak rack", "rack", 3, 4);
  // where the layout API is closed (the gate tests), the place keeps its plain grid: enough to be refused
  if (layout) await giveLayout(call, rack, "rack_classic", 3, 4);
  const placed = await addBottles(call, RED, 2, rack); // (1,1) and (1,2)
  const loose = await addBottles(call, WHITE, 2, null);
  return {
    email,
    householdId,
    call,
    token,
    rack,
    placed: placed.bottleIds,
    loose: loose.bottleIds,
  };
}
const readPath = (bottleId: string) => `/api/v1/smart-cellar/bottles/${bottleId}`;
const movePath = (bottleId: string) => `/api/v1/smart-cellar/bottles/${bottleId}/move`;
const swapPath = (bottleId: string) => `/api/v1/smart-cellar/bottles/${bottleId}/swap`;
const post = (request: APIRequestContext, token: string | null, path: string, data: object) =>
  request.post(path, {
    headers: token ? bearer(token) : { origin: PREVIEW_URL },
    data,
  });

// =================================================================================================================
test.describe("gate closed (the default)", () => {
  test.use({ baseURL: APP_URL });
  test("no placement anywhere, and the endpoints are not there", async ({ page, request }) => {
    const { token, placed, rack } = await household(page, request, "pclosed", { layout: false });
    const res = await post(request, token, movePath(placed[0]!), {
      from: spot(rack, 1, 1),
      to: spot(rack, 3, 3),
    });
    expect(res.status()).toBe(404);
    expect((await request.get(readPath(placed[0]!), { headers: bearer(token) })).status()).toBe(
      404,
    );
    expect((await spotOf(placed[0]!)).loc_row).toBe(1);
  });
});

test.describe("gate asked for on a production build: stays CLOSED", () => {
  test.use({ baseURL: FEATURES_URL });
  test("CELLR_SMART_CELLAR_PLACEMENT=1 opens nothing there: 404, nothing moves", async ({
    page,
    request,
  }) => {
    const { token, placed, rack } = await household(page, request, "pprod", { layout: false });
    for (const [path, data] of [
      [movePath(placed[0]!), { from: spot(rack, 1, 1), to: spot(rack, 3, 3) }],
      [
        swapPath(placed[0]!),
        { with: placed[1], expected: { self: spot(rack, 1, 1), other: spot(rack, 1, 2) } },
      ],
    ] as const) {
      const res = await post(request, token, path, data);
      expect(res.status(), path).toBe(404);
    }
    expect((await request.get(readPath(placed[0]!), { headers: bearer(token) })).status()).toBe(
      404,
    );
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 1, loc_col: 1 });
  });
});

// =================================================================================================================
test.describe("the API (preview, real database)", () => {
  test.use({ baseURL: PREVIEW_URL });

  test("moves: onto a free spot, between spots and places, off a place; the whole spot every time", async ({
    page,
    request,
  }) => {
    const { call, token, rack, loose, placed } = await household(page, request, "pmove");
    const fridge = await addPlace(call, "Old fridge", "fridge", 2, 2); // a place from before templates
    const m = (bottleId: string, from: object | null, to: object | null) =>
      post(request, token, movePath(bottleId), { from, to });

    let res = await m(loose[0]!, null, spot(rack, 3, 4));
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "moved", from: null, to: spot(rack, 3, 4) });
    expect(await spotOf(loose[0]!)).toMatchObject({
      location_id: rack,
      loc_row: 3,
      loc_col: 4,
      loc_index: 1,
    });

    res = await m(loose[0]!, spot(rack, 3, 4), spot(fridge, 2, 2));
    expect(res.status()).toBe(200);
    expect(await spotOf(loose[0]!)).toMatchObject({
      location_id: fridge,
      loc_row: 2,
      loc_col: 2,
      loc_index: 1,
    });

    res = await m(loose[0]!, spot(fridge, 2, 2), null);
    expect(res.status()).toBe(200);
    expect(await spotOf(loose[0]!)).toMatchObject({
      location_id: null,
      loc_row: null,
      loc_index: 1,
    });

    // a repeat of a move that already happened (its answer was lost): already there, nothing changes
    res = await m(placed[0]!, spot(rack, 1, 1), spot(rack, 2, 1));
    expect((await res.json()).outcome).toBe("moved");
    res = await m(placed[0]!, spot(rack, 1, 1), spot(rack, 2, 1));
    expect(res.status()).toBe(200);
    expect((await res.json()).outcome).toBe("already_there");
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 2, loc_col: 1 });
  });

  test("refused, and nothing changes: stale source, taken target, past index 1, outside the place, unknown arrangement, same bottle", async ({
    page,
    request,
  }) => {
    const { call, token, rack, loose, placed } = await household(page, request, "prefuse");
    const odd = await addPlace(call, "Odd rack", "rack", 2, 2);
    await sql(
      "update public.cellar_locations set template = 'hex_rack_2031', slot_semantics = 'depth' where id = $1",
      [odd],
    );
    const m = (bottleId: string, from: object | null, to: object | null) =>
      post(request, token, movePath(bottleId), { from, to });
    const before = await sql(
      "select id, location_id, loc_row, loc_col, loc_index from public.bottles where household_id = (select household_id from public.bottles where id = $1) order by id",
      [placed[0]!],
    );
    const cases: Array<[Promise<import("@playwright/test").APIResponse>, number, string]> = [
      [m(placed[0]!, spot(rack, 3, 3), spot(rack, 3, 4)), 409, "moved by someone else"],
      [m(loose[0]!, null, spot(rack, 1, 2)), 409, "just taken"],
      // a second bottle in a one-bottle cell: no such spot (and the database refuses it too, below)
      [m(loose[0]!, null, spot(rack, 3, 3, 2)), 422, "doesn't exist in this place"],
      [m(loose[0]!, null, spot(rack, 4, 1)), 422, "doesn't exist in this place"],
      [m(loose[0]!, null, spot(odd, 1, 1)), 409, "doesn't know how that place is arranged"],
      [
        post(request, token, swapPath(placed[0]!), {
          with: placed[0],
          expected: { self: spot(rack, 1, 1), other: spot(rack, 1, 2) },
        }),
        422,
        "itself",
      ],
    ];
    for (const [response, status, words] of cases) {
      const res = await response;
      expect(res.status(), words).toBe(status);
      expect(JSON.stringify(await res.json()), words).toContain(words);
    }
    expect(
      await sql(
        "select id, location_id, loc_row, loc_col, loc_index from public.bottles where household_id = (select household_id from public.bottles where id = $1) order by id",
        [placed[0]!],
      ),
    ).toEqual(before);
  });

  test("the database decides in the end: a direct write past index 1 or onto a taken spot is refused (PostgREST, as the person)", async ({
    page,
    request,
  }) => {
    const { token, rack, loose } = await household(page, request, "pdirect");
    const patch = (data: object) =>
      fetch(`http://localhost:54321/rest/v1/bottles?id=eq.${loose[0]}`, {
        method: "PATCH",
        headers: {
          apikey: "sb_publishable_localstack_0000000000",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          prefer: "return=representation",
        },
        body: JSON.stringify(data),
      });
    const deep = await patch({ location_id: rack, loc_row: 3, loc_col: 3, loc_index: 2 });
    expect(deep.ok).toBe(false);
    const taken = await patch({ location_id: rack, loc_row: 1, loc_col: 1, loc_index: 1 });
    expect(taken.ok).toBe(false);
    expect((await spotOf(loose[0]!)).location_id).toBeNull();
  });

  test("concurrency: six bottles at once for one free spot, one gets it; two moves of one bottle, one wins and the other is stale", async ({
    page,
    request,
  }) => {
    const { call, token, rack } = await household(page, request, "prace");
    const many = (await addBottles(call, WHITE, 6, null)).bottleIds;
    const results = await Promise.all(
      many.map((id) => post(request, token, movePath(id), { from: null, to: spot(rack, 3, 3) })),
    );
    const statuses = results.map((r) => r.status()).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    expect(
      await sql(
        "select count(*)::int as n from public.bottles where location_id = $1 and loc_row = 3 and loc_col = 3",
        [rack],
      ),
    ).toEqual([{ n: 1 }]);
    // one bottle, two places at once, both from where it was seen
    const one = many.find((_, i) => results[i]!.status() !== 200)!;
    const both = await Promise.all([
      post(request, token, movePath(one), { from: null, to: spot(rack, 2, 1) }),
      post(request, token, movePath(one), { from: null, to: spot(rack, 2, 2) }),
    ]);
    expect(both.map((r) => r.status()).sort()).toEqual([200, 409]);
    const now = await spotOf(one);
    expect(now.loc_row).toBe(2);
    expect([1, 2]).toContain(now.loc_col);
    // no bottle lost, none doubled
    expect(
      await sql(
        "select count(*)::int as n from public.bottles where id = any($1::uuid[]) and status = 'in_cellar'",
        [many],
      ),
    ).toEqual([{ n: 6 }]);
  });

  test("swaps: whole spots across places; stale is refused; Undo only while both are where the swap put them; old clients' swap unchanged", async ({
    page,
    request,
  }) => {
    const { call, token, rack, placed, loose } = await household(page, request, "pswap");
    const fridge = await addPlace(call, "Old fridge", "fridge", 2, 2);
    await post(request, token, movePath(loose[0]!), { from: null, to: spot(fridge, 1, 1) });
    const swap = (self: string, other: string, a: object, b: object) =>
      post(request, token, swapPath(self), { with: other, expected: { self: a, other: b } });
    let res = await swap(placed[0]!, loose[0]!, spot(rack, 1, 1), spot(fridge, 1, 1));
    expect(res.status()).toBe(200);
    expect(await spotOf(placed[0]!)).toMatchObject({
      location_id: fridge,
      loc_row: 1,
      loc_col: 1,
      loc_index: 1,
    });
    expect(await spotOf(loose[0]!)).toMatchObject({
      location_id: rack,
      loc_row: 1,
      loc_col: 1,
      loc_index: 1,
    });
    // stale: one is not where the caller saw it
    res = await swap(placed[0]!, loose[0]!, spot(rack, 1, 1), spot(fridge, 1, 1));
    expect(res.status()).toBe(409);
    // someone moves one of them; the Undo of the swap must not overwrite that
    await post(request, token, movePath(loose[0]!), {
      from: spot(rack, 1, 1),
      to: spot(rack, 3, 1),
    });
    res = await swap(placed[0]!, loose[0]!, spot(fridge, 1, 1), spot(rack, 1, 1));
    expect(res.status()).toBe(409);
    expect(await spotOf(loose[0]!)).toMatchObject({ loc_row: 3, loc_col: 1 });
    // the existing two-coordinate swap still works for old clients
    const legacy = await request.patch(`/api/v1/bottles/${placed[1]}`, {
      headers: bearer(token),
      data: {
        action: "swap",
        with: loose[0],
        expected: {
          self: { locationId: rack, row: 1, col: 2 },
          other: { locationId: rack, row: 3, col: 1 },
        },
      },
    });
    expect(legacy.status()).toBe(200);
    expect(await spotOf(placed[1]!)).toMatchObject({ loc_row: 3, loc_col: 1, loc_index: 1 });
  });

  test("an Undo of a move is refused when someone moved the bottle since", async ({
    page,
    request,
  }) => {
    const { token, rack, placed } = await household(page, request, "pundo");
    const m = (from: object | null, to: object | null) =>
      post(request, token, movePath(placed[0]!), { from, to });
    expect((await m(spot(rack, 1, 1), spot(rack, 3, 1))).status()).toBe(200);
    // someone else moves it on
    expect((await m(spot(rack, 3, 1), spot(rack, 3, 2))).status()).toBe(200);
    // the first person's Undo (back from where THEIR move put it): refused, the later move stands
    expect((await m(spot(rack, 3, 1), spot(rack, 1, 1))).status()).toBe(409);
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 3, loc_col: 2 });
    // the later move's own Undo works
    expect((await m(spot(rack, 3, 2), spot(rack, 3, 1))).status()).toBe(200);
  });

  test("authorization: signed out 401; another household's bottle or place 404; the swap function called directly sees nothing of theirs", async ({
    page,
    request,
    browser,
  }) => {
    const { token, rack, placed, householdId } = await household(page, request, "pauth");
    expect(
      (
        await post(request, null, movePath(placed[0]!), {
          from: spot(rack, 1, 1),
          to: spot(rack, 3, 3),
        })
      ).status(),
    ).toBe(401);
    const otherPage = await browser.newPage({ baseURL: PREVIEW_URL });
    const theirs = await household(otherPage, request, "pauth2");
    await otherPage.close();
    // my token, their bottle
    expect(
      (
        await post(request, token, movePath(theirs.placed[0]!), {
          from: spot(theirs.rack, 1, 1),
          to: spot(theirs.rack, 3, 3),
        })
      ).status(),
    ).toBe(404);
    // my bottle, their place
    expect(
      (
        await post(request, token, movePath(placed[0]!), {
          from: spot(rack, 1, 1),
          to: spot(theirs.rack, 3, 3),
        })
      ).status(),
    ).toBe(404);
    // swap_bottles_v2 straight through PostgREST with their household and bottles: not found, nothing moves
    const rpc = await fetch("http://localhost:54321/rest/v1/rpc/swap_bottles_v2", {
      method: "POST",
      headers: {
        apikey: "sb_publishable_localstack_0000000000",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_household: theirs.householdId,
        p_a: theirs.placed[0],
        p_a_location: theirs.rack,
        p_a_row: 1,
        p_a_col: 1,
        p_a_index: 1,
        p_b: theirs.placed[1],
        p_b_location: theirs.rack,
        p_b_row: 1,
        p_b_col: 2,
        p_b_index: 1,
      }),
    });
    expect(await rpc.json()).toBe("not_found");
    expect(await spotOf(theirs.placed[0]!)).toMatchObject({ loc_row: 1, loc_col: 1 });
    expect(householdId).not.toBe(theirs.householdId);
  });

  test("where a bottle is now (the read after a lost answer): from the database, its whole spot or none; another household's is not found", async ({
    page,
    request,
    browser,
  }) => {
    const { token, rack, placed, loose } = await household(page, request, "pread");
    const read = async (id: string, t: string | null = token) =>
      request.get(readPath(id), { headers: t ? bearer(t) : { origin: PREVIEW_URL } });
    expect(await (await read(placed[0]!)).json()).toEqual({
      bottleId: placed[0],
      inCellar: true,
      spot: spot(rack, 1, 1),
    });
    // no place: in the cellar, spot null (distinct from "moved elsewhere")
    expect(await (await read(loose[0]!)).json()).toEqual({
      bottleId: loose[0],
      inCellar: true,
      spot: null,
    });
    // moved by a direct write a moment ago: the read sees it at once (no cache in between)
    await sql("update public.bottles set loc_row = 3, loc_col = 4 where id = $1", [placed[0]!]);
    expect((await (await read(placed[0]!)).json()).spot).toEqual(spot(rack, 3, 4));
    // opened: no longer in the cellar
    await sql(
      "update public.bottles set status = 'opened', location_id = null, loc_row = null, loc_col = null where id = $1",
      [placed[1]!],
    );
    expect(await (await read(placed[1]!)).json()).toMatchObject({ inCellar: false, spot: null });
    expect((await read(placed[0]!, null)).status()).toBe(401);
    const otherPage = await browser.newPage({ baseURL: PREVIEW_URL });
    const theirs = await household(otherPage, request, "pread2");
    await otherPage.close();
    expect((await read(theirs.placed[0]!)).status()).toBe(404);
    expect((await read("00000000-0000-4000-8000-000000000000")).status()).toBe(404);
  });

  test("the existing ways of moving are unchanged: PATCH /bottles move, the racks view", async ({
    page,
    request,
  }) => {
    const { token, rack, placed } = await household(page, request, "plegacy");
    const res = await request.patch(`/api/v1/bottles/${placed[0]}`, {
      headers: bearer(token),
      data: { action: "move", to: { locationId: rack, row: 2, col: 2 } },
    });
    expect(res.status()).toBe(200);
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 2, loc_col: 2, loc_index: 1 });
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "Racks" }).click();
    await expect(
      page.getByRole("button", { name: /Pavillon Rouge 2015, shelf 2, position 2/ }),
    ).toBeVisible();
  });
});

// =================================================================================================================
test.describe("the new cellar (preview)", () => {
  test.use({ baseURL: PREVIEW_URL });
  const stage = (page: Page) => page.getByTestId("smart-3d-stage");
  const panel = (page: Page) => page.getByTestId("placement-panel");
  const picker = (page: Page) => page.getByTestId("spot-picker");
  const debugOn = (page: Page) =>
    page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const drawn = (page: Page) =>
    expect(stage(page).locator("canvas[data-engine]")).toHaveAttribute("data-frames", /^[1-9]/, {
      timeout: 60_000,
    });
  async function open3D(page: Page) {
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    await expect(page.getByTestId("smart-3d")).toHaveAttribute("data-mode", "ready");
  }
  async function moveFromInspection(page: Page, row: number, col: number) {
    await page
      .getByRole("button", {
        name: new RegExp(`Pavillon Rouge 2015, shelf ${row}, position ${col}`),
      })
      .focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("smart-3d-move").click();
    await expect(panel(page)).toBeVisible();
  }

  test("a placed bottle: Move, a free spot, the target ringed, confirmed, everywhere refreshed; Undo puts it back", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { rack, placed } = await household(page, request, "puimove");
    await open3D(page);
    await drawn(page);
    await moveFromInspection(page, 1, 1);
    await expect(page.getByTestId("placement-from")).toContainText("Oak rack · shelf 1 · spot 1");
    await expect(picker(page).locator('[data-spot="1:1:1"]')).toHaveAttribute(
      "data-state",
      "current",
    );
    await expect(picker(page).locator('[data-spot="1:2:1"]')).toHaveAttribute(
      "data-state",
      "taken",
    );
    await picker(page).locator('[data-spot="3:4:1"]').click();
    await expect(panel(page)).toHaveAttribute("data-choice", "move:3:4:1");
    await expect(page.getByTestId("placement-summary")).toContainText(
      "It goes to Oak rack · shelf 3 · spot 4.",
    );
    // nothing has moved yet
    expect((await spotOf(placed[0]!)).loc_row).toBe(1);
    await page.getByTestId("placement-confirm").click();
    await expect(
      page.getByText(/Pavillon Rouge 2015 is now at Oak rack · shelf 3 · spot 4/),
    ).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    expect(await spotOf(placed[0]!)).toMatchObject({
      location_id: rack,
      loc_row: 3,
      loc_col: 4,
      loc_index: 1,
    });
    // the picture and the racks know it
    await expect(
      page.getByRole("button", { name: /Pavillon Rouge 2015, shelf 3, position 4/ }),
    ).toBeAttached();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Moved back.")).toBeVisible();
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 1, loc_col: 1 });
  });

  test("cancelling changes nothing; choosing another spot before confirming is fine", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { placed } = await household(page, request, "puicancel");
    await open3D(page);
    await drawn(page);
    await moveFromInspection(page, 1, 2);
    await picker(page).locator('[data-spot="2:1:1"]').click();
    await picker(page).locator('[data-spot="2:2:1"]').click();
    await expect(panel(page)).toHaveAttribute("data-choice", "move:2:2:1");
    await page.getByTestId("placement-cancel").click();
    await expect(panel(page)).toHaveCount(0);
    expect(await spotOf(placed[1]!)).toMatchObject({ loc_row: 1, loc_col: 2 });
  });

  test("a swap is said before it is done, and done whole", async ({ page, request }) => {
    await debugOn(page);
    const { placed } = await household(page, request, "puiswap");
    await open3D(page);
    await drawn(page);
    await moveFromInspection(page, 1, 1);
    await picker(page).locator('[data-spot="1:2:1"]').click();
    await expect(page.getByTestId("placement-swap")).toContainText(
      "swaps places with Château Margaux Pavillon Rouge 2015",
    );
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/swapped places/)).toBeVisible();
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 1, loc_col: 2 });
    expect(await spotOf(placed[1]!)).toMatchObject({ loc_row: 1, loc_col: 1 });
  });

  test("a bottle without a place, and a spot first (then which bottle)", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { loose } = await household(page, request, "puiplace");
    await open3D(page);
    await drawn(page);
    const list = page.getByTestId("placement-unplaced");
    await expect(list).toContainText("2 bottles without a place");
    await list.getByRole("button", { name: "Place" }).first().click();
    await expect(page.getByTestId("placement-from")).toContainText("no place");
    // no swap for a bottle without a place: a taken spot is not offered
    await expect(picker(page).locator('[data-spot="1:1:1"]')).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await picker(page).locator('[data-spot="2:3:1"]').click();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/is now at Oak rack · shelf 2 · spot 3/)).toBeVisible();
    // the other one, spot first
    await page.getByTestId("placement-start").click();
    await picker(page).locator('[data-spot="3:3:1"]').click();
    await page.getByTestId("placement-which").getByRole("radio").first().check();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/is now at Oak rack · shelf 3 · spot 3/)).toBeVisible();
    const rows = await sql<{ n: number }>(
      "select count(*)::int as n from public.bottles where id = any($1::uuid[]) and location_id is not null",
      [loose],
    );
    expect(rows).toEqual([{ n: 2 }]);
  });

  test("someone else moved it meanwhile: said, nothing claimed, nothing moved", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { token, rack, placed } = await household(page, request, "puistale");
    await open3D(page);
    await drawn(page);
    await moveFromInspection(page, 1, 1);
    await picker(page).locator('[data-spot="3:1:1"]').click();
    await post(request, token, movePath(placed[0]!), {
      from: spot(rack, 1, 1),
      to: spot(rack, 2, 4),
    });
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByTestId("placement-problem")).toContainText("moved by someone else");
    await expect(page.getByText(/is now at/)).toHaveCount(0);
    // the panel catches up: where it is now becomes the source, and the choice is cleared
    await expect(page.getByTestId("placement-from")).toContainText("shelf 2 · spot 4");
    await expect(panel(page)).toHaveAttribute("data-choice", "");
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 2, loc_col: 4 });
  });

  test("the answer is lost: a fresh read decides; moved is said only when it really moved", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { placed } = await household(page, request, "puinet");
    await open3D(page);
    await drawn(page);
    // 1. the request never arrives: not moved, and said
    await page.route("**/api/v1/smart-cellar/bottles/*/move", (route) =>
      route.abort("internetdisconnected"),
    );
    await moveFromInspection(page, 1, 1);
    await picker(page).locator('[data-spot="3:1:1"]').click();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByTestId("placement-problem")).toContainText("The bottle didn't move");
    expect((await spotOf(placed[0]!)).loc_row).toBe(1);
    await page.unroute("**/api/v1/smart-cellar/bottles/*/move");
    // 2. it arrives and moves the bottle, but the answer is lost: the fresh read finds it moved
    await page.route("**/api/v1/smart-cellar/bottles/*/move", async (route) => {
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/is now at Oak rack · shelf 3 · spot 1/)).toBeVisible();
    // established by reading afterwards: not attributable to this request, so no Undo
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 3, loc_col: 1 });
  });

  test("a swap whose answer is lost: reported only once both bottles are found on each other's spot", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { placed } = await household(page, request, "puiswapnet");
    await open3D(page);
    await drawn(page);
    await page.route("**/api/v1/smart-cellar/bottles/*/swap", async (route) => {
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await moveFromInspection(page, 1, 1);
    await picker(page).locator('[data-spot="1:2:1"]').click();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/swapped places/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 1, loc_col: 2 });
    expect(await spotOf(placed[1]!)).toMatchObject({ loc_row: 1, loc_col: 1 });
  });

  // ---- answers lost on the way back: the database's word decides, never a guess (final review) -------------------
  const ROUTE = "**/api/v1/smart-cellar/bottles/*/move";
  const READ = "**/api/v1/smart-cellar/bottles/*";
  const noUndo = (page: Page) => expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);

  test("taking off: a request that never arrives is said as not moved; one whose answer is lost is said as done, without Undo", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { placed } = await household(page, request, "puioffnet");
    await open3D(page);
    await drawn(page);
    // 1. never reaches the server: the read finds it still on its spot
    await page.route(ROUTE, (route) => route.abort("internetdisconnected"));
    await moveFromInspection(page, 1, 1);
    await page.getByTestId("placement-take-off").click();
    await expect(page.getByTestId("placement-problem")).toContainText("The bottle didn't move");
    await expect(page.getByText(/has no place now/)).toHaveCount(0);
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 1, loc_col: 1 });
    await page.unroute(ROUTE);
    // 2. applied, answer lost: the read finds it without a place
    await page.route(ROUTE, async (route) => {
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await page.getByTestId("placement-take-off").click();
    await expect(
      page.getByText("Château Margaux Pavillon Rouge 2015 has no place now."),
    ).toBeVisible();
    await noUndo(page);
    expect(await spotOf(placed[0]!)).toMatchObject({ location_id: null, loc_row: null });
  });

  test("moved to a third place by someone else while the answer was lost: said with where it is, nothing claimed, the new source", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { token, rack, placed } = await household(page, request, "puithird");
    await open3D(page);
    await drawn(page);
    await page.route(ROUTE, async (route) => {
      // another member moves it to a third spot first; this request then finds it stale, and its answer is lost
      await post(request, token, movePath(placed[0]!), {
        from: spot(rack, 1, 1),
        to: spot(rack, 2, 4),
      });
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await moveFromInspection(page, 1, 1);
    await picker(page).locator('[data-spot="3:1:1"]').click();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByTestId("placement-problem")).toContainText(
      "This bottle is now at Oak rack · shelf 2 · spot 4: it was moved meanwhile.",
    );
    await expect(page.getByText(/is now at Oak rack · shelf 3/)).toHaveCount(0);
    await expect(page.getByTestId("placement-from")).toContainText("shelf 2 · spot 4");
    await expect(panel(page)).toHaveAttribute("data-choice", "");
    await noUndo(page);
    expect(await spotOf(placed[0]!)).toMatchObject({ loc_row: 2, loc_col: 4 });
  });

  test("taken off by someone else while the answer was lost: confirmed without a place, not 'moved elsewhere' and not 'didn't move'", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { token, rack, placed } = await household(page, request, "puiunplaced");
    await open3D(page);
    await drawn(page);
    await page.route(ROUTE, async (route) => {
      await post(request, token, movePath(placed[0]!), { from: spot(rack, 1, 1), to: null });
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await moveFromInspection(page, 1, 1);
    await picker(page).locator('[data-spot="3:1:1"]').click();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByTestId("placement-problem")).toContainText(
      "This bottle has no place now: it was taken off meanwhile.",
    );
    await expect(page.getByTestId("placement-problem")).not.toContainText("didn't move");
    await expect(page.getByTestId("placement-from")).toContainText("no place");
    await noUndo(page);
    expect(await spotOf(placed[0]!)).toMatchObject({ location_id: null });
  });

  test("the check fails too: the outcome is said to be unknown; trying again is safe and moves nothing twice", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { placed, rack } = await household(page, request, "puiunknown");
    const before = await sql<{ n: number }>(
      "select count(*)::int as n from public.bottles where household_id = (select household_id from public.bottles where id = $1)",
      [placed[0]!],
    );
    await open3D(page);
    await drawn(page);
    // the move applies, its answer is lost, and so is the read that would have told
    await page.route(ROUTE, async (route) => {
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await page.route(READ, (route) =>
      route.request().method() === "GET" ? route.abort("internetdisconnected") : route.fallback(),
    );
    await moveFromInspection(page, 1, 1);
    await picker(page).locator('[data-spot="3:1:1"]').click();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByTestId("placement-problem")).toContainText(
      "We couldn't reach CELLR to check whether the bottle moved.",
    );
    await expect(page.getByText(/is now at/)).toHaveCount(0);
    await noUndo(page);
    // the choice stays, to try again
    await expect(panel(page)).toHaveAttribute("data-choice", "move:3:1:1");
    expect(await spotOf(placed[0]!)).toMatchObject({ location_id: rack, loc_row: 3, loc_col: 1 });
    // the network is back: the same request again is answered "already there", changes nothing, offers no Undo
    await page.unroute(ROUTE);
    await page.unroute(READ);
    await page.getByTestId("placement-confirm").click();
    await expect(
      page.getByText(
        "Château Margaux Pavillon Rouge 2015 was already at Oak rack · shelf 3 · spot 1. Nothing was changed.",
      ),
    ).toBeVisible();
    await noUndo(page);
    expect(await spotOf(placed[0]!)).toMatchObject({ location_id: rack, loc_row: 3, loc_col: 1 });
    expect(
      await sql(
        "select count(*)::int as n from public.bottles where location_id = $1 and loc_row = 3 and loc_col = 1",
        [rack],
      ),
    ).toEqual([{ n: 1 }]);
    expect(
      await sql<{ n: number }>(
        "select count(*)::int as n from public.bottles where household_id = (select household_id from public.bottles where id = $1)",
        [placed[0]!],
      ),
    ).toEqual(before);
  });

  test("taking off, the check fails too: unknown; trying again answers 'already had no place' and changes nothing", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { placed } = await household(page, request, "puioffunknown");
    await open3D(page);
    await drawn(page);
    await page.route(ROUTE, async (route) => {
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await page.route(READ, (route) =>
      route.request().method() === "GET" ? route.abort("internetdisconnected") : route.fallback(),
    );
    await moveFromInspection(page, 1, 1);
    await page.getByTestId("placement-take-off").click();
    await expect(page.getByTestId("placement-problem")).toContainText(
      "We couldn't reach CELLR to check whether the bottle moved.",
    );
    await noUndo(page);
    await page.unroute(ROUTE);
    await page.unroute(READ);
    await page.getByTestId("placement-take-off").click();
    await expect(
      page.getByText(
        "Château Margaux Pavillon Rouge 2015 already had no place. Nothing was changed.",
      ),
    ).toBeVisible();
    await noUndo(page);
    expect(await spotOf(placed[0]!)).toMatchObject({ location_id: null, status: "in_cellar" });
  });

  test("temperature zones in daily use: on the stage, in a bottle's details, a setting never a reading; none where there are none", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { call } = await household(page, request, "pzones");
    const cooler = await addPlace(call, "Wine cooler", "fridge", 6, 4);
    await giveLayout(call, cooler, "cooler_dual", 6, 4, {
      zones: [
        { fromRow: 1, toRow: 2, purpose: "serving", targetTempC: 8 },
        { fromRow: 3, toRow: 6, purpose: "storage", targetTempC: null },
      ],
    });
    await addBottles(call, RED, 3, cooler);
    await open3D(page);
    // the rack (no zones): no zone legend, no temperature
    await expect(page.getByTestId("zone-legend")).toHaveCount(0);
    await page.getByRole("button", { name: "Wine cooler", exact: true }).click();
    const legend = page.getByTestId("zone-legend");
    await expect(legend).toHaveAttribute("data-zones", "2");
    await expect(legend.locator('[data-zone="1"]')).toContainText(
      "Zone 1 · Serving zone · shelves 1–2",
    );
    await expect(legend.locator('[data-zone="1"]')).toContainText("set to 8.0 °C · 3 bottles");
    await expect(legend.locator('[data-zone="2"]')).toContainText(
      "no temperature set · no bottles",
    );
    await expect(legend).toContainText("Set temperatures are settings, not readings.");
    // a bottle in the serving zone says so in its details (once the cooler's picture is drawn)
    await drawn(page);
    await page.getByRole("button", { name: /Pavillon Rouge 2015, shelf 1, position 1/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("inspection-panel")).toContainText(
      "Serving zone (set to 8.0 °C)",
    );
    await page.keyboard.press("Escape");
    // the zones are edited in the Rack Builder, at its zones
    await legend.getByTestId("zone-edit").click();
    await expect(page).toHaveURL(new RegExp(`/cellar/builder/${cooler}\\?section=zones`));
    await expect(page.getByTestId("builder-zones")).toBeVisible();
  });

  test("without WebGL: the flat picture of the same place, and a bottle chosen there can be moved", async ({
    page,
    request,
  }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
        return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    const { placed } = await household(page, request, "puiflat");
    await open3D(page);
    await expect(page.getByTestId("smart-3d-flat")).toBeVisible();
    await page
      .getByTestId("smart-3d-flat")
      .getByRole("button", { name: /position 2/ })
      .first()
      .click();
    await page.getByTestId("smart-3d-flat-chosen").getByTestId("smart-3d-move").click();
    await picker(page).locator('[data-spot="3:2:1"]').click();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/is now at Oak rack · shelf 3 · spot 2/)).toBeVisible();
    expect(await spotOf(placed[1]!)).toMatchObject({ loc_row: 3, loc_col: 2 });
  });

  test("with the keyboard: the picker is reached, arrows move, Enter chooses; no accessibility violations", async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== "desktop", "keyboard: desktop");
    await debugOn(page);
    await household(page, request, "puikeys");
    await open3D(page);
    await drawn(page);
    await moveFromInspection(page, 1, 1);
    await expect(
      page.getByRole("heading", { name: /Move Château Margaux Pavillon Rouge 2015/ }),
    ).toBeFocused();
    const first = picker(page).locator('[tabindex="0"]');
    await first.focus();
    const from = await first.getAttribute("data-spot");
    await page.keyboard.press("ArrowDown");
    const to = await page.evaluate(() => document.activeElement?.getAttribute("data-spot"));
    expect(to).not.toBe(from);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(panel(page)).toHaveAttribute("data-choice", /^move:/);
    expect(await audit(page)).toEqual([]);
  });

  test("on a phone, with reduced motion: the panel fits the screen, the targets are large enough, nothing scrolls sideways", async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone");
    // with reduced motion asked for, as many phones are set
    await page.emulateMedia({ reducedMotion: "reduce" });
    await debugOn(page);
    await household(page, request, "puiphone");
    await open3D(page);
    await drawn(page);
    await moveFromInspection(page, 1, 1);
    const width = await page.evaluate(() => window.innerWidth);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const box = (await picker(page).locator('[data-spot="2:2:1"]').boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(40);
    await picker(page).locator('[data-spot="2:2:1"]').tap();
    await expect(page.getByTestId("placement-confirm")).toBeEnabled();
  });
});
