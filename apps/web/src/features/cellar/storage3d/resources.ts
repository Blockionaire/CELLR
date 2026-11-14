import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BottleShape } from "@/ui/bottle-glyph";
import { BOTTLE_LENGTH, SHAPES, capsulePoints, lathePoints } from "../three/layout";
import { brushedTexture, contactShadowTexture, woodTexture } from "../three/materials";
import type { PlacedBottle, QualitySpec, RenderModel } from "./model";
import type { MaterialRole, SurfaceSpec } from "./palette";
import { BOTTLE_L, BOTTLE_R, TOKEN_R, TOKEN_T, type Part, type Pose } from "./parts";

/**
 * The three.js side of a place: its furniture as a handful of merged meshes, and the few geometries and materials
 * every bottle shares. Built from the plain numbers of `model.ts`; nothing is downloaded.
 *
 * WHO OWNS WHAT. Everything made here belongs to the `Owned` it was made in and is released by its `dispose()`:
 * a scene that is closed, or rebuilt for another template, gives back all it took. The small grain and shadow
 * pictures of ../three/materials are shared by every scene on the page and are NOT owned here (they are made once
 * and kept, as the existing 3D view keeps them).
 */
export class Owned {
  private items = new Set<{ dispose(): void }>();
  private released = false;
  add<T extends { dispose(): void }>(item: T): T {
    this.items.add(item);
    this.released = false;
    return item;
  }
  /** How many things are held and not given back (0 after dispose). */
  get live(): number {
    return this.released ? 0 : this.items.size;
  }
  /**
   * Gives everything back. Safe to call again, and it then gives back again: three.js quietly takes a geometry or
   * a material up anew when it is drawn after being released (React does exactly that to a scene in development,
   * closing and reopening it once), so the last close must release what was taken up in between.
   */
  dispose(): void {
    for (const item of this.items) item.dispose();
    this.released = true;
  }
}

// ---- Surfaces -------------------------------------------------------------------------------------------------------

/** A material for a surface. Grain comes from a shared procedural picture; its scale is in the geometry's UVs. */
export function materialFor(spec: SurfaceSpec): THREE.Material {
  if (spec.kind === "glass")
    return new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: 0,
      envMapIntensity: spec.env,
      transparent: true,
      opacity: spec.opacity ?? 0.15,
      depthWrite: false,
    });
  const map =
    spec.kind === "wood" ? woodTexture() : spec.kind === "brushed" ? brushedTexture() : null;
  return new THREE.MeshStandardMaterial({
    color: spec.color,
    map,
    roughness: spec.roughness,
    metalness: spec.metalness,
    envMapIntensity: spec.env,
    ...(spec.emissive
      ? { emissive: new THREE.Color(spec.emissive), emissiveIntensity: spec.emissiveIntensity ?? 1 }
      : {}),
  });
}

// ---- Furniture ------------------------------------------------------------------------------------------------------

const AXIS_Z = new THREE.Vector3(0, 0, 1);
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v3 = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

/** One part as a geometry in its place, its grain running along its length at the same scale as every other part. */
function partGeometry(part: Part, rounded: boolean): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (part.shape === "cyl") {
    const [r, len] = part.size;
    g = new THREE.CylinderGeometry(r, r, len, 14);
    if (part.axis === "x") g.rotateZ(Math.PI / 2);
    else if (part.axis === "z") g.rotateX(Math.PI / 2);
  } else {
    const [w, h, d] = part.size;
    const thin = Math.min(w, h, d);
    g =
      rounded && thin >= 0.06
        ? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.03, thin / 3))
        : new THREE.BoxGeometry(w, h, d);
    // grain along the longest side, one repeat per 3 units
    const upright = h > w && h > d;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const long = Math.max(w, h, d) / 3;
    for (let i = 0; i < uv.count; i++) {
      const [u, v] = [uv.getX(i), uv.getY(i)];
      if (upright) uv.setXY(i, v * long, u * 0.6);
      else uv.setXY(i, u * long, v * 0.6);
    }
  }
  if (g.index) {
    const flat = g.toNonIndexed();
    g.dispose();
    g = flat;
  }
  q.setFromAxisAngle(AXIS_Z, part.rotZ ?? 0);
  g.applyMatrix4(m4.compose(v3.set(...part.pos), q, ONE));
  return g;
}

export interface StructureMesh {
  role: MaterialRole;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Glass is drawn after everything else, and never catches a tap. */
  transparent: boolean;
}

/**
 * The furniture: every part of one material merged into ONE mesh, so a place of any size is at most a dozen
 * draw calls, whether it has six shelves or nine hundred slats.
 */
export function buildStructure(
  model: RenderModel,
  quality: QualitySpec,
  owned: Owned,
): StructureMesh[] {
  const byRole = new Map<MaterialRole, Part[]>();
  for (const part of model.parts) byRole.set(part.role, [...(byRole.get(part.role) ?? []), part]);
  const rounded = quality.rounded && model.parts.length <= 160;
  const out: StructureMesh[] = [];
  for (const [role, parts] of byRole) {
    const pieces = parts.map((p) => partGeometry(p, rounded));
    const merged = pieces.length === 1 ? pieces[0]! : mergeGeometries(pieces, false);
    if (pieces.length > 1) for (const p of pieces) p.dispose();
    if (!merged) continue;
    const spec = model.look.surfaces[role];
    out.push({
      role,
      geometry: owned.add(merged),
      material: owned.add(materialFor(spec)),
      transparent: spec.kind === "glass",
    });
  }
  return out;
}

// ---- Bottles --------------------------------------------------------------------------------------------------------

export interface BottleKit {
  body: Record<BottleShape, THREE.BufferGeometry>;
  label: Record<BottleShape, THREE.BufferGeometry>;
  cap: Record<BottleShape, THREE.BufferGeometry>;
  shadow: THREE.BufferGeometry;
  token: THREE.BufferGeometry;
  dot: THREE.BufferGeometry;
  ring: THREE.BufferGeometry;
  glass: THREE.Material;
  paper: THREE.Material;
  foil: THREE.Material;
  shade: THREE.Material;
  counter: THREE.Material;
  marker: THREE.Material;
}

const BOTTLE_SHAPES: BottleShape[] = ["bordeaux", "burgundy", "champagne"];

/** Every other point of a profile, keeping its ends: a bottle that is drawn small needs fewer rings. */
function thin(points: Array<[number, number]>, every: number): Array<[number, number]> {
  if (every <= 1) return points;
  return points.filter((_, i) => i === 0 || i === points.length - 1 || i % every === 0 || i < 6);
}

/**
 * What every bottle of a scene shares: three body shapes at the level's roundness, and four materials in all.
 * A thousand bottles are a dozen draw calls, not a thousand.
 */
export function buildBottleKit(quality: QualitySpec, owned: Owned): BottleKit {
  const each = <T>(make: (shape: BottleShape) => T) =>
    Object.fromEntries(BOTTLE_SHAPES.map((s) => [s, make(s)])) as Record<BottleShape, T>;
  const sparse = quality.radial <= 12 ? 3 : quality.radial <= 20 ? 2 : 1;
  const glass = quality.clearcoat
    ? new THREE.MeshPhysicalMaterial({
        color: "#ffffff",
        roughness: 0.05,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        ior: 1.5,
        specularIntensity: 1,
        envMapIntensity: 1.35,
      })
    : new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 0.08,
        metalness: 0.1,
        envMapIntensity: 1.5,
      });
  return {
    body: each((shape) =>
      owned.add(
        new THREE.LatheGeometry(
          thin(lathePoints(shape), sparse).map(([r, y]) => new THREE.Vector2(r, y)),
          quality.radial,
        ),
      ),
    ),
    label: each((shape) => {
      const spec = SHAPES[shape];
      const from = 0.16 * BOTTLE_LENGTH;
      const to = Math.min(spec.bodyEnd - 0.04, 0.48) * BOTTLE_LENGTH;
      const g = new THREE.CylinderGeometry(
        spec.radius + 0.008,
        spec.radius + 0.008,
        to - from,
        quality.radial,
        1,
        true,
      );
      g.translate(0, (from + to) / 2, 0);
      return owned.add(g);
    }),
    cap: each((shape) =>
      owned.add(
        new THREE.LatheGeometry(
          thin(capsulePoints(shape), sparse).map(([r, y]) => new THREE.Vector2(r, y)),
          Math.max(8, Math.round(quality.radial * 0.7)),
        ),
      ),
    ),
    shadow: owned.add(
      new THREE.PlaneGeometry(BOTTLE_R * 2.1, BOTTLE_L * 0.96).rotateX(-Math.PI / 2),
    ),
    token: owned.add(
      new THREE.CylinderGeometry(TOKEN_R, TOKEN_R, TOKEN_T, 20).rotateX(Math.PI / 2),
    ),
    dot: owned.add(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 10).rotateX(Math.PI / 2)),
    ring: owned.add(new THREE.TorusGeometry(BOTTLE_R + 0.07, 0.035, 8, 40)),
    glass: owned.add(glass),
    paper: owned.add(new THREE.MeshStandardMaterial({ color: "#e8dcc2", roughness: 0.85 })),
    foil: owned.add(
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 0.32,
        metalness: 0.75,
        envMapIntensity: 1.1,
      }),
    ),
    shade: owned.add(
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
      }),
    ),
    counter: owned.add(
      new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5, metalness: 0 }),
    ),
    marker: owned.add(new THREE.MeshBasicMaterial({ color: "#d9a441", toneMapped: false })),
  };
}

/**
 * The bottles as they are drawn: one group per bottle shape (one instanced mesh each), and the counters of a neutral
 * picture apart. THE ORDER IN A GROUP IS THE PICKING TABLE: instance i of a group's mesh is `items[i]`, so a tap that
 * hits instance i chose that bottle and no other.
 */
export interface BottleGroups {
  shapes: Array<[BottleShape, PlacedBottle[]]>;
  tokens: PlacedBottle[];
}
export function bottleGroups(placed: readonly PlacedBottle[]): BottleGroups {
  const byShape = new Map<BottleShape, PlacedBottle[]>();
  const tokens: PlacedBottle[] = [];
  for (const b of placed) {
    if (b.pose.lie === "token") tokens.push(b);
    else {
      const list = byShape.get(b.shape);
      if (list) list.push(b);
      else byShape.set(b.shape, [b]);
    }
  }
  return { shapes: [...byShape.entries()], tokens };
}

// ---- Poses ----------------------------------------------------------------------------------------------------------

/** Lying with the neck towards the viewer. (The bottle is modelled standing on y = 0.) */
const LIE_Z = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
/** Lying along the wall, neck to the right. */
const LIE_X = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2));
const FLAT = new THREE.Quaternion();
const PIVOT = new THREE.Matrix4().makeTranslation(0, -BOTTLE_LENGTH / 2, 0);

/** The matrix that puts a bottle (or a counter) in a pose. */
export function poseMatrix(pose: Pose, out = new THREE.Matrix4()): THREE.Matrix4 {
  v3.set(...pose.position);
  if (pose.lie === "token") return out.compose(v3, FLAT, ONE);
  return out.compose(v3, pose.lie === "z" ? LIE_Z : LIE_X, ONE).multiply(PIVOT);
}

/** Where the ring that marks the chosen bottle goes: round its end in a rack, round its middle on a wall. */
export function markerMatrix(pose: Pose, out = new THREE.Matrix4()): THREE.Matrix4 {
  const [x, y, z] = pose.position;
  if (pose.lie === "x")
    return out.compose(v3.set(x, y, z), q.setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), ONE);
  if (pose.lie === "token")
    return out.compose(
      v3.set(x, y, z + TOKEN_T / 2),
      FLAT,
      v3Scale((TOKEN_R + 0.08) / (BOTTLE_R + 0.07)),
    );
  return out.compose(v3.set(x, y, z + BOTTLE_L / 2 + 0.02), FLAT, ONE);
}
const scaleTmp = new THREE.Vector3();
const v3Scale = (s: number) => scaleTmp.set(s, s, s);
