import type { StorageKind, WineType } from "@cellr/domain";
import type { BottleShape } from "@/ui/bottle-glyph";

/**
 * The geometry of the 3D cellar, as plain numbers (no three.js in here, so it is easy to test).
 * Unit of length: the distance between two neighbouring bottles' axes ("one slot").
 */
export const SLOT = 1;
export const BOTTLE_LENGTH = 3.4;
/** Depth of a rack: a bottle with a little air at the back and the neck just inside the front. */
export const RACK_DEPTH = BOTTLE_LENGTH + 0.2;
export const FRAME = 0.14; // thickness of boards
export const FOV = 32;

interface ShapeSpec {
  radius: number;
  /** Where (0..1 of the length) the straight body ends and the shoulder begins / ends. */
  bodyEnd: number;
  shoulderEnd: number;
  neckRadius: number;
}

export const SHAPES: Record<BottleShape, ShapeSpec> = {
  bordeaux: { radius: 0.42, bodyEnd: 0.6, shoulderEnd: 0.76, neckRadius: 0.125 },
  burgundy: { radius: 0.43, bodyEnd: 0.52, shoulderEnd: 0.77, neckRadius: 0.13 },
  champagne: { radius: 0.46, bodyEnd: 0.5, shoulderEnd: 0.79, neckRadius: 0.14 },
};

/** Half-profile of a bottle as [radius, height] pairs from the base up to the lip, for a lathe. */
export function lathePoints(shape: BottleShape, length = BOTTLE_LENGTH): Array<[number, number]> {
  const s = SHAPES[shape];
  const pts: Array<[number, number]> = [
    [0, 0],
    [s.radius * 0.72, 0],
    [s.radius * 0.95, 0.02 * length],
    [s.radius, 0.06 * length],
    [s.radius, s.bodyEnd * length],
  ];
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const eased = t * t * (3 - 2 * t); // smoothstep: a shoulder, not a cone
    pts.push([
      s.radius + (s.neckRadius - s.radius) * eased,
      (s.bodyEnd + (s.shoulderEnd - s.bodyEnd) * t) * length,
    ]);
  }
  pts.push(
    [s.neckRadius, 0.96 * length],
    [s.neckRadius * 1.22, 0.965 * length],
    [s.neckRadius * 1.22, length],
    [0, length],
  );
  return pts;
}

/** Glass colours: decorative, never the only carrier of meaning (the name and the type are text elsewhere). */
export const GLASS: Record<WineType, string> = {
  red: "#2a1318",
  white: "#9ba868",
  rose: "#c98a9a",
  sparkling: "#3b4a35",
  orange: "#b9773c",
  dessert: "#cfa34a",
  fortified: "#3d2616",
};
export const FOIL: Record<WineType, string> = {
  red: "#7d2234",
  white: "#c9b87a",
  rose: "#d98a9b",
  sparkling: "#c9a45c",
  orange: "#b9773c",
  dessert: "#8a6a24",
  fortified: "#6b4b2a",
};
export const FRAME_COLOUR: Record<StorageKind, string> = {
  fridge: "#3a4046",
  rack: "#43302a",
  cabinet: "#4d3a2e",
  shelving: "#3a3430",
  wall: "#3f3a35",
  other: "#3a3430",
};

/** Centre of a slot's bottle, in the unit's own coordinates (x right, y up, z towards the viewer). */
export function slotPosition(
  row: number,
  col: number,
  rows: number,
  cols: number,
): [number, number, number] {
  return [(col - (cols + 1) / 2) * SLOT, ((rows + 1) / 2 - row) * SLOT, 0];
}

/** Width and height of the unit's front, frame included. */
export function unitSize(rows: number, cols: number): { width: number; height: number } {
  return { width: cols * SLOT + 2 * FRAME, height: rows * SLOT + 2 * FRAME };
}

/** How far back the camera sits so the whole front is in view, for a given screen aspect ratio. */
export function cameraDistance(rows: number, cols: number, aspect: number): number {
  const { width, height } = unitSize(rows, cols);
  const tan = Math.tan((FOV * Math.PI) / 360);
  const fitHeight = height / 2 / tan;
  const fitWidth = width / 2 / (tan * Math.max(0.2, aspect));
  return Math.max(fitHeight, fitWidth) * 1.06 + RACK_DEPTH / 2;
}
