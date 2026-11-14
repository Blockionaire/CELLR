import * as THREE from "three";
import type { WineType } from "@cellr/domain";
import type { BottleShape } from "@/ui/bottle-glyph";
import {
  BOTTLE_LENGTH,
  FOIL,
  GLASS,
  GLASS_CLEAR,
  GLASS_TINT,
  LIQUID,
  SHAPES,
  capsulePoints,
  lathePoints,
  liquidPoints,
} from "../three/layout";
import { makeShadowTexture } from "../three/label-texture";
import { contactShadowTexture } from "../three/materials";
import type { QualitySpec } from "./model";
import { BOTTLE_L, BOTTLE_R } from "./parts";
import type { Owned } from "./resources";

/**
 * The ONE bottle that is taken out to be looked at (Smart Cellar 3D, sprint 2B.1): finer than the bottles in the
 * place (it fills the screen), with clear glass, the wine inside and a printed label. One set of geometries and
 * materials for the whole life of a scene, reused by every inspection: looking at a hundred bottles makes nothing
 * new except each one's label picture, which is released when it goes back.
 *
 * Everything is owned by the `Owned` it is made in. The bottle profiles, colours and shadow pictures are the
 * existing view's (../three): a bottle is the same bottle in both.
 */
export interface HeroGeometry {
  body: THREE.BufferGeometry;
  liquid: THREE.BufferGeometry;
  cap: THREE.BufferGeometry;
  /** The plain paper band the bottle wears in its place. */
  paper: THREE.BufferGeometry;
}

export interface HeroKit {
  /** The geometries of a shape: made the first time that shape is looked at, then kept. */
  geometry(shape: BottleShape): HeroGeometry;
  glass: THREE.MeshPhysicalMaterial;
  liquid: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  foil: THREE.MeshStandardMaterial;
  front: THREE.MeshStandardMaterial;
  back: THREE.MeshStandardMaterial;
  /** Its shadow on the shelf it lies on (the storage view's own), and the pool of shadow under it on display. */
  contact: THREE.MeshBasicMaterial;
  contactGeometry: THREE.BufferGeometry;
  floor: THREE.MeshBasicMaterial;
  floorGeometry: THREE.BufferGeometry;
  /** Between the bottle and the place, only when no still picture of the place could be taken. */
  veil: THREE.MeshBasicMaterial;
  veilGeometry: THREE.BufferGeometry;
  /** What a label is until its picture is ready: one white dot. The shader is the same with or without a picture. */
  blank: THREE.Texture;
}

const PAPER_COLOUR = "#e8dcc2";
/** Segments round the bottle: it is seen large. */
const ROUND = { body: 96, liquid: 48, cap: 64, label: 64 };

/** Where the label band sits on a bottle (along its length). */
export function labelBand(shape: BottleShape): { from: number; to: number; radius: number } {
  const spec = SHAPES[shape];
  return {
    from: 0.16 * BOTTLE_LENGTH,
    to: Math.min(spec.bodyEnd - 0.04, 0.48) * BOTTLE_LENGTH,
    radius: spec.radius + 0.008,
  };
}

export function buildHeroKit(owned: Owned): HeroKit {
  const made = new Map<BottleShape, HeroGeometry>();
  const lathe = (points: Array<[number, number]>, segments: number) =>
    owned.add(
      new THREE.LatheGeometry(
        points.map(([r, y]) => new THREE.Vector2(r, y)),
        segments,
      ),
    );
  const blank = owned.add(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1));
  blank.needsUpdate = true;
  const print = () =>
    owned.add(
      new THREE.MeshStandardMaterial({
        map: blank,
        emissiveMap: blank,
        emissive: "#000000",
        emissiveIntensity: 0,
        color: PAPER_COLOUR,
        roughness: 0.72,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
  return {
    geometry(shape) {
      const had = made.get(shape);
      if (had) return had;
      const band = labelBand(shape);
      const paper = owned.add(
        new THREE.CylinderGeometry(
          band.radius,
          band.radius,
          band.to - band.from,
          ROUND.label,
          1,
          true,
        ),
      );
      paper.translate(0, (band.from + band.to) / 2, 0);
      const g: HeroGeometry = {
        body: lathe(lathePoints(shape), ROUND.body),
        liquid: lathe(liquidPoints(shape), ROUND.liquid),
        cap: lathe(capsulePoints(shape), ROUND.cap),
        paper,
      };
      made.set(shape, g);
      return g;
    },
    glass: owned.add(
      new THREE.MeshPhysicalMaterial({
        color: "#ffffff",
        metalness: 0,
        clearcoat: 1,
        ior: 1.5,
        specularIntensity: 1,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      }),
    ),
    liquid: owned.add(new THREE.MeshStandardMaterial({ roughness: 0.32, envMapIntensity: 0.45 })),
    paper: owned.add(new THREE.MeshStandardMaterial({ color: PAPER_COLOUR, roughness: 0.85 })),
    foil: owned.add(
      new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.75, envMapIntensity: 1.1 }),
    ),
    front: print(),
    back: print(),
    contact: owned.add(
      new THREE.MeshBasicMaterial({
        map: contactShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    ),
    contactGeometry: owned.add(
      new THREE.PlaneGeometry(BOTTLE_R * 2.1, BOTTLE_L * 0.96).rotateX(-Math.PI / 2),
    ),
    floor: owned.add(
      new THREE.MeshBasicMaterial({
        map: owned.add(makeShadowTexture()),
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    ),
    floorGeometry: owned.add(new THREE.CircleGeometry(1, 40)),
    veil: owned.add(
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    ),
    veilGeometry: owned.add(new THREE.PlaneGeometry(1, 1)),
    blank,
  };
}

/**
 * The printed labels' own pieces of cylinder: each wraps just far enough round the glass to keep its picture's
 * proportions; the back label is a little smaller and sits opposite. Made per inspection (a photo of a real
 * label has its own proportions) and released with it.
 */
export function labelWraps(
  shape: BottleShape,
  frontAspect: number,
  backAspect: number,
  owned: Owned,
): { front: THREE.BufferGeometry; back: THREE.BufferGeometry } {
  const band = labelBand(shape);
  const radius = band.radius + 0.004;
  const wrap = (thetaStart: number, thetaLength: number, bottom: number, top: number) => {
    const g = new THREE.CylinderGeometry(
      radius,
      radius,
      top - bottom,
      ROUND.label,
      1,
      true,
      thetaStart,
      thetaLength,
    );
    g.translate(0, (bottom + top) / 2, 0);
    return owned.add(g);
  };
  const height = band.to - band.from;
  const arc = Math.min(2.6, (frontAspect * height) / radius);
  const backHeight = height * 0.84;
  const backArc = Math.min(2.2, (backAspect * backHeight) / radius);
  return {
    front: wrap(-arc / 2, arc, band.from, band.to),
    back: wrap(Math.PI - backArc / 2, backArc, band.from, band.from + backHeight),
  };
}

/** The glass of a bottle as the storage view draws it at a level of detail (resources.ts, buildBottleKit). */
export function placeGlass(quality: QualitySpec) {
  return quality.clearcoat
    ? { roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, env: 1.35 }
    : { roughness: 0.08, metalness: 0.1, clearcoat: 0, clearcoatRoughness: 0.03, env: 1.5 };
}
/** The glass on display. */
const SHOWN_GLASS = {
  roughness: 0.04,
  metalness: 0,
  clearcoat: 1,
  clearcoatRoughness: 0.02,
  env: 1.3,
};

const tint = { place: new THREE.Color(), shown: new THREE.Color() };

/** Sets the kit up for one bottle: its colours, and the look it has in its place. */
export function dressHero(kit: HeroKit, type: WineType, transparent: boolean): void {
  kit.liquid.color.set(LIQUID[type]);
  kit.foil.color.set(FOIL[type]);
  // a bottle that fades up out of its place is see-through as a whole while it does
  for (const m of [kit.liquid, kit.paper, kit.foil]) {
    m.transparent = transparent;
    m.opacity = 1;
  }
  for (const m of [kit.front, kit.back]) {
    m.map = kit.blank;
    m.emissiveMap = kit.blank;
    m.color.set(PAPER_COLOUR);
    m.emissive.set("#000000");
    m.opacity = 0;
  }
}

/**
 * The look of the bottle at one moment of the film. `rise` 0: exactly the storage view's bottle (so the hand-over
 * at either end is the same colour and the same shine, not a jump). `rise` 1: the glass clears to its real tint and
 * the wine and the printed labels show. `opacity`: the whole bottle, for the one that fades up.
 */
export function lookAt(
  kit: HeroKit,
  type: WineType,
  quality: QualitySpec,
  rise: number,
  opacity: number,
): void {
  const from = placeGlass(quality);
  const mix = (a: number, b: number) => a + (b - a) * rise;
  kit.glass.color.lerpColors(tint.place.set(GLASS[type]), tint.shown.set(GLASS_TINT[type]), rise);
  kit.glass.opacity = (1 - GLASS_CLEAR[type] * 0.72 * rise) * opacity;
  kit.glass.roughness = mix(from.roughness, SHOWN_GLASS.roughness);
  kit.glass.metalness = mix(from.metalness, SHOWN_GLASS.metalness);
  kit.glass.clearcoat = mix(from.clearcoat, SHOWN_GLASS.clearcoat);
  kit.glass.clearcoatRoughness = mix(from.clearcoatRoughness, SHOWN_GLASS.clearcoatRoughness);
  kit.glass.envMapIntensity = mix(from.env, SHOWN_GLASS.env);
  for (const m of [kit.liquid, kit.paper, kit.foil]) m.opacity = opacity;
  for (const m of [kit.front, kit.back]) {
    m.opacity = rise * opacity;
    m.emissiveIntensity = 0.16 * rise;
  }
}

/** How dark the three flat helpers are: the shadow on the shelf, the pool at its foot, the veil over the place. */
export function shadeHero(kit: HeroKit, contact: number, floor: number, veil: number): void {
  kit.contact.opacity = contact;
  kit.floor.opacity = floor;
  kit.veil.opacity = veil;
}

/** The colour the place fades towards when no picture of it could be taken. */
export function veilColour(kit: HeroKit, colour: string): void {
  kit.veil.color.set(colour);
}

/** Puts a label's picture on a print (or takes it off again). */
export function printLabel(
  material: THREE.MeshStandardMaterial,
  kit: HeroKit,
  label: THREE.Texture | null,
): void {
  material.map = label ?? kit.blank;
  material.emissiveMap = label ?? kit.blank;
  material.color.set(label ? "#ffffff" : PAPER_COLOUR);
  material.emissive.set(label ? "#ffffff" : "#000000");
}

/**
 * The materials as they will be used, for compiling their shaders before the first bottle is taken out (clear-coated
 * and plain glass, prints, shadows). Copies, on a speck of geometry: nothing of the kit is changed. The caller
 * compiles the group and releases what is returned.
 */
export function prewarmSet(kit: HeroKit): { group: THREE.Group; dispose(): void } {
  const speck = new THREE.PlaneGeometry(0.001, 0.001);
  const coated = kit.glass.clone();
  coated.clearcoat = 1;
  const plain = kit.glass.clone();
  plain.clearcoat = 0;
  const faded = [kit.liquid.clone(), kit.foil.clone()];
  for (const m of faded) m.transparent = true;
  // the ring that marks the chosen bottle when it is back in its place (the storage view's own, resources.ts)
  const ring = new THREE.MeshBasicMaterial({ color: "#d9a441", toneMapped: false });
  const all: THREE.Material[] = [
    coated,
    plain,
    ...faded,
    ring,
    kit.liquid,
    kit.paper,
    kit.foil,
    kit.front,
    kit.contact,
    kit.floor,
    kit.veil,
  ];
  const group = new THREE.Group();
  for (const m of all) group.add(new THREE.Mesh(speck, m));
  return {
    group,
    dispose() {
      speck.dispose();
      coated.dispose();
      plain.dispose();
      for (const m of faded) m.dispose();
      ring.dispose();
    },
  };
}
