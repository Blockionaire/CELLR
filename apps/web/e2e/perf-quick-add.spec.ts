import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive, sql } from "./helpers";

/**
 * Not a test: the measuring bench of sprint 7 (3D Quick Add). A real household in the local stack, one rack_classic
 * place HALF full (every other spot taken, so as many markers as bottles: the most markers for its size), measured in
 * the product's 3D cellar on the preview server:
 *   PERF_QUICK=1 PERF_OUT=/some/file.json pnpm exec playwright test perf-quick-add --workers=1
 * Software rendering unless the machine has a GPU: these numbers compare builds on one machine, they are not a phone's.
 */
test.skip(!process.env.PERF_QUICK, "only when asked for (PERF_QUICK=1)");
test.use({ baseURL: PREVIEW_URL });

const OUT = process.env.PERF_OUT ?? "test-results/perf-quick-add.json";
const SIZES = [
  { rows: 10, cols: 8 },
  { rows: 20, cols: 20 },
  { rows: 30, cols: 30 },
];
const ROUNDS = 3;
const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN;

async function seed(
  page: Page,
  request: Parameters<typeof apiClient>[0],
  rows: number,
  cols: number,
) {
  await page.context().clearCookies();
  await page.goto("about:blank");
  const { email, householdId } = await arrive(page, `perfquick${rows * cols}`);
  const { call } = await apiClient(request, email);
  const w = (
    await call(
      "post",
      "/wines",
      { producer: "Domaine Perf", name: "Cuvée Quick", type: "red", countryCode: "FR" },
      201,
    )
  ).body as { id: string };
  const vintage = (
    (
      await call(
        "post",
        "/bottles",
        { wineId: w.id, year: 2019, quantity: 1, locationId: null },
        201,
      )
    ).body as { vintageId: string }
  ).vintageId;
  const id = (
    (await call("post", "/storage", { label: "Measured rack", kind: "rack", rows, cols }, 201))
      .body as { id: string }
  ).id;
  await sql(
    "update public.cellar_locations set template = 'rack_classic', slot_semantics = 'depth' where id = $1",
    [id],
  );
  // every other spot (a checkerboard): half the place taken, half free
  await sql(
    `insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col)
     select $1, $2, $3, r, c from generate_series(1, $4::int) r, generate_series(1, $5::int) c
      where (r + c) % 2 = 0`,
    [householdId, vintage, id, rows, cols],
  );
  const placed = Math.floor((rows * cols) / 2) + ((rows * cols) % 2);
  return { placed };
}

test("measure 3D Quick Add", async ({ page, request, hasTouch }, info) => {
  test.setTimeout(3_600_000);
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const results = [];
  for (const size of SIZES) {
    await seed(page, request, size.rows, size.cols);
    console.error(`${info.project.name} ${size.rows}x${size.cols}: seeded`);
    const canvas = page.locator('[data-testid="smart-3d-stage"] canvas[data-engine]');
    const num = async (name: string) => Number((await canvas.getAttribute(`data-${name}`)) ?? NaN);
    const held = async () =>
      `${await num("geometries")}/${await num("textures")}/${await num("programs")}`;
    const quiet = async () => {
      let last = await num("frames");
      for (let k = 0; k < 40; k++) {
        await page.waitForTimeout(500);
        const now = await num("frames");
        if (now === last) return;
        last = now;
      }
    };
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    await expect(canvas).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 180_000 });
    await quiet();
    const before = {
      calls: await num("calls"),
      triangles: await num("triangles"),
      held: await held(),
      builds: await num("builds"),
    };
    const heapBefore = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? 0,
    );
    const enterMs: number[] = [];
    const tapMs: number[] = [];
    const heldAfterRounds: string[] = [];
    let withMarkers: Record<string, unknown> = {};
    for (let round = 0; round < ROUNDS; round++) {
      // Add bottle → the first picture with every marker (timed in the page: the click to the next picture)
      enterMs.push(
        await page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const c = document.querySelector<HTMLCanvasElement>(
                '[data-testid="smart-3d-stage"] canvas[data-engine]',
              )!;
              const start = performance.now();
              const obs = new MutationObserver(() => {
                if (!c.dataset.spots) return;
                obs.disconnect();
                resolve(performance.now() - start);
              });
              obs.observe(c, { attributes: true, attributeFilter: ["data-frames", "data-spots"] });
              // never wait for ever: a missing picture is a result (-1), not a hung bench
              setTimeout(() => {
                obs.disconnect();
                resolve(c.dataset.spots ? performance.now() - start : -1);
              }, 60_000);
              document.querySelector<HTMLButtonElement>('[data-testid="quick-add-start"]')!.click();
            }),
        ),
      );
      await quiet();
      if (round === 0) {
        const f0 = await num("frames");
        await page.waitForTimeout(3000);
        withMarkers = {
          markers: await num("spots"),
          calls: await num("calls"),
          triangles: await num("triangles"),
          held: await held(),
          idleFrames3s: (await num("frames")) - f0,
        };
      }
      // a tap on a marker → the sheet (Playwright's own click and wait included: an upper bound)
      const at = await page.evaluate(() => {
        const w = window as unknown as {
          __cellrStorage3d: {
            spots: () => string[];
            locateSpot: (r: number, c: number) => { x: number; y: number } | null;
          };
        };
        const key = w.__cellrStorage3d.spots()[0]!;
        const [r, c] = key.split(":").map(Number);
        return w.__cellrStorage3d.locateSpot(r!, c!);
      });
      const box = (await canvas.boundingBox())!;
      const t = Date.now();
      // a finger on a touch screen, a mouse elsewhere
      if (hasTouch) await page.touchscreen.tap(box.x + at!.x, box.y + at!.y);
      else await page.mouse.click(box.x + at!.x, box.y + at!.y);
      await expect(page.getByRole("dialog", { name: "Add a bottle here" })).toBeVisible();
      tapMs.push(Date.now() - t);
      await page.keyboard.press("Escape");
      await page.getByTestId("quick-close").click();
      await expect(page.getByTestId("quick-placing")).toHaveCount(0);
      await quiet();
      heldAfterRounds.push(await held());
    }
    const heapAfter = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? 0,
    );
    const row = {
      device: info.project.name,
      spots: size.rows * size.cols,
      free: Math.floor((size.rows * size.cols) / 2),
      before,
      withMarkers,
      enterToMarkersMedianMs: Math.round(median(enterMs)),
      tapToSheetMedianMs: Math.round(median(tapMs)),
      heldAfterRounds,
      buildsAfter: await num("builds"),
      heapMbBefore: +(heapBefore / 1e6).toFixed(1),
      heapMbAfter: +(heapAfter / 1e6).toFixed(1),
    };
    console.error(JSON.stringify(row));
    results.push(row);
    // entering and leaving leaks nothing: the same geometries, textures and programs after every round, and the
    // furniture built once
    expect(new Set(heldAfterRounds).size, heldAfterRounds.join(" | ")).toBe(1);
    expect(row.buildsAfter).toBe(before.builds);
  }
  const all = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")) as unknown[]) : [];
  fs.writeFileSync(OUT, JSON.stringify([...all, ...results], null, 2));
});
