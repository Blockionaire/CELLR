import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { PREVIEW_URL } from "./helpers";
import { bottleIds, canvasOf, held, num, phaseIs, show, storageOf, whereIs } from "./storage3d";

/**
 * Not a test: one bench for the storage view AND its showcase, at 40, 200, 900 and 1,200 bottles (Smart Cellar 3D,
 * sprint 2B.2). It is run on the build before a change and on the build after it, with nothing else different,
 * so the two can be laid side by side.
 *   PERF_FIDELITY3D=1 PERF_OUT=/some/file.json pnpm exec playwright test perf-fidelity3d --project=desktop
 *   PERF_QUERY="fidelity=classic" adds that to every scene's address (to measure one look against the other).
 *
 * Per scene: what is drawn and held at rest; time to the first picture; pictures drawn in three seconds at rest;
 * the time between pictures while the place is turned; then twenty inspections of a bottle: five played in full
 * (tap to first movement, time between pictures out and home, what is drawn on display) and fifteen with reduced
 * motion (the same code path for resources, without the wait), and what is held after the twenty.
 *
 * WHAT IS MEASURED AND WHAT IS ESTIMATED. Draw calls, triangles, geometries, textures and programs are three.js'
 * own counts. Times are timestamps. Texture memory is an ESTIMATE: the sizes textures were given, times four
 * bytes a pixel (eight for half-float), times 1.33 for mip levels; the browser does not say what a driver takes.
 *
 * The browser here draws with software (no graphics card): the times compare two builds on this machine and say
 * nothing about a phone.
 */
test.skip(!process.env.PERF_FIDELITY3D, "only when asked for (PERF_FIDELITY3D=1)");
test.use({ baseURL: PREVIEW_URL, deviceScaleFactor: 1 });

const OUT = process.env.PERF_OUT ?? "test-results/perf-fidelity3d.json";
const EXTRA = process.env.PERF_QUERY ? `&${process.env.PERF_QUERY}` : "";
const SCENES = [
  {
    name: "small cellar",
    bottles: 40,
    query: "template=rack_classic&rows=5&cols=8&fill=full&quality=high",
  },
  {
    name: "medium cellar",
    bottles: 200,
    query: "template=rack_classic&rows=10&cols=20&fill=full&quality=balanced",
  },
  {
    name: "large cellar",
    bottles: 900,
    query: "template=rack_classic&rows=30&cols=30&fill=full&quality=low",
  },
  {
    name: "stress case",
    bottles: 1200,
    query: "template=rack_double_depth&rows=20&cols=30&cap=2&fill=full&quality=low",
  },
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

/** Adds up the sizes textures are given, from outside the page's code. Installed before any page script runs. */
function texturesProbe() {
  const bytes = new Map<object, number>();
  let bound: object | null = null;
  (window as unknown as { __textureBytes: () => number }).__textureBytes = () =>
    [...bytes.values()].reduce((a, b) => a + b, 0);
  const proto = WebGL2RenderingContext.prototype as unknown as Record<
    string,
    (...a: never[]) => unknown
  >;
  const px = (format: number) => (format === 0x881a ? 8 : format === 0x8814 ? 16 : 4);
  const sized = (format: number, w: number, h: number) => {
    if (bound && w > 0 && h > 0) bytes.set(bound, Math.round(w * h * px(format) * 1.33));
  };
  const wrap = (name: string, before: (...args: never[]) => void) => {
    const original = proto[name]!;
    proto[name] = function (this: unknown, ...args: never[]) {
      before(...args);
      return original.apply(this, args);
    };
  };
  wrap("bindTexture", (...a) => {
    bound = a[1] as unknown as object | null;
  });
  wrap("texStorage2D", (...a) =>
    sized(a[2] as unknown as number, a[3] as unknown as number, a[4] as unknown as number),
  );
  wrap("texImage2D", (...a) => {
    const args = a as unknown as unknown[];
    if (args[1] !== 0) return;
    if (args.length >= 9) sized(args[2] as number, args[3] as number, args[4] as number);
    else {
      const source = args[5] as { width?: number; height?: number } | null;
      if (source?.width) sized(args[2] as number, source.width, source.height ?? 0);
    }
  });
  wrap("deleteTexture", (...a) => {
    bytes.delete(a[0] as unknown as object);
  });
}

test("measure the storage view and its showcase", async ({ page }) => {
  test.setTimeout(5_400_000);
  await page.addInitScript(texturesProbe);
  const results = [];
  for (const scene of SCENES) {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await show(page, scene.query + EXTRA);
    await page.waitForTimeout(3000);
    const drawn = async () => ({
      calls: await num(page, "calls"),
      triangles: await num(page, "triangles"),
    });
    const textureMB = async () =>
      round(
        (await page.evaluate(() =>
          (window as unknown as { __textureBytes: () => number }).__textureBytes(),
        )) / 1048576,
      );
    const atRest = {
      ...(await drawn()),
      ...(await held(page)),
      warmedPrograms: await num(page, "prewarmed"),
      textureMBEstimate: await textureMB(),
      firstPictureMs: await num(page, "first-frame-ms"),
    };
    const f0 = await num(page, "frames");
    await page.waitForTimeout(3000);
    const idleFrames3s = (await num(page, "frames")) - f0;

    // every picture the view draws, with its time
    await page.evaluate(() => {
      const w = window as unknown as { __pics: number[] };
      w.__pics = [];
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="gallery-stage"] canvas[data-engine]',
      )!;
      let last = canvas.dataset.frames;
      const tick = (t: number) => {
        if (canvas.dataset.frames !== last) {
          last = canvas.dataset.frames;
          w.__pics.push(t);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const pics = () =>
      page.evaluate(() => (window as unknown as { __pics: number[] }).__pics.slice());
    const gapsOf = (list: number[]) =>
      list
        .slice(1)
        .map((t, i) => t - list[i]!)
        .filter((g) => g < 8000);

    // turning the place
    const box = (await canvasOf(page).boundingBox())!;
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    const turnFrom = (await pics()).length;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(cx - i * 10, cy);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(2500);
    const turning = gapsOf((await pics()).slice(turnFrom));
    // back to where it started, so that every bottle is where the taps expect it
    await show(page, scene.query + EXTRA);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const w = window as unknown as { __pics: number[] };
      w.__pics = [];
      const canvas = document.querySelector<HTMLCanvasElement>(
        '[data-testid="gallery-stage"] canvas[data-engine]',
      )!;
      let last = canvas.dataset.frames;
      const tick = (t: number) => {
        if (canvas.dataset.frames !== last) {
          last = canvas.dataset.frames;
          w.__pics.push(t);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const ids = (await bottleIds(page)).filter((id) => id.endsWith(":1"));
    const pick = (i: number) => ids[Math.floor(((i * 7 + 3) % 17) * (ids.length / 17))]!;
    const full: Array<{
      latency: number;
      out: number[];
      home: number[];
      onDisplay: Awaited<ReturnType<typeof drawn>>;
    }> = [];
    const heldAfter: string[] = [];
    let worstPose = 0;
    let worstDrift = 0;
    let programsDuringFirst = NaN;
    for (let i = 0; i < 20; i++) {
      if (i === 5) await page.emulateMedia({ reducedMotion: "reduce" });
      const id = pick(i);
      const at = await whereIs(page, id);
      const before = (await pics()).length;
      await page.mouse.click(at.x, at.y);
      await expect(storageOf(page)).toHaveAttribute("data-showcase-bottle", id, {
        timeout: 30_000,
      });
      await phaseIs(page, "inspecting");
      await page.waitForTimeout(i < 5 ? 500 : 150);
      if (i === 0) programsDuringFirst = await num(page, "programs");
      const outPics = (await pics()).slice(before);
      const onDisplay = await drawn();
      const latency = await num(page, "inspect-latency");
      const homeFrom = (await pics()).length;
      await page.keyboard.press("Escape");
      await phaseIs(page, "idle");
      await page.waitForTimeout(i < 5 ? 700 : 200);
      if (i < 5)
        full.push({
          latency,
          out: gapsOf(outPics),
          home: gapsOf((await pics()).slice(homeFrom)),
          onDisplay,
        });
      const h = await held(page);
      heldAfter.push(`${h.geometries}/${h.textures}/${h.programs}`);
      worstPose = Math.max(worstPose, await num(page, "handoff-pose"));
      worstDrift = Math.max(worstDrift, await num(page, "handoff-drift"));
    }
    const out = full.flatMap((c) => c.out);
    const home = full.flatMap((c) => c.home);
    results.push({
      scene: scene.name,
      bottles: scene.bottles,
      detail: await canvasOf(page).getAttribute("data-quality"),
      atRest,
      idleFrames3s,
      turningMs: {
        median: round(median(turning)),
        p95: round(p95(turning)),
        pictures: turning.length + 1,
      },
      firstInteractionMs: full[0]!.latency,
      laterInteractionMs: full.slice(1).map((c) => c.latency),
      programsBeforeAndDuringFirstInspection: [atRest.warmedPrograms, programsDuringFirst],
      onDisplay: full[0]!.onDisplay,
      outMs: { median: round(median(out)), p95: round(p95(out)) },
      homeMs: { median: round(median(home)), p95: round(p95(home)) },
      heldAfterInspections: {
        1: heldAfter[0],
        5: heldAfter[4],
        10: heldAfter[9],
        20: heldAfter[19],
      },
      heldEvery: heldAfter,
      textureMBEstimateAfter20: await textureMB(),
      afterTwenty: { ...(await drawn()), ...(await held(page)) },
      worstPose,
      worstDriftPx: worstDrift,
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
  fs.writeFileSync(OUT, JSON.stringify({ environment, query: EXTRA, results }, null, 2));
  console.log(JSON.stringify(environment));
});
