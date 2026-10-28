import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { apiClient, arrive, sql } from "./helpers";

/**
 * Sprint N: moving bottles by trading places and by dragging them.
 * - Tapping Move and then another bottle swaps the two (also between places, and from the Move sheet); Undo puts
 *   them back, unless someone has moved one since.
 * - Pressing and holding a bottle lifts it; dragging it onto a free spot moves it, onto another bottle swaps them,
 *   anywhere else puts it back. A short tap still opens the bottle; a quick swipe still scrolls.
 * - Two people swapping at the same moment: one wins, the other is told, nothing is lost or doubled.
 * The touches are real touch events (through the browser's DevTools protocol), as a finger on an iPhone makes them.
 */
test.skip(({ isMobile }) => !isMobile, "touch: the phone project");

const RED = { producer: "Château Margaux", name: "Pavillon Rouge", type: "red", countryCode: "FR" };
const WHITE = { producer: "Domaine Test", name: "Chablis", type: "white", countryCode: "FR" };
const SWEET = { producer: "Weingut Test", name: "Riesling", type: "white", countryCode: "DE" };

async function seed(page: Page, request: Parameters<typeof apiClient>[0], label: string) {
  const { email, householdId } = await arrive(page, label);
  const { call, token } = await apiClient(request, email);
  const place = async (name: string, kind: string, rows: number, cols: number) =>
    (await call<{ id: string }>("post", "/storage", { label: name, kind, rows, cols }, 201)).body
      .id;
  const rack = await place("Rack", "rack", 2, 4);
  const fridge = await place("Fridge", "fridge", 2, 3);
  const add = async (wine: object, year: number, at: [string, number, number]) => {
    const w = (await call<{ id: string }>("post", "/wines", wine, 201)).body;
    const { bottleIds } = (
      await call<{ bottleIds: string[] }>(
        "post",
        "/bottles",
        { wineId: w.id, year, quantity: 1, locationId: null },
        201,
      )
    ).body;
    await sql(
      "update public.bottles set location_id = $2, loc_row = $3, loc_col = $4 where id = $1",
      [bottleIds[0], ...at],
    );
    return bottleIds[0]!;
  };
  const a = await add(RED, 2015, [rack, 1, 1]);
  const b = await add(WHITE, 2019, [rack, 1, 2]);
  const c = await add(SWEET, 2020, [fridge, 2, 2]);
  return { householdId, call, token, rack, fridge, a, b, c };
}

/** Where each bottle stands now: "place r:c", or "-" without a place. */
async function where(...ids: string[]) {
  const rows = await sql<{
    id: string;
    place: string | null;
    row: number | null;
    col: number | null;
  }>(
    `select b.id, l.label as place, b.loc_row as row, b.loc_col as col
       from public.bottles b left join public.cellar_locations l on l.id = b.location_id
      where b.id = any($1::uuid[])`,
    [ids],
  );
  return ids.map((id) => {
    const r = rows.find((x) => x.id === id)!;
    return r.place ? `${r.place} ${r.row}:${r.col}` : "-";
  });
}

async function openRacks(page: Page) {
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "Racks" }).click();
  for (const name of ["Rack", "Fridge"]) {
    const header = page.getByTestId("place").getByRole("button", { name, exact: true });
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");
  }
}

const slot = (page: Page, name: RegExp | string) =>
  page.getByRole("button", { name, exact: typeof name === "string" });

/** A finger: press at a spot, hold, travel along the way (in small steps), and lift. */
async function finger(
  page: Page,
  cdp: CDPSession,
  from: Locator,
  to: Locator | { x: number; y: number } | null,
  holdMs: number,
) {
  const centre = async (l: Locator) => {
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const start = await centre(from);
  const touch = (type: string, p?: { x: number; y: number }) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [],
    } as never);
  await touch("touchStart", start);
  await page.waitForTimeout(holdMs);
  if (to) {
    const end = "x" in to ? to : await centre(to);
    for (let i = 1; i <= 12; i++)
      await touch("touchMove", {
        x: start.x + ((end.x - start.x) * i) / 12,
        y: start.y + ((end.y - start.y) * i) / 12,
      });
    await page.waitForTimeout(80);
  }
  await touch("touchEnd");
}

test("tapping Move, then another bottle: they trade places, also between places; Undo puts them back", async ({
  page,
  request,
}) => {
  const { a, b, c } = await seed(page, request, "swap1");
  await openRacks(page);

  // Within the rack.
  await slot(page, /Pavillon Rouge 2015, shelf 1, position 1/).click();
  await page.getByRole("dialog").getByRole("button", { name: "Move", exact: true }).click();
  await slot(page, /Swap with .*Chablis 2019, shelf 1, position 2/).click();
  await expect(
    page.getByText("Pavillon Rouge 2015 and Chablis 2019 swapped places."),
  ).toBeVisible();
  expect(await where(a, b)).toEqual(["Rack 1:2", "Rack 1:1"]);
  await expect(slot(page, /Pavillon Rouge 2015, shelf 1, position 2/)).toBeVisible();

  // Undo trades them back.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => where(a, b)).toEqual(["Rack 1:1", "Rack 1:2"]);

  // Between two places.
  await slot(page, /Pavillon Rouge 2015, shelf 1, position 1/).click();
  await page.getByRole("dialog").getByRole("button", { name: "Move", exact: true }).click();
  await slot(page, /Swap with .*Riesling 2020, shelf 2, position 2/).click();
  await expect(
    page.getByText("Pavillon Rouge 2015 and Riesling 2020 swapped places."),
  ).toBeVisible();
  expect(await where(a, c)).toEqual(["Fridge 2:2", "Rack 1:1"]);
  await expect(
    page.getByRole("region", { name: "Fridge" }).getByRole("button", { name: /Pavillon Rouge/ }),
  ).toBeVisible();

  // Undo after someone else has moved one of them: their move stands, and the screen says why.
  await sql("update public.bottles set loc_col = 3 where id = $1", [c]); // Riesling: Rack 1:1 → Rack 1:3
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/just moved by someone else\. Nothing was changed\./)).toBeVisible();
  expect(await where(a, c)).toEqual(["Fridge 2:2", "Rack 1:3"]);
});

test("the Move sheet offers taken spots too: choosing one swaps the two bottles", async ({
  page,
  request,
}) => {
  const { a, b } = await seed(page, request, "swap2");
  const [v] = await sql<{ vintage_id: string }>(
    "select vintage_id from public.bottles where id = $1",
    [a],
  );
  await page.goto(`/cellar/${v!.vintage_id}`);
  await page.getByRole("button", { name: "Move", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Move a bottle" });
  await expect(
    sheet.getByText("Tap a free spot, or a bottle to swap places with it."),
  ).toBeVisible();
  await sheet
    .getByRole("button", { name: /Swap with .*Chablis 2019, shelf 1, position 2/ })
    .click();
  await expect(
    page.getByText("Pavillon Rouge 2015 and Chablis 2019 swapped places."),
  ).toBeVisible();
  expect(await where(a, b)).toEqual(["Rack 1:2", "Rack 1:1"]);
});

test("press and hold to drag: onto a free spot moves, onto a bottle swaps, elsewhere puts it back; a tap and a swipe stay what they were", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const { a, b, c } = await seed(page, request, "drag1");
  await openRacks(page);
  const cdp = await page.context().newCDPSession(page);
  const ghost = page.getByTestId("drag-ghost");
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && r.url().includes("/api/v1/bottles/")) writes.push(r.url());
  });

  // A short tap still opens the bottle.
  await finger(page, cdp, slot(page, /Pavillon Rouge 2015, shelf 1, position 1/), null, 60);
  await expect(page.getByRole("dialog", { name: "Pavillon Rouge" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // A quick swipe over a bottle scrolls; nothing is lifted.
  await finger(page, cdp, slot(page, /Chablis 2019, shelf 1, position 2/), { x: 200, y: 120 }, 30);
  await expect(ghost).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeHidden();
  await openRacks(page); // back to the top

  // Held: it lifts. Let go over nothing: it goes back, nothing is written.
  const red = slot(page, /Pavillon Rouge 2015, shelf 1, position 1/);
  const box = (await red.boundingBox())!;
  const cdpTouch = (type: string, x?: number, y?: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: x === undefined ? [] : [{ x, y, id: 1 }],
    } as never);
  await cdpTouch("touchStart", box.x + 22, box.y + 22);
  await page.waitForTimeout(500);
  await cdpTouch("touchMove", box.x + 30, box.y + 30);
  await expect(ghost).toBeVisible();
  await expect(ghost).toContainText("Let go to put it back");
  await cdpTouch("touchMove", 20, box.y - 40); // off the grid
  await cdpTouch("touchEnd");
  await expect(ghost).toHaveCount(0);
  expect(writes).toEqual([]);
  await expect(page.getByRole("dialog")).toBeHidden(); // the release is not a tap

  // Onto a free spot: moved.
  await finger(page, cdp, red, slot(page, "Shelf 2, position 4, empty"), 500);
  await expect(page.getByText(/Moved to Rack · Shelf 2 · Position 4/)).toBeVisible();
  expect(await where(a)).toEqual(["Rack 2:4"]);

  // Onto another bottle: the two trade places.
  await finger(
    page,
    cdp,
    slot(page, /Pavillon Rouge 2015, shelf 2, position 4/),
    slot(page, /Chablis 2019, shelf 1, position 2/),
    500,
  );
  await expect(
    page.getByText("Pavillon Rouge 2015 and Chablis 2019 swapped places."),
  ).toBeVisible();
  expect(await where(a, b)).toEqual(["Rack 1:2", "Rack 2:4"]);

  // Onto a bottle in another place (the fridge, further down): they trade places across places.
  const riesling = page
    .getByRole("region", { name: "Fridge" })
    .getByRole("button", { name: /Riesling/ });
  const chablis = slot(page, /Chablis 2019, shelf 2, position 4/);
  // both in sight, away from the edges where the page scrolls along
  await chablis.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 110));
  await finger(page, cdp, chablis, riesling, 500);
  await expect(page.getByText("Chablis 2019 and Riesling 2020 swapped places.")).toBeVisible();
  expect(await where(b, c)).toEqual(["Fridge 2:2", "Rack 2:4"]);
});

test("two people swapping the same bottle at the same moment: one wins, the other is told, nothing is lost", async ({
  page,
  request,
}) => {
  const { call, rack, fridge, a, b, c } = await seed(page, request, "swap3");
  const spot = (locationId: string, row: number, col: number) => ({ locationId, row, col });
  const [one, two] = await Promise.all([
    call("patch", `/bottles/${a}`, {
      action: "swap",
      with: b,
      expected: { self: spot(rack, 1, 1), other: spot(rack, 1, 2) },
    }),
    call("patch", `/bottles/${a}`, {
      action: "swap",
      with: c,
      expected: { self: spot(rack, 1, 1), other: spot(fridge, 2, 2) },
    }),
  ]);
  expect([one.status, two.status].sort()).toEqual([200, 409]);
  const after = await where(a, b, c);
  // Exactly one of the two swaps happened; every bottle has its own spot.
  expect([
    ["Rack 1:2", "Rack 1:1", "Fridge 2:2"].join(),
    ["Fridge 2:2", "Rack 1:2", "Rack 1:1"].join(),
  ]).toContain(after.join());
  expect(new Set(after).size).toBe(3);
});
