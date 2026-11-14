import { BOTTLE_LENGTH } from "../three/layout";
import type { MaterialRole } from "./palette";

/**
 * The vocabulary of the layout-driven renderer, as plain numbers (no three.js): a place is a list of PARTS (boards,
 * rods, panels) and a way to say where a bottle lies. Unit of length: as in the existing 3D view, the distance
 * between two neighbouring bottles' axes is about 1.
 *
 * Axes: x to the right, y up, z towards the viewer. A place stands with its front at positive z.
 */
export type Vec3 = [number, number, number];

/** The widest bottle there is (a champagne): every clearance is worked out against it. */
export const BOTTLE_R = 0.46;
export const BOTTLE_L = BOTTLE_LENGTH;
/** Air around a bottle, so glass never touches wood. */
export const AIR = 0.02;

export interface Part {
  role: MaterialRole;
  /** `box`: size is width, height, depth. `cyl`: size is [radius, length, 0], lying along `axis`. */
  shape: "box" | "cyl";
  size: Vec3;
  pos: Vec3;
  /** A box turned about the z axis (radians): the diagonal boards of a diamond rack. */
  rotZ?: number;
  axis?: "x" | "y" | "z";
  /**
   * Not something a bottle rests on or could be cut by: a door, a pane of glass, a light strip, the wall. The
   * clearance checks leave these out; they are still drawn.
   */
  soft?: boolean;
}

export const box = (
  role: MaterialRole,
  size: Vec3,
  pos: Vec3,
  extra: Partial<Part> = {},
): Part => ({
  role,
  shape: "box",
  size,
  pos,
  ...extra,
});
export const rod = (
  role: MaterialRole,
  axis: "x" | "y" | "z",
  radius: number,
  length: number,
  pos: Vec3,
  extra: Partial<Part> = {},
): Part => ({ role, shape: "cyl", size: [radius, length, 0], pos, axis, ...extra });

/**
 * How a bottle (or what stands for one) is put down:
 * - `z`: lying, neck towards the viewer (a rack, a bin);
 * - `x`: lying along the wall, its label towards the viewer (pegs and rails);
 * - `token`: not a bottle in a pose at all, but a counter in a neutral picture of a place whose arrangement the app
 *   does not know. It says "one bottle is in this compartment" and nothing about where.
 */
export type Lie = "z" | "x" | "token";
export interface Pose {
  position: Vec3;
  lie: Lie;
}

/** The space a part takes, as a box around it (turned boxes: the box around the turned box). */
export function partBounds(p: Part): { min: Vec3; max: Vec3 } {
  let half: Vec3;
  if (p.shape === "cyl") {
    const [r, len] = p.size;
    half = p.axis === "x" ? [len / 2, r, r] : p.axis === "y" ? [r, len / 2, r] : [r, r, len / 2];
  } else if (p.rotZ) {
    const c = Math.abs(Math.cos(p.rotZ));
    const s = Math.abs(Math.sin(p.rotZ));
    half = [
      (p.size[0] * c + p.size[1] * s) / 2,
      (p.size[0] * s + p.size[1] * c) / 2,
      p.size[2] / 2,
    ];
  } else half = [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2];
  return {
    min: [p.pos[0] - half[0], p.pos[1] - half[1], p.pos[2] - half[2]],
    max: [p.pos[0] + half[0], p.pos[1] + half[1], p.pos[2] + half[2]],
  };
}

/** The space a bottle takes in a pose, as a box around the widest bottle. */
export function poseBounds(pose: Pose): { min: Vec3; max: Vec3 } {
  const [x, y, z] = pose.position;
  const h: Vec3 =
    pose.lie === "z"
      ? [BOTTLE_R, BOTTLE_R, BOTTLE_L / 2]
      : pose.lie === "x"
        ? [BOTTLE_L / 2, BOTTLE_R, BOTTLE_R]
        : [TOKEN_R, TOKEN_R, TOKEN_T / 2];
  return { min: [x - h[0], y - h[1], z - h[2]], max: [x + h[0], y + h[1], z + h[2]] };
}

/** A counter in the neutral picture: a flat disc. */
export const TOKEN_R = 0.2;
export const TOKEN_T = 0.12;

/**
 * How far a bottle in `pose` reaches INTO a part (0 or less: they do not touch). Exact for what this renderer
 * builds: a bottle is a cylinder along z or x, a part is a box (possibly turned about z) or a rod along an axis.
 * A rod is taken as the box around it, which only ever overstates a collision.
 */
export function penetration(pose: Pose, part: Part): number {
  if (pose.lie === "token") return 0;
  const [bx, by, bz] = pose.position;
  // the bottle's own axis interval, and its circle in the plane across it
  const along = pose.lie === "z" ? 2 : 0;
  const b = partBounds(part);
  const axisGap = Math.max(
    b.min[along] - (pose.position[along] + BOTTLE_L / 2),
    pose.position[along] - BOTTLE_L / 2 - b.max[along],
  );
  if (axisGap >= 0) return -axisGap;
  // circle (centre c, radius R) against a rectangle in the plane across the bottle
  let cx: number, cy: number, hw: number, hh: number;
  if (pose.lie === "z") {
    // plane x-y; a turned box is handled in its own frame
    const dx = bx - part.pos[0];
    const dy = by - part.pos[1];
    const a = part.shape === "box" ? (part.rotZ ?? 0) : 0;
    cx = dx * Math.cos(a) + dy * Math.sin(a);
    cy = -dx * Math.sin(a) + dy * Math.cos(a);
    if (part.shape === "box") [hw, hh] = [part.size[0] / 2, part.size[1] / 2];
    else [hw, hh] = [(b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2];
  } else {
    // plane z-y (the bottle lies along x); nothing turned about z stands beside such a bottle
    cx = bz - (b.min[2] + b.max[2]) / 2;
    cy = by - (b.min[1] + b.max[1]) / 2;
    [hw, hh] = [(b.max[2] - b.min[2]) / 2, (b.max[1] - b.min[1]) / 2];
  }
  const ox = Math.max(Math.abs(cx) - hw, 0);
  const oy = Math.max(Math.abs(cy) - hh, 0);
  const outside = Math.hypot(ox, oy);
  if (outside > 0) return BOTTLE_R - outside;
  // the centre is inside the rectangle
  return BOTTLE_R + Math.min(hw - Math.abs(cx), hh - Math.abs(cy));
}

/**
 * Two bottles in their poses: how far they reach into each other (0 or less: apart). Exact for bottles lying the
 * same way; for two that lie differently it is the overlap of the boxes around them, which only overstates.
 */
export function bottleOverlap(a: Pose, b: Pose): number {
  if (a.lie === "token" || b.lie === "token") return -Infinity;
  if (a.lie !== b.lie) {
    const [p, q] = [poseBounds(a), poseBounds(b)];
    return Math.min(
      ...[0, 1, 2].map((i) => Math.min(p.max[i]!, q.max[i]!) - Math.max(p.min[i]!, q.min[i]!)),
    );
  }
  const along = a.lie === "z" ? 2 : 0;
  const across = a.lie === "z" ? [0, 1] : [1, 2];
  const axisGap = Math.abs(a.position[along]! - b.position[along]!) - BOTTLE_L;
  if (axisGap >= 0) return -axisGap;
  const d = Math.hypot(
    a.position[across[0]!]! - b.position[across[0]!]!,
    a.position[across[1]!]! - b.position[across[1]!]!,
  );
  return 2 * BOTTLE_R - d;
}

/** The box around a set of parts (and bottles). */
export function boundsOf(
  parts: readonly Part[],
  poses: readonly Pose[] = [],
): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (b: { min: Vec3; max: Vec3 }) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, b.min[i]!);
      max[i] = Math.max(max[i]!, b.max[i]!);
    }
  };
  for (const p of parts) grow(partBounds(p));
  for (const p of poses) grow(poseBounds(p));
  if (min[0] === Infinity) return { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
  return { min, max };
}
