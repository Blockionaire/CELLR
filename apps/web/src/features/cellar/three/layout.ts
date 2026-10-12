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

// ---- The showcase: a bottle leaves its slot and stands on display -------------------------------------------

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * t * (t * (t * 6 - 15) + 10); // smootherstep: no visible start or stop
};

/** How far a bottle slides out of its slot before it is clear of the rack. */
export const SLIDE_OUT = BOTTLE_LENGTH + 0.15;

/**
 * The whole "bottle comes out of the rack" movement as a function of one number, `progress`
 * (0 = lying in its slot, 1 = on display). First it slides out along its own axis, then it stands up and
 * glides to the display spot, so the same function plays the movement backwards when it goes home.
 */
export function showcasePhases(progress: number): { slide: number; rise: number; glide: number } {
  return {
    slide: smooth(0, 0.4, progress),
    rise: smooth(0.32, 0.92, progress),
    glide: smooth(0.28, 1, progress),
  };
}

export type ShowcaseLayout = "side" | "top";

/**
 * Where the standing bottle is shown, as fractions of what the camera sees (x: -0.5 left … 0.5 right,
 * y: -0.5 bottom … 0.5 top) and how much of the view's height it fills. On a wide screen it stands on the
 * left and the details take the right; on a phone it stands on top and the details take the bottom.
 */
export function showcaseSpot(layout: ShowcaseLayout): { x: number; y: number; fill: number } {
  return layout === "side" ? { x: -0.23, y: 0.0, fill: 0.74 } : { x: 0, y: 0.26, fill: 0.42 };
}

/** The panel sits beside the picture on screens at least this wide (px), below it underneath. */
export const SIDE_BY_SIDE_MIN_WIDTH = 720;
export const layoutFor = (width: number): ShowcaseLayout =>
  width >= SIDE_BY_SIDE_MIN_WIDTH ? "side" : "top";

/**
 * Breaks a name into at most `maxLines` lines no wider than `maxWidth`, by words, using the caller's
 * way of measuring text (a canvas in the browser, a counter in tests). A single word wider than the
 * line stays whole: the label shrinks its type instead of cutting words.
 */
export function wrapLines(
  text: string,
  measure: (s: string) => number,
  maxWidth: number,
  maxLines: number,
): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  if (lines.length > maxLines) return null;
  return lines.every((l) => measure(l) <= maxWidth) ? lines : null;
}
