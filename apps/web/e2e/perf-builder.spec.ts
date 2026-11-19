import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive, sql } from "./helpers";

/**
 * Not a test: the measuring bench of the Rack Builder (Smart Cellar 3D, sprint 3), on the test server where it is
 * open, with a real household in the local stack.
 *   PERF_BUILDER=1 PERF_OUT=/some/file.json pnpm exec playwright test perf-builder --project=desktop
 * Software rendering unless the machine has a GPU: the numbers compare scenarios and earlier sprints on the same
 * machine; they say nothing about a phone's frame rate.
 */
test.skip(!process.env.PERF_BUILDER, "only when asked for (PERF_BUILDER=1)");
test.use({ baseURL: PREVIEW_URL });

const OUT = process.env.PERF_OUT ?? "test-results/perf-builder.json";
const SIZES = [
  { bottles: 40, rows: 5, cols: 8 },
  { bottles: 200, rows: 10, cols: 20 },
  { bottles: 900, rows: 30, cols: 30 },
];
const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN;
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : NaN);
const round = (n: number) => +n.toFixed(1);

const canvasOf = (page: Page) => page.locator('[data-testid="builder-stage"] canvas[data-engine]');
const num = async (page: Page, name: string) =>
  Number((await canvasOf(page).getAttribute(`data-${name}`)) ?? NaN);
const held = async (page: Page) =>
  `${await num(page, "geometries")}/${await num(page, "textures")}/${await num(page, "programs")}`;

/** Installs a recorder of layout shifts (CLS) for this page. */
const recordShifts = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{
        value: number;
        hadRecentInput: boolean;
      }>)
        if (!e.hadRecentInput) w.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);

/**
 * From a click to the first picture drawn of the changed place: the click's time and the time the frame counter
 * moves after the stage says it shows the change (`attr` = `value`) and is no longer "updating".
 */
async function changeToPicture(
  page: Page,
  click: () => Promise<void>,
  attr: string,
  expected: string,
) {
  await page.evaluate(
    ({ attr, expected }) => {
      const w = window as unknown as { __t: { click?: number; picture?: number } };
      w.__t = {};
      const stage = document.querySelector<HTMLElement>('[data-testid="builder-stage"]')!;
      const start = () => {
        w.__t.click = performance.now();
        let from = -1;
        const tick = () => {
          const c = stage.querySelector<HTMLCanvasElement>("canvas[data-engine]");
          const shows = stage.getAttribute(attr) === expected && stage.dataset.updating === "false";
          if (c && shows) {
            const frames = Number(c.dataset.frames);
            if (from < 0) from = frames;
            else if (frames > from) {
              w.__t.picture = performance.now();
              return;
            }
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      document.addEventListener("click", start, { once: true, capture: true });
    },
    { attr, expected },
  );
  await click();
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as { __t: { picture?: number } }).__t.picture ?? 0),
      {
        timeout: 60_000,
      },
    )
    .toBeGreaterThan(0);
  const t = await page.evaluate(
    () => (window as unknown as { __t: { click: number; picture: number } }).__t,
  );
  return t.picture - t.click;
}

async function settle(page: Page) {
  await expect(canvasOf(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 120_000 });
  await expect(page.getByTestId("builder-stage")).toHaveAttribute("data-updating", "false");
  await page.waitForTimeout(1500);
}

test("measure the Rack Builder", async ({ page, request }, info) => {
  test.setTimeout(3_600_000);
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  await recordShifts(page);
  const { email, householdId } = await arrive(page, "perfbuild");
  const { call } = await apiClient(request, email);
  const w = (
    await call("post", "/wines", { producer: "P", name: "R", type: "red", countryCode: "FR" }, 201)
  ).body as { id: string };
  const vintage = (
    (
      await call(
        "post",
        "/bottles",
        { wineId: w.id, year: 2019, quantity: 1, locationId: null },
        201,
      )
    ).body as {
      vintageId: string;
    }
  ).vintageId;
  const places = new Map<number, string>();
  for (const size of SIZES) {
    const id = (
      (
        await call(
          "post",
          "/storage",
          { label: `Rack ${size.bottles}`, kind: "rack", rows: size.rows, cols: size.cols },
          201,
        )
      ).body as { id: string }
    ).id;
    places.set(size.bottles, id);
    await sql(
      "update public.cellar_locations set template = 'rack_classic', slot_semantics = 'depth' where id = $1",
      [id],
    );
    await sql(
      `insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col)
       select $1, $2, $3, 1 + (n / $4::int), 1 + (n % $4::int) from generate_series(0, $5::int - 1) n`,
      [householdId, vintage, id, size.cols, size.bottles],
    );
  }

  const results: Record<string, unknown> = { device: info.project.name };

  // ---- a new place: from navigation to the first picture --------------------------------------------------------
  // The scene marks its first picture (performance.mark): its time since navigation is the page's own clock.
  const navToPicture: number[] = [];
  const loads: number[] = [];
  for (let run = 0; run < 3; run++) {
    await page.goto("/cellar/builder");
    await settle(page);
    navToPicture.push(
      await page.evaluate(
        () => performance.getEntriesByName("cellr:storage3d-first-frame").at(-1)?.startTime ?? NaN,
      ),
    );
    loads.push(await num(page, "first-frame-ms"));
  }
  await settle(page);
  results.newPlace = {
    firstPictureMs: round(median(loads)),
    navigationToPictureMs: round(median(navToPicture)),
    atRest: {
      calls: await num(page, "calls"),
      triangles: await num(page, "triangles"),
      held: await held(page),
      quality: await canvasOf(page).getAttribute("data-quality"),
    },
    layoutShift: round((await shifts(page)) * 1000) / 1000,
  };

  // ---- control changes on a new place: steppers, swatches, materials --------------------------------------------
  const stepper = (field: string, dir: 0 | 1) =>
    page.getByTestId(`builder-${field}`).getByRole("button").nth(dir);
  const rowsChanges: number[] = [];
  for (let i = 0; i < 6; i++) {
    const rows = Number(await page.getByTestId("builder-rows").getAttribute("data-value"));
    const dir: 0 | 1 = i % 2 === 0 ? 1 : 0;
    rowsChanges.push(
      await changeToPicture(
        page,
        () => stepper("rows", dir).click(),
        "data-rows",
        String(rows + (dir ? 1 : -1)),
      ),
    );
  }
  const colorChanges: number[] = [];
  for (const color of ["Oak", "Mahogany", "Ebony", "Pine", "Walnut", "Oak"]) {
    const value = color.toLowerCase();
    colorChanges.push(
      await changeToPicture(
        page,
        () =>
          page
            .getByRole("radiogroup", { name: "Colour" })
            .getByRole("radio", { name: color })
            .click(),
        "data-color",
        value,
      ),
    );
  }
  results.controlChange = {
    rowsMedianMs: round(median(rowsChanges)),
    rowsWorstMs: round(max(rowsChanges)),
    colourMedianMs: round(median(colorChanges)),
    colourWorstMs: round(max(colorChanges)),
  };

  // ---- template switching, and what stays held after many switches ----------------------------------------------
  const tour = [
    "cooler_dual",
    "diamond_bins",
    "wall_rails",
    "cabinet_closed",
    "rack_metal",
    "rack_classic",
  ];
  const switches: Array<{ template: string; ms: number; calls: number; triangles: number }> = [];
  const heldAfter: string[] = [];
  for (let round_ = 0; round_ < 4; round_++) {
    for (const id of tour) {
      const ms = await changeToPicture(
        page,
        () => page.getByTestId(`template-${id}`).click(),
        "data-template",
        id,
      );
      if (round_ === 0) {
        await page.waitForTimeout(400);
        switches.push({
          template: id,
          ms: round(ms),
          calls: await num(page, "calls"),
          triangles: await num(page, "triangles"),
        });
      }
    }
    await page.waitForTimeout(600);
    heldAfter.push(await held(page));
  }
  const idleFrom = await num(page, "frames");
  await page.waitForTimeout(3000);
  results.templateSwitch = {
    firstRound: switches,
    medianMs: round(median(switches.map((s) => s.ms))),
    heldAfterRounds: heldAfter,
    idleFrames3s: (await num(page, "frames")) - idleFrom,
    canvases: await page.locator("canvas[data-engine]").count(),
  };

  // ---- an existing place full of bottles: load, change, stay stable ----------------------------------------------
  const existing: unknown[] = [];
  for (const size of SIZES) {
    const id = places.get(size.bottles)!;
    const t0 = Date.now();
    await page.goto(`/cellar/builder/${id}`);
    await expect(page.getByTestId("builder-stage")).toHaveAttribute(
      "data-bottles",
      String(size.bottles),
      {
        timeout: 120_000,
      },
    );
    await expect(canvasOf(page)).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 120_000 });
    const toPicture = Date.now() - t0;
    await settle(page);
    const atRest = {
      quality: await canvasOf(page).getAttribute("data-quality"),
      calls: await num(page, "calls"),
      triangles: await num(page, "triangles"),
      held: await held(page),
      firstPictureMs: await num(page, "first-frame-ms"),
    };
    const f0 = await num(page, "frames");
    await page.waitForTimeout(3000);
    const idle = (await num(page, "frames")) - f0;
    // a colour change: a new look, the same bottles on the same spots
    const colour = await changeToPicture(
      page,
      () =>
        page
          .getByRole("radiogroup", { name: "Colour" })
          .getByRole("radio", { name: "Oak" })
          .click(),
      "data-color",
      "oak",
    );
    // one shelf more (space for bottles to stay where they are)
    const rows = Number(await page.getByTestId("builder-rows").getAttribute("data-value"));
    const grow =
      rows < 30
        ? await changeToPicture(
            page,
            () => stepper("rows", 1).click(),
            "data-rows",
            String(rows + 1),
          )
        : NaN;
    await page.waitForTimeout(600);
    existing.push({
      bottles: size.bottles,
      navigationToPictureMs: toPicture,
      atRest,
      idleFrames3s: idle,
      colourChangeMs: round(colour),
      addShelfMs: round(grow),
      heldAfterChanges: await held(page),
      stranded: Number(await page.getByTestId("builder-stage").getAttribute("data-stranded")),
      layoutShift: round((await shifts(page)) * 1000) / 1000,
    });
    // leave without saving: discard
    await page.getByTestId("builder-reset").click();
    await page.getByTestId("builder-discard-confirm").click();
  }
  results.existingPlace = existing;

  results.environment = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      gpu: info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown",
      cores: navigator.hardwareConcurrency,
      viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    };
  });
  console.log(JSON.stringify(results));
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
});
