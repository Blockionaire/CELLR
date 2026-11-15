import type { StorageDoor, StorageTemplateId, StorageZone } from "@cellr/domain";
import {
  AIR,
  BOTTLE_L,
  BOTTLE_R,
  TOKEN_R,
  box,
  rod,
  type Part,
  type Pose,
  type Vec3,
} from "./parts";

/**
 * THE THREE FAMILIES (and the neutral picture), as geometry in plain numbers. Each takes the logical layout's
 * numbers (shelves, cells per shelf, bottles per cell) and a few template parameters, and gives back the parts of
 * the furniture and where a bottle lies. Fourteen templates are fourteen parameter sets over these builders: there
 * is no template-specific drawing code anywhere else.
 */
export interface Built {
  parts: Part[];
  /** Where the bottle on a spot lies: layouts whose index is a physical position (depth, single). */
  poseOf?: (row: number, col: number, index: number) => Pose;
  /**
   * Where the n-th bottle of a compartment lies (rank 0 = the first to settle): layouts whose index is a mere
   * counter. The rank is "how many bottles are already in this compartment", never the stored index.
   */
  pileOf?: (row: number, col: number, rank: number) => Pose;
  /** Where an EMPTY counter of the neutral picture is drawn (capacity that is not taken). */
  emptyOf?: (row: number, col: number, rank: number) => Vec3;
  /** Where the light inside sits, when the place can be lit. */
  light: Vec3 | null;
  /**
   * The inside of a lit cabinet, for shading it (sprint 2B.2): each lit zone's height, and which strip lights it
   * (0: the strip under the top, 1: a strip under a zone bar). Says how the inside is LIT, nothing else.
   */
  interior?: { halfWidth: number; zones: Array<{ top: number; bottom: number; strip: 0 | 1 }> };
  /** A wall mount: how far out from the wall the surface behind the bottles is (where their shadows fall). */
  surface?: number;
}

const DEPTH_GAP = 0.15;
const SQRT1_2 = Math.SQRT1_2;

// ================================================================================================
// GRID: shelves of single positions, possibly several bottles deep
// ================================================================================================

export interface GridStyle {
  /** Distance between two bottles' axes on a shelf, and between two shelves. */
  pitchX: number;
  pitchY: number;
  /** What a bottle lies on: a board, two thin rods, or a cooler's slide-out shelf with a metal edge. */
  shelves: "board" | "rods" | "slide";
  /** Thickness of a shelf board. */
  board: number;
  /** Thickness of the upright between two bottles (0: none). */
  dividers: number;
  /** The ends: full panels, four square posts with stretchers (open sides), or four round steel posts. */
  sides: "panel" | "posts" | "rodposts";
  /** Thickness of a side panel. */
  side: number;
  back: boolean;
  /** Joinery, as against a plain frame: a recessed plinth under it and a slim cornice over it. */
  trim?: boolean;
  /** A body around it: a cabinet with a crown and a plinth, a cooler, a cooler under a worktop. */
  shell?: "cabinet" | "cooler" | "undercounter";
}

export interface GridSpec {
  rows: number;
  cols: number;
  cap: number;
  zones: readonly Pick<StorageZone, "fromRow" | "toRow">[];
  style: GridStyle;
  door: StorageDoor;
  lit: boolean;
  /**
   * The furnishing the premium look adds (sprint 2B.2): a plinth and a cornice, the hardware of a wall rail. It
   * never moves a spot or a bottle. Left out: the furniture exactly as sprint 2A built it.
   */
  detail?: boolean;
}

const ZONE_GAP = 0.34;

export function buildGrid(spec: GridSpec): Built {
  const { rows, cols, cap, style: s } = spec;
  const parts: Part[] = [];
  const W = cols * s.pitchX;
  const zFront = BOTTLE_L / 2 + 0.12;
  const zBack = -(cap - 1) * (BOTTLE_L + DEPTH_GAP) - BOTTLE_L / 2 - 0.1;
  const D = zFront - zBack;
  const zc = (zFront + zBack) / 2;

  // Shelves from the top down. Where a zone ends, an insulated bar sits between two shelves.
  const zoneEnds = new Set(spec.zones.slice(0, -1).map((z) => z.toRow));
  const H = rows * s.pitchY + zoneEnds.size * ZONE_GAP;
  const floor: number[] = []; // the centre line of the shelf under each row
  const bars: number[] = []; // the centre of each zone bar
  let y = H / 2;
  for (let r = 1; r <= rows; r++) {
    y -= s.pitchY;
    floor[r] = y;
    if (zoneEnds.has(r) && r < rows) {
      bars.push(y - ZONE_GAP / 2);
      y -= ZONE_GAP;
    }
  }
  const rest = s.shelves === "rods" ? 0.04 : s.board / 2; // from the shelf's centre line up to what a bottle lies on
  const xOf = (col: number) => (col - (cols + 1) / 2) * s.pitchX;
  const yOf = (row: number) => floor[row]! + rest + BOTTLE_R + AIR;
  const zOf = (index: number) => -(index - 1) * (BOTTLE_L + DEPTH_GAP);

  // ---- what bottles lie on
  for (let r = 1; r <= rows; r++) {
    if (s.shelves === "rods") {
      for (let i = 1; i <= cap; i++)
        for (const dz of [-1, 1])
          parts.push(rod("frame", "x", 0.04, W + 0.1, [0, floor[r]!, zOf(i) + dz]));
    } else {
      parts.push(box("shelf", [W, s.board, D - 0.04], [0, floor[r]!, zc]));
      if (s.shelves === "slide")
        parts.push(
          box("metal", [W, 0.05, 0.04], [0, floor[r]! + s.board / 2 + 0.02, zFront - 0.03]),
        );
    }
  }
  // ---- between bottles
  if (s.dividers > 0)
    for (let c = 1; c < cols; c++)
      parts.push(
        box("shelf", [s.dividers, H - s.board, D * 0.96], [xOf(c) + s.pitchX / 2, s.board / 2, zc]),
      );
  // ---- the bar between two zones, with its own display
  for (const by of bars) {
    parts.push(
      box("frame", [W, ZONE_GAP - s.board - 0.04, D - 0.02], [0, by + s.board / 2 - 0.02, zc]),
    );
    parts.push(
      box("display", [0.5, 0.09, 0.02], [W / 2 - 0.6, by + s.board / 2 - 0.02, zFront - 0.0], {
        soft: true,
      }),
    );
  }

  // ---- the ends, the top, the back
  const sx = W / 2 + s.side / 2;
  const top = H / 2;
  const bottom = -H / 2;
  if (s.sides === "panel") {
    for (const sign of [-1, 1])
      parts.push(box("frame", [s.side, H + s.board, D], [sign * sx, 0, zc]));
    parts.push(box("frame", [W + 2 * s.side, s.board, D], [0, top + s.board / 2, zc]));
  } else if (s.sides === "posts") {
    // open sides, so the depth of the rack is there to be seen: four posts, and a stretcher under every shelf
    for (const sign of [-1, 1])
      for (const z of [zFront - 0.07, zBack + 0.07])
        parts.push(box("frame", [s.side, H + s.board, 0.14], [sign * sx, 0, z]));
    for (const sign of [-1, 1])
      for (let r = 1; r <= rows; r++)
        parts.push(box("frame", [s.side * 0.7, 0.12, D - 0.28], [sign * sx, floor[r]!, zc]));
    for (const sign of [-1, 1])
      parts.push(box("frame", [s.side * 0.7, 0.12, D - 0.28], [sign * sx, top, zc]));
    parts.push(box("frame", [W + 2 * s.side, s.board, D], [0, top + s.board / 2, zc]));
  } else {
    // slender steel: four round posts, a tie front to back under every shelf and at the top
    for (const sign of [-1, 1])
      for (const z of [zFront - 0.05, zBack + 0.05])
        parts.push(rod("frame", "y", 0.05, H + 0.3, [sign * (W / 2 + 0.05), 0, z]));
    for (const sign of [-1, 1])
      for (const ty of [...floor.slice(1), top])
        parts.push(rod("frame", "z", 0.035, D - 0.1, [sign * (W / 2 + 0.05), ty, zc]));
    for (const z of [zFront - 0.05, zBack + 0.05])
      parts.push(rod("frame", "x", 0.035, W + 0.1, [0, top, z]));
  }
  if (s.back)
    parts.push(
      box(
        "back",
        [W + (s.sides === "panel" ? 2 * s.side : 0), H + s.board, 0.04],
        [0, 0, zBack - 0.02],
      ),
    );

  let light: Vec3 | null = null;
  const outerW = W + 2 * s.side;

  // ---- a piece of furniture, not a crate of boards: it stands on a recessed plinth and ends in a slim cornice
  if (s.trim && spec.detail) {
    parts.push(box("frame", [outerW + 0.14, 0.09, D + 0.1], [0, top + s.board + 0.045, zc + 0.03]));
    parts.push(
      box("frame", [outerW - 0.16, 0.3, D - 0.22], [0, bottom - s.board / 2 - 0.15, zc - 0.05]),
    );
  }

  // ---- bodies
  if (s.shell === "cabinet") {
    parts.push(box("frame", [outerW + 0.3, 0.16, D + 0.2], [0, top + s.board + 0.08, zc + 0.05])); // crown
    parts.push(
      box("frame", [outerW - 0.12, 0.5, D - 0.25], [0, bottom - s.board / 2 - 0.25, zc - 0.05]),
    ); // plinth
    parts.push(...doors(spec.door, outerW, H + s.board, 0, zFront + 0.03, sx + s.side / 2, 2));
    light = [0, top - 0.35, zFront - 0.5];
  } else if (s.shell === "cooler" || s.shell === "undercounter") {
    const under = s.shell === "undercounter";
    // the head with the controls, the foot
    parts.push(box("frame", [outerW, 0.3, D], [0, top + s.board + 0.15, zc]));
    parts.push(
      box("trim", [outerW * 0.5, 0.11, 0.03], [0, top + s.board + 0.15, zFront + 0.005], {
        soft: true,
      }),
    );
    parts.push(
      box("display", [0.5, 0.07, 0.02], [0, top + s.board + 0.15, zFront + 0.02], { soft: true }),
    );
    parts.push(
      box(
        "trim",
        [outerW - 0.1, under ? 0.45 : 0.22, D - (under ? 0.5 : 0.2)],
        [0, bottom - s.board / 2 - (under ? 0.225 : 0.11), zc - (under ? 0.25 : 0.1)],
      ),
    );
    const doorH = H + s.board;
    parts.push(
      ...doors(
        spec.door,
        outerW,
        doorH,
        0,
        zFront + 0.03,
        sx + s.side / 2,
        1,
        under ? "top" : "side",
      ),
    );
    light = [0, top - 0.35, zFront - 0.5];
    if (under) {
      // built in: a cabinet front on either side, a stone worktop over all of it, a vent in the toe kick
      const cab = 1.5;
      const topY = top + s.board + 0.3;
      for (const sign of [-1, 1])
        parts.push(
          box(
            "wall",
            [cab, H + s.board + 0.3, D - 0.05],
            [sign * (outerW / 2 + cab / 2 + 0.03), (s.board + 0.3) / 2, zc],
            { soft: true },
          ),
        );
      parts.push(
        box("stone", [outerW + 2 * cab + 0.3, 0.18, D + 0.35], [0, topY + 0.09, zc + 0.1], {
          soft: true,
        }),
      );
      parts.push(
        box(
          "trim",
          [outerW + 2 * cab, 0.45, D - 0.5],
          [0, bottom - s.board / 2 - 0.225, zc - 0.25],
          { soft: true },
        ),
      );
      for (let i = 0; i < 4; i++)
        parts.push(
          box(
            "metal",
            [outerW * 0.6, 0.025, 0.03],
            [0, bottom - s.board / 2 - 0.1 - i * 0.08, zFront - 0.35],
            { soft: true },
          ),
        );
    }
  }
  // ---- light strips: one under the top, one under each zone bar
  let interior: Built["interior"];
  if (spec.lit || s.shell === "cooler" || s.shell === "undercounter" || s.shell === "cabinet") {
    const edges = [top, ...bars, bottom];
    interior = {
      halfWidth: W / 2,
      zones: edges.slice(0, -1).map((from, i) => ({
        top: from - (i === 0 ? 0 : ZONE_GAP / 2),
        bottom: edges[i + 1]! + (i === edges.length - 2 ? 0 : ZONE_GAP / 2),
        strip: i === 0 ? 0 : 1,
      })),
    };
    if (light === null) light = [0, top - 0.35, zFront - 0.5];
    parts.push(box("glow", [W * 0.86, 0.03, 0.06], [0, top - 0.04, zFront - 0.3], { soft: true }));
    for (const by of bars)
      parts.push(
        box("glowB", [W * 0.86, 0.03, 0.06], [0, by - ZONE_GAP / 2 + 0.05, zFront - 0.3], {
          soft: true,
        }),
      );
  }

  return {
    parts,
    poseOf: (row, col, index) => ({ position: [xOf(col), yOf(row), zOf(index)], lie: "z" }),
    light,
    ...(interior ? { interior } : {}),
  };
}

/**
 * A door. Glass: a closed pane in a frame, with a handle; it is drawn but never in the way of a tap (the scene
 * does not let it catch one). Solid: shown standing open at a right angle, or nothing behind it could be seen.
 */
function doors(
  door: StorageDoor,
  width: number,
  height: number,
  yc: number,
  z: number,
  edgeX: number,
  leaves: 1 | 2,
  handle: "side" | "top" = "side",
): Part[] {
  if (door === "none") return [];
  const out: Part[] = [];
  const soft = { soft: true };
  if (door === "glass") {
    const f = 0.14;
    out.push(box("glass", [width - 2 * f, height - 2 * f, 0.04], [0, yc, z + 0.04], soft));
    for (const sign of [-1, 1]) {
      out.push(box("frame", [f, height, 0.09], [sign * (width / 2 - f / 2), yc, z + 0.045], soft));
      out.push(
        box(
          "frame",
          [width - 2 * f, f, 0.09],
          [0, yc + sign * (height / 2 - f / 2), z + 0.045],
          soft,
        ),
      );
    }
    if (leaves === 2)
      out.push(box("frame", [f * 0.8, height - 2 * f, 0.09], [0, yc, z + 0.045], soft));
    out.push(
      handle === "top"
        ? rod("metal", "x", 0.04, width * 0.7, [0, yc + height / 2 - f - 0.12, z + 0.2], soft)
        : rod(
            "metal",
            "y",
            0.04,
            Math.min(height * 0.55, 3),
            [width / 2 - f - 0.12, yc, z + 0.2],
            soft,
          ),
    );
    return out;
  }
  // solid: each leaf swung out to 90 degrees on its own side
  const leaf = width / leaves;
  for (const sign of leaves === 2 ? [-1, 1] : [-1]) {
    out.push(box("frame", [0.1, height, leaf], [sign * (edgeX + 0.05), yc, z + leaf / 2], soft));
    out.push(
      rod(
        "metal",
        "y",
        0.035,
        Math.min(height * 0.4, 2),
        [sign * (edgeX - 0.08), yc, z + leaf - 0.2],
        soft,
      ),
    );
  }
  return out;
}

export const GRID_STYLES: Partial<Record<StorageTemplateId, GridStyle>> = {
  // wooden boards all round: a shelf under every row, an upright between every two bottles
  rack_classic: {
    pitchX: 1.04,
    pitchY: 1.08,
    shelves: "board",
    board: 0.11,
    dividers: 0.07,
    sides: "panel",
    side: 0.16,
    back: true,
    trim: true,
  },
  // the same carpentry, open at the ends so its depth shows, and no back: light falls through to the second row
  rack_double_depth: {
    pitchX: 1.04,
    pitchY: 1.1,
    shelves: "board",
    board: 0.12,
    dividers: 0.07,
    sides: "posts",
    side: 0.16,
    back: false,
  },
  // steel rods only: bottles lie on two thin rails, nothing between them
  rack_metal: {
    pitchX: 1.0,
    pitchY: 1.06,
    shelves: "rods",
    board: 0.08,
    dividers: 0,
    sides: "rodposts",
    side: 0.1,
    back: false,
  },
  // display shelving: thick shelves, room above each bottle, no uprights between
  shelving_open: {
    pitchX: 1.1,
    pitchY: 1.42,
    shelves: "board",
    board: 0.16,
    dividers: 0,
    sides: "panel",
    side: 0.18,
    back: false,
  },
  cabinet_closed: {
    pitchX: 1.04,
    pitchY: 1.08,
    shelves: "board",
    board: 0.1,
    dividers: 0.06,
    sides: "panel",
    side: 0.2,
    back: true,
    shell: "cabinet",
  },
  // neutral: thin boards, a plain grid, nothing else
  rack_generic: {
    pitchX: 1.0,
    pitchY: 1.04,
    shelves: "board",
    board: 0.07,
    dividers: 0.05,
    sides: "panel",
    side: 0.07,
    back: false,
  },
  cooler_single: {
    pitchX: 1.02,
    pitchY: 1.1,
    shelves: "slide",
    board: 0.1,
    dividers: 0,
    sides: "panel",
    side: 0.24,
    back: true,
    shell: "cooler",
  },
  cooler_dual: {
    pitchX: 1.02,
    pitchY: 1.1,
    shelves: "slide",
    board: 0.1,
    dividers: 0,
    sides: "panel",
    side: 0.24,
    back: true,
    shell: "cooler",
  },
  cooler_undercounter: {
    pitchX: 1.02,
    pitchY: 1.08,
    shelves: "slide",
    board: 0.1,
    dividers: 0,
    sides: "panel",
    side: 0.2,
    back: true,
    shell: "undercounter",
  },
};

// ================================================================================================
// BINS: compartments that each hold a loose pile
// ================================================================================================

export type BinShape = "cube" | "diamond" | "crate";
export interface BinsSpec {
  rows: number;
  cols: number;
  cap: number;
  shape: BinShape;
}

/** Distance between two bottles' axes in a pile. */
const PILE = 2 * BOTTLE_R + AIR;

/** How a crate of `cap` bottles is packed: so many across, so many layers. */
export function crateGrid(cap: number): { across: number; layers: number } {
  const layers = cap <= 3 ? 1 : cap <= 8 ? 2 : 3;
  return { across: Math.ceil(cap / layers), layers };
}

export function buildBins(spec: BinsSpec): Built {
  const { rows, cols, cap, shape } = spec;
  const parts: Part[] = [];
  const D = BOTTLE_L + 0.3;
  const zc = 0.02;
  const pose = (x: number, y: number): Pose => ({ position: [x, y, 0], lie: "z" });

  if (shape === "diamond") {
    // A lattice of two sets of diagonal boards. Every opening is a square standing on a corner: a diamond.
    const k = Math.ceil(Math.sqrt(cap));
    const t = 0.07; // board thickness
    const inset = t / 2 + AIR; // from an edge's centre line to where bottles may be
    const side = k * PILE + 2 * inset;
    const h = side * SQRT1_2; // half a diagonal
    // staggered rows: every opening of the lattice is a compartment
    const cx = (row: number, col: number) => (col - 1) * 2 * h + ((row - 1) % 2) * h;
    const cy = (row: number) => -(row - 1) * h;
    const x0 = -h;
    const x1 = (cols - 1) * 2 * h + (rows > 1 ? h : 0) + h;
    const y1 = h;
    const y0 = -(rows - 1) * h - h;
    const ox = -(x0 + x1) / 2;
    const oy = -(y0 + y1) / 2;
    // the boards: every line x+y = c and x-y = c that carries an edge of a compartment, cut to the frame
    const sums = new Set<number>();
    const diffs = new Set<number>();
    const key = (v: number) => Math.round(v * 1e6) / 1e6;
    for (let r = 1; r <= rows; r++)
      for (let c = 1; c <= cols; c++) {
        const [x, y] = [cx(r, c), cy(r)];
        sums.add(key(x + y + h)).add(key(x + y - h));
        diffs.add(key(x - y + h)).add(key(x - y - h));
      }
    const clip = (c: number, sign: 1 | -1) => {
      // points of y = sign*(c - x) [sum] or y = x - c [diff] inside the frame
      const pts: Array<[number, number]> = [];
      const at = (x: number) => (sign === 1 ? c - x : x - c);
      const xAt = (y: number) => (sign === 1 ? c - y : y + c);
      for (const x of [x0, x1]) if (at(x) >= y0 - 1e-9 && at(x) <= y1 + 1e-9) pts.push([x, at(x)]);
      for (const y of [y0, y1]) if (xAt(y) > x0 + 1e-9 && xAt(y) < x1 - 1e-9) pts.push([xAt(y), y]);
      if (pts.length < 2) return;
      pts.sort((a, b) => a[0] - b[0]);
      const [a, b] = [pts[0]!, pts[pts.length - 1]!];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.2) return;
      parts.push(
        box("shelf", [len, t, D - 0.06], [(a[0] + b[0]) / 2 + ox, (a[1] + b[1]) / 2 + oy, zc], {
          rotZ: (sign === 1 ? -1 : 1) * (Math.PI / 4),
        }),
      );
    };
    for (const c of sums) clip(c, 1);
    for (const c of diffs) clip(c, -1);
    // the frame round the lattice, and a back
    const [w, hh] = [x1 - x0, y1 - y0];
    const f = 0.16;
    for (const sign of [-1, 1]) {
      parts.push(box("frame", [f, hh + 2 * f, D], [sign * (w / 2 + f / 2), 0, zc]));
      parts.push(box("frame", [w, f, D], [0, sign * (hh / 2 + f / 2), zc]));
    }
    parts.push(box("back", [w + 2 * f, hh + 2 * f, 0.04], [0, 0, zc - D / 2 - 0.02]));
    // the pile: a diamond fills from its bottom corner up, row upon row along its two lower edges
    const order: Array<[number, number]> = [];
    for (let u = 0; u < k; u++) for (let v = 0; v < k; v++) order.push([u, v]);
    order.sort(
      (a, b) =>
        a[0] + a[1] - (b[0] + b[1]) || Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]) || a[0] - b[0],
    );
    return {
      parts,
      pileOf: (row, col, rank) => {
        const [u, v] = order[Math.min(rank, order.length - 1)]!;
        const a = inset + (u + 0.5) * PILE;
        const b = inset + (v + 0.5) * PILE;
        return pose(cx(row, col) + ox + (a - b) * SQRT1_2, cy(row) + oy - h + (a + b) * SQRT1_2);
      },
      light: null,
    };
  }

  // cubes and crates: a box per compartment, bottles in rows from the floor up
  const crate = shape === "crate";
  const { across, layers } = crate
    ? crateGrid(cap)
    : { across: Math.ceil(Math.sqrt(cap)), layers: Math.ceil(Math.sqrt(cap)) };
  const t = crate ? 0.06 : 0.09;
  const innerW = across * PILE + 2 * AIR;
  const innerH = layers * PILE + 2 * AIR;
  const gap = crate ? 0.06 : 0.0;
  const [cellW, cellH] = [innerW + 2 * t + gap, innerH + 2 * t + gap];
  const cx = (col: number) => (col - (cols + 1) / 2) * cellW;
  const cy = (row: number) => ((rows + 1) / 2 - row) * cellH;
  for (let r = 1; r <= rows; r++)
    for (let c = 1; c <= cols; c++) {
      const [x, y] = [cx(c), cy(r)];
      if (crate) {
        // a crate: a floor of planks, sides of two slats with a gap between, a slat across the top at front and back
        parts.push(box("frame", [innerW + 2 * t, t, D], [x, y - innerH / 2 - t / 2, zc]));
        for (const sign of [-1, 1]) {
          const slat = innerH * 0.4;
          for (const sy of [-1, 1])
            parts.push(
              box(
                "frame",
                [t, slat, D],
                [x + sign * (innerW / 2 + t / 2), y + sy * (innerH / 2 - slat / 2), zc],
              ),
            );
          // corner battens, proud of the slats
          for (const z of [zc + D / 2 - 0.08, zc - D / 2 + 0.08])
            parts.push(
              box(
                "shelf",
                [t * 1.5, innerH + 2 * t, 0.16],
                [x + sign * (innerW / 2 + t * 0.75), y, z],
              ),
            );
        }
        for (const z of [zc + D / 2 - 0.2, zc - D / 2 + 0.2])
          parts.push(box("frame", [innerW + 2 * t, t, 0.4], [x, y + innerH / 2 + t / 2, z]));
        parts.push(
          box("back", [innerW, innerH * 0.4, 0.05], [x, y - innerH * 0.25, zc - D / 2 + 0.03]),
        );
      } else {
        // a cube: four walls of its own (two cubes side by side show a double wall, as stacked modules do) and a back
        for (const sign of [-1, 1]) {
          parts.push(
            box("frame", [t, innerH + 2 * t, D], [x + sign * (innerW / 2 + t / 2), y, zc]),
          );
          parts.push(box("frame", [innerW, t, D], [x, y + sign * (innerH / 2 + t / 2), zc]));
        }
        parts.push(box("back", [innerW, innerH, 0.04], [x, y, zc - D / 2 + 0.02]));
      }
    }
  return {
    parts,
    pileOf: (row, col, rank) => {
      const j = Math.min(rank, across * layers - 1);
      const [i, layer] = [j % across, Math.floor(j / across)];
      return pose(
        cx(col) + (i - (across - 1) / 2) * PILE,
        cy(row) - innerH / 2 + AIR + BOTTLE_R + layer * PILE,
      );
    },
    light: null,
  };
}

// ================================================================================================
// WALL: bottles along a wall, their labels towards the viewer
// ================================================================================================

export interface WallSpec {
  rows: number;
  cols: number;
  cap: number;
  mount: "pegs" | "rails";
  /** The premium look's hardware (see GridSpec.detail). */
  detail?: boolean;
}

export function buildWall(spec: WallSpec): Built {
  const { rows, cols, cap, mount } = spec;
  const parts: Part[] = [];
  const pitchX = BOTTLE_L + (mount === "pegs" ? 0.6 : 0.5);
  const pitchY = mount === "pegs" ? 1.3 : 1.14;
  const W = cols * pitchX;
  const H = rows * pitchY;
  const cx = (col: number) => (col - (cols + 1) / 2) * pitchX;
  const cy = (row: number) => ((rows + 1) / 2 - row) * pitchY;
  // the wall itself, so that what hangs on it reads as hanging
  parts.push(box("wall", [W + 1.6, H + 1.6, 0.05], [0, 0, -0.03], { soft: true }));
  // two supports under the body of every bottle (its weight is in the body, not the neck)
  const under = [-1.1, 0.2];

  if (mount === "pegs") {
    // a board on the wall, two pegs under every bottle
    const board = 0.12;
    parts.push(box("frame", [W + 0.3, H + 0.3, board], [0, 0, board / 2]));
    const z = board + 0.06 + BOTTLE_R;
    const pegR = 0.06;
    for (let r = 1; r <= rows; r++)
      for (let c = 1; c <= cols; c++)
        for (const dx of under)
          parts.push(
            rod("metal", "z", pegR, 2 * BOTTLE_R + 0.2, [
              cx(c) + dx,
              cy(r) - BOTTLE_R - AIR - pegR,
              board + BOTTLE_R + 0.1,
            ]),
          );
    return {
      parts,
      poseOf: (row, col) => ({ position: [cx(col), cy(row), z], lie: "x" }),
      light: null,
      surface: board,
    };
  }
  // rails: two upright strips per column on the bare wall, and from each a rod under every bottle, long enough for
  // as many bottles as the rail is deep; index 1 is the one in front, furthest from the wall
  const step = 2 * BOTTLE_R + AIR;
  const z1 = 0.08 + BOTTLE_R + (cap - 1) * step; // index 1
  const reach = cap * step + 0.16;
  const rodR = 0.04;
  for (let c = 1; spec.detail && c <= cols; c++) {
    // what makes two strips one rack: a tie across them at the top and at the bottom, and the plates it is
    // screwed to the wall by (all of it flat against the wall, behind the bottles)
    const mid = cx(c) + (under[0]! + under[1]!) / 2;
    const span = under[1]! - under[0]!;
    for (const sign of [-1, 1]) {
      const ty = sign * (H / 2 + 0.01);
      parts.push(box("frame", [span + 0.14, 0.08, 0.04], [mid, ty, 0.02]));
      for (const dx of under) {
        parts.push(box("frame", [0.3, 0.26, 0.03], [cx(c) + dx, ty + sign * 0.16, 0.015]));
        parts.push(
          rod("metal", "z", 0.035, 0.03, [cx(c) + dx, ty + sign * 0.2, 0.04], { soft: true }),
        );
      }
    }
  }
  for (let c = 1; c <= cols; c++)
    for (const dx of under) {
      parts.push(box("frame", [0.14, H + 0.1, 0.05], [cx(c) + dx, 0, 0.025]));
      for (let r = 1; r <= rows; r++) {
        const y = cy(r) - BOTTLE_R - AIR - rodR;
        parts.push(rod("frame", "z", rodR, reach, [cx(c) + dx, y, 0.05 + reach / 2]));
        // the upturned tip that keeps the front bottle from rolling off
        parts.push(
          // low enough that a bottle can be lifted over it without meeting the rod of the row above
          rod("frame", "y", rodR, 0.12, [cx(c) + dx, y + 0.04, 0.05 + reach + rodR], {
            soft: true,
          }),
        );
      }
    }
  return {
    parts,
    poseOf: (row, col, index) => ({
      position: [cx(col), cy(row), z1 - (index - 1) * step],
      lie: "x",
    }),
    light: null,
    surface: 0,
  };
}

// ================================================================================================
// NEUTRAL: a place whose arrangement the app does not know
// ================================================================================================

/**
 * Not furniture: a plate with one tile per compartment, and in each tile a counter per bottle. It says which
 * compartments there are, how many bottles each holds and how many it could hold. It says nothing about depth,
 * about front or back, or about where in a compartment a bottle is, because none of that is known.
 */
export function buildNeutral(spec: { rows: number; cols: number; cap: number }): Built {
  const { rows, cols, cap } = spec;
  const k = Math.ceil(Math.sqrt(cap));
  const step = 2 * TOKEN_R + 0.1;
  const tile = Math.max(1, k * step + 0.2);
  const pitch = tile + 0.16;
  const parts: Part[] = [];
  const cx = (col: number) => (col - (cols + 1) / 2) * pitch;
  const cy = (row: number) => ((rows + 1) / 2 - row) * pitch;
  parts.push(
    box("neutral", [cols * pitch + 0.3, rows * pitch + 0.3, 0.08], [0, 0, -0.04], { soft: true }),
  );
  for (let r = 1; r <= rows; r++)
    for (let c = 1; c <= cols; c++)
      parts.push(box("slot", [tile, tile, 0.04], [cx(c), cy(r), 0.02], { soft: true }));
  const at = (row: number, col: number, rank: number): Vec3 => {
    const j = Math.min(rank, k * k - 1);
    return [
      cx(col) + ((j % k) - (k - 1) / 2) * step,
      cy(row) + ((k - 1) / 2 - Math.floor(j / k)) * step,
      0.1,
    ];
  };
  return {
    parts,
    pileOf: (row, col, rank) => ({ position: at(row, col, rank), lie: "token" }),
    emptyOf: at,
    light: null,
  };
}
