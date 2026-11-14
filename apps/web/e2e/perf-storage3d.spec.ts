import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Not a test: a measuring bench for the layout-driven 3D view (Smart Cellar 3D, sprint 2A), against the existing
 * view in the same browser on the same machine. Both are opened in the template gallery, which needs no account.
 *   PERF_STORAGE3D=1 pnpm exec playwright test perf-storage3d --project=desktop
 *
 * WHAT IS COUNTED, AND HOW. Not by asking either view: the browser's own WebGL calls are counted from outside, so
 * both views are measured by one ruler. Per picture drawn to the screen: draw calls and triangles. Alive at that
 * moment: textures, and an estimate of their memory from the sizes they were given. Times: from the making of the
 * graphics context to the first picture on the screen; between pictures while the place is being turned; and the
 * main thread's work per picture (from the browser's own task clock).
 *
 * WHAT THIS IS NOT. The browser here draws with software (no graphics card), so the TIMES say how the two views
 * compare on this machine and nothing about a phone. Draw calls, triangles and textures are the same everywhere.
 */
test.skip(!process.env.PERF_STORAGE3D, "only when asked for (PERF_STORAGE3D=1)");
test.use({ deviceScaleFactor: 1 });

const OUT = process.env.PERF_OUT ?? "test-results/perf-storage3d.json";

interface Probe {
  created: number | null;
  firstScreen: number | null;
  frames: Array<{ t: number; calls: number; triangles: number }>;
  textures: number;
  textureBytes: number;
  programs: number;
}

/** Counts what the page asks of WebGL. Installed before any page script runs. */
function install() {
  const probe = {
    created: null as number | null,
    firstScreen: null as number | null,
    frames: [] as Array<{ t: number; calls: number; triangles: number }>,
    calls: 0,
    triangles: 0,
    screen: true,
    bytes: new Map<object, number>(),
    bound: null as object | null,
    programs: 0,
  };
  (window as unknown as { __probe: typeof probe }).__probe = probe;
  const proto = WebGL2RenderingContext.prototype as unknown as Record<
    string,
    (...a: never[]) => unknown
  >;
  const wrap = (name: string, before: (...args: number[]) => void) => {
    const original = proto[name]!;
    proto[name] = function (this: unknown, ...args: never[]) {
      before(...(args as unknown as number[]));
      return original.apply(this, args);
    };
  };
  const drew = (triangles: number) => {
    if (!probe.screen) return;
    if (probe.firstScreen === null) probe.firstScreen = performance.now();
    probe.calls += 1;
    probe.triangles += triangles;
  };
  const tris = (mode: number, count: number) =>
    mode === 4 ? count / 3 : mode === 5 ? count - 2 : 0;
  wrap("drawElements", (mode, count) => drew(tris(mode, count)));
  wrap("drawArrays", (mode, _first, count) => drew(tris(mode, count)));
  wrap("drawElementsInstanced", (mode, count, _type, _offset, n) => drew(tris(mode, count) * n));
  wrap("drawArraysInstanced", (mode, _first, count, n) => drew(tris(mode, count) * n));
  wrap("bindFramebuffer", (_target, fb) => {
    probe.screen = (fb as unknown) === null;
  });
  wrap("bindTexture", (_target, texture) => {
    probe.bound = texture as unknown as object | null;
  });
  // RGBA16F / RGBA32F take 8 / 16 bytes a pixel; everything else here is taken as 4. A third more for mip levels.
  const px = (format: number) => (format === 0x881a ? 8 : format === 0x8814 ? 16 : 4);
  const sized = (format: number, w: number, h: number) => {
    if (probe.bound && w > 0 && h > 0)
      probe.bytes.set(probe.bound, Math.round(w * h * px(format) * 1.33));
  };
  wrap("texStorage2D", (_t, _levels, format, w, h) => sized(format, w, h));
  const texImage = proto.texImage2D!;
  proto.texImage2D = function (this: unknown, ...args: never[]) {
    const a = args as unknown as unknown[];
    if (a[1] === 0) {
      if (a.length >= 9) sized(a[2] as number, a[3] as number, a[4] as number);
      else {
        const source = a[5] as { width?: number; height?: number; videoWidth?: number } | null;
        if (source?.width) sized(a[2] as number, source.width, source.height ?? 0);
      }
    }
    return texImage.apply(this, args);
  };
  const deleteTexture = proto.deleteTexture!;
  proto.deleteTexture = function (this: unknown, ...args: never[]) {
    probe.bytes.delete(args[0] as unknown as object);
    return deleteTexture.apply(this, args);
  };
  wrap("linkProgram", () => {
    probe.programs += 1;
  });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
    const made = (getContext as (...a: unknown[]) => unknown).apply(this, args);
    // the page first asks a canvas that is not on the page whether 3D is possible at all; the view's own is on it
    if (made && String(args[0]).startsWith("webgl") && this.isConnected)
      probe.created ??= performance.now();
    return made;
  } as typeof getContext;
  const tick = (t: number) => {
    if (probe.calls > 0)
      probe.frames.push({ t, calls: probe.calls, triangles: Math.round(probe.triangles) });
    probe.calls = 0;
    probe.triangles = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const read = (page: Page) =>
  page.evaluate((): Probe => {
    const p = (window as unknown as { __probe: Probe & { bytes: Map<object, number> } }).__probe;
    return {
      created: p.created,
      firstScreen: p.firstScreen,
      frames: p.frames.slice(),
      textures: p.bytes.size,
      textureBytes: [...p.bytes.values()].reduce((a, b) => a + b, 0),
      programs: p.programs,
    };
  });

const median = (xs: number[]) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN;
const p95 = (xs: number[]) =>
  xs.length
    ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))]!
    : NaN;

interface Scene {
  name: string;
  view: "new" | "existing";
  bottles: number;
  query: string;
}
const SCENES: Scene[] = [
  {
    name: "rack 5×8",
    view: "existing",
    bottles: 40,
    query: "sample=legacy&rows=5&cols=8&fill=full",
  },
  {
    name: "rack 5×8",
    view: "new",
    bottles: 40,
    query: "template=rack_classic&rows=5&cols=8&fill=full&quality=high",
  },
  {
    name: "rack 10×20",
    view: "existing",
    bottles: 200,
    query: "sample=legacy&rows=10&cols=20&fill=full",
  },
  {
    name: "rack 10×20",
    view: "new",
    bottles: 200,
    query: "template=rack_classic&rows=10&cols=20&fill=full&quality=balanced",
  },
  {
    name: "rack 30×30",
    view: "existing",
    bottles: 900,
    query: "sample=legacy&rows=30&cols=30&fill=full",
  },
  {
    name: "rack 30×30",
    view: "new",
    bottles: 900,
    query: "template=rack_classic&rows=30&cols=30&fill=full&quality=low",
  },
  {
    name: "rack 30×30, detail forced high",
    view: "new",
    bottles: 900,
    query: "template=rack_classic&rows=30&cols=30&fill=full&quality=high",
  },
  {
    name: "double-depth rack 20×30×2",
    view: "new",
    bottles: 1200,
    query: "template=rack_double_depth&rows=20&cols=30&cap=2&fill=full&quality=low",
  },
  {
    name: "diamond bins 10×10×12",
    view: "new",
    bottles: 1200,
    query: "template=diamond_bins&rows=10&cols=10&cap=12&fill=full&quality=low",
  },
  {
    name: "cooler 10×20, glass door, lit",
    view: "new",
    bottles: 200,
    query: "template=cooler_single&rows=10&cols=20&fill=full&quality=balanced",
  },
  {
    name: "wall pegs 30×30",
    view: "new",
    bottles: 900,
    query: "template=wall_pegs&rows=30&cols=30&fill=full&quality=low",
  },
];

test("measure the 3D views", async ({ page, browserName }, info) => {
  test.setTimeout(3_600_000);
  await page.addInitScript(install);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const taskSeconds = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return metrics.find((m) => m.name === "TaskDuration")!.value;
  };
  const results = [];
  for (const scene of SCENES) {
    await page.goto(`/design/cellar-3d?${scene.query}`);
    const canvas = page.locator('[data-testid="gallery-stage"] canvas');
    await expect(canvas).toBeVisible({ timeout: 120_000 });
    // until pictures stop coming: the place is up and at rest
    await expect
      .poll(async () => (await read(page)).frames.length, { timeout: 180_000, intervals: [1000] })
      .toBeGreaterThan(0);
    let last = -1;
    await expect
      .poll(
        async () => {
          const n = (await read(page)).frames.length;
          const still = n === last;
          last = n;
          return still;
        },
        { timeout: 300_000, intervals: [3000] },
      )
      .toBe(true);
    const settled = await read(page);
    expect(
      Number((await page.getByTestId("layout-map-summary").innerText()).match(/^(\d+)/)![1]),
    ).toBe(scene.bottles);

    // at rest for three seconds: how many pictures were drawn for nothing
    await page.waitForTimeout(3000);
    const idle = (await read(page)).frames.length - settled.frames.length;

    // turning the place: a drag across a third of the view, in steps
    const box = (await canvas.boundingBox())!;
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    const before = await read(page);
    const tasksBefore = await taskSeconds();
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(cx - i * 10, cy + Math.sin(i / 3) * 12);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const after = await read(page);
    const tasks = (await taskSeconds()) - tasksBefore;
    const moving = after.frames.slice(before.frames.length);
    const gaps = moving
      .slice(1)
      .map((f, i) => f.t - moving[i]!.t)
      .filter((g) => g < 2000);
    const steady = moving.length ? moving : settled.frames.slice(-1);

    results.push({
      scene: scene.name,
      view: scene.view,
      bottles: scene.bottles,
      detail: scene.view === "new" ? await canvas.getAttribute("data-quality") : "(its own)",
      drawCalls: median(steady.map((f) => f.calls)),
      triangles: median(steady.map((f) => f.triangles)),
      textures: after.textures,
      textureMB: +(after.textureBytes / 1048576).toFixed(1),
      programs: after.programs,
      firstPictureMs:
        settled.created !== null && settled.firstScreen !== null
          ? Math.round(settled.firstScreen - settled.created)
          : null,
      idleFrames: idle,
      turningFrames: moving.length,
      frameMsMedian: +median(gaps).toFixed(1),
      frameMsP95: +p95(gaps).toFixed(1),
      mainThreadMsPerFrame: moving.length ? +((tasks * 1000) / moving.length).toFixed(1) : null,
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
  fs.writeFileSync(
    OUT,
    JSON.stringify({ environment, browserName, project: info.project.name, results }, null, 2),
  );
  console.log(JSON.stringify(environment));
});
