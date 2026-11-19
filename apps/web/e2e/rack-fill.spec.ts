import { expect, test } from "@playwright/test";
import { apiClient, arrive, sql } from "./helpers";

/**
 * "Where it is": a rack is spread over the popup's whole width (its spots evenly apart, numbers centred above
 * them, shelf numbers beside their row), and one too wide for the screen scrolls sideways at the usual spot size.
 * The bottle at shelf 2, position 1 is the one ringed.
 */
test("racks of 3, 5, 8 and 12 columns use the popup's width evenly, or scroll when they cannot fit", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { email, householdId } = await arrive(page, "rackfill");
  const { call } = await apiClient(request, email);
  const vintages: Record<number, string> = {};
  for (const cols of [3, 5, 8, 12]) {
    const unit = (
      await call<{ id: string }>(
        "post",
        "/storage",
        { label: `Rack ${cols}`, kind: "rack", rows: 3, cols },
        201,
      )
    ).body;
    const wine = (
      await call<{ id: string }>(
        "post",
        "/wines",
        { producer: `Domaine ${cols}`, name: "Cuvée", type: "red", countryCode: "FR" },
        201,
      )
    ).body;
    const { bottleIds } = (
      await call<{ bottleIds: string[] }>(
        "post",
        "/bottles",
        { wineId: wine.id, year: 2019, quantity: 1, locationId: unit.id },
        201,
      )
    ).body;
    await call(
      "patch",
      `/bottles/${bottleIds[0]}`,
      { action: "move", to: { locationId: unit.id, row: 2, col: 1 } },
      200,
    );
    const [v] = await sql<{ vintage_id: string }>(
      "select vintage_id from public.bottles where id = $1",
      [bottleIds[0]],
    );
    vintages[cols] = v!.vintage_id;
  }
  const spots = () =>
    sql(
      "select id, location_id, loc_row, loc_col from public.bottles where household_id = $1 order by id",
      [householdId],
    );
  const before = await spots();

  for (const cols of [3, 5, 8, 12]) {
    await page.goto(`/cellar/${vintages[cols]}`);
    await expect(async () => {
      await page.getByTestId("where-trigger").click();
      await expect(page.getByTestId("where-unit")).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 20_000 });
    const unit = page.getByTestId("where-unit");
    const grid = unit.getByRole("group", { name: `Rack ${cols}` });
    await expect(grid).toBeVisible();

    const m = await grid.evaluate((scroller, n) => {
      const inner = scroller.firstElementChild as HTMLElement;
      const kids = [...inner.children] as HTMLElement[];
      const centre = (e: Element) => {
        const b = e.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width };
      };
      // grid order: corner, n column numbers, then per shelf: its number, n spots, its board
      const heads = kids.slice(1, 1 + n).map((e) => ({ text: e.textContent, ...centre(e) }));
      const shelves: Array<{
        number: { text: string | null; y: number };
        spots: Array<{ x: number; y: number; w: number }>;
        board: { left: number; right: number };
      }> = [];
      for (let i = 1 + n; i < kids.length; i += n + 2) {
        const b = kids[i + n + 1]!.getBoundingClientRect();
        shelves.push({
          number: { text: kids[i]!.textContent, y: centre(kids[i]!).y },
          spots: kids.slice(i + 1, i + 1 + n).map(centre),
          board: { left: b.left, right: b.right },
        });
      }
      const lit = scroller.querySelector("[data-highlighted]")!;
      return {
        clientWidth: scroller.clientWidth,
        scrollWidth: scroller.scrollWidth,
        box: (() => {
          const b = scroller.getBoundingClientRect();
          return { left: b.left, right: b.right };
        })(),
        heads,
        shelves,
        lit: { label: lit.getAttribute("aria-label"), ...centre(lit) },
      };
    }, cols);

    const row1 = m.shelves[0]!.spots;
    const gaps = row1.slice(1).map((s, i) => s.x - row1[i]!.x);
    const fits = m.scrollWidth <= m.clientWidth;
    console.log(
      `${test.info().project.name} ${cols} cols: popup grid ${m.clientWidth}px, content ${m.scrollWidth}px, spots ${Math.round(row1[0]!.x - m.box.left)}…${Math.round(row1.at(-1)!.x - m.box.left)}px, pitch ${gaps.map((g) => g.toFixed(1)).join("/")}`,
    );
    // evenly apart, spots never smaller than 44px
    for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThan(1);
    for (const s of row1) expect(s.w).toBeGreaterThanOrEqual(44);
    if (fits) {
      // the whole width is used: the last spot ends near the popup's right edge, not two-thirds of the way
      const lastRight = row1.at(-1)!.x + gaps[0]! / 2;
      expect(m.box.right - lastRight).toBeLessThan(12);
      expect(gaps[0]!).toBeGreaterThanOrEqual(50);
    } else {
      // too wide to fit: it scrolls, at the usual pitch (44px spot + 6px gap)
      expect(gaps[0]!).toBeCloseTo(50, 0);
      await grid.evaluate((s) => (s.scrollLeft = s.scrollWidth));
      expect(await grid.evaluate((s) => s.scrollLeft)).toBeGreaterThan(0);
    }
    // numbers centred above their spots; shelf numbers beside their row; boards as wide as the spots
    m.heads.forEach((h, i) => {
      expect(h.text).toBe(String(i + 1));
      expect(Math.abs(h.x - row1[i]!.x)).toBeLessThan(1);
    });
    for (const [i, shelf] of m.shelves.entries()) {
      expect(shelf.number.text).toBe(String(i + 1));
      expect(Math.abs(shelf.number.y - shelf.spots[0]!.y)).toBeLessThan(1);
      expect(shelf.board.left).toBeLessThanOrEqual(shelf.spots[0]!.x - shelf.spots[0]!.w / 2 + 1);
      expect(shelf.board.right).toBeGreaterThanOrEqual(
        shelf.spots.at(-1)!.x + shelf.spots.at(-1)!.w / 2 - 1,
      );
    }
    // the ring is on shelf 2, position 1: under column 1's number, beside shelf 2's number
    expect(m.lit.label).toMatch(/shelf 2, position 1, this wine$/);
    expect(Math.abs(m.lit.x - m.heads[0]!.x)).toBeLessThan(1);
    expect(Math.abs(m.lit.y - m.shelves[1]!.number.y)).toBeLessThan(1);
    if (cols === 5)
      await page.screenshot({
        path: `test-results/shots/rack-fill-5-${test.info().project.name}.png`,
      });
    await page.keyboard.press("Escape");
  }
  expect(await spots()).toEqual(before);
});
