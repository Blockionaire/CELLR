import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, wineBody } from "./helpers";

/**
 * Not a test: a stopwatch for taking a bottle out, with the CPU slowed 4× (roughly a phone). For each selection it
 * reports the time from the key press to the bottle's first moving frame, the still of the rack, and the longest
 * frame in the first 1.5 s (a frozen frame shows up there). The first selection pays for anything done only once.
 *   PERF_3D=1 pnpm exec playwright test perf-3d --project=desktop
 */
test.skip(!process.env.PERF_3D, "only when asked for (PERF_3D=1)");

async function stock(page: Page, request: Parameters<typeof apiClient>[0]) {
  const { email } = await arrive(page, "perf3d");
  const { call } = await apiClient(request, email);
  const rack = (
    await call<{ id: string }>(
      "post",
      "/storage",
      { label: "Perf rack", kind: "rack", rows: 6, cols: 8 },
      201,
    )
  ).body;
  for (const type of ["red", "white", "rose", "sparkling"] as const) {
    const wine = (
      await call<{ id: string }>("post", "/wines", { ...wineBody, name: `${type} perf`, type }, 201)
    ).body;
    await call(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2019, quantity: 10, locationId: rack.id },
      201,
    );
  }
}

test("time taking a bottle out", async ({ page, request }) => {
  test.setTimeout(300_000);
  await stock(page, request);
  const cdp = await page.context().newCDPSession(page);
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  const scene = page.getByTestId("cellar-3d");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await page.waitForTimeout(2000);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.PERF_RATE ?? 4) });
  // Every animation frame's time, and the moment of each key press.
  await page.evaluate(() => {
    const w = window as unknown as { frames_: number[]; keys_: number[] };
    w.frames_ = [];
    w.keys_ = [];
    const tick = (t: number) => {
      w.frames_.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.addEventListener("keydown", (e) => e.key === "Enter" && w.keys_.push(e.timeStamp), true);
  });
  const results = [];
  for (const [i, name] of [
    [0, /shelf 2, position 3$/],
    [1, /shelf 4, position 6$/],
    [2, /shelf 1, position 1$/],
  ] as const) {
    await page.evaluate(() => performance.clearMarks());
    // Programs before the tap: the last count the scene reported (the previous bottle, or the warm-up).
    const programsBefore = Number(
      (await scene.locator("canvas[data-engine]").getAttribute("data-programs")) ?? NaN,
    );
    await page
      .getByRole("list", { name: /Bottles in Perf rack/ })
      .getByRole("button", { name })
      .focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const w = window as unknown as { frames_: number[]; keys_: number[] };
      const key = w.keys_.at(-1)!;
      const mark = (n: string) => performance.getEntriesByName(n).at(-1)?.startTime ?? NaN;
      const moving = mark("cellr:showcase-moving");
      const shown = w.frames_.find((t) => t > moving) ?? NaN;
      const frames = w.frames_.filter((t) => t >= key && t <= key + 1500);
      let worst = 0;
      for (let j = 1; j < frames.length; j++) worst = Math.max(worst, frames[j]! - frames[j - 1]!);
      worst = Math.max(worst, (frames[0] ?? key) - key);
      return {
        raw: [
          ["key", key],
          ...performance.getEntriesByType("mark").map((m) => [m.name, m.startTime]),
          ["frames", w.frames_.filter((t) => t >= key).length],
          ["firstFrameAfterKey", w.frames_.find((t) => t > key) ?? NaN],
        ],
        pickMs: mark("cellr:pick") - key,
        stillMs: mark("cellr:still-ready") - mark("cellr:still-start"),
        stillReadyMs: mark("cellr:still-ready") - key,
        firstMovingFrameMs: shown - key,
        worstFrameMs: worst,
      };
    });
    const programsAfter = Number(
      await scene.locator("canvas[data-engine]").getAttribute("data-programs"),
    );
    results.push({ selection: i + 1, ...r, programsBefore, programsAfter });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("rack-backdrop")).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(1500);
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const out = process.env.PERF_OUT ?? "test-results/perf-3d.json";
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
});

/**
 * Frame times through the whole movement: taking a bottle out (2 s from the key press) and putting it back (1.5 s
 * from Escape). Reports per phase the median, 95th percentile and longest frame, the long main-thread tasks
 * (> 50 ms) and how often the 3D canvas changed size (each resize reallocates its drawing buffers).
 */
test("frame times while a bottle comes out and goes back", async ({ page, request }) => {
  test.setTimeout(300_000);
  await stock(page, request);
  const cdp = await page.context().newCDPSession(page);
  await page.goto("/cellar");
  await page.getByRole("radio", { name: "3D" }).click();
  const scene = page.getByTestId("cellar-3d");
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.PERF_RATE ?? 4) });
  await page.evaluate(() => {
    const w = window as unknown as {
      frames_: number[];
      long_: Array<[number, number]>;
      resizes_: number[];
    };
    w.frames_ = [];
    w.long_ = [];
    w.resizes_ = [];
    const tick = (t: number) => {
      w.frames_.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.long_.push([e.startTime, e.duration]);
    }).observe({ type: "longtask", buffered: false });
    const canvas = document.querySelector('[data-testid="cellar-3d"] canvas[data-engine]')!;
    new ResizeObserver(() => w.resizes_.push(performance.now())).observe(canvas);
  });
  const stats = (from: number, to: number) =>
    page.evaluate(
      ([a, b]) => {
        const w = window as unknown as {
          frames_: number[];
          long_: Array<[number, number]>;
          resizes_: number[];
        };
        const f = w.frames_.filter((t) => t >= a! && t <= b!);
        const gaps = f
          .slice(1)
          .map((t, i) => t - f[i]!)
          .sort((x, y) => x - y);
        const at = (q: number) =>
          gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] ?? NaN;
        const long = w.long_.filter(([s]) => s >= a! && s <= b!);
        return {
          frames: f.length,
          p50: Math.round(at(0.5)),
          p95: Math.round(at(0.95)),
          max: Math.round(gaps.at(-1) ?? NaN),
          over50: gaps.filter((g) => g > 50).length,
          longTasks: long.length,
          longTaskMs: Math.round(long.reduce((s, [, d]) => s + d, 0)),
          resizes: w.resizes_.filter((t) => t >= a! && t <= b!).length,
        };
      },
      [from, to] as const,
    );
  const results = [];
  for (const name of [/shelf 2, position 3$/, /shelf 4, position 6$/, /shelf 1, position 1$/]) {
    await page
      .getByRole("list", { name: /Bottles in Perf rack/ })
      .getByRole("button", { name })
      .focus();
    const out = await page.evaluate(() => performance.now());
    await page.keyboard.press("Enter");
    await page.waitForTimeout(3500);
    const back = await page.evaluate(() => performance.now());
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("rack-backdrop")).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(2000);
    results.push({ out: await stats(out, out + 2000), back: await stats(back, back + 1500) });
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const file = process.env.PERF_OUT ?? "test-results/perf-3d-frames.json";
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
});
