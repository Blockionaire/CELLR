import * as THREE from "three";
import { BOTTLE_LENGTH, showcaseFrame, type ShowcaseLayout } from "../three/layout";
import type { Pose, Vec3 } from "./parts";
import type { ExtractionPlan } from "./showcase-plan";

/**
 * The movement of a bottle between its place and the spot it is looked at, as ONE function of ONE number
 * (Smart Cellar 3D, sprint 2B.1): `progress` 0 = in its place, 1 = on display. Going home is the same film played
 * backwards, so the bottle comes back to exactly where it left: at progress 0 every number below IS the storage
 * view's own pose of the bottle (see `originMatrix`, and the tests that hold the two against each other).
 *
 * three.js is used for its arithmetic only (vectors, quaternions): nothing here needs a canvas.
 */

/** A bottle is modelled standing on y = 0; these lay it down as the storage view does (resources.ts, poseMatrix). */
export const LIE_Z = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
export const LIE_X = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2));

/** How long the movements take (seconds). An inspection transition claims no path, and is shorter. */
export const FILM_SECONDS = {
  physical: { out: 1.4, home: 0.85 },
  lift: { out: 0.95, home: 0.65 },
  emerge: { out: 0.95, home: 0.65 },
} as const;

/**
 * The progress at which the storage view hands over to its still picture on the way out, and takes over again on
 * the way home. `physical`: once the bottle is clear of the furniture (until then the furniture's own boards cover
 * it, live). An inspection transition: at once, since nothing of it is a path through the furniture.
 */
export const HANDOVER = { physical: 0.4, lift: 0.04, emerge: 0.04 } as const;

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** The parts of the movement, each 0..1. The physical ones are the existing view's (three/layout showcasePhases). */
export function phasesOf(
  mode: ExtractionPlan["mode"],
  progress: number,
): { slide: number; rise: number; glide: number; opacity: number } {
  if (mode === "physical")
    return {
      slide: smooth(0, 0.4, progress),
      rise: smooth(0.32, 0.92, progress),
      glide: smooth(0.28, 1, progress),
      opacity: 1,
    };
  // no slide along a path: the bottle turns and comes forward in one movement
  return {
    slide: smooth(0, 0.3, progress),
    rise: smooth(0.05, 0.85, progress),
    glide: smooth(0, 1, progress),
    // out of plain sight (or a counter): it fades up. In plain sight: it is simply there.
    opacity: mode === "emerge" ? smooth(0, 0.3, progress) : 1,
  };
}

/** Where on the screen the bottle is looked at, and how large: fixed in front of the camera. */
export interface Display {
  position: THREE.Vector3;
  /** Upright and square to the screen: the camera's own orientation. */
  facing: THREE.Quaternion;
  scale: number;
}

/**
 * Where the panel is, and so where the bottle stands:
 * - `side`: a wide picture. The panel is beside the bottle, inside the picture.
 * - `stacked`: a narrow picture, and the screen has given a place for the panel below it. The bottle has the whole
 *   picture.
 * - `sheet`: a narrow picture and NO place for the panel outside it. The panel is a sheet over the lower part of
 *   the picture, and the bottle stands in the part above it. (The fallback: a panel is never simply not there.)
 */
export type InspectionLayout = "side" | "stacked" | "sheet";
export const layoutForWidth = (width: number, hasSlot = true): InspectionLayout =>
  width >= 720 ? "side" : hasSlot ? "stacked" : "sheet";

/**
 * Where the bottle stands in the picture, as fractions of it (x: -0.5 left … 0.5 right, y: -0.5 bottom … 0.5 top)
 * and its height as a fraction of the picture's height. `side` is the existing view's own frame (the panel takes
 * the right); `stacked` centres it in the whole picture, below a top inset (a status bar or a notch).
 */
export function inspectionFrame(
  layout: InspectionLayout,
  width: number,
  height: number,
  safeTop = 0,
): { x: number; y: number; fill: number } {
  // beside the panel, or above a sheet: the existing view's own frames for exactly these two
  if (layout === "side")
    return showcaseFrame("side" satisfies ShowcaseLayout, width, height, safeTop);
  if (layout === "sheet")
    return showcaseFrame("top" satisfies ShowcaseLayout, width, height, safeTop);
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const inset = 12;
  const top = safeTop + inset;
  const bottom = h - inset;
  const free = Math.max(1, bottom - top);
  // as tall as the picture allows, unless that would make it wider than the picture
  const slenderness = (2 * 0.46) / BOTTLE_LENGTH;
  const tall = Math.min(free * 0.9, ((w - 2 * inset) * 0.8) / slenderness);
  return { x: 0, y: 0.5 - (top + bottom) / 2 / h, fill: tall / h };
}

/** The display spot for a camera and a picture size. `depth`: how far in front of the camera. */
export function displayFor(
  camera: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number },
  size: { width: number; height: number },
  frame: { x: number; y: number; fill: number },
  depth: number,
  out: Display = { position: new THREE.Vector3(), facing: new THREE.Quaternion(), scale: 1 },
): Display {
  const visibleH = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const visibleW = visibleH * (size.width / Math.max(1, size.height));
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  out.position
    .copy(camera.position)
    .addScaledVector(forward, depth)
    .addScaledVector(right, frame.x * visibleW)
    .addScaledVector(up, frame.y * visibleH);
  out.facing.copy(camera.quaternion);
  out.scale = (frame.fill * visibleH) / BOTTLE_LENGTH;
  return out;
}

/** How the bottle is turned in its place. A counter is not a bottle lying anywhere: it starts as it will be shown. */
export function originQuaternion(pose: Pose, facing: THREE.Quaternion): THREE.Quaternion {
  return pose.lie === "z" ? LIE_Z : pose.lie === "x" ? LIE_X : facing;
}

export interface FilmFrame {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: number;
  /** 0 = not drawn, 1 = solid. */
  opacity: number;
  /** 0 = it looks as the storage view draws it, 1 = as it is shown: clear glass, the wine, its printed label. */
  rise: number;
  /** 0 = still resting in its place (its contact shadow is there), 1 = off it. */
  slide: number;
  /** 0 = the place is as it is, 1 = it has stepped back behind the bottle. */
  dim: number;
}

export const newFrame = (): FilmFrame => ({
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: 1,
  opacity: 1,
  rise: 0,
  slide: 0,
  dim: 0,
});

const scratch = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  turn: new THREE.Quaternion(),
  facing: new THREE.Quaternion(),
  axisY: new THREE.Vector3(0, 1, 0),
};

/** The point a fraction (0..1, by length) of the way along a path. */
export function alongPath(
  path: readonly Vec3[],
  fraction: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  if (path.length === 0) return out.set(0, 0, 0);
  if (path.length === 1 || fraction <= 0) return out.set(...path[0]!);
  const lengths = path
    .slice(1)
    .map((p, i) => Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1], p[2] - path[i]![2]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let left = Math.min(1, fraction) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]! || i === lengths.length - 1) {
      const t = lengths[i]! === 0 ? 0 : Math.min(1, left / lengths[i]!);
      scratch.a.set(...path[i]!);
      scratch.b.set(...path[i + 1]!);
      return out.lerpVectors(scratch.a, scratch.b, t);
    }
    left -= lengths[i]!;
  }
  return out.set(...path[path.length - 1]!);
}

/**
 * One picture of the film. `yaw`: how far the person has turned the bottle (radians), which counts only as far as
 * the bottle has risen, so that it is back square by the time it lies down again.
 */
export function filmAt(
  plan: ExtractionPlan,
  progress: number,
  display: Display,
  yaw: number,
  out: FilmFrame = newFrame(),
): FilmFrame {
  const p = Math.min(1, Math.max(0, progress));
  const { slide, rise, glide, opacity } = phasesOf(plan.mode, p);
  // where it is before it comes forward: on its way out of the furniture, or simply its place
  if (plan.mode === "physical") alongPath(plan.path, slide, scratch.a);
  else scratch.a.set(...plan.origin.position);
  out.position.lerpVectors(scratch.a, display.position, glide);
  scratch.turn.setFromAxisAngle(scratch.axisY, yaw * rise);
  scratch.facing.copy(display.facing).multiply(scratch.turn);
  out.quaternion.slerpQuaternions(
    originQuaternion(plan.origin, display.facing),
    scratch.facing,
    rise,
  );
  out.scale = plan.originScale + (display.scale - plan.originScale) * glide;
  out.opacity = opacity;
  out.rise = rise;
  out.slide = slide;
  out.dim = plan.mode === "physical" ? glide : smooth(0, 0.45, p);
  return out;
}

/** The bottle is modelled standing on y = 0 and turned about its middle. */
export const PIVOT = new THREE.Matrix4().makeTranslation(0, -BOTTLE_LENGTH / 2, 0);

/** The matrix the film puts the bottle's model at (the frame's transform, then the pivot). */
export function frameMatrix(frame: FilmFrame, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out
    .compose(frame.position, frame.quaternion, scratch.b.setScalar(frame.scale))
    .multiply(PIVOT);
}
