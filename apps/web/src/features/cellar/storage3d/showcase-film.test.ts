import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { STORAGE_TEMPLATE_IDS, resolveStorage } from "@cellr/domain";

vi.mock("../three/materials", () => {
  const shared = new THREE.Texture();
  return {
    woodTexture: () => shared,
    brushedTexture: () => shared,
    contactShadowTexture: () => shared,
  };
});

import { BOTTLE_LENGTH, FOV } from "../three/layout";
import { fixtureBottles, fixturePlace } from "./fixtures";
import {
  buildModel,
  frameFor,
  placeBottles,
  START_AZIMUTH,
  START_ELEVATION,
  type RenderModel,
} from "./model";
import { poseMatrix } from "./resources";
import {
  FILM_SECONDS,
  HANDOVER,
  alongPath,
  displayFor,
  filmAt,
  frameMatrix,
  inspectionFrame,
  layoutForWidth,
  newFrame,
  phasesOf,
  type Display,
} from "./showcase-film";
import { planExtraction, type ExtractionPlan } from "./showcase-plan";

/** The storage view's camera for a place, as its rig puts it (template-scene.tsx, Rig), turned a little further. */
function cameraFor(model: RenderModel, aspect: number, turn = 0) {
  const f = frameFor(model.bounds, aspect);
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 600);
  const [tx, ty, tz] = f.target;
  const az = START_AZIMUTH + turn;
  camera.position.set(
    tx + f.distance * Math.sin(az) * Math.cos(START_ELEVATION),
    ty + f.distance * Math.sin(START_ELEVATION),
    tz + f.distance * Math.cos(az) * Math.cos(START_ELEVATION),
  );
  camera.lookAt(tx, ty, tz);
  camera.updateMatrixWorld();
  return camera;
}
const SIZE = { width: 1200, height: 800 };
const displayOf = (model: RenderModel, size = SIZE, turn = 0): Display =>
  displayFor(
    cameraFor(model, size.width / size.height, turn),
    size,
    inspectionFrame(layoutForWidth(size.width), size.width, size.height),
    6,
  );

/** Every bottle of every template (and the unsure places), with its plan. */
function everyPlan(): Array<{ model: RenderModel; plan: ExtractionPlan; name: string }> {
  const out: Array<{ model: RenderModel; plan: ExtractionPlan; name: string }> = [];
  const models = [
    ...STORAGE_TEMPLATE_IDS.map((id) => buildModel(fixturePlace({ template: id }))),
    buildModel(fixturePlace({ template: "wall_rails", rows: 3, cols: 2, cellCapacity: 3 })),
    buildModel(fixturePlace({ template: "cabinet_closed", appearance: { door: "glass" } })),
    buildModel(
      resolveStorage({
        kind: "rack",
        rows: 2,
        cols: 3,
        template: "diamond_bins",
        cellCapacity: 8,
        semantics: "depth",
      }),
    ),
  ];
  for (const model of models) {
    const { placed } = placeBottles(model, fixtureBottles(model.resolved.layout, "partial"));
    for (const b of placed)
      out.push({
        model,
        plan: planExtraction(model, b, placed),
        name: `${model.templateId ?? "unknown"} ${b.id}`,
      });
  }
  return out;
}
const ALL = everyPlan();
const maxDiff = (a: THREE.Matrix4, b: THREE.Matrix4) =>
  Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i]!)));

describe("at progress 0 the film IS the storage view's own bottle", () => {
  it("every bottle of every template: the same matrix, to the last bit, however it was turned on display", () => {
    expect(ALL.length).toBeGreaterThan(300);
    let checked = 0;
    for (const { model, plan, name } of ALL) {
      if (plan.origin.lie === "token") continue;
      const display = displayOf(model);
      for (const yaw of [0, 1.3, -7.5, 100]) {
        const frame = filmAt(plan, 0, display, yaw);
        expect(maxDiff(frameMatrix(frame), poseMatrix(plan.origin)), `${name} yaw ${yaw}`).toBe(0);
        expect(frame.scale).toBe(1);
        expect(frame.rise).toBe(0);
        expect(frame.slide).toBe(0);
        expect(frame.dim).toBe(0);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("a counter comes back to its counter, at a counter's size", () => {
    const tokens = ALL.filter((x) => x.plan.origin.lie === "token");
    expect(tokens.length).toBeGreaterThan(0);
    for (const { model, plan } of tokens) {
      const frame = filmAt(plan, 0, displayOf(model), 2);
      expect(frame.position.toArray()).toEqual(plan.origin.position);
      expect(frame.scale).toBe(plan.originScale);
      expect(frame.opacity).toBe(0);
    }
  });

  it("out and back is the same film: the frame at a progress does not depend on the direction or on what came before", () => {
    for (const { model, plan } of ALL.filter((_, i) => i % 23 === 0)) {
      const display = displayOf(model);
      const reused = newFrame();
      for (const p of [0, 0.2, 0.5, 0.9, 1, 0.9, 0.5, 0.2, 0]) {
        const fresh = filmAt(plan, p, display, 0);
        const again = filmAt(plan, p, display, 0, reused);
        expect(maxDiff(frameMatrix(fresh), frameMatrix(again))).toBe(0);
      }
      expect(
        maxDiff(
          frameMatrix(filmAt(plan, 0, display, 0, reused)),
          frameMatrix(filmAt(plan, 0, display, 0)),
        ),
      ).toBe(0);
    }
  });
});

describe("at progress 1 the bottle is on display", () => {
  it("at the display spot, upright and square to the screen, at the display size, solid", () => {
    for (const { model, plan, name } of ALL.filter((_, i) => i % 7 === 0)) {
      const display = displayOf(model);
      const frame = filmAt(plan, 1, display, 0);
      expect(frame.position.distanceTo(display.position), name).toBeLessThan(1e-9);
      expect(frame.quaternion.angleTo(display.facing), name).toBeLessThan(1e-6);
      expect(frame.scale).toBeCloseTo(display.scale, 12);
      expect(frame.opacity).toBe(1);
      expect(frame.rise).toBe(1);
      expect(frame.dim).toBe(1);
    }
  });

  it("turning it turns it about its own axis and moves nothing else", () => {
    const { model, plan } = ALL[0]!;
    const display = displayOf(model);
    const turned = filmAt(plan, 1, display, Math.PI / 2);
    expect(turned.position.distanceTo(display.position)).toBeLessThan(1e-9);
    expect(turned.quaternion.angleTo(display.facing)).toBeCloseTo(Math.PI / 2, 6);
    // its long axis is still the screen's up
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turned.quaternion);
    expect(up.angleTo(new THREE.Vector3(0, 1, 0).applyQuaternion(display.facing))).toBeLessThan(
      1e-6,
    );
  });

  it("stands at the same place on the screen for every template and every angle the place was turned to", () => {
    const boxes = new Set<string>();
    for (const { model, plan } of ALL.filter((_, i) => i % 11 === 0))
      for (const turn of [0, -0.9, 0.7]) {
        const camera = cameraFor(model, SIZE.width / SIZE.height, turn);
        const display = displayFor(
          camera,
          SIZE,
          inspectionFrame("side", SIZE.width, SIZE.height),
          6,
        );
        const frame = filmAt(plan, 1, display, 0);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        const px = (v: THREE.Vector3) => {
          v.project(camera);
          return [((v.x + 1) / 2) * SIZE.width, ((1 - v.y) / 2) * SIZE.height];
        };
        const half = (frame.scale * BOTTLE_LENGTH) / 2;
        const [cx, top] = px(frame.position.clone().addScaledVector(up, half));
        const [, bottom] = px(frame.position.clone().addScaledVector(up, -half));
        boxes.add([cx, top, bottom].map((n) => n!.toFixed(1)).join(","));
      }
    expect([...boxes]).toHaveLength(1);
  });
});

describe("in between", () => {
  it("never jumps: a small step in progress is a small step of the bottle, all the way, for every kind of movement", () => {
    for (const { model, plan, name } of ALL.filter((_, i) => i % 13 === 0)) {
      const display = displayOf(model);
      const reach = new THREE.Vector3(...plan.origin.position).distanceTo(display.position) + 8;
      let before = filmAt(plan, 0, display, 0);
      for (let i = 1; i <= 400; i++) {
        const now = filmAt(plan, i / 400, display, 0);
        expect(now.position.distanceTo(before.position), `${name} at ${i / 400}`).toBeLessThan(
          reach * 0.012,
        );
        expect(now.quaternion.angleTo(before.quaternion)).toBeLessThan(0.03);
        expect(Math.abs(now.scale - before.scale)).toBeLessThan(0.03);
        expect(Math.abs(now.opacity - before.opacity)).toBeLessThan(0.03);
        before = now;
      }
    }
  });

  it("a bottle that is drawn out stays on its path, lying as it lay, until it is clear of the furniture", () => {
    const physical = ALL.filter((x) => x.plan.mode === "physical").filter((_, i) => i % 9 === 0);
    expect(physical.length).toBeGreaterThan(10);
    for (const { model, plan, name } of physical) {
      const display = displayOf(model);
      const home = filmAt(plan, 0, display, 0).quaternion.clone();
      for (const p of [0.05, 0.1, 0.2, 0.27]) {
        const frame = filmAt(plan, p, display, 0);
        const onPath = alongPath(plan.path, phasesOf("physical", p).slide, new THREE.Vector3());
        expect(frame.position.distanceTo(onPath), `${name} at ${p}`).toBeLessThan(1e-9);
        expect(frame.quaternion.angleTo(home)).toBeLessThan(1e-9);
        expect(frame.scale).toBe(1);
      }
      // at the hand-over it has all but reached the end of the path
      const end = new THREE.Vector3(...plan.path.at(-1)!);
      expect(
        alongPath(
          plan.path,
          phasesOf("physical", HANDOVER.physical).slide,
          new THREE.Vector3(),
        ).distanceTo(end),
      ).toBeLessThan(1e-9);
    }
  });

  it("an inspection transition claims no path: it goes straight from the place to the display spot", () => {
    for (const { model, plan, name } of ALL.filter((x) => x.plan.mode !== "physical").filter(
      (_, i) => i % 9 === 0,
    )) {
      const display = displayOf(model);
      const from = new THREE.Vector3(...plan.origin.position);
      const line = new THREE.Line3(from, display.position);
      for (const p of [0.1, 0.4, 0.8]) {
        const at = filmAt(plan, p, display, 0).position;
        expect(
          line.closestPointToPoint(at, true, new THREE.Vector3()).distanceTo(at),
          `${name} at ${p}`,
        ).toBeLessThan(1e-9);
      }
    }
  });

  it("a bottle in plain sight is solid throughout; one that is not fades up, and is solid long before it is turned", () => {
    expect([0, 0.01, 0.5, 1].map((p) => phasesOf("lift", p).opacity)).toEqual([1, 1, 1, 1]);
    expect([0, 0.01, 0.5, 1].map((p) => phasesOf("physical", p).opacity)).toEqual([1, 1, 1, 1]);
    expect(phasesOf("emerge", 0).opacity).toBe(0);
    expect(phasesOf("emerge", 0.15).opacity).toBeGreaterThan(0.3);
    expect(phasesOf("emerge", 0.3).opacity).toBe(1);
  });

  it("the place is handed over to its picture once a drawn-out bottle is clear, and at once otherwise", () => {
    expect(HANDOVER.physical).toBe(0.4);
    expect(phasesOf("physical", HANDOVER.physical).slide).toBe(1);
    expect(HANDOVER.lift).toBeLessThan(0.1);
    expect(HANDOVER.emerge).toBeLessThan(0.1);
    // and an inspection transition is the shorter movement
    expect(FILM_SECONDS.emerge.out).toBeLessThan(FILM_SECONDS.physical.out);
  });

  it("with reduced motion there is no in between: the two ends are all there is, and they are the same two ends", () => {
    const { model, plan } = ALL.find((x) => x.plan.mode === "physical")!;
    const display = displayOf(model);
    expect(maxDiff(frameMatrix(filmAt(plan, 0, display, 0)), poseMatrix(plan.origin))).toBe(0);
    expect(filmAt(plan, 1, display, 0).position.distanceTo(display.position)).toBeLessThan(1e-9);
  });
});

describe("where the bottle stands in the picture", () => {
  it("beside the panel on a wide picture, in the middle of the whole picture on a narrow one", () => {
    expect(layoutForWidth(1100)).toBe("side");
    expect(layoutForWidth(720)).toBe("side");
    expect(layoutForWidth(719)).toBe("stacked");
    const side = inspectionFrame("side", 1100, 640);
    expect(side.x).toBeLessThan(-0.1); // left of the middle: the panel has the right
    const stacked = inspectionFrame("stacked", 356, 416);
    expect(stacked.x).toBe(0);
    expect(stacked.y).toBeCloseTo(0, 12);
  });

  it("is large on a phone: most of the picture's height, and never wider than the picture", () => {
    for (const [w, h] of [
      [296, 416],
      [356, 416],
      [390, 600],
      [700, 544],
    ] as const) {
      const { fill } = inspectionFrame("stacked", w, h);
      const tall = fill * h;
      expect(tall, `${w}×${h}`).toBeGreaterThan(0.8 * h);
      expect(tall * ((2 * 0.46) / BOTTLE_LENGTH)).toBeLessThanOrEqual(w - 24);
    }
    // 320 px wide phone (a 296 px picture): the bottle is over 330 px tall
    expect(inspectionFrame("stacked", 296, 416).fill * 416).toBeGreaterThan(330);
  });

  it("stays below a status bar or a notch", () => {
    const plain = inspectionFrame("stacked", 390, 800);
    const notched = inspectionFrame("stacked", 390, 800, 59);
    const top = (f: { y: number; fill: number }) => (0.5 - f.y - f.fill / 2) * 800;
    expect(top(notched)).toBeGreaterThanOrEqual(59 + 12);
    expect(top(notched)).toBeGreaterThan(top(plain));
    expect(notched.fill).toBeLessThan(plain.fill);
  });

  it("follows the picture when it changes size: always whole, always inside it", () => {
    for (const [w, h] of [
      [300, 300],
      [320, 568],
      [768, 1024],
      [1280, 544],
      [2000, 400],
      [200, 900],
    ] as const) {
      const f = inspectionFrame(layoutForWidth(w), w, h);
      const cy = (0.5 - f.y) * h;
      expect(cy - (f.fill * h) / 2, `${w}×${h} top`).toBeGreaterThanOrEqual(0);
      expect(cy + (f.fill * h) / 2, `${w}×${h} bottom`).toBeLessThanOrEqual(h);
      expect(f.fill).toBeGreaterThan(0);
    }
  });
});

describe("the arithmetic", () => {
  it("a point along a path, by length", () => {
    const path: Array<[number, number, number]> = [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 3],
    ];
    const at = (f: number) => alongPath(path, f, new THREE.Vector3()).toArray();
    expect(at(0)).toEqual([0, 0, 0]);
    expect(at(0.25)).toEqual([0, 1, 0]);
    expect(at(0.625)).toEqual([0, 1, 1.5]);
    expect(at(1)).toEqual([0, 1, 3]);
    expect(at(7)).toEqual([0, 1, 3]);
    expect(alongPath([[2, 2, 2]], 0.5, new THREE.Vector3()).toArray()).toEqual([2, 2, 2]);
  });
});
