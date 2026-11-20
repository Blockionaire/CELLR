import {
  expect as baseExpect,
  test,
  type APIRequestContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import {
  APP_URL,
  FEATURES_URL,
  PREVIEW_URL,
  api,
  apiClient,
  arrive,
  audit,
  bearer,
  sessionToken,
  sql,
} from "./helpers";

/**
 * Smart Cellar 3D, sprint 5: placement advice, against the local stack (real Postgres, real PostgREST: the database's
 * own rules decide, nothing is mocked). Servers as in placement.spec.ts: 3100 nothing set, 3101 an unmarked production
 * build with CELLR_SMART_CELLAR_ADVICE=1 (must stay CLOSED), 3102 a Vercel preview with advice, placement, writes and
 * the local database.
 */
test.setTimeout(150_000);
const expect = baseExpect.configure({ timeout: 15_000 });

type Call = Awaited<ReturnType<typeof apiClient>>["call"];
type Spot = { locationId: string; row: number; col: number; index: number };
type Option = { spot: Spot; rank: number; suitability: string; reasons: Array<{ code: string }> };
type Advice = {
  status: string;
  intent: string;
  canPlace: boolean;
  stay: Option | null;
  recommendations: Option[];
  alternatives: Option[];
  eligible: number;
};
const RED = { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" };

async function addPlace(call: Call, label: string, kind: string, rows: number, cols: number) {
  return ((await call("post", "/storage", { label, kind, rows, cols }, 201)).body as { id: string })
    .id;
}
async function giveLayout(
  call: Call,
  id: string,
  template: "rack_classic" | "cooler_dual",
  rows: number,
  cols: number,
  zones: object[] = [],
) {
  const look =
    template === "cooler_dual"
      ? { v: 1, material: "metal", color: "graphite", lighting: "warm", door: "glass" }
      : { v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" };
  await call(
    "put",
    `/smart-cellar/storage/${id}/layout`,
    { structure: { template, rows, cols, cellCapacity: 1, zones }, appearance: look },
    200,
  );
}
const spotOf = (bottleId: string) =>
  sql<{ location_id: string | null; loc_row: number | null; loc_col: number | null }>(
    "select location_id, loc_row, loc_col from public.bottles where id = $1",
    [bottleId],
  ).then((r) => r[0]!);
const advicePath = (bottleId: string, intent = "store") =>
  `/api/v1/smart-cellar/bottles/${bottleId}/recommendations?intent=${intent}`;
const getAdvice = async (
  request: APIRequestContext,
  token: string,
  bottleId: string,
  intent = "store",
) => {
  const res = await request.get(advicePath(bottleId, intent), { headers: bearer(token) });
  expect(res.status()).toBe(200);
  return (await res.json()) as Advice;
};
const key = (s: Spot) => `${s.locationId}:${s.row}:${s.col}:${s.index}`;

/**
 * A household with an oak rack (3 × 4, no zones) holding two bottles of one vintage at (1,1) and (1,2), a wine cooler
 * (4 × 2: shelves 1–2 serving at 8 °C, 3–4 keeping at 12 °C), and two more bottles of that vintage without a place.
 */
async function household(
  page: Page,
  request: APIRequestContext,
  label: string,
  options = { layout: true },
) {
  const { email, householdId } = await arrive(page, label);
  const { call, token } = await apiClient(request, email);
  const rack = await addPlace(call, "Oak rack", "rack", 3, 4);
  const cooler = await addPlace(call, "Wine cooler", "fridge", 4, 2);
  if (options.layout) {
    await giveLayout(call, rack, "rack_classic", 3, 4);
    await giveLayout(call, cooler, "cooler_dual", 4, 2, [
      { fromRow: 1, toRow: 2, purpose: "serving", targetTempC: 8 },
      { fromRow: 3, toRow: 4, purpose: "storage", targetTempC: 12 },
    ]);
  }
  const w = (await call("post", "/wines", RED, 201)).body as { id: string };
  const placed = (
    (
      await call(
        "post",
        "/bottles",
        { wineId: w.id, year: 2015, quantity: 2, locationId: rack },
        201,
      )
    ).body as { bottleIds: string[] }
  ).bottleIds;
  const loose = (
    (
      await call(
        "post",
        "/bottles",
        { wineId: w.id, year: 2015, quantity: 2, locationId: null },
        201,
      )
    ).body as { bottleIds: string[] }
  ).bottleIds;
  return { email, householdId, call, token, rack, cooler, placed, loose, wineId: w.id };
}

// =================================================================================================================
test.describe("gate closed (the default)", () => {
  test.use({ baseURL: APP_URL });
  test("no advice: the endpoint is not there", async ({ page, request }) => {
    const { token, loose } = await household(page, request, "aclosed", { layout: false });
    const res = await request.get(advicePath(loose[0]!), { headers: bearer(token) });
    expect(res.status()).toBe(404);
  });
});

test.describe("asked for on a production build: stays CLOSED", () => {
  test.use({ baseURL: FEATURES_URL });
  test("CELLR_SMART_CELLAR_ADVICE=1 opens nothing there", async ({ page, request }) => {
    const { token, loose } = await household(page, request, "aprod", { layout: false });
    const res = await request.get(advicePath(loose[0]!), { headers: bearer(token) });
    expect(res.status()).toBe(404);
  });
});

// =================================================================================================================
test.describe("the API (preview, real database)", () => {
  test.use({ baseURL: PREVIEW_URL });

  test("ranked and explained from the database's facts; every option free and placeable; same answer twice", async ({
    page,
    request,
  }) => {
    const { token, rack, cooler, loose } = await household(page, request, "aapi");
    const advice = await getAdvice(request, token, loose[0]!);
    expect(advice).toMatchObject({ status: "ok", intent: "store", canPlace: true, stay: null });
    expect(advice.recommendations).toHaveLength(3);
    // a keeping zone first, then next to its two twins, then next to one
    expect(key(advice.recommendations[0]!.spot)).toBe(`${cooler}:3:1:1`);
    expect(advice.recommendations[0]!.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(["purpose_match", "zone_target"]),
    );
    expect(key(advice.recommendations[1]!.spot)).toBe(`${rack}:2:1:1`);
    expect(advice.recommendations[1]!.reasons).toContainEqual({
      code: "group",
      tier: "vintage",
      proximity: "neighbour",
      count: 2,
    });
    // free in the database, every one
    const taken = await sql<{ k: string }>(
      "select location_id || ':' || loc_row || ':' || loc_col || ':' || loc_index as k from public.bottles where location_id is not null and status = 'in_cellar'",
    );
    const takenKeys = new Set(taken.map((t) => t.k));
    for (const o of [...advice.recommendations, ...advice.alternatives])
      expect(takenKeys.has(key(o.spot)), key(o.spot)).toBe(false);
    // nothing was written
    expect((await spotOf(loose[0]!)).location_id).toBeNull();
    // the same question, the same answer
    expect(await getAdvice(request, token, loose[0]!)).toEqual(advice);
    // and the first option really can be placed through the Sprint 4 move
    const moved = await request.post(`/api/v1/smart-cellar/bottles/${loose[0]}/move`, {
      headers: bearer(token),
      data: { from: null, to: advice.recommendations[0]!.spot },
    });
    expect(moved.status()).toBe(200);
  });

  test("intent changes the advice for a stated reason; a bottle already well placed is told to stay", async ({
    page,
    request,
  }) => {
    const { token, cooler, placed } = await household(page, request, "aintent");
    const serve = await getAdvice(request, token, placed[0]!, "serve");
    expect(key(serve.recommendations[0]!.spot)).toBe(`${cooler}:1:1:1`);
    expect(serve.recommendations[0]!.reasons).toContainEqual({
      code: "purpose_match",
      purpose: "serving",
      zone: 1,
    });
    // kept next to its twin in the rack: a keeping zone (+40) doesn't beat that (+30) by more than the margin
    const store = await getAdvice(request, token, placed[0]!, "store");
    expect(store.stay?.reasons.map((r) => r.code)).toContain("current_spot");
  });

  test("refused: unknown intent or none (422), not a uuid or a bottle that isn't ours or none (404, the API's convention), signed out (401)", async ({
    page,
    request,
    browser,
  }) => {
    const { token, loose } = await household(page, request, "arefuse");
    for (const path of [
      `/api/v1/smart-cellar/bottles/${loose[0]}/recommendations?intent=cellar`,
      `/api/v1/smart-cellar/bottles/${loose[0]}/recommendations`,
    ])
      expect((await request.get(path, { headers: bearer(token) })).status(), path).toBe(422);
    expect(
      (
        await request.get(`/api/v1/smart-cellar/bottles/not-a-uuid/recommendations?intent=store`, {
          headers: bearer(token),
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get(advicePath("00000000-0000-4000-8000-000000000000"), {
          headers: bearer(token),
        })
      ).status(),
    ).toBe(404);
    expect(
      (await request.get(advicePath(loose[0]!), { headers: { origin: PREVIEW_URL } })).status(),
    ).toBe(401);
    // another household: their bottle is not found, and nothing of theirs is ever advised to us
    const otherPage = await browser.newPage({ baseURL: PREVIEW_URL });
    const theirs = await household(otherPage, request, "arefuse2");
    await otherPage.close();
    expect(
      (await request.get(advicePath(theirs.loose[0]!), { headers: bearer(token) })).status(),
    ).toBe(404);
    const mine = await getAdvice(request, token, loose[0]!);
    const ourPlaces = new Set(
      (
        await sql<{ id: string }>(
          "select id from public.cellar_locations where household_id = (select household_id from public.bottles where id = $1)",
          [loose[0]!],
        )
      ).map((r) => r.id),
    );
    for (const o of [...mine.recommendations, ...mine.alternatives])
      expect(ourPlaces.has(o.spot.locationId)).toBe(true);
    expect(ourPlaces.has(theirs.rack)).toBe(false);
  });

  test("a bottle whose wine this person can't read (RLS) still occupies its spot: never advised, and the move agrees", async ({
    page,
    request,
    browser,
  }) => {
    const { householdId, token, rack, loose } = await household(page, request, "ahidden");
    // another household's provisional wine (invisible to us under wines_select), and one of OUR bottles of it, on 2·1
    const otherPage = await browser.newPage({ baseURL: PREVIEW_URL });
    const theirs = await household(otherPage, request, "ahidden2");
    await otherPage.close();
    const [vintage] = await sql<{ vintage_id: string }>(
      "select vintage_id from public.bottles where id = $1",
      [theirs.loose[0]!],
    );
    await sql(
      "insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col) values ($1, $2, $3, 2, 1)",
      [householdId, vintage!.vintage_id, rack],
    );
    const advice = await getAdvice(request, token, loose[0]!);
    const spots = [...advice.recommendations, ...advice.alternatives].map((o) => key(o.spot));
    expect(spots).not.toContain(`${rack}:2:1:1`);
    // the move API sees the same occupancy: the spot is taken
    const res = await request.post(`/api/v1/smart-cellar/bottles/${loose[0]}/move`, {
      headers: bearer(token),
      data: { from: null, to: { locationId: rack, row: 2, col: 1, index: 1 } },
    });
    expect(res.status()).toBe(409);
  });

  test("a household member gets the same advice as the owner (RLS, as the person)", async ({
    page,
    request,
    browser,
  }) => {
    const owner = await household(page, request, "aowner");
    const invite = (
      await owner.call<{ code: string }>(
        "post",
        `/households/${owner.householdId}/invites`,
        {},
        201,
      )
    ).body;
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const member = await arrive(await context.newPage(), "amember");
    const memberToken = await sessionToken(member.email);
    expect(
      (await api(request, memberToken, "post", "/households/join", { code: invite.code })).status(),
    ).toBe(200);
    await api(request, memberToken, "put", "/households/active", {
      householdId: owner.householdId,
    });
    await context.close();
    expect(await getAdvice(request, memberToken, owner.loose[0]!)).toEqual(
      await getAdvice(request, owner.token, owner.loose[0]!),
    );
  });

  test("nothing free: said, nothing invented; no places at all: said; a bottle no longer in the cellar: said", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "anone");
    const { call, token } = await apiClient(request, email);
    const w = (await call("post", "/wines", RED, 201)).body as { id: string };
    const loose = (
      (
        await call(
          "post",
          "/bottles",
          { wineId: w.id, year: 2015, quantity: 2, locationId: null },
          201,
        )
      ).body as { bottleIds: string[] }
    ).bottleIds;
    expect((await getAdvice(request, token, loose[0]!)).status).toBe("no_places");
    const tiny = await addPlace(call, "Tiny", "rack", 1, 1);
    await giveLayout(call, tiny, "rack_classic", 1, 1);
    await request.post(`/api/v1/smart-cellar/bottles/${loose[1]}/move`, {
      headers: bearer(token),
      data: { from: null, to: { locationId: tiny, row: 1, col: 1, index: 1 } },
    });
    expect(await getAdvice(request, token, loose[0]!)).toMatchObject({
      status: "no_eligible",
      recommendations: [],
      alternatives: [],
      eligible: 0,
    });
    await sql(
      "update public.bottles set status = 'opened', location_id = null, loc_row = null, loc_col = null where id = $1",
      [loose[1]!],
    );
    expect((await getAdvice(request, token, loose[1]!)).status).toBe("not_in_cellar");
  });
});

// =================================================================================================================
test.describe("advice in the new cellar (preview)", () => {
  test.use({ baseURL: PREVIEW_URL });
  const panel = (page: Page) => page.getByTestId("placement-panel");
  const advice = (page: Page) => page.getByTestId("advice-panel");
  // the three recommendations (the alternatives are listed apart, folded)
  const options = (page: Page) =>
    page.getByTestId("advice-recommendations").getByTestId("advice-option");
  const option = (page: Page, rank: number) =>
    options(page).and(page.locator(`[data-rank="${rank}"]`));
  /** Which of the bottles without a place the panel placed (the list's order isn't the test's to choose). */
  const placedOne = async (ids: string[], locationId: string, row: number, col: number) =>
    (
      await sql<{ id: string }>(
        "select id from public.bottles where id = any($1::uuid[]) and location_id = $2 and loc_row = $3 and loc_col = $4",
        [ids, locationId, row, col],
      )
    ).map((r) => r.id);
  const debugOn = (page: Page) =>
    page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  async function openLoose(page: Page) {
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    await expect(page.getByTestId("smart-3d")).toHaveAttribute("data-mode", "ready");
    await page
      .getByTestId("placement-unplaced")
      .getByRole("button", { name: "Place" })
      .first()
      .click();
    await expect(advice(page)).toHaveAttribute("data-status", "ok");
  }

  test("a bottle without a place: three options, explained, shown in the picker and in 3D; placed only when asked", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { rack, cooler, loose } = await household(page, request, "auiloose");
    await openLoose(page);
    await expect(options(page)).toHaveCount(3);
    await expect(option(page, 1)).toHaveAttribute("data-spot", `${cooler}:3:1:1`);
    await expect(option(page, 1)).toContainText("Wine cooler · shelf 3 · spot 1");
    await expect(option(page, 1)).toContainText("Zone 2 is set aside for keeping wine.");
    await expect(option(page, 1)).toContainText(
      "Zone 2 is set to 12.0 °C. That is a setting in CELLR, not a measured temperature.",
    );
    await expect(option(page, 2)).toContainText(
      "2 bottles of the same vintage nearby (within one shelf or spot).",
    );
    await expect(advice(page)).toContainText("Advice, not a rule");
    // nothing has moved
    expect((await spotOf(loose[0]!)).location_id).toBeNull();
    expect((await spotOf(loose[1]!)).location_id).toBeNull();
    // the second option, in its own place (the rack): chosen in the picker, ringed in 3D
    await option(page, 2).getByTestId("advice-show").click();
    await expect(panel(page)).toHaveAttribute("data-unit", rack);
    await expect(panel(page)).toHaveAttribute("data-choice", "move:2:1:1");
    await expect(page.getByTestId("placement-summary")).toContainText(
      "Oak rack · shelf 2 · spot 1",
    );
    // the first, in another place: that place is shown and the spot chosen there
    await option(page, 1).getByTestId("advice-show").click();
    await expect(panel(page)).toHaveAttribute("data-unit", cooler);
    await expect(panel(page)).toHaveAttribute("data-choice", "move:3:1:1");
    expect(await placedOne(loose, cooler, 3, 1)).toEqual([]);
    // placed, by the Sprint 4 move, only now
    await option(page, 1).getByTestId("advice-place").click();
    await expect(page.getByText(/is now at Wine cooler · shelf 3 · spot 1/)).toBeVisible();
    expect(await placedOne(loose, cooler, 3, 1)).toHaveLength(1);
  });

  test("'Place here' on an option in another place confirms exactly that spot, without switching first", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { rack, cooler, loose } = await household(page, request, "auicross");
    await openLoose(page);
    // the panel shows the rack; option 1 is in the cooler
    await page.getByTestId("placement-units").getByRole("button", { name: "Oak rack" }).click();
    await expect(panel(page)).toHaveAttribute("data-unit", rack);
    await option(page, 1).getByTestId("advice-place").click();
    await expect(page.getByText(/is now at Wine cooler · shelf 3 · spot 1/)).toBeVisible();
    expect(await placedOne(loose, cooler, 3, 1)).toHaveLength(1);
  });

  test("changing the intent changes the advice; any free spot can still be chosen by hand", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { rack, cooler, loose } = await household(page, request, "auiintent");
    await openLoose(page);
    await advice(page)
      .getByTestId("advice-intent")
      .getByRole("button", { name: "Serve soon" })
      .click();
    await expect(advice(page)).toHaveAttribute("data-intent", "serve");
    await expect(option(page, 1)).toHaveAttribute("data-spot", `${cooler}:1:1:1`);
    await expect(option(page, 1)).toContainText("Zone 1 is set aside for serving.");
    // override: a spot no option named
    await page.getByTestId("placement-units").getByRole("button", { name: "Oak rack" }).click();
    await page.getByTestId("spot-picker").locator('[data-spot="3:4:1"]').click();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/is now at Oak rack · shelf 3 · spot 4/)).toBeVisible();
    expect(await placedOne(loose, rack, 3, 4)).toHaveLength(1);
  });

  test("an option taken meanwhile: refused, said, advice asked again; nothing substituted", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { call, token, cooler, wineId } = await household(page, request, "auistale");
    await openLoose(page);
    await option(page, 1).getByTestId("advice-show").click();
    await expect(panel(page)).toHaveAttribute("data-choice", "move:3:1:1");
    // a third bottle (made only now, so it isn't the one in the panel), which someone puts on that spot meanwhile
    const third = (
      (await call("post", "/bottles", { wineId, year: 2015, quantity: 1, locationId: null }, 201))
        .body as { bottleIds: string[] }
    ).bottleIds[0]!;
    const busy = await request.post(`/api/v1/smart-cellar/bottles/${third}/move`, {
      headers: bearer(token),
      data: { from: null, to: { locationId: cooler, row: 3, col: 1, index: 1 } },
    });
    expect(busy.status()).toBe(200);
    await option(page, 1).getByTestId("advice-place").click();
    await expect(page.getByTestId("placement-problem")).toContainText("just taken");
    await expect(page.getByText(/is now at/)).toHaveCount(0);
    // the advice is asked again: its first option is no longer that spot
    await expect(option(page, 1)).not.toHaveAttribute("data-spot", `${cooler}:3:1:1`);
    const states = await sql<{ n: number }>(
      "select count(*)::int as n from public.bottles where location_id = $1 and loc_row = 3 and loc_col = 1",
      [cooler],
    );
    expect(states).toEqual([{ n: 1 }]);
  });

  test("cancel changes nothing; advice that can't be loaded says so and can be tried again", async ({
    page,
    request,
  }) => {
    await debugOn(page);
    const { loose } = await household(page, request, "auifail");
    await page.route("**/recommendations?intent=*", (route) => route.abort("internetdisconnected"));
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    await page
      .getByTestId("placement-unplaced")
      .getByRole("button", { name: "Place" })
      .first()
      .click();
    await expect(page.getByTestId("advice-failed")).toContainText("The advice couldn't be loaded.");
    // the panel itself still works by hand
    await expect(page.getByTestId("spot-picker")).toBeVisible();
    await page.unroute("**/recommendations?intent=*");
    await page.getByTestId("advice-failed").getByRole("button", { name: "Try again" }).click();
    await expect(advice(page)).toHaveAttribute("data-status", "ok");
    await option(page, 1).getByTestId("advice-show").click();
    await page.getByTestId("placement-cancel").click();
    await expect(panel(page)).toHaveCount(0);
    expect((await spotOf(loose[0]!)).location_id).toBeNull();
    expect((await spotOf(loose[1]!)).location_id).toBeNull();
  });

  test("nothing free for it: said, without inventing a place", async ({ page, request }) => {
    const { email } = await arrive(page, "auinone");
    const { call, token } = await apiClient(request, email);
    const tiny = await addPlace(call, "Tiny", "rack", 1, 1);
    await giveLayout(call, tiny, "rack_classic", 1, 1);
    const w = (await call("post", "/wines", RED, 201)).body as { id: string };
    const ids = (
      (
        await call(
          "post",
          "/bottles",
          { wineId: w.id, year: 2015, quantity: 2, locationId: null },
          201,
        )
      ).body as { bottleIds: string[] }
    ).bottleIds;
    await request.post(`/api/v1/smart-cellar/bottles/${ids[0]}/move`, {
      headers: bearer(token),
      data: { from: null, to: { locationId: tiny, row: 1, col: 1, index: 1 } },
    });
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    await page
      .getByTestId("placement-unplaced")
      .getByRole("button", { name: "Place" })
      .first()
      .click();
    await expect(advice(page)).toHaveAttribute("data-status", "no_eligible");
    await expect(page.getByTestId("advice-none")).toContainText(
      "There is no free position for this bottle right now.",
    );
    await expect(options(page)).toHaveCount(0);
  });

  test("without WebGL the same advice works with the flat picture", async ({ page, request }) => {
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
    const { cooler, loose } = await household(page, request, "auiflat");
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    await expect(page.getByTestId("smart-3d-flat")).toBeVisible();
    await page
      .getByTestId("placement-unplaced")
      .getByRole("button", { name: "Place" })
      .first()
      .click();
    await expect(advice(page)).toHaveAttribute("data-status", "ok");
    await option(page, 1).getByTestId("advice-place").click();
    await expect(page.getByText(/is now at Wine cooler · shelf 3 · spot 1/)).toBeVisible();
    expect(await placedOne(loose, cooler, 3, 1)).toHaveLength(1);
  });

  test("with the keyboard: intent and options are buttons, Enter shows; no accessibility violations", async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== "desktop", "keyboard: desktop");
    await debugOn(page);
    const { cooler } = await household(page, request, "auikeys");
    await openLoose(page);
    await option(page, 1).getByTestId("advice-show").focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toHaveAttribute("data-unit", cooler);
    await expect(option(page, 1).getByTestId("advice-show")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await audit(page)).toEqual([]);
  });

  test("on a phone, with reduced motion: the advice fits the screen and its buttons are large enough", async ({
    page,
    request,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await debugOn(page);
    await household(page, request, "auiphone");
    await openLoose(page);
    const width = await page.evaluate(() => window.innerWidth);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const box = (await option(page, 1).getByTestId("advice-place").boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(32);
    await option(page, 1).getByTestId("advice-show").tap();
    await expect(page.getByTestId("placement-confirm")).toBeEnabled();
  });
});
