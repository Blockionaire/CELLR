import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

// Pictures drawn on a <canvas>, which Node does not have. They are stand-ins here: what is tested is who owns what.
vi.mock("../three/materials", () => {
  const shared = new THREE.Texture();
  return {
    woodTexture: () => shared,
    brushedTexture: () => shared,
    contactShadowTexture: () => shared,
  };
});
vi.mock("../three/label-texture", () => ({
  LABEL_ASPECT: 640 / 760,
  makeShadowTexture: () => new THREE.Texture(),
}));

import { GLASS, GLASS_TINT } from "../three/layout";
import {
  buildHeroKit,
  dressHero,
  labelBand,
  labelWraps,
  lookAt,
  placeGlass,
  prewarmSet,
  printLabel,
  shadeHero,
} from "./hero-kit";
import { QUALITY, type Quality } from "./model";
import { Owned, buildBottleKit } from "./resources";

const LEVELS: Quality[] = ["high", "balanced", "low"];
const SHAPES = ["bordeaux", "burgundy", "champagne"] as const;
type Thing = THREE.BufferGeometry | THREE.Material | THREE.Texture;
const count = (things: Thing[]) => {
  const freed = { n: 0 };
  for (const t of things) t.addEventListener("dispose", () => (freed.n += 1));
  return freed;
};

describe("the bottle that is taken out: one kit for the life of a scene", () => {
  it("makes a shape's geometry the first time it is looked at, and never again", () => {
    const owned = new Owned();
    const kit = buildHeroKit(owned);
    const base = owned.live;
    const first = kit.geometry("bordeaux");
    expect(owned.live).toBe(base + 4);
    for (let i = 0; i < 50; i++) expect(kit.geometry("bordeaux")).toBe(first);
    expect(owned.live).toBe(base + 4);
    kit.geometry("burgundy");
    kit.geometry("champagne");
    expect(owned.live).toBe(base + 12);
    // a hundred inspections of the three shapes later: not one thing more
    for (let i = 0; i < 100; i++) kit.geometry(SHAPES[i % 3]!);
    expect(owned.live).toBe(base + 12);
    owned.dispose();
  });

  it("releases everything it made when the scene closes", () => {
    const owned = new Owned();
    const kit = buildHeroKit(owned);
    const things: Thing[] = [
      ...SHAPES.flatMap((s) => Object.values(kit.geometry(s))),
      kit.glass,
      kit.liquid,
      kit.paper,
      kit.foil,
      kit.front,
      kit.back,
      kit.contact,
      kit.floor,
      kit.veil,
      kit.contactGeometry,
      kit.floorGeometry,
      kit.veilGeometry,
      kit.blank,
      kit.floor.map!,
    ];
    expect(owned.live).toBe(things.length);
    const freed = count(things);
    owned.dispose();
    expect(freed.n).toBe(things.length);
    expect(owned.live).toBe(0);
  });

  it("does not own the shadow picture it shares with the storage view", () => {
    const owned = new Owned();
    const kit = buildHeroKit(owned);
    const freed = count([kit.contact.map!]);
    owned.dispose();
    expect(freed.n).toBe(0);
  });

  it("a label's own pieces belong to the inspection that made them, and go with it", () => {
    const scene = new Owned();
    buildHeroKit(scene);
    const kept = scene.live;
    for (let i = 0; i < 20; i++) {
      const inspection = new Owned();
      const wraps = labelWraps(SHAPES[i % 3]!, 0.84, 0.7, inspection);
      const freed = count([wraps.front, wraps.back]);
      expect(inspection.live).toBe(2);
      inspection.dispose();
      expect(freed.n).toBe(2);
    }
    expect(scene.live).toBe(kept);
    scene.dispose();
  });

  it("a wide photo of a label wraps further round the glass, but never right round it", () => {
    const arc = (aspect: number) => {
      const owned = new Owned();
      const g = labelWraps("bordeaux", aspect, 0.7, owned).front as THREE.CylinderGeometry;
      const out = g.parameters.thetaLength;
      owned.dispose();
      return out;
    };
    expect(arc(1.4)).toBeGreaterThan(arc(0.84));
    expect(arc(40)).toBeLessThanOrEqual(2.6);
    const band = labelBand("champagne");
    expect(band.to).toBeGreaterThan(band.from);
  });
});

describe("the look of the bottle through the film", () => {
  it("in its place it is the storage view's bottle exactly, at every level of detail", () => {
    for (const level of LEVELS) {
      const owned = new Owned();
      const kit = buildHeroKit(owned);
      const place = buildBottleKit(QUALITY[level], owned).glass as THREE.MeshStandardMaterial & {
        clearcoat?: number;
        clearcoatRoughness?: number;
      };
      dressHero(kit, "red", false);
      lookAt(kit, "red", QUALITY[level], 0, 1);
      expect(kit.glass.roughness, level).toBe(place.roughness);
      expect(kit.glass.metalness, level).toBe(place.metalness);
      expect(kit.glass.envMapIntensity, level).toBe(place.envMapIntensity);
      expect(kit.glass.clearcoat, level).toBe(place.clearcoat ?? 0);
      if (place.clearcoat) expect(kit.glass.clearcoatRoughness).toBe(place.clearcoatRoughness);
      // the same colour as the instance's (white material × the wine's glass colour), and solid
      expect(`#${kit.glass.color.getHexString()}`).toBe(
        `#${new THREE.Color(GLASS.red).getHexString()}`,
      );
      expect(kit.glass.opacity).toBe(1);
      // no printed label yet: the plain paper band, as in the place
      expect(kit.front.opacity).toBe(0);
      expect(kit.back.opacity).toBe(0);
      expect(placeGlass(QUALITY[level]).clearcoat).toBe(QUALITY[level].clearcoat ? 1 : 0);
      owned.dispose();
    }
  });

  it("on display the glass clears to its tint and the printed labels are there", () => {
    const owned = new Owned();
    const kit = buildHeroKit(owned);
    for (const type of ["red", "white", "rose"] as const) {
      dressHero(kit, type, false);
      lookAt(kit, type, QUALITY.balanced, 1, 1);
      expect(`#${kit.glass.color.getHexString()}`).toBe(
        `#${new THREE.Color(GLASS_TINT[type]).getHexString()}`,
      );
      expect(kit.glass.clearcoat).toBe(1);
      expect(kit.glass.opacity).toBeLessThanOrEqual(1);
      expect(kit.front.opacity).toBe(1);
    }
    owned.dispose();
  });

  it("changes smoothly in between: no step in any number of the glass", () => {
    const owned = new Owned();
    const kit = buildHeroKit(owned);
    dressHero(kit, "white", false);
    const read = () => [
      kit.glass.roughness,
      kit.glass.metalness,
      kit.glass.clearcoat,
      kit.glass.envMapIntensity,
      kit.glass.opacity,
      kit.front.opacity,
    ];
    for (const level of LEVELS) {
      lookAt(kit, "white", QUALITY[level], 0, 1);
      let before = read();
      for (let i = 1; i <= 200; i++) {
        lookAt(kit, "white", QUALITY[level], i / 200, 1);
        const now = read();
        now.forEach((v, k) =>
          expect(Math.abs(v - before[k]!), `${level} value ${k} at ${i / 200}`).toBeLessThan(0.011),
        );
        before = now;
      }
    }
    owned.dispose();
  });

  it("a bottle that fades up is see-through as a whole while it does, and only then", () => {
    const owned = new Owned();
    const kit = buildHeroKit(owned);
    dressHero(kit, "red", true);
    expect([kit.liquid, kit.paper, kit.foil].map((m) => m.transparent)).toEqual([true, true, true]);
    lookAt(kit, "red", QUALITY.high, 0.5, 0.25);
    expect([kit.liquid, kit.paper, kit.foil].map((m) => m.opacity)).toEqual([0.25, 0.25, 0.25]);
    expect(kit.glass.opacity).toBeLessThanOrEqual(0.25);
    expect(kit.front.opacity).toBeLessThanOrEqual(0.25);
    // the next bottle, drawn out for real: solid again
    dressHero(kit, "white", false);
    expect([kit.liquid, kit.paper, kit.foil].map((m) => [m.transparent, m.opacity])).toEqual([
      [false, 1],
      [false, 1],
      [false, 1],
    ]);
    owned.dispose();
  });

  it("a label is put on and taken off without leaving anything on the kit", () => {
    const owned = new Owned();
    const kit = buildHeroKit(owned);
    const label = new THREE.Texture();
    printLabel(kit.front, kit, label);
    expect(kit.front.map).toBe(label);
    expect(kit.front.emissiveMap).toBe(label);
    printLabel(kit.front, kit, null);
    expect(kit.front.map).toBe(kit.blank);
    expect(kit.front.emissiveMap).toBe(kit.blank);
    // dressing for the next bottle clears a label that was left on, too
    printLabel(kit.back, kit, label);
    dressHero(kit, "red", false);
    expect(kit.back.map).toBe(kit.blank);
    shadeHero(kit, 0.5, 0.25, 0);
    expect([kit.contact.opacity, kit.floor.opacity, kit.veil.opacity]).toEqual([0.5, 0.25, 0]);
    owned.dispose();
  });
});

describe("warming the shaders up before the first bottle is taken out", () => {
  it("covers the glass with and without its clear coat, the prints and the shadows, and changes nothing of the kit", () => {
    const owned = new Owned();
    const kit = buildHeroKit(owned);
    const before = { clearcoat: kit.glass.clearcoat, transparent: kit.liquid.transparent };
    const set = prewarmSet(kit);
    const materials = set.group.children.map((c) => (c as THREE.Mesh).material as THREE.Material);
    const coats = materials
      .filter((m): m is THREE.MeshPhysicalMaterial => m instanceof THREE.MeshPhysicalMaterial)
      .map((m) => m.clearcoat);
    expect(coats.sort()).toEqual([0, 1]);
    for (const m of [kit.front, kit.contact, kit.floor, kit.veil, kit.liquid, kit.paper, kit.foil])
      expect(materials).toContain(m);
    expect(materials).not.toContain(kit.glass);
    expect({ clearcoat: kit.glass.clearcoat, transparent: kit.liquid.transparent }).toEqual(before);
    owned.dispose();
  });

  it("releases its own copies and nothing of the kit", () => {
    const owned = new Owned();
    const kit = buildHeroKit(owned);
    const set = prewarmSet(kit);
    const all = set.group.children.map((c) => (c as THREE.Mesh).material as THREE.Material);
    const copies = all.filter(
      (m) =>
        ![kit.liquid, kit.paper, kit.foil, kit.front, kit.contact, kit.floor, kit.veil].includes(
          m as never,
        ),
    );
    const mine = count(copies);
    const kits = count([
      kit.glass,
      kit.liquid,
      kit.paper,
      kit.foil,
      kit.front,
      kit.contact,
      kit.floor,
      kit.veil,
    ]);
    set.dispose();
    expect(mine.n).toBe(copies.length);
    expect(copies.length).toBe(5); // the glass twice, two faded ones, the ring of the chosen bottle
    expect(kits.n).toBe(0);
    owned.dispose();
  });
});
