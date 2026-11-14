import {
  checkSlot,
  compareSlots,
  slotKey,
  type ResolvedStorage,
  type SlotAddress,
  type StorageTemplateId,
  type WineType,
} from "@cellr/domain";
import type { BottleShape } from "@/ui/bottle-glyph";
import { FOV } from "../three/layout";
import {
  GRID_STYLES,
  buildBins,
  buildGrid,
  buildNeutral,
  buildWall,
  type BinShape,
  type Built,
} from "./families";
import { COOLER_SHELF, lookFor, type Look } from "./palette";
import { boundsOf, type Part, type Pose, type Vec3 } from "./parts";

/**
 * FROM A STORED PLACE TO SOMETHING THAT CAN BE DRAWN (Smart Cellar 3D, sprint 2A). Pure numbers, no three.js.
 *
 * The domain layer says what a place IS (`ResolvedStorage`: its template, its logical layout, what its index means,
 * whether its arrangement is known). This says what that looks like: which of a few renderers draws it, the parts
 * of the furniture, where each bottle lies. Nothing about spots is decided here: which spots exist, which are
 * valid, and what an index means all come from the layout.
 */

/**
 * Which renderer draws a place:
 * - `legacy`: a place from before templates. It is NOT drawn by this module at all: the existing 3D view
 *   (three/scene.tsx) draws it, exactly as it always has.
 * - `grid`, `bins`, `wall`: the three families.
 * - `neutral`: a place whose arrangement the app does not know. No furniture; compartments and counts.
 */
export type RendererKind = "legacy" | "grid" | "bins" | "wall" | "neutral";

export interface RenderModel {
  renderer: RendererKind;
  /** The template whose furniture is drawn; null when no furniture is (legacy, neutral). */
  templateId: StorageTemplateId | null;
  resolved: ResolvedStorage;
  look: Look;
  parts: readonly Part[];
  built: Built;
  /** The box around the furniture and every spot a bottle can be on. */
  bounds: { min: Vec3; max: Vec3 };
}

const BIN_SHAPES: Partial<Record<StorageTemplateId, BinShape>> = {
  cube_modular: "cube",
  diamond_bins: "diamond",
  crate_storage: "crate",
};
const WALL_MOUNTS: Partial<Record<StorageTemplateId, "pegs" | "rails">> = {
  wall_pegs: "pegs",
  wall_rails: "rails",
};

/** The renderer for a place. Every template of the catalogue has one; the tests hold that to be so. */
export function rendererFor(resolved: ResolvedStorage): RendererKind {
  if (resolved.legacy) return "legacy";
  if (!resolved.arrangementKnown) return "neutral";
  const id = resolved.template.id;
  // the family is the layout's; the template only chooses parameters within it
  if (resolved.layout.family === "grid" && GRID_STYLES[id]) return "grid";
  if (resolved.layout.family === "bins" && BIN_SHAPES[id]) return "bins";
  if (resolved.layout.family === "wall" && WALL_MOUNTS[id]) return "wall";
  // a template this renderer has no parameters for: drawn truthfully rather than as something it is not
  return "neutral";
}

export function buildModel(resolved: ResolvedStorage): RenderModel {
  const renderer = rendererFor(resolved);
  const { rows, cols, cellCapacity: cap, zones } = resolved.structure;
  const id = resolved.template.id;
  const a = resolved.appearance;
  let built: Built;
  let look: Look = lookFor(a);
  if (renderer === "grid") {
    const style = GRID_STYLES[id]!;
    const cooler = style.shell === "cooler" || style.shell === "undercounter";
    // a dual-zone cooler with no zones stored still has two: split in the middle, as it comes out of the box
    const split =
      id === "cooler_dual" && zones.length === 0 && rows >= 2
        ? [
            { fromRow: 1, toRow: Math.floor(rows / 2) },
            { fromRow: Math.floor(rows / 2) + 1, toRow: rows },
          ]
        : zones;
    built = buildGrid({
      rows,
      cols,
      cap,
      zones: split,
      style,
      door: a.door,
      lit: a.lighting !== "none",
    });
    if (cooler) look = lookFor(a, { shelf: COOLER_SHELF, secondGlow: "#ffd7a3" });
  } else if (renderer === "bins") built = buildBins({ rows, cols, cap, shape: BIN_SHAPES[id]! });
  else if (renderer === "wall") built = buildWall({ rows, cols, cap, mount: WALL_MOUNTS[id]! });
  else if (renderer === "neutral") built = buildNeutral({ rows, cols, cap });
  else built = { parts: [], light: null };
  return {
    renderer,
    templateId: renderer === "legacy" || renderer === "neutral" ? null : id,
    resolved,
    look,
    parts: built.parts,
    built,
    // what the camera has to hold: the furniture AND every spot a bottle can be on (on rails and pegs a bottle
    // reaches well past what carries it)
    bounds: boundsOf(built.parts, everyPose(resolved, built)),
  };
}

/** The pose of every spot of the place, full or not. */
function everyPose(resolved: ResolvedStorage, built: Built): Pose[] {
  const at = built.poseOf ?? built.pileOf;
  if (!at) return [];
  const out: Pose[] = [];
  for (const cell of resolved.layout.cells)
    for (let i = 1; i <= cell.capacity; i++) out.push(at(cell.row, cell.col, i));
  return out;
}

// ---- Bottles --------------------------------------------------------------------------------------------------------

/** A bottle to draw: its id, its spot as stored, and what kind of wine it is. */
export interface StoredBottle {
  id: string;
  row: number;
  col: number;
  /** Absent: 1, as every bottle from before depth. */
  index?: number | undefined;
  type: WineType;
  shape: BottleShape;
}

export interface PlacedBottle extends StoredBottle {
  address: SlotAddress;
  pose: Pose;
}

export interface Placement {
  placed: PlacedBottle[];
  /**
   * Bottles whose stored spot is not a spot of this layout. They are NOT drawn somewhere else and NOT dropped
   * silently: the caller shows them as "not on a spot of this place".
   */
  stranded: StoredBottle[];
  /** Where the neutral picture draws a counter for capacity that is not taken. */
  empties: Vec3[];
}

/**
 * Where every bottle lies.
 *
 * Where the index is a physical position (depth, single), a bottle lies exactly on its spot: index 2 behind index
 * 1, each spot its own place in space.
 *
 * Where the index is a mere counter (bins; and every place whose arrangement is not known), bottles are put down
 * by HOW MANY there are in the compartment: the first to the bottom, the next beside it. The stored index only
 * decides the order they are taken in, so the picture is the same every time. It is never drawn as a position: take
 * the bottle with the lowest index out, and the others settle.
 */
export function placeBottles(model: RenderModel, bottles: readonly StoredBottle[]): Placement {
  const { layout } = model.resolved;
  const placed: PlacedBottle[] = [];
  const stranded: StoredBottle[] = [];
  const empties: Vec3[] = [];
  const physical = model.built.poseOf !== undefined;
  const perCell = new Map<string, PlacedBottle[]>();
  const seen = new Set<string>();
  for (const b of bottles) {
    const address: SlotAddress = { row: b.row, col: b.col, index: b.index ?? 1 };
    const key = slotKey(address);
    // a spot that is not one of this layout's, or one a bottle is already drawn on, is never drawn over
    if (checkSlot(layout, address) !== null || seen.has(key)) {
      stranded.push(b);
      continue;
    }
    seen.add(key);
    if (physical) {
      placed.push({
        ...b,
        address,
        pose: model.built.poseOf!(address.row, address.col, address.index),
      });
      continue;
    }
    const cell = `${address.row}:${address.col}`;
    const list = perCell.get(cell) ?? [];
    list.push({ ...b, address, pose: { position: [0, 0, 0], lie: "z" } });
    perCell.set(cell, list);
  }
  if (!physical && model.built.pileOf) {
    for (const cell of layout.cells) {
      const list = (perCell.get(`${cell.row}:${cell.col}`) ?? []).sort((x, y) =>
        compareSlots(x.address, y.address),
      );
      list.forEach((b, rank) => {
        b.pose = model.built.pileOf!(cell.row, cell.col, rank);
        placed.push(b);
      });
      if (model.built.emptyOf)
        for (let rank = list.length; rank < cell.capacity; rank++)
          empties.push(model.built.emptyOf(cell.row, cell.col, rank));
    }
  }
  return { placed, stranded, empties };
}

// ---- Camera ---------------------------------------------------------------------------------------------------------

export interface Framing {
  /** What the camera looks at, and turns about. */
  target: Vec3;
  /** How far back it starts so that the whole place is in view. */
  distance: number;
  /** How far the view may be slid sideways and up and down before the place would be lost. */
  reach: { x: number; y: number };
}

/** The camera starts this far round to the side and above, as the existing view does, so depth reads at once. */
export const START_AZIMUTH = 0.22;
export const START_ELEVATION = 0.11;

/**
 * Where the camera stands for a place of any size and any screen: far enough that its front fits in the height
 * and, seen a little from the side, its front and its depth fit in the width.
 */
export function frameFor(bounds: { min: Vec3; max: Vec3 }, aspect: number): Framing {
  const size = [0, 1, 2].map((i) => Math.max(0.5, bounds.max[i]! - bounds.min[i]!)) as Vec3;
  const target: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const tan = Math.tan((FOV * Math.PI) / 360);
  const fitHeight = size[1] / 2 / tan;
  const seenWidth = size[0] * Math.cos(START_AZIMUTH) + size[2] * Math.sin(START_AZIMUTH);
  const fitWidth = seenWidth / 2 / (tan * Math.max(0.2, aspect));
  return {
    target,
    distance: Math.max(fitHeight, fitWidth) * 1.14 + size[2] / 2,
    reach: { x: size[0] / 2, y: size[1] / 2 },
  };
}

// ---- Quality --------------------------------------------------------------------------------------------------------

/**
 * How finely bottles are drawn. A full rack of 30 x 30 is 900 bottles; drawn as finely as 40 are, that is over two
 * million triangles under an expensive glass, which a phone cannot turn smoothly. Correctness never changes with
 * the level: every bottle is still there, on its spot, and can still be picked. Only roundness and gloss do.
 */
export type Quality = "high" | "balanced" | "low";

export interface QualitySpec {
  /** Segments round a bottle. */
  radial: number;
  /** Clear-coated glass (costly) or plain glossy glass. */
  clearcoat: boolean;
  /** The soft shadow under each bottle. */
  shadows: boolean;
  /** Softened edges on the furniture. */
  rounded: boolean;
  /** The sharpest the picture is drawn, in device pixels per CSS pixel. */
  maxDpr: number;
}

export const QUALITY: Readonly<Record<Quality, QualitySpec>> = {
  high: { radial: 32, clearcoat: true, shadows: true, rounded: true, maxDpr: 2 },
  balanced: { radial: 18, clearcoat: false, shadows: true, rounded: false, maxDpr: 1.5 },
  low: { radial: 10, clearcoat: false, shadows: false, rounded: false, maxDpr: 1.25 },
};

/** The level for a scene: by how much there is to draw, a step lower on a small phone. */
export function qualityFor(bottles: number, lowPower: boolean): Quality {
  const byCount: Quality = bottles <= 120 ? "high" : bottles <= 450 ? "balanced" : "low";
  if (!lowPower) return byCount;
  return byCount === "high" ? "balanced" : "low";
}

/** One step down, for when frames come too slowly. Null at the bottom. */
export const lowerQuality = (q: Quality): Quality | null =>
  q === "high" ? "balanced" : q === "balanced" ? "low" : null;
