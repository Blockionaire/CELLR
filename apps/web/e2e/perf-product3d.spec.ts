import fs from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive, sql } from "./helpers";

/**
 * Not a test: the measuring bench of sprint 2B.3. The SAME storage view, once in the template gallery (made-up
 * bottles, no data path) and once in the product's 3D cellar (a real household in the local stack, read through the
 * Smart Cellar API), at 40, 200 and 900 bottles, at the same level of detail. What differs between the two columns
 * is what the product integration costs.
 *   PERF_PRODUCT3D=1 PERF_OUT=/some/file.json pnpm exec playwright test perf-product3d --project=desktop
 * The product's picture is wider than the gallery's at the same window; PERF_MATCH=758 narrows the product's window
 * until both pictures have the same size (the like-for-like run).
 * Software rendering unless the machine has a GPU: the numbers compare the two columns, they are not a phone's.
 */
test.skip(!process.env.PERF_PRODUCT3D, "only when asked for (PERF_PRODUCT3D=1)");
test.use({ baseURL: PREVIEW_URL, viewport: { width: 1280, height: 800 } });

const OUT = process.env.PERF_OUT ?? "test-results/perf-product3d.json";
const SIZES = [
  { bottles: 40, rows: 5, cols: 8 },
  { bottles: 200, rows: 10, cols: 20 },
  { bottles: 900, rows: 30, cols: 30 },
].filter(
  (s) => !process.env.PERF_ONLY || process.env.PERF_ONLY.split(",").includes(String(s.bottles)),
);

const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN;
const p95 = (xs: number[]) =>
  xs.length
    ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]!
    : NaN;
const round = (n: number) => +n.toFixed(1);

type Hooks = { locate(id: string): { x: number; y: number } | null; ids(): string[] };

/** Everything measured the same way for both: only the stage's test id differs. */
async function measure(page: Page, stageId: string) {
  const canvas = page.locator(`[data-testid="${stageId}"] canvas[data-engine]`);
  const storage = page.locator(`[data-testid="${stageId}"] [data-testid="inspectable-storage"]`);
  const num = async (name: string) => Number((await canvas.getAttribute(`data-${name}`)) ?? NaN);
  await expect(canvas).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 120_000 });
  await expect(canvas).toHaveAttribute("data-prewarmed", /^\d+$/, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const held = async () =>
    `${await num("geometries")}/${await num("textures")}/${await num("programs")}`;
  // in the product the picture can lie partly under the fold: bring it in, then measure where it is
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const whereNow = async () => (await canvas.boundingBox())!;
  const box = await whereNow();
  const atRest = {
    stage: `${Math.round(box.width)}×${Math.round(box.height)}`,
    quality: await canvas.getAttribute("data-quality"),
    cameraDistance: await num("distance"),
    bottles: await num("bottles"),
    calls: await num("calls"),
    triangles: await num("triangles"),
    geometries: await num("geometries"),
    textures: await num("textures"),
    programs: await num("programs"),
    warmedPrograms: await num("prewarmed"),
    firstPictureMs: await num("first-frame-ms"),
  };
  const f0 = await num("frames");
  await page.waitForTimeout(3000);
  const idleFrames3s = (await num("frames")) - f0;

  // every picture the view draws, with its time
  await page.evaluate((id) => {
    const w = window as unknown as { __pics: number[] };
    w.__pics = [];
    const c = document.querySelector<HTMLCanvasElement>(
      `[data-testid="${id}"] canvas[data-engine]`,
    )!;
    let last = c.dataset.frames;
    const tick = (t: number) => {
      if (c.dataset.frames !== last) {
        last = c.dataset.frames;
        w.__pics.push(t);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, stageId);
  const pics = () =>
    page.evaluate(() => (window as unknown as { __pics: number[] }).__pics.slice());
  const gapsOf = (list: number[]) =>
    list
      .slice(1)
      .map((t, i) => t - list[i]!)
      .filter((g) => g < 8000);

  // taking bottles out (before the place is turned, so every bottle is where a tap expects it)
  const ids = await page.evaluate(() =>
    (window as unknown as { __cellrStorage3d: Hooks }).__cellrStorage3d.ids(),
  );
  const latencies: number[] = [];
  const heldAfter: string[] = [];
  let onDisplayCalls = NaN;
  let worstPose = 0;
  for (let i = 0; i < 5; i++) {
    const id = ids[Math.floor(((i * 7 + 3) % 17) * (ids.length / 17))]!;
    const at = await page.evaluate(
      (bottle) =>
        (window as unknown as { __cellrStorage3d: Hooks }).__cellrStorage3d.locate(bottle),
      id,
    );
    const now = await whereNow();
    await page.mouse.click(now.x + at!.x, now.y + at!.y);
    await expect(storage).toHaveAttribute("data-showcase", "inspecting", { timeout: 60_000 });
    latencies.push(await num("inspect-latency"));
    await page.waitForTimeout(600);
    onDisplayCalls = await num("calls");
    await page.keyboard.press("Escape");
    await expect(storage).toHaveAttribute("data-showcase", "idle", { timeout: 60_000 });
    await page.waitForTimeout(600);
    worstPose = Math.max(worstPose, await num("handoff-pose"));
    heldAfter.push(await held());
  }

  // turning the place
  const turnBox = await whereNow();
  const [cx, cy] = [turnBox.x + turnBox.width / 2, turnBox.y + turnBox.height / 2];
  const from = (await pics()).length;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(cx - i * 10, cy);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(2500);
  const turning = gapsOf((await pics()).slice(from));

  return {
    atRest,
    idleFrames3s,
    turningMs: {
      median: round(median(turning)),
      p95: round(p95(turning)),
      pictures: turning.length,
    },
    firstTapMs: round(latencies[0]!),
    laterTapMs: round(median(latencies.slice(1))),
    onDisplayCalls,
    heldAfter1: heldAfter[0],
    heldAfter5: heldAfter[4],
    worstPose,
  };
}

/** One household, one rack with a template per size, full of real bottles. */
async function seed(page: Page, request: APIRequestContext) {
  const { email, householdId } = await arrive(page, "perf3d");
  const { call } = await apiClient(request, email);
  // the gallery's made-up cellar, as real wines: the same kinds, on the same spots (fixtures.ts), so that both
  // columns draw the same picture and only the way the bottles got there differs
  const KINDS = [
    "red",
    "red",
    "red",
    "white",
    "white",
    "sparkling",
    "rose",
    "fortified",
    "dessert",
    "orange",
  ];
  const WINES = KINDS.map((type, i) => ({
    producer: `Domaine Perf ${i + 1}`,
    name: `Cuvée ${i + 1}`,
    type,
    countryCode: "FR",
    region: "Rhône",
  }));
  const vintages: string[] = [];
  for (const wine of WINES) {
    const w = (await call("post", "/wines", wine, 201)).body as { id: string };
    const added = (
      await call(
        "post",
        "/bottles",
        { wineId: w.id, year: 2019, quantity: 1, locationId: null },
        201,
      )
    ).body as { vintageId: string };
    vintages.push(added.vintageId);
  }
  const places = new Map<number, string>();
  for (const size of SIZES) {
    const id = (
      await call(
        "post",
        "/storage",
        { label: `Rack ${size.bottles}`, kind: "rack", rows: size.rows, cols: size.cols },
        201,
      )
    ).body as { id: string };
    places.set(size.bottles, id.id);
    await sql(
      "update public.cellar_locations set template = 'rack_classic', slot_semantics = 'depth' where id = $1",
      [id.id],
    );
    // a full rack, as the database owner in one statement (900 adds through the app would take minutes)
    await sql(
      `insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col)
       select $1, ($2::uuid[])[1 + (((1 + n / $4::int) * 3 + (n % $4::int) / 2) % 10)], $3,
              1 + (n / $4::int), 1 + (n % $4::int)
         from generate_series(0, $5::int - 1) n`,
      [householdId, vintages, id.id, size.cols, size.bottles],
    );
  }

  return places;
}

/** Resizes the window until the picture of this stage is `wanted` pixels wide (the layouts differ around it). */
async function matchWidth(page: Page, stageId: string, wanted: number) {
  const canvas = page.locator(`[data-testid="${stageId}"] canvas[data-engine]`);
  await expect(canvas).toBeVisible({ timeout: 120_000 });
  for (let i = 0; i < 5; i++) {
    const width = Math.round((await canvas.boundingBox())!.width);
    if (Math.abs(width - wanted) <= 2) return;
    await page.setViewportSize({
      width: page.viewportSize()!.width + (wanted - width),
      height: 800,
    });
    await page.waitForTimeout(600);
  }
}

test("measure the storage view in the gallery and in the product", async ({ page, request }) => {
  test.setTimeout(3_600_000);
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const results = [];

  const places = await seed(page, request);

  // PERF_MATCH=<width>: the product's picture as wide as the gallery's, so both draw the same number of pixels. The
  // window is sized BEFORE the place is opened: the camera is placed for the picture's shape when a place opens.
  let productWindow = 1280;
  if (process.env.PERF_MATCH) {
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    await matchWidth(page, "smart-3d-stage", Number(process.env.PERF_MATCH));
    productWindow = page.viewportSize()!.width;
  }

  for (const size of SIZES) {
    const placeId = places.get(size.bottles)!;
    // ---- product ---------------------------------------------------------------------------------------------
    const api: Array<{ ms: number; kB: number }> = [];
    // timings are only complete once the request has finished
    const onFinished = async (r: import("@playwright/test").Request) => {
      if (!r.url().endsWith(`/smart-cellar/storage/${placeId}/bottles`)) return;
      const timing = r.timing();
      const sizes = await r.sizes();
      api.push({
        ms: round(timing.responseEnd - timing.requestStart),
        kB: round(sizes.responseBodySize / 1024),
      });
    };
    page.on("requestfinished", onFinished);
    await page.setViewportSize({ width: productWindow, height: 800 });
    await page.goto("/cellar");
    // from choosing 3D for the place that opens by itself (this includes downloading the view the first time),
    // from choosing the place for the others
    let t0 = Date.now();
    await page.getByRole("radio", { name: "3D" }).click();
    const chip = page.getByRole("button", { name: `Rack ${size.bottles}`, exact: true });
    await expect(page.getByTestId("smart-3d")).toHaveAttribute("data-mode", "ready", {
      timeout: 30_000,
    });
    // a cellar with one place has no row of places to choose from (PERF_ONLY with one size)
    const pressed =
      (await chip.count()) === 0 || (await chip.getAttribute("aria-pressed")) === "true";
    if (!pressed) {
      await expect(
        page.getByTestId("smart-3d-stage").locator("canvas[data-engine]"),
      ).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 120_000 });
      t0 = Date.now();
      await chip.click();
    }
    const stage = page.getByTestId("smart-3d-stage");
    await expect(stage).toHaveAttribute("data-bottles", String(size.bottles), { timeout: 120_000 });
    await expect(stage.locator("canvas[data-engine]")).toHaveAttribute("data-frames", /^[1-9]/, {
      timeout: 120_000,
    });
    const toPicture = { from: pressed ? "3D" : "place", ms: Date.now() - t0 };
    const product = await measure(page, "smart-3d-stage");
    page.off("requestfinished", onFinished);

    // ---- gallery, at the level of detail the product chose -----------------------------------------------------
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(
      `/design/cellar-3d?template=rack_classic&rows=${size.rows}&cols=${size.cols}&fill=full&quality=${product.atRest.quality}`,
    );
    const gallery = await measure(page, "gallery-stage");

    const row = {
      bottles: size.bottles,
      product: { ...product, placementsApi: api[0] ?? null, toPicture },
      gallery,
    };
    console.log(JSON.stringify(row));
    results.push(row);
  }
  const environment = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      gpu: info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown",
      cores: navigator.hardwareConcurrency,
      viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    };
  });
  fs.writeFileSync(OUT, JSON.stringify({ environment, results }, null, 2));
});

/**
 * Where the time goes between choosing a place and seeing it, in the product (PERF_PHASES=1): until the bottles have
 * arrived (the integration's share), until the scene exists, until its first picture (the view's share, the same in
 * the gallery). Three runs per size; the first of all also downloads the view's code.
 */
test("where the time goes between choosing a place and its picture", async ({ page, request }) => {
  test.skip(!process.env.PERF_PHASES, "only when asked for (PERF_PHASES=1)");
  test.setTimeout(1_800_000);
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const places = await seed(page, request);
  const rows = [];
  for (const size of SIZES) {
    const placeId = places.get(size.bottles)!;
    for (let run = 0; run < 3; run++) {
      await page.goto("/cellar");
      await page.getByRole("radio", { name: "3D" }).click();
      const chip = page.getByRole("button", { name: `Rack ${size.bottles}`, exact: true });
      await expect(chip).toBeVisible({ timeout: 30_000 });
      // another place first, so the place under test is always CHOSEN (the 40 rack opens by itself)
      const other = page.getByRole("button", {
        name: `Rack ${size.bottles === 40 ? 200 : 40}`,
        exact: true,
      });
      if ((await chip.getAttribute("aria-pressed")) === "true") await other.click();
      const stage = page.getByTestId("smart-3d-stage");
      await expect(stage.locator("canvas[data-engine]")).toHaveAttribute("data-frames", /^[1-9]/, {
        timeout: 120_000,
      });
      await page.waitForTimeout(1500);
      await page.evaluate((id) => {
        const w = window as unknown as { __phases: Record<string, number> };
        const before = document.querySelector('[data-testid="smart-3d-stage"] canvas[data-engine]');
        w.__phases = {};
        const tick = () => {
          const now = performance.now();
          const c = document.querySelector<HTMLCanvasElement>(
            '[data-testid="smart-3d-stage"] canvas[data-engine]',
          );
          const data = performance
            .getEntriesByType("resource")
            .filter((e) => e.name.endsWith(`/smart-cellar/storage/${id}/bottles`))
            .at(-1) as PerformanceResourceTiming | undefined;
          if (data && data.responseEnd > (w.__phases.click ?? Infinity))
            w.__phases.data ??= data.responseEnd;
          if (c && c !== before) {
            w.__phases.scene ??= now;
            if (Number(c.dataset.frames) >= 1) {
              w.__phases.picture = now;
              return;
            }
          }
          requestAnimationFrame(tick);
        };
        document.addEventListener(
          "click",
          () => {
            w.__phases.click = performance.now();
            requestAnimationFrame(tick);
          },
          { once: true, capture: true },
        );
      }, placeId);
      await chip.click();
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as { __phases: Record<string, number> }).__phases.picture,
            ),
          { timeout: 120_000 },
        )
        .toBeGreaterThan(0);
      const t = await page.evaluate(
        () => (window as unknown as { __phases: Record<string, number> }).__phases,
      );
      const row = {
        bottles: size.bottles,
        run,
        toDataMs: t.data === undefined ? null : round(t.data - t.click!),
        toSceneMs: round(t.scene! - t.click!),
        toPictureMs: round(t.picture! - t.click!),
        ownFirstPictureMs: Number(
          await stage.locator("canvas[data-engine]").getAttribute("data-first-frame-ms"),
        ),
      };
      console.log(JSON.stringify(row));
      rows.push(row);
    }
  }
  // the gallery's own start, for comparison: from the scene existing to its first picture, on a fresh page
  await page.addInitScript(() => {
    const w = window as unknown as { __start: Record<string, number> };
    w.__start = {};
    const tick = () => {
      const c = document.querySelector<HTMLCanvasElement>(
        '[data-testid="gallery-stage"] canvas[data-engine]',
      );
      if (c) {
        w.__start.scene ??= performance.now();
        if (Number(c.dataset.frames) >= 1) {
          w.__start.picture = performance.now();
          return;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const gallery = [];
  for (const size of SIZES) {
    for (let run = 0; run < 3; run++) {
      await page.goto(
        `/design/cellar-3d?template=rack_classic&rows=${size.rows}&cols=${size.cols}&fill=full`,
      );
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as unknown as { __start: Record<string, number> }).__start.picture,
            ),
          { timeout: 120_000 },
        )
        .toBeGreaterThan(0);
      const t = await page.evaluate(
        () => (window as unknown as { __start: Record<string, number> }).__start,
      );
      const row = { bottles: size.bottles, run, sceneToPictureMs: round(t.picture! - t.scene!) };
      console.log(JSON.stringify(row));
      gallery.push(row);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ product: rows, gallery }, null, 2));
});
