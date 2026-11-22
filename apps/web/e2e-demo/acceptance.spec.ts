import { expect as baseExpect, test, type Page } from "@playwright/test";
import {
  APP_URL,
  CODE,
  READONLY_URL,
  STACK_URL,
  apiAs,
  drawn,
  freshPerson,
  open3D,
  signInDemo,
  type Api,
} from "./demo";

/**
 * Smart Cellar 3D, sprint 6: ACCEPTANCE of the workflows on the running demonstration environment
 * (scripts/demo/up.sh): the production build, as a Vercel preview, on the isolated local stack. Every test makes its
 * own synthetic person and household (`…@demo.cellr.test`), so the seeded demo cellar stays as it is; nothing here
 * is mocked except a lost network answer where a test says so. Run on a desktop and on a phone (the config's two
 * projects):
 *
 *   bash scripts/demo/up.sh
 *   cd apps/web && pnpm exec playwright test -c playwright.demo.config.ts acceptance
 *   node scripts/demo/seed.mjs --reset      (removes these households with the demo's, and seeds the demo again)
 */
const expect = baseExpect.configure({ timeout: 20_000 });

const RED = {
  producer: "Domaine Acceptance",
  name: "Rouge Réserve",
  type: "red",
  countryCode: "FR",
};
const WHITE = { producer: "Weingut Probe", name: "Riesling", type: "white", countryCode: "DE" };
const WOOD = { v: 1, material: "wood", color: "walnut", lighting: "warm", door: "none" };
const COOLER = { v: 1, material: "metal", color: "graphite", lighting: "warm", door: "glass" };
type Spot = { locationId: string; row: number; col: number; index: number };
type Unit = {
  id: string;
  templateId: string | null;
  rows: number;
  zones: unknown[];
  occupied: number;
};

async function place(
  call: Api,
  label: string,
  kind: string,
  template: string,
  rows: number,
  cols: number,
  zones: object[] = [],
) {
  const { id } = (await call<{ id: string }>("post", "/storage", { label, kind, rows, cols }, 201))
    .body;
  const appearance = template.startsWith("cooler")
    ? COOLER
    : template === "rack_metal"
      ? { ...COOLER, color: "black", lighting: "none", door: "none" }
      : WOOD;
  await call(
    "put",
    `/smart-cellar/storage/${id}/layout`,
    { structure: { template, rows, cols, cellCapacity: 1, zones }, appearance },
    200,
  );
  return id;
}
async function bottles(call: Api, wine: object, quantity: number, locationId: string | null) {
  const w = (await call<{ id: string }>("post", "/wines", wine, 201)).body;
  return (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: w.id, year: 2015, quantity, locationId },
      201,
    )
  ).body.bottleIds;
}
const spotOf = async (call: Api, bottleId: string) =>
  (await call<{ spot: Spot | null }>("get", `/smart-cellar/bottles/${bottleId}`, undefined, 200))
    .body.spot;
const unitOf = async (call: Api, id: string) =>
  (await call<Unit>("get", `/smart-cellar/storage/${id}`, undefined, 200)).body;

/** A household with a rack (two bottles on shelf 1), a two-zone cooler (empty) and two bottles without a place. */
async function cellar(page: Page, label: string) {
  const person = await freshPerson(label);
  const { call } = person;
  const rack = await place(call, "Oak rack", "rack", "rack_classic", 3, 4);
  const cooler = await place(call, "Wine cooler", "fridge", "cooler_dual", 6, 4, [
    { fromRow: 1, toRow: 2, purpose: "serving", targetTempC: 8 },
    { fromRow: 3, toRow: 6, purpose: "storage", targetTempC: 12 },
  ]);
  const placed = await bottles(call, RED, 2, rack); // shelf 1, spots 1 and 2
  const loose = await bottles(call, WHITE, 2, null);
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  await signInDemo(page, person.email);
  return { ...person, rack, cooler, placed, loose };
}

const panel = (page: Page) => page.getByTestId("placement-panel");
const picker = (page: Page) => page.getByTestId("spot-picker");
const option = (page: Page, rank: number) =>
  page
    .getByTestId("advice-recommendations")
    .getByTestId("advice-option")
    .and(page.locator(`[data-rank="${rank}"]`));

async function inspect(page: Page, name: RegExp) {
  await page.getByRole("button", { name }).focus();
  await page.keyboard.press("Enter");
  const details = page.getByTestId("inspection-panel");
  await expect(details).toHaveAttribute("data-open", "true");
  await details.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  return details;
}
async function moveFromInspection(page: Page, row: number, col: number) {
  await inspect(page, new RegExp(`Rouge Réserve 2015, shelf ${row}, position ${col}`));
  await page.getByTestId("smart-3d-move").click();
  await expect(panel(page)).toBeVisible();
}
async function placeLoose(page: Page) {
  await page
    .getByTestId("placement-unplaced")
    .getByRole("button", { name: "Place" })
    .first()
    .click();
  await expect(page.getByTestId("advice-panel")).toHaveAttribute("data-status", "ok");
}
const spotKey = (s: Spot | null) => (s ? `${s.locationId}:${s.row}:${s.col}:${s.index}` : null);

// =================================================================================================================
test.describe("workflows", () => {
  test("W1 design my cellar: a template, configured, previewed, saved, and there in 3D", async ({
    page,
  }) => {
    const { call, email } = await freshPerson("w1");
    await bottles(call, RED, 1, null); // a bottle, so the cellar has its views
    await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
    await signInDemo(page, email);
    await page.goto("/cellar/builder");
    const builder = page.getByTestId("rack-builder");
    const stage = page.getByTestId("builder-stage");
    await expect(builder).toHaveAttribute("data-mode", "new");
    await page.getByTestId("template-rack_classic").click();
    await page.getByTestId("builder-name").fill("Acceptance rack");
    const rows = Number(await stage.getAttribute("data-rows"));
    await page.getByTestId("builder-rows").getByRole("button").nth(0).click();
    await expect(stage).toHaveAttribute("data-rows", String(rows - 1));
    await page
      .getByRole("radiogroup", { name: "Colour" })
      .getByRole("radio", { name: "Oak" })
      .click();
    await expect(stage).toHaveAttribute("data-color", "oak");
    await page.getByTestId("builder-lighting").getByRole("radio", { name: "Warm light" }).click();
    await expect(stage).toHaveAttribute("data-lighting", "warm");
    await expect(builder).toHaveAttribute("data-status", "ready");
    await page.getByTestId("builder-save").click();
    await expect(page).toHaveURL(/\/cellar\/builder\/[0-9a-f-]{36}\?saved=1$/, { timeout: 45_000 });
    const id = page.url().match(/builder\/([0-9a-f-]{36})/)![1]!;
    const unit = await unitOf(call, id);
    expect(unit).toMatchObject({ templateId: "rack_classic", rows: rows - 1 });
    expect((unit as unknown as { appearance: object }).appearance).toMatchObject({
      material: "wood",
      color: "oak",
      lighting: "warm",
    });
    // in the cellar, in 3D
    await open3D(page);
    await drawn(page);
    await expect(
      page.getByText(new RegExp(`Rack · 0 of ${(rows - 1) * 8} · ${(rows - 1) * 8} free`)),
    ).toBeVisible();
  });

  test("W2 organise: a bottle without a place, its advice, followed; stored exactly on the advised spot", async ({
    page,
  }) => {
    const { call, cooler, loose } = await cellar(page, "w2");
    await open3D(page);
    await drawn(page);
    await placeLoose(page);
    const first = option(page, 1);
    await expect(first).toContainText("Wine cooler");
    const advised = await first.getAttribute("data-spot");
    expect(advised).toMatch(new RegExp(`^${cooler}:[3-6]:\\d+:1$`)); // the keeping zone, index 1
    // nothing moved by looking
    expect(await spotOf(call, loose[0]!)).toBeNull();
    expect(await spotOf(call, loose[1]!)).toBeNull();
    await first.getByTestId("advice-place").click();
    await expect(page.getByText(/is now at Wine cooler · shelf \d · spot \d/)).toBeVisible();
    const where = [await spotOf(call, loose[0]!), await spotOf(call, loose[1]!)].map(spotKey);
    expect(where.filter((k) => k === advised)).toHaveLength(1);
    expect(where.filter((k) => k === null)).toHaveLength(1);
  });

  test("W3 reorganise: to another place, the source free, the destination taken; Undo puts it back", async ({
    page,
  }) => {
    const { call, rack, cooler, placed } = await cellar(page, "w3");
    await open3D(page);
    await drawn(page);
    await moveFromInspection(page, 1, 1);
    await page.getByTestId("placement-units").getByRole("button", { name: "Wine cooler" }).click();
    await expect(panel(page)).toHaveAttribute("data-unit", cooler);
    await picker(page).locator('[data-spot="4:2:1"]').click();
    await expect(page.getByTestId("placement-summary")).toContainText(
      "Wine cooler · shelf 4 · spot 2",
    );
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/is now at Wine cooler · shelf 4 · spot 2/)).toBeVisible();
    expect(await spotOf(call, placed[0]!)).toEqual({
      locationId: cooler,
      row: 4,
      col: 2,
      index: 1,
    });
    expect((await unitOf(call, rack)).occupied).toBe(1);
    expect((await unitOf(call, cooler)).occupied).toBe(1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Moved back.")).toBeVisible();
    expect(await spotOf(call, placed[0]!)).toEqual({ locationId: rack, row: 1, col: 1, index: 1 });
    expect((await unitOf(call, cooler)).occupied).toBe(0);
  });

  test("W4 build a wine cooler: two zones, split and set, saved, and the zones in the cellar", async ({
    page,
  }) => {
    const { call, email } = await freshPerson("w4");
    await bottles(call, RED, 1, null);
    await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
    await signInDemo(page, email);
    await page.goto("/cellar/builder");
    await expect(page.getByTestId("rack-builder")).toHaveAttribute("data-mode", "new");
    await page.getByTestId("template-cooler_dual").click();
    await page.getByTestId("builder-name").fill("Acceptance cooler");
    await expect(page.getByTestId("builder-zone-0")).toContainText("shelves 1–4");
    await page.getByTestId("builder-zone-split").getByRole("button").first().click();
    await expect(page.getByTestId("builder-zone-0")).toContainText("shelves 1–3");
    await expect(page.getByTestId("builder-zone-1")).toContainText("shelves 4–8");
    const up = page.getByRole("button", { name: "Zone 2: +0.5 °C" });
    await up.click();
    await up.click();
    await expect(page.getByTestId("builder-zone-1").getByTestId("builder-zone-temp")).toContainText(
      "13.0",
    );
    await page.getByTestId("builder-save").click();
    await expect(page).toHaveURL(/\/cellar\/builder\/[0-9a-f-]{36}\?saved=1$/, { timeout: 45_000 });
    const id = page.url().match(/builder\/([0-9a-f-]{36})/)![1]!;
    expect((await unitOf(call, id)).zones).toEqual([
      { fromRow: 1, toRow: 3, purpose: "serving", targetTempC: 8 },
      { fromRow: 4, toRow: 8, purpose: "storage", targetTempC: 13 },
    ]);
    await open3D(page);
    await drawn(page);
    const legend = page.getByTestId("zone-legend");
    await expect(legend).toContainText("shelves 1–3");
    await expect(legend).toContainText("shelves 4–8");
    await expect(legend).toContainText("13.0 °C");
  });

  test("W6 recover: a lost answer is decided by a fresh read; a request that never arrives is said as not moved", async ({
    page,
  }) => {
    const { call, rack, placed } = await cellar(page, "w6net");
    await open3D(page);
    await drawn(page);
    const move = "**/api/v1/smart-cellar/bottles/*/move";
    await page.route(move, (route) => route.abort("internetdisconnected"));
    await moveFromInspection(page, 1, 1);
    await picker(page).locator('[data-spot="3:1:1"]').click();
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByTestId("placement-problem")).toContainText("The bottle didn't move");
    expect(await spotOf(call, placed[0]!)).toEqual({ locationId: rack, row: 1, col: 1, index: 1 });
    await page.unroute(move);
    await page.route(move, async (route) => {
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await page.getByTestId("placement-confirm").click();
    await expect(page.getByText(/is now at Oak rack · shelf 3 · spot 1/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
    expect(await spotOf(call, placed[0]!)).toEqual({ locationId: rack, row: 3, col: 1, index: 1 });
  });

  test("W6 recover: an advised spot taken meanwhile is refused and said; nothing is placed elsewhere", async ({
    page,
  }) => {
    const { call, loose } = await cellar(page, "w6busy");
    await open3D(page);
    await drawn(page);
    await placeLoose(page);
    // a third bottle, made only now (so it isn't the one in the panel)
    const third = (await bottles(call, WHITE, 1, null))[0]!;
    const advised = (await option(page, 1).getAttribute("data-spot"))!;
    const [locationId, row, col] = advised.split(":");
    // someone else puts another bottle there meanwhile
    await call(
      "post",
      `/smart-cellar/bottles/${third}/move`,
      { from: null, to: { locationId, row: Number(row), col: Number(col), index: 1 } },
      200,
    );
    await option(page, 1).getByTestId("advice-place").click();
    await expect(page.getByTestId("placement-problem")).toContainText("just taken");
    await expect(page.getByText(/is now at/)).toHaveCount(0);
    // neither bottle of the panel was put anywhere
    for (const id of loose) expect(await spotOf(call, id)).toBeNull();
    // and the advice was asked again: its first option is another spot
    await expect(option(page, 1)).not.toHaveAttribute("data-spot", advised);
  });
});

// =================================================================================================================
test.describe("scenarios", () => {
  test("first-time user: no bottles, no places; the existing welcome, nothing of the 3D asked for", async ({
    page,
  }) => {
    const { email } = await freshPerson("first");
    await signInDemo(page, email);
    await page.goto("/cellar");
    await expect(page.getByRole("radio", { name: "3D" })).toHaveCount(0);
  });

  test("the demo's fixed code signs in demo addresses only", async () => {
    const json = { "content-type": "application/json" };
    const tryCode = async (email: string) => {
      await fetch(`${STACK_URL}/auth/v1/otp`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ email, create_user: true }),
      });
      const res = await fetch(`${STACK_URL}/auth/v1/verify`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ email, token: CODE, type: "email" }),
      });
      return ((await res.json()) as { access_token?: string }).access_token ?? null;
    };
    expect(await tryCode(`someone-${Date.now()}@demo.cellr.test`)).toBeTruthy();
    expect(await tryCode(`someone-${Date.now()}@example.com`)).toBeNull();
    expect(await tryCode(`someone-${Date.now()}@demo.cellr.test.example.com`)).toBeNull();
  });

  test("bottles but no place: the 3D view invites to build a cellar first", async ({ page }) => {
    const { call, email } = await freshPerson("empty");
    await bottles(call, RED, 2, null);
    await signInDemo(page, email);
    await open3D(page).catch(() => undefined);
    await expect(page.getByTestId("smart-3d")).toHaveAttribute("data-mode", "empty", {
      timeout: 30_000,
    });
    await expect(page.getByText("Build your cellar first")).toBeVisible();
  });

  test("returning user: signed in again, the same cellar and the same view", async ({
    page,
    context,
  }) => {
    const { email, rack } = await cellar(page, "back");
    await open3D(page);
    await drawn(page);
    await context.clearCookies();
    await signInDemo(page, email);
    await open3D(page);
    await drawn(page);
    await expect(page.getByTestId("placement-unplaced")).toContainText("Riesling");
    expect(rack).toBeTruthy();
  });

  test("households are isolated: another household's bottle and place are not found, and not movable", async ({
    page,
  }) => {
    const a = await cellar(page, "isoa");
    const b = await freshPerson("isob", "Other household");
    const theirRack = await place(b.call, "Their rack", "rack", "rack_classic", 2, 2);
    const [theirs] = await bottles(b.call, RED, 1, theirRack);
    const r1 = await a.call("get", `/smart-cellar/bottles/${theirs}`);
    const r2 = await a.call("post", `/smart-cellar/bottles/${theirs}/move`, {
      from: { locationId: theirRack, row: 1, col: 1, index: 1 },
      to: { locationId: a.rack, row: 3, col: 4, index: 1 },
    });
    const r3 = await a.call("get", `/smart-cellar/storage/${theirRack}`);
    const r4 = await a.call("get", `/smart-cellar/bottles/${theirs}/recommendations?intent=store`);
    expect([r1.status, r2.status, r3.status, r4.status]).toEqual([404, 404, 404, 404]);
    expect(await spotOf(b.call, theirs!)).toEqual({
      locationId: theirRack,
      row: 1,
      col: 1,
      index: 1,
    });
    // and nothing of theirs in the view
    await open3D(page);
    await drawn(page);
    await expect(page.getByText("Their rack")).toHaveCount(0);
  });

  test("household switching: each household's own places in the 3D view", async ({ page }) => {
    const a = await cellar(page, "switch");
    const second = await a.call<{ id: string }>("post", "/households", { name: "The cabin" }, 201);
    // creating a household doesn't switch to it (the app does that as a separate step): switch, as the app does
    await a.call("put", "/households/active", { householdId: second.body.id }, 200);
    const cabin = await place(a.call, "Cabin rack", "rack", "rack_metal", 2, 3);
    await bottles(a.call, RED, 1, cabin);
    await open3D(page);
    await drawn(page);
    // one place there: no buttons to choose, just its picture and its own bottle
    await expect(page.getByRole("group", { name: "3D view of Cabin rack" })).toBeVisible();
    await expect(page.getByText("Rack · 1 of 6 · 5 free")).toBeVisible();
    await expect(page.getByRole("button", { name: "Oak rack", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("placement-unplaced")).toHaveCount(0);
    await a.call("put", "/households/active", { householdId: a.householdId }, 200);
    await open3D(page);
    await drawn(page);
    await expect(page.getByRole("button", { name: "Oak rack", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cabin rack", exact: true })).toHaveCount(0);
    expect(second.body.id).not.toBe(a.householdId);
  });

  test("read-only deployment: the same view and advice; moving is refused by the API and said in the UI", async ({
    page,
  }) => {
    const { token, rack, placed } = await cellar(page, "ro");
    const ro = apiAs(token, READONLY_URL);
    const refused = await ro("post", `/smart-cellar/bottles/${placed[0]}/move`, {
      from: { locationId: rack, row: 1, col: 1, index: 1 },
      to: { locationId: rack, row: 3, col: 4, index: 1 },
    });
    expect(refused.status).toBe(403);
    // the session cookie is shared by every port of localhost
    await open3D(page, READONLY_URL);
    await drawn(page);
    await placeLoose(page);
    await expect(page.getByTestId("placement-read-only")).toBeVisible();
    await expect(page.getByTestId("placement-confirm")).toHaveCount(0);
    const live = apiAs(token, APP_URL);
    expect(
      (await live<{ spot: Spot }>("get", `/smart-cellar/bottles/${placed[0]}`, undefined, 200)).body
        .spot,
    ).toEqual({ locationId: rack, row: 1, col: 1, index: 1 });
  });

  test("without WebGL: the flat picture, and a bottle can still be moved", async ({ page }) => {
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
    const { call, rack, placed } = await cellar(page, "flat");
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
    expect(await spotOf(call, placed[1]!)).toEqual({ locationId: rack, row: 3, col: 2, index: 1 });
  });

  test("WebGL context lost: said, and the view starts again", async ({ page }) => {
    await cellar(page, "lost");
    await open3D(page);
    await drawn(page);
    await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>(
        '[data-testid="smart-3d-stage"] canvas[data-engine]',
      )!;
      (c.getContext("webgl2") ?? c.getContext("webgl"))!
        .getExtension("WEBGL_lose_context")!
        .loseContext();
    });
    const lost = page.getByTestId("smart-3d-lost");
    await expect(lost).toBeVisible();
    await lost.getByRole("button", { name: "Show 3D again" }).click();
    await drawn(page);
  });

  test("reduced motion: a bottle out and back, nothing written", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { call, rack, placed } = await cellar(page, "still");
    await open3D(page);
    await drawn(page);
    // the details arrive after the panel opens: their line is held open, so Move doesn't move under a finger
    await page.route("**/api/v1/cellar/*", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.getByRole("button", { name: /Rouge Réserve 2015, shelf 1, position 1/ }).focus();
    await page.keyboard.press("Enter");
    const details = page.getByTestId("inspection-panel");
    await expect(details).toHaveAttribute("data-open", "true");
    const move = page.getByTestId("smart-3d-move");
    await expect(details).toContainText("In your cellar…");
    const early = (await move.boundingBox())!.y;
    await expect(details).toContainText("2 bottles of this vintage");
    expect((await move.boundingBox())!.y).toBe(early);
    await expect(details).toContainText("Oak rack · Shelf 1 · Position 1");
    await page.keyboard.press("Escape");
    await expect(details).not.toHaveAttribute("data-open", "true");
    expect(await spotOf(call, placed[0]!)).toEqual({ locationId: rack, row: 1, col: 1, index: 1 });
  });

  test("slow rendering (CPU 4× slower): the view still draws, and a bottle can be inspected", async ({
    page,
  }) => {
    await cellar(page, "slow");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await open3D(page);
    await drawn(page);
    await inspect(page, /Rouge Réserve 2015, shelf 1, position 1/);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  });

  test("the seeded demo: every place opens, the legacy place in the existing view", async ({
    page,
  }) => {
    await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
    await signInDemo(page);
    await open3D(page);
    await drawn(page);
    for (const label of [
      "Walnut rack",
      "Metal wall system",
      "Dual-zone cooler",
      "Kitchen cooler",
      "Undercounter cooler",
      "Open shelves",
      "Mahogany cabinet",
      "Wine crates",
      "Brass wall pegs",
      "Wall rails",
      "Studio rack",
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await drawn(page);
    }
    await page.getByRole("button", { name: "Old fridge", exact: true }).click();
    await expect(page.getByTestId("smart-3d")).toHaveAttribute("data-unit-renderer", "legacy");
    await expect(page.getByTestId("smart-3d-stage")).toHaveCount(0);
    await expect(page.getByTestId("cellar-3d")).toHaveAttribute("data-ready", "true", {
      timeout: 60_000,
    });
  });
});
