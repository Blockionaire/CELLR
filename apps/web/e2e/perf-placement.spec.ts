import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive, sql } from "./helpers";

/**
 * Not a test: the measuring bench of sprint 4 (placement). A real household in the local stack, one rack_classic
 * place full of bottles but for one free spot, at 40, 200 and 900 bottles, plus "1,200": 900 in the measured place
 * and 300 in a second one (one place can't hold 1,200 single bottles: 30 × 30 is the largest grid, and more than one
 * bottle per cell needs depth placement, which is off). Measured in the product's 3D cellar on the preview server:
 *   PERF_PLACEMENT=1 PERF_OUT=/some/file.json pnpm exec playwright test perf-placement --project=desktop
 * Software rendering unless the machine has a GPU: these numbers compare builds on one machine, they are not a phone's.
 */
test.skip(!process.env.PERF_PLACEMENT, "only when asked for (PERF_PLACEMENT=1)");
test.use({ baseURL: PREVIEW_URL });

const OUT = process.env.PERF_OUT ?? "test-results/perf-placement.json";
const SIZES = [
  { bottles: 40, rows: 5, cols: 8, extra: 0 },
  { bottles: 200, rows: 10, cols: 20, extra: 0 },
  { bottles: 900, rows: 30, cols: 30, extra: 0 },
  { bottles: 1200, rows: 30, cols: 30, extra: 300 },
].filter(
  (s) => !process.env.PERF_ONLY || process.env.PERF_ONLY.split(",").includes(String(s.bottles)),
);
const ROUNDS = 5;
const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN;

async function seed(page: Page, request: Parameters<typeof apiClient>[0], size: (typeof SIZES)[0]) {
  // a new household for each size: signed out first, so the first-run starts again
  await page.context().clearCookies();
  await page.goto("about:blank");
  const { email, householdId } = await arrive(page, `perfplace${size.bottles}`);
  const { call } = await apiClient(request, email);
  const vintages: string[] = [];
  for (const [i, type] of ["red", "white", "sparkling", "rose"].entries()) {
    const w = (
      await call(
        "post",
        "/wines",
        { producer: `Domaine Perf ${i + 1}`, name: `Cuvée ${i + 1}`, type, countryCode: "FR" },
        201,
      )
    ).body as { id: string };
    vintages.push(
      (
        (
          await call(
            "post",
            "/bottles",
            { wineId: w.id, year: 2019, quantity: 1, locationId: null },
            201,
          )
        ).body as { vintageId: string }
      ).vintageId,
    );
  }
  const place = async (label: string, rows: number, cols: number, n: number) => {
    const id = (
      (await call("post", "/storage", { label, kind: "rack", rows, cols }, 201)).body as {
        id: string;
      }
    ).id;
    await sql(
      "update public.cellar_locations set template = 'rack_classic', slot_semantics = 'depth' where id = $1",
      [id],
    );
    // as the database owner in one statement (hundreds of adds through the app would take minutes); the last
    // spot of the measured place stays free, for the moves
    await sql(
      `insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col)
       select $1, ($2::uuid[])[1 + (n % 4)], $3, 1 + (n / $4::int), 1 + (n % $4::int)
         from generate_series(0, $5::int - 1) n`,
      [householdId, vintages, id, cols, n],
    );
    return id;
  };
  const inPlace = Math.min(size.bottles, size.rows * size.cols) - 1;
  const measured = await place("Measured rack", size.rows, size.cols, inPlace);
  if (size.extra) await place("Second rack", 20, 15, size.extra);
  return { measured, inPlace };
}

test("measure placing and moving bottles", async ({ page, request }, info) => {
  test.setTimeout(3_600_000);
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const results = [];
  for (const size of SIZES) {
    const { inPlace } = await seed(page, request, size);
    const canvas = page.locator('[data-testid="smart-3d-stage"] canvas[data-engine]');
    const num = async (name: string) => Number((await canvas.getAttribute(`data-${name}`)) ?? NaN);
    const held = async () =>
      `${await num("geometries")}/${await num("textures")}/${await num("programs")}`;
    const t0 = Date.now();
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    if (size.extra) await page.getByRole("button", { name: "Measured rack", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 180_000 });
    await expect(canvas).toHaveAttribute("data-bottles", String(inPlace), { timeout: 180_000 });
    const firstPictureMs = Date.now() - t0;
    console.error(`${size.bottles}: first picture after ${firstPictureMs} ms`);
    await page.waitForTimeout(3000);
    const atRest = {
      calls: await num("calls"),
      triangles: await num("triangles"),
      held: await held(),
      builds: await num("builds"),
    };
    let f0 = await num("frames");
    await page.waitForTimeout(3000);
    const idleFrames3s = (await num("frames")) - f0;

    // the free spot is the last one; the bottle moved is the first
    const last = `${size.rows}:${size.cols}:1`;
    const timings = {
      select: [] as number[],
      out: [] as number[],
      panel: [] as number[],
      target: [] as number[],
      confirmed: [] as number[],
    };
    const requests: number[] = [];
    const heldAfter: string[] = [];
    const heapBefore = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? 0,
    );
    let panelIdle = NaN;
    let lostTaps = 0;
    for (let round = 0; round < ROUNDS; round++) {
      for (const [from, to] of [
        ["1:1", last],
        [`${size.rows}:${size.cols}`, "1:1:1"],
      ] as const) {
        const [r, c] = from.split(":");
        // selection: the bottle, out, its Move, and the placement panel with its picker
        let t = Date.now();
        await page
          .getByRole("button", {
            name: new RegExp(`Cuvée \\d 2019, shelf ${r}, position ${c}(?!\\d)`),
          })
          .focus();
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("inspection-panel")).toHaveAttribute("data-open", "true", {
          timeout: 60_000,
        });
        timings.out.push(Date.now() - t);
        // Move → the panel with its picker, timed in the page (Playwright's own waits for a still button would
        // count the take-out animation, which in software rendering runs at about a picture a second at 900)
        const tMove = Date.now();
        await page.getByTestId("smart-3d-move").dispatchEvent("click");
        // a tap on Move that did not open the panel is counted (and tried again), not hidden
        if (
          !(await page
            .getByTestId("spot-picker")
            .waitFor({ timeout: 15_000 })
            .then(() => true)
            .catch(() => false))
        ) {
          lostTaps += 1;
          await page.getByTestId("smart-3d-move").dispatchEvent("click");
          await expect(page.getByTestId("spot-picker")).toBeVisible({ timeout: 60_000 });
        }
        timings.panel.push(Date.now() - tMove);
        timings.select.push(Date.now() - t);
        if (round === 0 && Number.isNaN(panelIdle)) {
          await page.waitForTimeout(1500);
          f0 = await num("frames");
          await page.waitForTimeout(3000);
          panelIdle = (await num("frames")) - f0;
        }
        // the picture at rest first (the bottle that was taken out is back, nothing animating), so the next picture
        // after the click is the one the click asked for
        let quiet = await num("frames");
        for (let k = 0; k < 40; k++) {
          await page.waitForTimeout(500);
          const now = await num("frames");
          if (now === quiet) break;
          quiet = now;
        }
        // destination: chosen, and the ring drawn; timed in the page (click → the next picture), not by polling
        timings.target.push(
          await page.evaluate(
            (key) =>
              new Promise<number>((resolve) => {
                const c = document.querySelector<HTMLCanvasElement>(
                  '[data-testid="smart-3d-stage"] canvas[data-engine]',
                )!;
                const button = document.querySelector<HTMLButtonElement>(
                  `[data-testid="spot-picker"] [data-spot="${key}"]`,
                )!;
                const start = performance.now();
                new MutationObserver((_, obs) => {
                  obs.disconnect();
                  resolve(performance.now() - start);
                }).observe(c, { attributes: true, attributeFilter: ["data-frames"] });
                button.click();
              }),
            to,
          ),
        );
        await expect(page.getByTestId("placement-panel")).toHaveAttribute(
          "data-choice",
          `move:${to}`,
        );
        // confirmed: the server's answer, the refresh, and the bottle drawn at its new spot
        let n = 0;
        const count = (req: { url(): string }) => {
          if (req.url().includes("/api/v1/")) n += 1;
        };
        page.on("request", count);
        t = Date.now();
        await page.getByTestId("placement-confirm").click();
        const [tr, tc] = to.split(":");
        await expect(
          page.getByRole("button", {
            name: new RegExp(`Cuvée \\d 2019, shelf ${tr}, position ${tc}(?!\\d)`),
          }),
        ).toBeAttached({ timeout: 60_000 });
        await expect(page.getByTestId("placement-panel")).toHaveCount(0);
        timings.confirmed.push(Date.now() - t);
        await page.waitForTimeout(1500);
        page.off("request", count);
        requests.push(n);
      }
      heldAfter.push(await held());
      console.error(`${size.bottles}: round ${round + 1} done`);
    }
    const heapAfter = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? 0,
    );
    f0 = await num("frames");
    await page.waitForTimeout(3000);
    const result = {
      device: info.project.name,
      bottles: size.bottles,
      inMeasuredPlace: inPlace,
      firstPictureMs,
      ...atRest,
      idleFrames3s,
      idleFrames3sPanelOpen: panelIdle,
      selectMedianMs: median(timings.select),
      bottleOutMedianMs: median(timings.out),
      moveToPanelMedianMs: median(timings.panel),
      targetMedianMs: median(timings.target),
      confirmedMedianMs: median(timings.confirmed),
      apiRequestsPerMove: median(requests),
      heldAfterRounds: heldAfter,
      buildsAfter: await num("builds"),
      idleFrames3sAfter: (await num("frames")) - f0,
      heapMbBefore: +(heapBefore / 1e6).toFixed(1),
      heapMbAfter: +(heapAfter / 1e6).toFixed(1),
      canvases: await page.locator("canvas[data-engine]").count(),
      moves: ROUNDS * 2,
      lostTaps,
    };
    console.log(JSON.stringify(result));
    results.push(result);
  }
  const prior = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")) as unknown[]) : [];
  fs.writeFileSync(OUT, JSON.stringify([...prior, ...results], null, 2));
});
