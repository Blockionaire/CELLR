import type { SlotAddress } from "@cellr/domain";
import type { PlacedBottle, RenderModel } from "./model";
import {
  AIR,
  BOTTLE_L,
  BOTTLE_R,
  TOKEN_R,
  bottleOverlap,
  partBounds,
  penetration,
  type Part,
  type Pose,
  type Vec3,
} from "./parts";

/**
 * HOW a bottle leaves its place to be looked at (Smart Cellar 3D, sprint 2B.1). Decided from what the place is
 * and what is physically in the way, as plain numbers; the animation only plays what is decided here.
 *
 * Two kinds of movement, and they are not to be confused:
 *
 * - `physical`: the bottle is DRAWN OUT along a path it could really take: out of its cell along its own axis, or
 *   up off its pegs and away from the wall. The path is checked: nothing on it touches wood, glass or another
 *   bottle. Only then is it shown as an extraction.
 *
 * - an INSPECTION TRANSITION, which claims no path at all: the place is frozen as a picture and the bottle comes
 *   forward out of that picture.
 *   - `lift`: the bottle is in plain sight (a pile in a bin): it rises from where it is drawn.
 *   - `emerge`: the bottle is not in plain sight or not a bottle on a known spot (behind another bottle, behind a
 *     closed door, a counter in a place whose arrangement is not known): it fades up from there.
 *
 * WHAT NEVER CHANGES: the bottle's address. A plan carries it in and out untouched; nothing here writes.
 */
export type ExtractionMode = "physical" | "lift" | "emerge";

export type ExtractionReason =
  /** Nothing in the way: drawn out for real. */
  | "clear_path"
  /** A bottle lies before it (a lower index in the same position). It is not drawn out through that bottle. */
  | "behind_bottle"
  /** A closed door stands before it. The door is not opened by this view, and the bottle is not drawn through it. */
  | "behind_door"
  /** Something else of the furniture is in the way. */
  | "blocked"
  /** A loose pile: where a bottle lies in it is an illustration, not a fact, so no path out of it is claimed. */
  | "pile"
  /** The arrangement of the place is not known: there is no spot to take it from. */
  | "unknown_arrangement";

export interface ExtractionPlan {
  mode: ExtractionMode;
  reason: ExtractionReason;
  /** The bottle's logical spot, exactly as stored. Carried, never changed. */
  address: SlotAddress;
  /** Exactly where and how the storage view draws it: the movement starts and ends here to the last bit. */
  origin: Pose;
  /** `physical` only: the way out, from `origin` (first) to clear of the furniture (last). */
  path: Vec3[];
  /** How large the bottle is when it starts (1; smaller where it stands for a counter). */
  originScale: number;
}

/** How far past the furniture's front a bottle is drawn before it turns. */
const CLEARANCE = 0.25;
/** How far a bottle on a wall is lifted off what carries it, and how far past the mount it is taken. */
const LIFT = 0.07;
const OFF_THE_WALL = 0.3;
/** What a path may touch without it counting: rounding. */
const TOUCH = 1e-6;
/** Steps a path is checked at (scene units). */
const STEP = 0.08;
/** Never in a bottle's way: a backdrop, and light. */
const NOT_IN_THE_WAY = new Set<Part["role"]>(["wall", "glow", "glowB", "display"]);

/** The points of a path, at most `STEP` apart. */
export function samplePath(path: readonly Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i]!, path[i + 1]!];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / STEP));
    for (let k = i === 0 ? 0 : 1; k <= n; k++)
      out.push([
        a[0] + ((b[0] - a[0]) * k) / n,
        a[1] + ((b[1] - a[1]) * k) / n,
        a[2] + ((b[2] - a[2]) * k) / n,
      ]);
  }
  return out;
}

export interface Obstacles {
  /** Another bottle lies on the path. */
  bottle: boolean;
  /** Something that is not carried weight on: a door, a pane of glass. */
  door: boolean;
  /** A hard part of the furniture: a lip, a board, a rod. */
  furniture: boolean;
}

/** What a bottle would run into along a path. All false: the path is free. */
export function obstaclesOn(
  path: readonly Vec3[],
  lie: Pose["lie"],
  parts: readonly Part[],
  others: readonly Pose[],
): Obstacles {
  const found: Obstacles = { bottle: false, door: false, furniture: false };
  const inTheWay = parts.filter((p) => !NOT_IN_THE_WAY.has(p.role));
  for (const position of samplePath(path)) {
    const pose: Pose = { position, lie };
    if (!found.bottle && others.some((other) => bottleOverlap(pose, other) > TOUCH))
      found.bottle = true;
    for (const part of inTheWay) {
      if (part.soft ? found.door : found.furniture) continue;
      if (penetration(pose, part) > TOUCH) {
        if (part.soft) found.door = true;
        else found.furniture = true;
      }
    }
  }
  return found;
}

/** The front of the furniture a bottle has to clear: its hard parts (a door that stands open is not in the way). */
function frontOf(parts: readonly Part[]): number {
  let z = -Infinity;
  for (const p of parts) if (!p.soft) z = Math.max(z, partBounds(p).max[2]);
  return z;
}

/**
 * The way a bottle would really leave its spot, were nothing in the way.
 * - Lying in a cell, neck to the viewer: straight out along its own axis until all of it is before the furniture.
 * - Lying along a wall on pegs or a rail: up off what carries it, then away from the wall.
 */
export function wayOut(model: RenderModel, origin: Pose): Vec3[] {
  const [x, y, z] = origin.position;
  if (origin.lie === "x") {
    // off the pegs, or over the upturned tip of a rail's rod, then out until all of it is before the mount
    const out = Math.max(z, frontOf(model.parts) + BOTTLE_R + AIR + OFF_THE_WALL);
    return [origin.position, [x, y + LIFT, z], [x, y + LIFT, out]];
  }
  const clear = Math.max(z, frontOf(model.parts) + BOTTLE_L / 2 + CLEARANCE);
  return [origin.position, [x, y, clear]];
}

export function planExtraction(
  model: RenderModel,
  bottle: PlacedBottle,
  placed: readonly PlacedBottle[],
): ExtractionPlan {
  const base = { address: bottle.address, origin: bottle.pose, path: [], originScale: 1 };
  // a place whose arrangement is not known: a counter, not a bottle on a spot
  if (model.renderer === "neutral" || bottle.pose.lie === "token")
    return {
      ...base,
      mode: "emerge",
      reason: "unknown_arrangement",
      originScale: (TOKEN_R * 2 * 1.5) / BOTTLE_L,
    };
  // a pile: the index is a counter, the place in the pile an illustration
  if (model.resolved.layout.semantics === "ordinal" || model.built.poseOf === undefined)
    return { ...base, mode: "lift", reason: "pile" };

  const path = wayOut(model, bottle.pose);
  const others = placed.filter((b) => b.id !== bottle.id).map((b) => b.pose);
  const found = obstaclesOn(path, bottle.pose.lie, model.parts, others);
  if (!found.bottle && !found.door && !found.furniture)
    return { ...base, mode: "physical", reason: "clear_path", path };
  // what is said first is what a person would see first: a bottle before it, then a door, then the furniture
  const reason: ExtractionReason = found.bottle
    ? "behind_bottle"
    : found.door
      ? "behind_door"
      : "blocked";
  return { ...base, mode: "emerge", reason };
}
