import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BottleShape } from "@/ui/bottle-glyph";
import { BOTTLE_LENGTH, SHAPES, capsulePoints, lathePoints } from "../three/layout";
import { brushedTexture, contactShadowTexture, woodTexture } from "../three/materials";
import type { PlacedBottle, QualitySpec, RenderModel } from "./model";
import { PAPER_COLOUR, foilLook, paperLook, placeGlass } from "./bottle-look";
import type { Fidelity, MaterialRole, SurfaceSpec } from "./palette";
import { BOTTLE_L, BOTTLE_R, TOKEN_R, TOKEN_T, boundsOf, type Part, type Pose } from "./parts";
import {
  brushedMetalTexture,
  distantLabelTexture,
  fineWoodTexture,
  glassSheenTexture,
  haloTexture,
  softShadowTexture,
  speckleTexture,
} from "./textures";

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

/**
 * A material for a surface. Classic: a small procedural grain as its colour, as sprint 2A drew it. Premium: a finer
 * picture as colour and (at the highest level of detail) as relief, and the surface takes a tone from each corner
 * of its geometry (`vertexColors`): that is where the darkness at the back of a compartment, the difference
 * between two boards and the light of a strip come from, without one more light or one more draw call.
 */
export function materialFor(
  spec: SurfaceSpec,
  fidelity: Fidelity = "classic",
  relief = false,
): THREE.Material {
  const premium = fidelity === "premium";
  if (spec.kind === "glass")
    return new THREE.MeshStandardMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: 0,
      envMapIntensity: spec.env,
      transparent: true,
      opacity: spec.opacity ?? 0.15,
      depthWrite: false,
      // premium: the room lies in the pane as two soft bands, and the pane is clear between them
      ...(premium ? { map: glassSheenTexture() } : {}),
    });
  const map = premium
    ? spec.kind === "wood"
      ? fineWoodTexture()
      : spec.kind === "brushed"
        ? brushedMetalTexture()
        : null
    : spec.kind === "wood"
      ? woodTexture()
      : spec.kind === "brushed"
        ? brushedTexture()
        : null;
  const bump =
    premium && relief && spec.relief
      ? spec.relief === "grain"
        ? fineWoodTexture()
        : spec.relief === "brushed"
          ? brushedMetalTexture()
          : speckleTexture()
      : null;
  return new THREE.MeshStandardMaterial({
    color: spec.color,
    map,
    roughness: spec.roughness,
    metalness: spec.metalness,
    envMapIntensity: spec.env,
    ...(bump ? { bumpMap: bump, bumpScale: spec.reliefDepth ?? 0.5 } : {}),
    // light itself is not shaded
    ...(premium && spec.kind !== "glow" ? { vertexColors: true } : {}),
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

/** A number in 0..1 from a part's place: the same for the same part every time, different for its neighbour. */
function partSeed(part: Part, salt: number): number {
  const n =
    Math.sin(part.pos[0] * 12.9898 + part.pos[1] * 78.233 + part.pos[2] * 37.719 + salt * 4.1414) *
    43758.5453;
  return n - Math.floor(n);
}

/** How wide the fine pictures are in the scene: the wood runs 4 units before it repeats, and is 2 units across. */
const GRAIN = { along: 4, across: 2 };

/**
 * One part of the premium look. Three things the classic one does not have:
 *
 * - THE GRAIN IS LAID BY THE PART'S OWN MEASURE, not by its faces' own 0..1: the same scale on a wide shelf and on
 *   a narrow upright, running along each part's length, and begun at a different place on every part, so two
 *   boards never show the same piece of wood side by side.
 * - EVERY PART HAS ITS OWN TONE, a few hundredths lighter or darker than its neighbour, as boards cut from
 *   different planks are.
 * - A TALL PANEL IS CUT INTO SEGMENTS, so that the shading (below) can change along its height.
 */
function premiumPartGeometry(
  part: Part,
  rounded: boolean,
): { geometry: THREE.BufferGeometry; tone: number } {
  let g: THREE.BufferGeometry;
  const size = part.shape === "cyl" ? null : part.size;
  if (part.shape === "cyl") {
    const [r, len] = part.size;
    g = new THREE.CylinderGeometry(r, r, len, 16);
    // brushing runs along a rod
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, (uv.getY(i) * len) / GRAIN.along, uv.getX(i) * 0.5);
    if (part.axis === "x") g.rotateZ(Math.PI / 2);
    else if (part.axis === "z") g.rotateX(Math.PI / 2);
  } else {
    const [w, h, d] = size!;
    const thin = Math.min(w, h, d);
    g =
      rounded && thin >= 0.06
        ? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.035, thin / 3))
        : new THREE.BoxGeometry(w, h, d, 1, Math.min(24, Math.max(1, Math.ceil(h / 0.9))), 1);
  }
  if (g.index) {
    const flat = g.toNonIndexed();
    g.dispose();
    g = flat;
  }
  if (size) {
    // which way the part is long: the grain runs that way
    const along = size[0] >= size[1] && size[0] >= size[2] ? 0 : size[1] >= size[2] ? 1 : 2;
    const [offsetU, offsetV] = [partSeed(part, 1), partSeed(part, 2)];
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const normal = g.getAttribute("normal") as THREE.BufferAttribute;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const n = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i)), Math.abs(normal.getZ(i))];
      const facing = n[0]! >= n[1]! && n[0]! >= n[2]! ? 0 : n[1]! >= n[2]! ? 1 : 2;
      // across the grain: the axis that is neither the grain's nor the face's own; on an end face, the other two
      const others = [0, 1, 2].filter((k) => k !== along);
      const across = facing === along ? others[1]! : others.find((k) => k !== facing)!;
      const lengthwise = facing === along ? others[0]! : along;
      uv.setXY(i, p[lengthwise]! / GRAIN.along + offsetU, p[across]! / GRAIN.across + offsetV);
    }
  }
  q.setFromAxisAngle(AXIS_Z, part.rotZ ?? 0);
  g.applyMatrix4(m4.compose(v3.set(...part.pos), q, ONE));
  return { geometry: g, tone: 0.93 + partSeed(part, 3) * 0.14 };
}

/**
 * WHERE THE LIGHT DOES NOT REACH, AND WHERE A STRIP OF LIGHT DOES, worked out once and written into the corners of
 * the geometry. It costs nothing when a picture is drawn: no extra light, no shadow pass, no draw call.
 *
 * - DEPTH. A compartment is dark at the back. Every corner of the furniture is darkened by how far behind the
 *   front it is: full tone at the front edge, about half at the back.
 * - A LIT CABINET. Inside it, each zone takes the colour of its own strip, strongest just under the strip and
 *   fading down the zone: two zones lit by two colours are two areas at a glance.
 */
export interface Shading {
  /** The furniture's front and back (z), or null where there is no depth to shade (a wall, a counter plate). */
  depth: { front: number; back: number } | null;
  /** The lit zones of a cabinet's inside, with the colour each is lit in. */
  zones: Array<{ top: number; bottom: number; halfWidth: number; colour: THREE.Color }>;
}

export function shadingOf(model: RenderModel): Shading {
  const hard = model.parts.filter((p) => !p.soft);
  const flat = model.renderer === "wall" || model.renderer === "neutral" || hard.length === 0;
  let front = -Infinity;
  let back = Infinity;
  for (const p of hard) {
    const half = p.shape === "cyl" ? (p.axis === "z" ? p.size[1] / 2 : p.size[0]) : p.size[2] / 2;
    front = Math.max(front, p.pos[2] + half);
    back = Math.min(back, p.pos[2] - half);
  }
  const lights = model.look.zoneLights;
  const interior = model.built.interior;
  return {
    depth: flat || front - back < 0.5 ? null : { front, back },
    zones:
      interior && model.look.light.intensity > 0
        ? interior.zones.flatMap((z) => {
            const colour = lights[z.strip];
            return colour
              ? [
                  {
                    top: z.top,
                    bottom: z.bottom,
                    halfWidth: interior.halfWidth,
                    colour: new THREE.Color(colour),
                  },
                ]
              : [];
          })
        : [],
  };
}

const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const tint = new THREE.Color();

/** The tone of one corner of the furniture: its part's own tone, the depth it is at, the strip that lights it. */
export function shadeAt(
  shading: Shading,
  x: number,
  y: number,
  z: number,
  tone: number,
  out: THREE.Color,
): THREE.Color {
  let dark = 1;
  if (shading.depth) {
    const { front, back } = shading.depth;
    dark = 0.5 + 0.5 * smoothstep((z - back) / (front - back));
  }
  out.setScalar(tone * dark);
  for (const zone of shading.zones) {
    if (y > zone.top + 1e-6 || y < zone.bottom - 1e-6 || Math.abs(x) > zone.halfWidth + 1e-6)
      continue;
    // strongest just under the strip, a third of that at the foot of the zone; the back of the zone a little less
    const down = (zone.top - y) / Math.max(0.001, zone.top - zone.bottom);
    const reach = (1 - 0.66 * down) * (0.75 + 0.25 * dark);
    // the strip's colour, brought up to full strength (a colour of light, not of paint)
    const peak = Math.max(zone.colour.r, zone.colour.g, zone.colour.b, 0.001);
    tint.copy(zone.colour).multiplyScalar(1 / peak);
    out.r = out.r * (1 - 0.35 * reach) + tint.r * (0.35 + 0.75 * tone) * reach;
    out.g = out.g * (1 - 0.35 * reach) + tint.g * (0.35 + 0.75 * tone) * reach;
    out.b = out.b * (1 - 0.35 * reach) + tint.b * (0.35 + 0.75 * tone) * reach;
    break;
  }
  return out;
}

/** Writes the shading into a part's corners. */
function paint(geometry: THREE.BufferGeometry, shading: Shading, tone: number): void {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const colours = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    shadeAt(shading, pos.getX(i), pos.getY(i), pos.getZ(i), tone, c);
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
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
  const premium = model.fidelity === "premium";
  const byRole = new Map<MaterialRole, Part[]>();
  for (const part of model.parts) byRole.set(part.role, [...(byRole.get(part.role) ?? []), part]);
  const rounded = quality.rounded && model.parts.length <= 160;
  const shading = premium ? shadingOf(model) : null;
  const out: StructureMesh[] = [];
  for (const [role, parts] of byRole) {
    const spec = model.look.surfaces[role];
    const shaded = shading !== null && spec.kind !== "glow" && spec.kind !== "glass";
    const pieces = parts.map((p) => {
      if (!premium) return partGeometry(p, rounded);
      const { geometry, tone } = premiumPartGeometry(p, rounded);
      // light and glass take no shading; everything else does (a part's own tone only where it is wood or stone)
      if (shaded)
        paint(geometry, shading, spec.kind === "wood" || spec.kind === "stone" ? tone : 1);
      return geometry;
    });
    const merged = pieces.length === 1 ? pieces[0]! : mergeGeometries(pieces, false);
    if (pieces.length > 1) for (const p of pieces) p.dispose();
    if (!merged) continue;
    out.push({
      role,
      geometry: owned.add(merged),
      material: owned.add(materialFor(spec, model.fidelity, quality.relief)),
      transparent: spec.kind === "glass",
    });
  }
  return out;
}

/** What is drawn around the furniture that is not furniture: light in the air, and shadow on the floor or wall. */
export interface Ambience {
  /** The glow round every strip of light, as one mesh (each strip in its own colour). Null: not lit, or not drawn. */
  glow: { geometry: THREE.BufferGeometry; material: THREE.Material } | null;
  /** The soft shadow the furniture casts where it stands: on the floor under it, or on the wall behind it. */
  shadow: { geometry: THREE.BufferGeometry; material: THREE.Material } | null;
}

/**
 * Premium only, and only where the level of detail has it: two more draw calls at most, for any place. Neither
 * is a light and neither is a shadow pass: a picture of glow, a picture of shadow.
 */
export function buildAmbience(model: RenderModel, quality: QualitySpec, owned: Owned): Ambience {
  if (model.fidelity !== "premium" || !quality.glow || model.renderer === "neutral")
    return { glow: null, shadow: null };
  // ---- glow: a plane before each strip, as wide as the strip, taller than it
  const strips = model.parts.filter((p) => p.role === "glow" || p.role === "glowB");
  let glow: Ambience["glow"] = null;
  if (strips.length > 0 && model.look.light.intensity > 0) {
    const planes = strips.flatMap((p) => {
      const colour = model.look.zoneLights[p.role === "glow" ? 0 : 1];
      if (!colour) return [];
      const g = new THREE.PlaneGeometry(p.size[0] * 1.06, 1.5).toNonIndexed();
      g.translate(p.pos[0], p.pos[1] - 0.28, p.pos[2] + 0.06);
      const c = new THREE.Color(colour);
      const colours = new Float32Array(g.getAttribute("position").count * 3);
      for (let i = 0; i < colours.length; i += 3) colours.set([c.r, c.g, c.b], i);
      g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
      return [g];
    });
    if (planes.length > 0) {
      const merged = planes.length === 1 ? planes[0]! : mergeGeometries(planes, false);
      if (planes.length > 1) for (const g of planes) g.dispose();
      glow = {
        geometry: owned.add(merged),
        material: owned.add(
          new THREE.MeshBasicMaterial({
            map: haloTexture(),
            vertexColors: true,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
      };
    }
  }
  // ---- shadow: where the furniture stands
  const hard = model.parts.filter((p) => !p.soft);
  const box = boundsOf(hard);
  const [w, h, d] = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  const g =
    model.renderer === "wall"
      ? // on the wall behind the mount, a little below and to the right of it: the light comes from the upper left
        new THREE.PlaneGeometry(w * 1.22 + 0.6, h * 1.14 + 0.5).translate(
          (box.min[0] + box.max[0]) / 2 + 0.14,
          (box.min[1] + box.max[1]) / 2 - 0.22,
          0.004,
        )
      : // on the floor under it, reaching out before it
        new THREE.PlaneGeometry(w * 1.5, d * 2.6)
          .rotateX(-Math.PI / 2)
          .translate(
            (box.min[0] + box.max[0]) / 2,
            box.min[1] + 0.005,
            (box.min[2] + box.max[2]) / 2 + d * 0.25,
          );
  return {
    glow,
    shadow: {
      geometry: owned.add(g),
      material: owned.add(
        new THREE.MeshBasicMaterial({
          color: "#000000",
          map: softShadowTexture(),
          transparent: true,
          opacity: model.renderer === "wall" ? 0.3 : 0.45,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    },
  };
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
  /** The ring round a spot a bottle is about to be put on (sprint 4): the app's own wine red, quiet. */
  target: THREE.Material;
  /**
   * Premium, where shadows are drawn: the soft shadow a bottle lying along a wall throws on that wall (one
   * instanced picture per bottle shape, as the shadow under a bottle on a shelf is). Null otherwise.
   */
  wallShadow: THREE.BufferGeometry | null;
  wallShade: THREE.Material | null;
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
export function buildBottleKit(
  quality: QualitySpec,
  owned: Owned,
  fidelity: Fidelity = "premium",
): BottleKit {
  const premium = fidelity === "premium";
  const look = placeGlass(quality, fidelity);
  const foil = foilLook(fidelity);
  const each = <T>(make: (shape: BottleShape) => T) =>
    Object.fromEntries(BOTTLE_SHAPES.map((s) => [s, make(s)])) as Record<BottleShape, T>;
  const sparse = quality.radial <= 12 ? 3 : quality.radial <= 20 ? 2 : 1;
  const glass = quality.clearcoat
    ? new THREE.MeshPhysicalMaterial({
        color: "#ffffff",
        roughness: look.roughness,
        metalness: look.metalness,
        clearcoat: look.clearcoat,
        clearcoatRoughness: look.clearcoatRoughness,
        ior: 1.5,
        specularIntensity: 1,
        envMapIntensity: look.env,
      })
    : new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: look.roughness,
        metalness: look.metalness,
        envMapIntensity: look.env,
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
    // (white: each bottle's paper colour is its instance's. Premium, where the level has it: the print of a label.)
    paper: owned.add(
      new THREE.MeshStandardMaterial({
        // classic keeps the paper colour it had; premium is white, so that the print shows and the paper's
        // colour is each bottle's own instance colour, as it is on the bottle on display
        color: premium ? "#ffffff" : PAPER_COLOUR,
        roughness: paperLook(fidelity).roughness,
        ...(premium && quality.labels ? { map: distantLabelTexture() } : {}),
      }),
    ),
    foil: owned.add(
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: foil.roughness,
        metalness: foil.metalness,
        envMapIntensity: foil.env,
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
    target: owned.add(
      new THREE.MeshBasicMaterial({
        color: "#8c2b3a",
        toneMapped: false,
        transparent: true,
        opacity: 0.9,
      }),
    ),
    wallShadow:
      premium && quality.shadows
        ? owned.add(new THREE.PlaneGeometry(BOTTLE_L * 1.12, BOTTLE_R * 3.1))
        : null,
    wallShade:
      premium && quality.shadows
        ? owned.add(
            new THREE.MeshBasicMaterial({
              color: "#000000",
              map: softShadowTexture(),
              transparent: true,
              depthWrite: false,
              opacity: 0.3,
              toneMapped: false,
            }),
          )
        : null,
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
