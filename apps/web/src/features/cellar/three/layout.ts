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
  /** The ring at the mouth (the "bague"): how much wider than the neck, and how tall (0..1 of the length). */
  lip: number;
  lipHeight: number;
  /** Where the capsule (foil) starts, 0..1 of the length: a champagne's foil comes down over the neck. */
  capsuleFrom: number;
  /** How far up the wine comes (0..1 of the length), for the bottle on display. */
  fill: number;
}

/**
 * Real proportions of a 75 cl bottle: a Bordeaux is straight with a short, high, round shoulder; a Burgundy slopes
 * all the way from the middle; a Champagne is stouter, heavier at the heel, with a thick ring for the cork wire.
 */
export const SHAPES: Record<BottleShape, ShapeSpec> = {
  bordeaux: {
    radius: 0.42,
    bodyEnd: 0.62,
    shoulderEnd: 0.76,
    neckRadius: 0.125,
    lip: 1.2,
    lipHeight: 0.035,
    capsuleFrom: 0.84,
    fill: 0.68,
  },
  burgundy: {
    radius: 0.43,
    bodyEnd: 0.47,
    shoulderEnd: 0.8,
    neckRadius: 0.13,
    lip: 1.2,
    lipHeight: 0.035,
    capsuleFrom: 0.85,
    fill: 0.66,
  },
  champagne: {
    radius: 0.46,
    bodyEnd: 0.47,
    shoulderEnd: 0.78,
    neckRadius: 0.14,
    lip: 1.34,
    lipHeight: 0.045,
    capsuleFrom: 0.72,
    fill: 0.7,
  },
};

/** Half-profile of a bottle as [radius, height] pairs from the base up to the mouth, for a lathe. */
export function lathePoints(shape: BottleShape, length = BOTTLE_LENGTH): Array<[number, number]> {
  const s = SHAPES[shape];
  const heel = shape === "champagne" ? 0.045 : 0.035;
  const pts: Array<[number, number]> = [
    [0, 0],
    [s.radius * 0.8, 0],
    [s.radius * 0.94, 0.008 * length],
    [s.radius * 0.99, heel * 0.6 * length],
    [s.radius, heel * length],
    [s.radius, s.bodyEnd * length],
  ];
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    pts.push([
      s.radius + (s.neckRadius - s.radius) * shoulder(shape, t),
      (s.bodyEnd + (s.shoulderEnd - s.bodyEnd) * t) * length,
    ]);
  }
  const lipFrom = 1 - s.lipHeight;
  pts.push(
    [s.neckRadius, (lipFrom - 0.005) * length],
    [s.neckRadius * s.lip, lipFrom * length],
    [s.neckRadius * s.lip, (1 - 0.006) * length],
    [s.neckRadius * (s.lip - 0.08), length],
    [0, length],
  );
  return pts;
}

/**
 * How far (0..1) the shoulder has come in from the body towards the neck at `t` (0..1 along it). A Bordeaux holds
 * its width and turns in late and round; the others slope from the start.
 */
function shoulder(shape: BottleShape, t: number): number {
  const smooth = t * t * (3 - 2 * t);
  if (shape === "bordeaux") return Math.pow(smooth, 1.35);
  return 1 - Math.pow(1 - smooth, 1.25);
}

/** The outside radius of the bottle at height `y`, read off its profile. */
export function radiusAt(shape: BottleShape, y: number, length = BOTTLE_LENGTH): number {
  const pts = lathePoints(shape, length).slice(1, -1);
  for (let i = 1; i < pts.length; i++) {
    const [r0, y0] = pts[i - 1]!;
    const [r1, y1] = pts[i]!;
    if (y >= y0 && y <= y1)
      return y1 === y0 ? Math.max(r0, r1) : r0 + ((y - y0) / (y1 - y0)) * (r1 - r0);
  }
  return pts.at(-1)![0];
}

/** The capsule: foil pressed over the top of the neck (and, on a champagne, down to the shoulder). */
export function capsulePoints(shape: BottleShape, length = BOTTLE_LENGTH): Array<[number, number]> {
  const s = SHAPES[shape];
  const from = s.capsuleFrom * length;
  const pts: Array<[number, number]> = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const y = from + ((length * 0.999 - from) * i) / steps;
    pts.push([radiusAt(shape, y, length) + 0.007, y]);
  }
  pts.push([0, length + 0.004]);
  return pts;
}

/** The wine inside, a little in from the glass, up to where the bottle is filled. */
export function liquidPoints(shape: BottleShape, length = BOTTLE_LENGTH): Array<[number, number]> {
  const s = SHAPES[shape];
  const top = s.fill * length;
  const pts = lathePoints(shape, length)
    .slice(1, -1)
    .filter(([, y]) => y > 0.012 * length && y < top)
    .map(([r, y]): [number, number] => [Math.max(0.01, r - 0.035), y]);
  return [
    [0, 0.012 * length],
    ...pts,
    [Math.max(0.01, radiusAt(shape, top, length) - 0.035), top],
    [0, top],
  ];
}

/**
 * Glass, seen as it is in a rack (no light through it): dark antique green for reds and sparkling wines, the
 * yellow-green "feuille morte" of white Burgundy, clear flint with the wine showing for rosé, orange and sweet wines.
 * Decorative, never the only carrier of meaning (the name and the type are text elsewhere).
 */
export const GLASS: Record<WineType, string> = {
  red: "#1c2016",
  white: "#5f6537",
  rose: "#caa198",
  sparkling: "#1d2618",
  orange: "#c78a50",
  dessert: "#c99c47",
  fortified: "#231810",
};
/** The glass itself for the bottle on display, where light passes through it to the wine. */
export const GLASS_TINT: Record<WineType, string> = {
  red: "#26321c",
  white: "#b7bd7c",
  rose: "#f3efe6",
  sparkling: "#2a3a22",
  orange: "#f3efe6",
  dessert: "#f3efe6",
  fortified: "#4a3420",
};
/** How much light gets through that glass (0 = none, 1 = clear). */
export const GLASS_CLEAR: Record<WineType, number> = {
  red: 0.32,
  white: 0.82,
  rose: 0.96,
  sparkling: 0.4,
  orange: 0.96,
  dessert: 0.96,
  fortified: 0.32,
};
/** The wine's own colour, seen through clear glass. */
export const LIQUID: Record<WineType, string> = {
  red: "#22060c",
  white: "#d8c067",
  rose: "#e79c8f",
  sparkling: "#e4cf86",
  orange: "#cf7d32",
  dessert: "#d1922a",
  fortified: "#4d1a0e",
};
export const FOIL: Record<WineType, string> = {
  red: "#6e1f2c",
  white: "#c9b880",
  rose: "#e6d6c6",
  sparkling: "#c4a058",
  orange: "#a65f2a",
  dessert: "#b48a3a",
  fortified: "#5a3a22",
};

/**
 * What each kind of storage is made of. Wood for racks and cabinets (walnut, a warmer dark wood, oak for open
 * shelving), brushed dark metal with beech shelves for a wine fridge, blackened steel for a wall mount.
 */
export interface StorageLook {
  /** The frame: sides, top, bottom. */
  frame: { tone: string; material: "wood" | "brushed" | "steel" };
  /** The shelves the bottles lie on. */
  shelf: { tone: string; material: "wood" | "brushed" | "steel" };
  /** The back. */
  back: string;
  /** Upright dividers between the bottles (a fridge and a wall mount have none). */
  dividers: boolean;
  /** A thin metal edge on each shelf (a fridge's slide-out shelves). */
  lip: boolean;
  /** A warm light strip at the top inside (a fridge). */
  glow: boolean;
  /** Board thickness, as a share of FRAME. */
  board: number;
}
export const STORAGE_LOOK: Record<StorageKind, StorageLook> = {
  rack: {
    frame: { tone: "#5b3a27", material: "wood" },
    shelf: { tone: "#5b3a27", material: "wood" },
    back: "#24170f",
    dividers: true,
    lip: false,
    glow: false,
    board: 1,
  },
  cabinet: {
    frame: { tone: "#3e2819", material: "wood" },
    shelf: { tone: "#4a3020", material: "wood" },
    back: "#1c120c",
    dividers: true,
    lip: false,
    glow: false,
    board: 1.35,
  },
  shelving: {
    frame: { tone: "#8a6440", material: "wood" },
    shelf: { tone: "#8a6440", material: "wood" },
    back: "#3a2a1c",
    dividers: true,
    lip: false,
    glow: false,
    board: 0.9,
  },
  fridge: {
    frame: { tone: "#2a2d31", material: "brushed" },
    shelf: { tone: "#b08458", material: "wood" },
    back: "#16181b",
    dividers: false,
    lip: true,
    glow: true,
    board: 0.75,
  },
  wall: {
    frame: { tone: "#2b2a2a", material: "steel" },
    shelf: { tone: "#2b2a2a", material: "steel" },
    back: "#1e1c1b",
    dividers: false,
    lip: false,
    glow: false,
    board: 0.45,
  },
  other: {
    frame: { tone: "#5b3a27", material: "wood" },
    shelf: { tone: "#5b3a27", material: "wood" },
    back: "#24170f",
    dividers: true,
    lip: false,
    glow: false,
    board: 1,
  },
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

/** The camera starts this far (radians) round to the side, and a little above, so depth reads at once. */
export const CAMERA_AZIMUTH = 0.22;
export const CAMERA_ELEVATION = 0.11;

/** How far back the camera sits so the whole front is in view, for a given screen aspect ratio. */
export function cameraDistance(rows: number, cols: number, aspect: number): number {
  const { width, height } = unitSize(rows, cols);
  const tan = Math.tan((FOV * Math.PI) / 360);
  const fitHeight = height / 2 / tan;
  // Seen a little from the side, the unit's depth shows next to its front and takes up width too.
  const seenWidth = width * Math.cos(CAMERA_AZIMUTH) + RACK_DEPTH * Math.sin(CAMERA_AZIMUTH);
  const fitWidth = seenWidth / 2 / (tan * Math.max(0.2, aspect));
  return Math.max(fitHeight, fitWidth) * 1.07 + RACK_DEPTH / 2;
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

/** The details panel, in the numbers its CSS uses: beside the bottle on a wide screen, below it on a phone. */
export const PANEL = {
  /** Gap between the panel (and the bottle's space) and the edges of the view, px. */
  inset: 12,
  /** Wide screens: the panel is this wide, but at most `sideShare` of the view. */
  sideMaxPx: 416,
  sideShare: 0.46,
  /** Phones: the panel takes this share of the screen's height, from the bottom. */
  topShare: 0.44,
} as const;

/** How far in front of the camera the bottle stands on display (scene units). Its size on screen does not depend on it. */
export const SHOWCASE_DEPTH = 9;

/** The bottle's height to its widest diameter (the widest of the three shapes), to keep a tall bottle in a narrow space. */
const BOTTLE_SLENDERNESS = (2 * 0.46) / BOTTLE_LENGTH;

/**
 * Where the bottle stands on display, worked out on the screen: in the middle of the space the panel leaves free,
 * as tall as that space allows with a margin. The same for every rack, shelf and camera angle.
 * Returns the bottle's centre as fractions of the view (x: -0.5 left … 0.5 right, y: -0.5 bottom … 0.5 top) and
 * its height as a fraction of the view's height.
 *
 * @param safeTop the phone's status-bar inset in px (the view fills the whole screen there)
 */
export function showcaseFrame(
  layout: ShowcaseLayout,
  width: number,
  height: number,
  safeTop = 0,
): { x: number; y: number; fill: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const { inset } = PANEL;
  const left = inset;
  let right = w - inset;
  let top = inset;
  let bottom = h - inset;
  let share: number;
  if (layout === "side") {
    right = w - inset - Math.min(PANEL.sideMaxPx, PANEL.sideShare * w) - inset;
    share = 0.8;
  } else {
    top = safeTop + inset;
    bottom = h * (1 - PANEL.topShare) - inset;
    share = 0.9;
  }
  const free = Math.max(1, bottom - top);
  // As tall as the free space allows, unless that would make it wider than the space is.
  const tall = Math.min(free * share, ((right - left) * 0.8) / BOTTLE_SLENDERNESS);
  return {
    x: (left + right) / 2 / w - 0.5,
    y: 0.5 - (top + bottom) / 2 / h,
    fill: tall / h,
  };
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
