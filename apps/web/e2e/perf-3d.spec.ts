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
    const programsAfter = Number(await scene.locator("canvas[data-engine]").getAttribute("data-programs"));
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
