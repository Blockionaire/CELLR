import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { PREVIEW_URL } from "./helpers";
import { bottleIds, canvasOf, held, num, phaseIs, show, storageOf, whereIs } from "./storage3d";

/**
 * Not a test: a measuring bench for taking a bottle out in the new storage view (Smart Cellar 3D, sprint 2B.1).
 *   PERF_SHOWCASE3D=1 pnpm exec playwright test perf-showcase3d --project=desktop
 *
 * For a place of 40, 200 and 900 bottles: what is drawn at rest, while a bottle is on display and after it is
 * back; how long from the tap to the first picture in which the bottle has moved; the time between pictures
 * while it comes out and goes home; what the view holds on the graphics card before and after many inspections.
 *
 * The numbers are the view's own (three.js' renderer.info, and timestamps the view writes), read here from its
 * canvas. The browser draws with software (no graphics card), so the TIMES compare this build with itself and
 * with the build before it on this machine; they say nothing about a phone.
 */
test.skip(!process.env.PERF_SHOWCASE3D, "only when asked for (PERF_SHOWCASE3D=1)");
test.use({ baseURL: PREVIEW_URL, deviceScaleFactor: 1 });

const OUT = process.env.PERF_OUT ?? "test-results/perf-showcase3d.json";
const SCENES = [
  {
    name: "rack 5×8",
    bottles: 40,
    query: "template=rack_classic&rows=5&cols=8&fill=full&quality=high",
  },
  {
    name: "rack 10×20",
    bottles: 200,
    query: "template=rack_classic&rows=10&cols=20&fill=full&quality=balanced",
  },
  {
    name: "rack 30×30",
    bottles: 900,
    query: "template=rack_classic&rows=30&cols=30&fill=full&quality=low",
  },
];
const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN;
const p95 = (xs: number[]) =>
  xs.length
    ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]!
    : NaN;

test("measure taking a bottle out", async ({ page }) => {
  test.setTimeout(3_600_000);
  const results = [];
  for (const scene of SCENES) {
    await show(page, scene.query);
    await page.waitForTimeout(3000);
    const drawn = async () => ({
      calls: await num(page, "calls"),
      triangles: await num(page, "triangles"),
    });
    const atRest = {
      ...(await drawn()),
      ...(await held(page)),
      warmed: await num(page, "prewarmed"),
    };
    const f0 = await num(page, "frames");
    await page.waitForTimeout(3000);
    const idleFrames = (await num(page, "frames")) - f0;

    // every picture the view draws, with its time
    await page.evaluate(() => {
      const w = window as unknown as { __pics: Array<[number, number]> };
      w.__pics = [];
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="gallery-stage"] canvas[data-engine]',
      )!;
      let last = canvas.dataset.frames;
      const tick = (t: number) => {
        if (canvas.dataset.frames !== last) {
          last = canvas.dataset.frames;
          w.__pics.push([t, Number(canvas.dataset.calls)]);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const pics = () =>
      page.evaluate(() =>
        (window as unknown as { __pics: Array<[number, number]> }).__pics.slice(),
      );
    const gapsOf = (list: Array<[number, number]>) =>
      list
        .slice(1)
        .map((p, i) => p[0] - list[i]![0])
        .filter((g) => g < 5000);

    const ids = (await bottleIds(page)).filter((id) => id.endsWith(":1"));
    const pick = (i: number) => ids[Math.floor(((i * 7 + 3) % 17) * (ids.length / 17))]!;
    type Drawn = {
      calls: number;
      triangles: number;
      geometries: number;
      textures: number;
      programs: number;
    };
    const cycles: Array<{
      id: string;
      latencyMs: number;
      outFrames: number;
      outFrameMs: number[];
      homeFrames: number;
      homeFrameMs: number[];
      onDisplay: Drawn;
      idleOnDisplay: number;
      after: Drawn;
      pose: number;
      drift: number;
    }> = [];
    for (let i = 0; i < 6; i++) {
      const id = pick(i);
      const at = await whereIs(page, id);
      const before = (await pics()).length;
      await page.mouse.click(at.x, at.y);
      await expect(storageOf(page)).toHaveAttribute("data-showcase-bottle", id, {
        timeout: 30_000,
      });
      await phaseIs(page, "inspecting");
      await page.waitForTimeout(600);
      const outPics = (await pics()).slice(before);
      const onDisplay = { ...(await drawn()), ...(await held(page)) };
      const latency = await num(page, "inspect-latency");
      const still = (await pics()).length;
      await page.waitForTimeout(2000);
      const idleOnDisplay = (await pics()).length - still;
      const homeFrom = (await pics()).length;
      await page.keyboard.press("Escape");
      await phaseIs(page, "idle");
      await page.waitForTimeout(800);
      const homePics = (await pics()).slice(homeFrom);
      cycles.push({
        id,
        latencyMs: latency,
        outFrames: outPics.length,
        outFrameMs: gapsOf(outPics),
        homeFrames: homePics.length,
        homeFrameMs: gapsOf(homePics),
        onDisplay,
        idleOnDisplay,
        after: { ...(await drawn()), ...(await held(page)) },
        pose: await num(page, "handoff-pose"),
        drift: await num(page, "handoff-drift"),
      });
    }
    const all = (key: "outFrameMs" | "homeFrameMs") => cycles.flatMap((c) => c[key]);
    results.push({
      scene: scene.name,
      bottles: scene.bottles,
      detail: await canvasOf(page).getAttribute("data-quality"),
      atRest,
      idleFrames3s: idleFrames,
      firstInspection: {
        latencyMs: cycles[0]!.latencyMs,
        programsBefore: atRest.warmed,
        programsDuring: cycles[0]!.onDisplay.programs,
      },
      laterLatencyMs: cycles.slice(1).map((c) => c.latencyMs),
      onDisplay: cycles[0]!.onDisplay,
      idleFramesOnDisplay2s: cycles.map((c) => c.idleOnDisplay),
      outFrameMs: {
        median: +median(all("outFrameMs")).toFixed(1),
        p95: +p95(all("outFrameMs")).toFixed(1),
        frames: median(cycles.map((c) => c.outFrames)),
      },
      homeFrameMs: {
        median: +median(all("homeFrameMs")).toFixed(1),
        p95: +p95(all("homeFrameMs")).toFixed(1),
        frames: median(cycles.map((c) => c.homeFrames)),
      },
      afterFirst: cycles[0]!.after,
      afterSix: cycles.at(-1)!.after,
      heldAfterEach: cycles.map(
        (c) => `${c.after.geometries}/${c.after.textures}/${c.after.programs}`,
      ),
      worstPose: Math.max(...cycles.map((c) => c.pose)),
      worstDriftPx: Math.max(...cycles.map((c) => c.drift)),
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  const environment = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2")!;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
      cores: navigator.hardwareConcurrency,
      viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    };
  });
  fs.mkdirSync(OUT.replace(/\/[^/]*$/, ""), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ environment, results }, null, 2));
  console.log(JSON.stringify(environment));
});
