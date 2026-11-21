import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_URL, apiClient, arrive, bearer, sql } from "./helpers";

/**
 * Not a test: the measuring bench of sprint 5 (placement advice), in the product on the preview server, a real
 * household in the local stack. Half-full racks, every other spot taken (as many free spots as bottles: the hardest
 * case for ranking): 40 in an 8 × 10 rack, 200 in 20 × 20, 900 in two 30 × 30, 1,200 in three.
 *   PERF_ADVICE=1 PERF_OUT=/some/file.json pnpm exec playwright test perf-advice --workers=1
 * Software rendering: these numbers compare builds on one machine; they are not a phone's.
 */
test.skip(!process.env.PERF_ADVICE, "only when asked for (PERF_ADVICE=1)");
test.use({ baseURL: PREVIEW_URL });

const OUT = process.env.PERF_OUT ?? "test-results/perf-advice.json";
const SIZES = [
  { bottles: 40, racks: 1, rows: 8, cols: 10 },
  { bottles: 200, racks: 1, rows: 20, cols: 20 },
  { bottles: 900, racks: 2, rows: 30, cols: 30 },
  { bottles: 1200, racks: 3, rows: 30, cols: 30 },
].filter(
  (s) => !process.env.PERF_ONLY || process.env.PERF_ONLY.split(",").includes(String(s.bottles)),
);
const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN;

async function seed(page: Page, request: Parameters<typeof apiClient>[0], size: (typeof SIZES)[0]) {
  await page.context().clearCookies();
  await page.goto("about:blank");
  const { email, householdId } = await arrive(page, `perfadvice${size.bottles}`);
  const { call, token } = await apiClient(request, email);
  const vintages: string[] = [];
  const loose: string[] = [];
  for (const [i, type] of ["red", "white", "sparkling", "rose"].entries()) {
    const w = (
      await call(
        "post",
        "/wines",
        { producer: `Domaine Perf ${i + 1}`, name: `Cuvée ${i + 1}`, type, countryCode: "FR" },
        201,
      )
    ).body as { id: string };
    const added = (
      await call(
        "post",
        "/bottles",
        { wineId: w.id, year: 2019, quantity: 1, locationId: null },
        201,
      )
    ).body as { vintageId: string; bottleIds: string[] };
    vintages.push(added.vintageId);
    loose.push(added.bottleIds[0]!);
  }
  const perRack = Math.ceil(size.bottles / size.racks);
  for (let k = 0; k < size.racks; k++) {
    const id = (
      (
        await call(
          "post",
          "/storage",
          { label: `Rack ${k + 1}`, kind: "rack", rows: size.rows, cols: size.cols },
          201,
        )
      ).body as { id: string }
    ).id;
    await sql(
      "update public.cellar_locations set template = 'rack_classic', slot_semantics = 'depth' where id = $1",
      [id],
    );
    const n = Math.min(perRack, size.bottles - k * perRack);
    // every other spot, as the database owner in one statement (hundreds of adds through the app take minutes)
    await sql(
      `insert into public.bottles (household_id, vintage_id, location_id, loc_row, loc_col)
       select $1, ($2::uuid[])[1 + (n % 4)], $3, 1 + ((2 * n) / $4::int), 1 + ((2 * n) % $4::int)
         from generate_series(0, $5::int - 1) n`,
      [householdId, vintages, id, size.cols, n],
    );
  }
  return { token, loose };
}

test("measure advice", async ({ page, request }, info) => {
  test.setTimeout(3_600_000);
  await page.addInitScript(() => window.sessionStorage.setItem("cellr:3d-debug", "1"));
  const results = [];
  for (const size of SIZES) {
    const { token, loose } = await seed(page, request, size);
    // the API alone (server: auth, five reads, the engine, JSON), from Node, median of 7 after a warm-up
    const apiTimes: number[] = [];
    let body: { eligible: number; recommendations: unknown[] } | null = null;
    for (let i = 0; i < 8; i++) {
      const t = performance.now();
      const res = await request.get(
        `/api/v1/smart-cellar/bottles/${loose[0]}/recommendations?intent=store`,
        { headers: bearer(token) },
      );
      const ms = performance.now() - t;
      expect(res.status()).toBe(200);
      body = await res.json();
      if (i > 0) apiTimes.push(ms);
    }
    const kB = +(JSON.stringify(body).length / 1024).toFixed(1);

    const canvas = page.locator('[data-testid="smart-3d-stage"] canvas[data-engine]');
    const num = async (name: string) => Number((await canvas.getAttribute(`data-${name}`)) ?? NaN);
    await page.goto("/cellar");
    await page.getByRole("radio", { name: "3D" }).click();
    await expect(canvas).toHaveAttribute("data-frames", /^[1-9]/, { timeout: 180_000 });
    await page.waitForTimeout(2000);

    // the panel opened, until the advice is on screen
    const panelTimes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t = Date.now();
      await page
        .getByTestId("placement-unplaced")
        .getByRole("button", { name: "Place" })
        .first()
        .click();
      await expect(page.getByTestId("advice-panel")).toHaveAttribute("data-status", "ok", {
        timeout: 60_000,
      });
      panelTimes.push(Date.now() - t);
      if (i < 2) await page.getByTestId("placement-cancel").click();
    }
    await page.waitForTimeout(1500);
    const buildsBefore = await num("builds");
    const heldBefore = `${await num("geometries")}/${await num("textures")}/${await num("programs")}`;
    let f0 = await num("frames");
    await page.waitForTimeout(3000);
    const idleWithAdvice = (await num("frames")) - f0;

    // showing options, one after another: in-page time from the tap to the picture with the ring
    let requests = 0;
    const count = (r: { url(): string }) => {
      if (r.url().includes("/recommendations")) requests++;
    };
    page.on("request", count);
    const heap0 = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? 0,
    );
    const showTimes: number[] = [];
    const heldAfter: string[] = [];
    const options = page.getByTestId("advice-recommendations").getByTestId("advice-option");
    const n = await options.count();
    for (let round = 0; round < 3; round++) {
      for (let k = 0; k < n; k++) {
        // the picture at rest first
        let quiet = await num("frames");
        for (let w = 0; w < 20; w++) {
          await page.waitForTimeout(300);
          const now = await num("frames");
          if (now === quiet) break;
          quiet = now;
        }
        showTimes.push(
          await options
            .nth(k)
            .getByTestId("advice-show")
            .evaluate(
              (button) =>
                new Promise<number>((resolve) => {
                  const c = document.querySelector<HTMLCanvasElement>(
                    '[data-testid="smart-3d-stage"] canvas[data-engine]',
                  )!;
                  const start = performance.now();
                  const obs = new MutationObserver(() => {
                    obs.disconnect();
                    resolve(performance.now() - start);
                  });
                  obs.observe(c, { attributes: true, attributeFilter: ["data-frames"] });
                  (button as HTMLButtonElement).click();
                  // a spot that is already shown draws nothing new: give up after a second
                  setTimeout(() => {
                    obs.disconnect();
                    resolve(NaN);
                  }, 1000);
                }),
            ),
        );
      }
      heldAfter.push(
        `${await num("geometries")}/${await num("textures")}/${await num("programs")}`,
      );
    }
    page.off("request", count);
    const heap1 = await page.evaluate(
      () =>
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? 0,
    );
    await page.waitForTimeout(1500);
    f0 = await num("frames");
    await page.waitForTimeout(3000);
    const result = {
      device: info.project.name,
      bottles: size.bottles,
      eligibleSpots: body?.eligible,
      apiMedianMs: Math.round(median(apiTimes)),
      responseKB: kB,
      panelToAdviceMedianMs: median(panelTimes),
      showToRingMedianMs: +median(showTimes.filter((x) => !Number.isNaN(x))).toFixed(1),
      adviceRequestsDuringShows: requests,
      buildsBefore,
      buildsAfter: await num("builds"),
      heldBefore,
      heldAfterRounds: heldAfter,
      idleFrames3sWithAdvice: idleWithAdvice,
      idleFrames3sAfter: (await num("frames")) - f0,
      heapMbBefore: +(heap0 / 1e6).toFixed(1),
      heapMbAfter: +(heap1 / 1e6).toFixed(1),
      canvases: await page.locator("canvas[data-engine]").count(),
    };
    console.log(JSON.stringify(result));
    results.push(result);
  }
  const prior = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")) as unknown[]) : [];
  fs.writeFileSync(OUT, JSON.stringify([...prior, ...results], null, 2));
});
