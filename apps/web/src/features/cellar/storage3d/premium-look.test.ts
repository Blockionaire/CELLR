import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  STORAGE_PALETTES,
  STORAGE_TEMPLATES,
  STORAGE_TEMPLATE_IDS,
  type StorageColor,
  type StorageMaterial,
} from "@cellr/domain";

// The existing view's pictures are drawn on a <canvas>, which Node does not have. They are shared by every scene
// and owned by none, so a stand-in changes nothing that is tested here. (The premium pictures of ./textures are
// the real module: without a canvas they are blank, and still the one shared picture each.)
const legacy = vi.hoisted(() => ({ wood: null as unknown, brushed: null as unknown }));
vi.mock("../three/materials", async () => {
  const three = await import("three");
  const wood = new three.Texture();
  const brushed = new three.Texture();
  legacy.wood = wood;
  legacy.brushed = brushed;
  return {
    woodTexture: () => wood,
    brushedTexture: () => brushed,
    contactShadowTexture: () => new three.Texture(),
  };
});
vi.mock("../three/label-texture", () => ({
  LABEL_ASPECT: 640 / 760,
  makeShadowTexture: () => new THREE.Texture(),
}));

import { placeGlass, shownGlass, foilLook, paperLook } from "./bottle-look";
import { fixtureBottles, fixturePlace } from "./fixtures";
import { buildHeroKit, dressHero, lookAt } from "./hero-kit";
import { QUALITY, buildModel, placeBottles, type Quality } from "./model";
import { FIDELITIES, MATERIAL_ROLES, lookFor, type Fidelity } from "./palette";
import {
  Owned,
  buildAmbience,
  buildBottleKit,
  buildStructure,
  materialFor,
  shadeAt,
  shadingOf,
} from "./resources";
import {
  brushedMetalTexture,
  distantLabelTexture,
  fineWoodTexture,
  glassSheenTexture,
  haloTexture,
  sharedTextureCount,
  softShadowTexture,
  speckleTexture,
} from "./textures";

const LEVELS: Quality[] = ["high", "balanced", "low"];
const SHARED = () => [
  fineWoodTexture(),
  brushedMetalTexture(),
  speckleTexture(),
  glassSheenTexture(),
  softShadowTexture(),
  haloTexture(),
  distantLabelTexture(),
];
const modelOf = (id: (typeof STORAGE_TEMPLATE_IDS)[number], fidelity: Fidelity = "premium") =>
  buildModel(fixturePlace({ template: id }), fidelity);

/** Every material and colour the catalogue lets a place have. */
const FINISHES = (Object.keys(STORAGE_PALETTES) as StorageMaterial[]).flatMap((material) =>
  STORAGE_PALETTES[material].map((color) => [material, color] as [StorageMaterial, StorageColor]),
);

describe("the two looks", () => {
  it("are the only two, and premium is what is drawn unless asked otherwise", () => {
    expect(FIDELITIES).toEqual(["classic", "premium"]);
    expect(modelOf("rack_classic").fidelity).toBe("premium");
    expect(buildModel(fixturePlace({ template: "rack_classic" })).fidelity).toBe("premium");
  });

  it("classic: no relief, no painted corners, the existing view's own pictures", () => {
    for (const [material, color] of FINISHES) {
      const look = lookFor(
        { v: 1, material, color, lighting: "warm", door: "none" },
        { fidelity: "classic" },
      );
      for (const role of MATERIAL_ROLES) {
        const spec = look.surfaces[role];
        expect(spec.relief, `${material}/${color}/${role}`).toBeUndefined();
        const made = materialFor(spec, "classic", true) as THREE.MeshStandardMaterial;
        expect(made.vertexColors).toBe(false);
        expect(made.bumpMap).toBeNull();
        if (spec.kind === "wood") expect(made.map).toBe(legacy.wood);
        if (spec.kind === "brushed") expect(made.map).toBe(legacy.brushed);
        made.dispose();
      }
    }
  });

  it("classic builds the furniture of sprint 2A: premium only adds to it, and moves nothing", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const classic = modelOf(id, "classic");
      const premium = modelOf(id, "premium");
      // every classic part is still there, in its place
      const key = (p: (typeof classic.parts)[number]) => JSON.stringify([p.role, p.size, p.pos]);
      const have = new Set(premium.parts.map(key));
      for (const part of classic.parts)
        expect(have.has(key(part)), `${id}: ${key(part)}`).toBe(true);
      // every bottle lies where it lay, to the last digit
      const bottles = fixtureBottles(classic.resolved.layout, "full");
      const a = placeBottles(classic, bottles).placed.map((b) => [b.id, b.pose]);
      const b = placeBottles(premium, bottles).placed.map((b) => [b.id, b.pose]);
      expect(a.length).toBeGreaterThan(0);
      expect(b).toEqual(a);
      expect(premium.resolved.layout).toEqual(classic.resolved.layout);
    }
  });

  it("only the classic rack and the wall rails are furnished further", () => {
    const more = STORAGE_TEMPLATE_IDS.filter(
      (id) => modelOf(id, "premium").parts.length > modelOf(id, "classic").parts.length,
    );
    expect(more.sort()).toEqual(["rack_classic", "wall_rails"]);
  });
});

describe("premium finishes", () => {
  it("every material and colour: numbers a renderer can use, and nothing that is a mirror", () => {
    for (const [material, color] of FINISHES)
      for (const lighting of ["none", "warm", "cool"] as const) {
        const look = lookFor({ v: 1, material, color, lighting, door: "glass" });
        for (const role of MATERIAL_ROLES) {
          const s = look.surfaces[role];
          const where = `${material}/${color}/${role}`;
          expect(s.color, where).toMatch(/^#[0-9a-f]{6}$/i);
          expect(s.roughness, where).toBeGreaterThanOrEqual(0);
          expect(s.roughness, where).toBeLessThanOrEqual(1);
          expect(s.metalness, where).toBeGreaterThanOrEqual(0);
          expect(s.metalness, where).toBeLessThanOrEqual(1);
          // a metal that is fully metal is never polished: the room is a soft streak in it
          if (s.metalness >= 0.9) expect(s.roughness, where).toBeGreaterThanOrEqual(0.3);
        }
      }
  });

  it("wood wears its grain, blackened steel is paint over metal, stainless and brass are brushed", () => {
    const of = (material: StorageMaterial, color: StorageColor) =>
      lookFor({ v: 1, material, color, lighting: "none", door: "none" }).surfaces.frame;
    for (const color of STORAGE_PALETTES.wood) {
      const wood = of("wood", color);
      expect(wood).toMatchObject({ kind: "wood", metalness: 0, relief: "grain" });
      expect(wood.env).toBeLessThan(0.5);
    }
    for (const color of ["black", "graphite"] as const) {
      const coat = of("metal", color);
      expect(coat.metalness).toBeLessThan(0.5);
      expect(coat.roughness).toBeGreaterThan(0.5);
      expect(coat.relief).toBe("speckle");
    }
    for (const color of ["stainless", "brass"] as const)
      expect(of("metal", color)).toMatchObject({
        kind: "brushed",
        metalness: 1,
        relief: "brushed",
      });
  });

  it("glass stays see-through: the bottles behind a door are the point of it", () => {
    const glass = lookFor({
      v: 1,
      material: "metal",
      color: "black",
      lighting: "cool",
      door: "glass",
    }).surfaces.glass;
    expect(glass.opacity).toBeGreaterThan(0.14); // more of a pane than it was
    expect(glass.opacity).toBeLessThanOrEqual(0.4); // and never a wall
    const made = materialFor(glass, "premium") as THREE.MeshStandardMaterial;
    expect(made.transparent).toBe(true);
    expect(made.depthWrite).toBe(false);
    expect(made.map).toBe(glassSheenTexture());
    expect(made.vertexColors).toBe(false);
    made.dispose();
  });

  it("two zones are lit apart, the upper cooler than the lower, whatever light was chosen", () => {
    for (const lighting of ["warm", "cool"] as const) {
      const place = fixturePlace({ template: "cooler_dual", appearance: { lighting } });
      const [upper, lower] = buildModel(place).look.zoneLights;
      expect(upper).not.toBeNull();
      expect(lower).not.toBeNull();
      expect(upper).not.toBe(lower);
      const warmth = (hex: string) => {
        const c = new THREE.Color(hex);
        return c.r - c.b;
      };
      expect(warmth(lower!)).toBeGreaterThan(warmth(upper!));
    }
    // not lit: no light is invented
    const dark = buildModel(
      fixturePlace({ template: "cooler_dual", appearance: { lighting: "none" } }),
    );
    expect(dark.look.zoneLights).toEqual([null, null]);
    expect(shadingOf(dark).zones).toEqual([]);
    // one zone: one light, the chosen one
    const [a, b] = modelOf("cooler_single").look.zoneLights;
    expect(a).toBe(b);
  });

  it("a material can wear its grain as relief when asked; the painted corners are every level's", () => {
    const spec = lookFor({
      v: 1,
      material: "wood",
      color: "walnut",
      lighting: "none",
      door: "none",
    }).surfaces.frame;
    const fine = materialFor(spec, "premium", true) as THREE.MeshStandardMaterial;
    const plain = materialFor(spec, "premium", false) as THREE.MeshStandardMaterial;
    expect(fine.bumpMap).toBe(fineWoodTexture());
    expect(plain.bumpMap).toBeNull();
    expect(fine.map).toBe(fineWoodTexture());
    expect(plain.map).toBe(fineWoodTexture());
    expect(fine.vertexColors && plain.vertexColors).toBe(true);
    // no level asks for relief today: its cost was measured and its gain was small (see QualitySpec.relief)
    for (const level of LEVELS) expect(QUALITY[level].relief).toBe(false);
    fine.dispose();
    plain.dispose();
  });
});

describe("shading written into the furniture", () => {
  const c = new THREE.Color();

  it("a compartment is dark at the back: full tone at the front, about half behind", () => {
    const shading = shadingOf(modelOf("rack_classic"));
    expect(shading.depth).not.toBeNull();
    const { front, back } = shading.depth!;
    expect(shadeAt(shading, 0, 0, front, 1, c).r).toBeCloseTo(1, 5);
    expect(shadeAt(shading, 0, 0, back, 1, c).r).toBeCloseTo(0.5, 5);
    let last = 0;
    for (let i = 0; i <= 10; i++) {
      const r = shadeAt(shading, 0, 0, back + ((front - back) * i) / 10, 1, c).r;
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });

  it("what hangs on a wall has no depth to shade, and neither has the neutral picture", () => {
    for (const id of ["wall_pegs", "wall_rails"] as const)
      expect(shadingOf(modelOf(id)).depth).toBeNull();
    const unknown = buildModel({
      ...fixturePlace({ template: "rack_classic" }),
      arrangementKnown: false,
    });
    expect(unknown.renderer).toBe("neutral");
    expect(shadingOf(unknown)).toEqual({ depth: null, zones: [] });
  });

  it("a part's own tone is kept, and is never far from the colour it was given", () => {
    const shading = shadingOf(modelOf("rack_classic"));
    const { front } = shading.depth!;
    expect(shadeAt(shading, 0, 0, front, 0.93, c).r).toBeCloseTo(0.93, 5);
    expect(shadeAt(shading, 0, 0, front, 1.07, c).r).toBeCloseTo(1.07, 5);
  });

  it("each zone of a lit cabinet takes its own strip's colour, strongest under the strip", () => {
    const model = modelOf("cooler_dual");
    const shading = shadingOf(model);
    expect(shading.zones).toHaveLength(2);
    const [upper, lower] = shading.zones;
    expect(upper!.top).toBeGreaterThan(lower!.top);
    expect(upper!.bottom).toBeGreaterThanOrEqual(lower!.top);
    const z = shading.depth!.front - 0.5;
    const warmth = (y: number) => {
      shadeAt(shading, 0, y, z, 1, c);
      return c.r - c.b;
    };
    // the lower zone is the warmer one
    expect(warmth(lower!.top - 0.2)).toBeGreaterThan(warmth(upper!.top - 0.2));
    // brighter under the strip than at the foot of the zone
    const bright = (y: number) => {
      shadeAt(shading, 0, y, z, 1, c);
      return c.r + c.g + c.b;
    };
    expect(bright(upper!.top - 0.05)).toBeGreaterThan(bright(upper!.bottom + 0.05));
    // outside the inside (the shell's flank), no strip lights it
    shadeAt(shading, upper!.halfWidth + 0.5, upper!.top - 0.2, z, 1, c);
    expect(c.r).toBeCloseTo(c.b, 5);
  });

  for (const id of STORAGE_TEMPLATE_IDS)
    it(`${id}: every corner of every surface has a tone, and none is black or blown out`, () => {
      const model = modelOf(id);
      const owned = new Owned();
      const limit = shadingOf(model).zones.length > 0 ? 1.8 : 1.08;
      for (const mesh of buildStructure(model, QUALITY.high, owned)) {
        const spec = model.look.surfaces[mesh.role];
        const colour = mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
        if (spec.kind === "glow" || spec.kind === "glass") {
          expect(colour, mesh.role).toBeUndefined();
          continue;
        }
        expect(colour, mesh.role).toBeDefined();
        expect(colour!.count).toBe(mesh.geometry.getAttribute("position").count);
        // every value of every corner, held by its lowest and its highest (the same check as one expect per value,
        // which made this file take ~27 s on a loaded machine and time out)
        let low = Infinity;
        let high = -Infinity;
        for (const v of colour!.array as Float32Array) {
          if (v < low) low = v;
          if (v > high) high = v;
        }
        // unlit: between the back's half tone and a light board's 1.07; under a strip of light, up to 1.8
        expect(low, mesh.role).toBeGreaterThan(0.4);
        expect(high, mesh.role).toBeLessThan(limit);
      }
      owned.dispose();
    });

  it("two boards of one rack are not the same piece of wood: tones differ, and the grain starts elsewhere", () => {
    const model = modelOf("rack_classic");
    const owned = new Owned();
    const frame = buildStructure(model, QUALITY.high, owned).find((m) => m.role === "frame")!;
    const colour = frame.geometry.getAttribute("color") as THREE.BufferAttribute;
    const pos = frame.geometry.getAttribute("position") as THREE.BufferAttribute;
    const front = shadingOf(model).depth!.front;
    // tones seen near the front of the furniture, where depth darkens next to nothing
    const tones = new Set<number>();
    for (let i = 0; i < pos.count; i++)
      if (front - pos.getZ(i) < 0.2) tones.add(Math.round(colour.getX(i) * 100));
    expect(tones.size).toBeGreaterThanOrEqual(3);
    for (const t of tones) {
      expect(t).toBeGreaterThanOrEqual(90);
      expect(t).toBeLessThanOrEqual(107);
    }
    owned.dispose();
  });
});

describe("light in the air and shadow on the floor", () => {
  it("two draw calls at most, for any place", () => {
    for (const id of STORAGE_TEMPLATE_IDS)
      for (const level of LEVELS) {
        const owned = new Owned();
        const { glow, shadow } = buildAmbience(modelOf(id), QUALITY[level], owned);
        const drawn = [glow, shadow].filter(Boolean).length;
        expect(drawn).toBeLessThanOrEqual(2);
        expect(owned.live).toBe(drawn * 2);
        if (level === "low") expect(drawn).toBe(0);
        owned.dispose();
        expect(owned.live).toBe(0);
      }
  });

  it("none of it for the classic look, and none for the neutral picture", () => {
    const owned = new Owned();
    for (const id of STORAGE_TEMPLATE_IDS)
      expect(buildAmbience(modelOf(id, "classic"), QUALITY.high, owned)).toEqual({
        glow: null,
        shadow: null,
      });
    const unknown = buildModel({
      ...fixturePlace({ template: "rack_classic" }),
      arrangementKnown: false,
    });
    expect(unknown.renderer).toBe("neutral");
    expect(buildAmbience(unknown, QUALITY.high, owned)).toEqual({ glow: null, shadow: null });
    expect(owned.live).toBe(0);
  });

  it("a glow only where a strip is lit; one mesh however many strips", () => {
    const lit = (id: (typeof STORAGE_TEMPLATE_IDS)[number]) => {
      const owned = new Owned();
      const out = buildAmbience(modelOf(id), QUALITY.high, owned).glow !== null;
      owned.dispose();
      return out;
    };
    expect(lit("cooler_dual")).toBe(true);
    expect(lit("cooler_single")).toBe(true);
    expect(lit("wall_rails")).toBe(false);
    expect(lit("diamond_bins")).toBe(false);
    const owned = new Owned();
    const dark = buildModel(
      fixturePlace({ template: "cooler_dual", appearance: { lighting: "none" } }),
    );
    expect(buildAmbience(dark, QUALITY.high, owned).glow).toBeNull();
    owned.dispose();
  });

  // The furniture's own shading is checked corner by corner above; the glow is not furniture (`buildStructure` gives
  // it no colours), so its corners are checked here: each is exactly the colour of its own zone's light, never black
  // and never anything else (sprint 10 review).
  it("every corner of a glow carries its zone's light colour, and nothing else", () => {
    let checked = 0;
    for (const id of STORAGE_TEMPLATE_IDS) {
      const model = modelOf(id);
      const owned = new Owned();
      const glow = buildAmbience(model, QUALITY.high, owned).glow;
      if (glow) {
        const allowed = new Set(
          model.look.zoneLights.filter(Boolean).map((c) => new THREE.Color(c!).getHexString()),
        );
        const colour = glow.geometry.getAttribute("color") as THREE.BufferAttribute;
        expect(colour.count, id).toBe(glow.geometry.getAttribute("position").count);
        const seen = new Set<string>();
        const c = new THREE.Color();
        for (let i = 0; i < colour.count; i++)
          seen.add(c.setRGB(colour.getX(i), colour.getY(i), colour.getZ(i)).getHexString());
        for (const hex of seen) expect(allowed.has(hex), `${id}: ${hex}`).toBe(true);
        for (const hex of seen) expect(hex, id).not.toBe("000000");
        checked += 1;
      }
      owned.dispose();
    }
    // the coolers and the lit cabinet: the check is not empty
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it("the shadow lies on the floor under furniture, and on the wall behind a wall mount", () => {
    const owned = new Owned();
    const flat = (id: (typeof STORAGE_TEMPLATE_IDS)[number]) => {
      const g = buildAmbience(modelOf(id), QUALITY.high, owned).shadow!.geometry;
      g.computeBoundingBox();
      const size = g.boundingBox!.getSize(new THREE.Vector3());
      return size;
    };
    expect(flat("rack_classic").y).toBeLessThan(0.001); // lies down
    expect(flat("rack_classic").z).toBeGreaterThan(1);
    expect(flat("wall_rails").z).toBeLessThan(0.001); // stands against the wall
    expect(flat("wall_rails").y).toBeGreaterThan(1);
    owned.dispose();
  });
});

describe("who owns the pictures", () => {
  it("each premium picture is made once and shared: asking again returns the same one", () => {
    const first = SHARED();
    const again = SHARED();
    for (let i = 0; i < first.length; i++) expect(again[i]).toBe(first[i]);
    expect(new Set(first).size).toBe(first.length);
    expect(sharedTextureCount()).toBe(first.length);
  });

  it("opening and closing every place at every level frees none of them and makes no more", () => {
    const shared = SHARED();
    let freed = 0;
    for (const t of shared) t.addEventListener("dispose", () => (freed += 1));
    const before = sharedTextureCount();
    for (let round = 0; round < 3; round++)
      for (const id of STORAGE_TEMPLATE_IDS)
        for (const level of LEVELS)
          for (const fidelity of FIDELITIES) {
            const owned = new Owned();
            const model = modelOf(id, fidelity);
            buildStructure(model, QUALITY[level], owned);
            buildAmbience(model, QUALITY[level], owned);
            buildBottleKit(QUALITY[level], owned, fidelity);
            const hero = buildHeroKit(owned, fidelity);
            dressHero(hero, "red", false, QUALITY[level].labels);
            expect(owned.live).toBeGreaterThan(0);
            owned.dispose();
            expect(owned.live).toBe(0);
          }
    expect(freed).toBe(0);
    expect(sharedTextureCount()).toBe(before);
    // 3 rounds x 14 places x 3 levels x 2 looks = 252 full builds: a few seconds alone, more on a loaded machine
  }, 60_000);

  it("a scene's materials point at the shared pictures: no place has a picture of its own", () => {
    const owned = new Owned();
    const shared = new Set<THREE.Texture>(SHARED());
    for (const id of STORAGE_TEMPLATE_IDS)
      for (const mesh of buildStructure(modelOf(id), QUALITY.high, owned)) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        for (const t of [m.map, m.bumpMap])
          if (t) expect(shared.has(t), `${id}/${mesh.role}`).toBe(true);
      }
    owned.dispose();
  });
});

describe("the bottle, in its place and on display", () => {
  it("premium glass is less of a mirror than it was, at every level", () => {
    for (const level of LEVELS) {
      const was = placeGlass(QUALITY[level], "classic");
      const now = placeGlass(QUALITY[level], "premium");
      expect(now.roughness).toBeGreaterThan(was.roughness);
      expect(now.env).toBeLessThan(was.env);
      expect(now.clearcoat).toBe(was.clearcoat); // the level decides the layers, not the look
    }
    expect(shownGlass("premium").roughness).toBeGreaterThan(shownGlass("classic").roughness);
    expect(foilLook("premium").roughness).toBeGreaterThan(foilLook("classic").roughness);
    expect(paperLook("premium").roughness).toBeGreaterThan(paperLook("classic").roughness);
  });

  it("the bottle that leaves its place IS the bottle of the place: the same numbers, both looks, all levels", () => {
    for (const fidelity of FIDELITIES)
      for (const level of LEVELS) {
        const owned = new Owned();
        const rack = buildBottleKit(QUALITY[level], owned, fidelity);
        const hero = buildHeroKit(owned, fidelity);
        dressHero(hero, "red", false, QUALITY[level].labels);
        lookAt(hero, "red", QUALITY[level], 0, 1);
        const glass = rack.glass as THREE.MeshPhysicalMaterial;
        const where = `${fidelity}/${level}`;
        expect(hero.glass.roughness, where).toBeCloseTo(glass.roughness, 6);
        expect(hero.glass.metalness, where).toBeCloseTo(glass.metalness, 6);
        expect(hero.glass.envMapIntensity, where).toBeCloseTo(glass.envMapIntensity, 6);
        expect(hero.glass.clearcoat, where).toBeCloseTo(glass.clearcoat ?? 0, 6);
        const foil = rack.foil as THREE.MeshStandardMaterial;
        expect(hero.foil.roughness, where).toBeCloseTo(foil.roughness, 6);
        expect(hero.foil.metalness, where).toBeCloseTo(foil.metalness, 6);
        // the print on the label seen from afar is the same picture on both, or on neither
        const paper = rack.paper as THREE.MeshStandardMaterial;
        const printed = fidelity === "premium" && QUALITY[level].labels;
        expect(paper.map === distantLabelTexture(), where).toBe(printed);
        expect(hero.paper.map === distantLabelTexture(), where).toBe(printed);
        owned.dispose();
      }
  });

  it("on display it is the finer glass, whatever the level was", () => {
    for (const level of LEVELS) {
      const owned = new Owned();
      const hero = buildHeroKit(owned, "premium");
      lookAt(hero, "red", QUALITY[level], 1, 1);
      expect(hero.glass.roughness).toBeCloseTo(shownGlass("premium").roughness, 6);
      expect(hero.glass.clearcoat).toBeCloseTo(1, 6);
      owned.dispose();
    }
  });

  it("a wall shadow per bottle is one shared geometry and one material, and only where shadows are drawn", () => {
    for (const level of LEVELS) {
      const owned = new Owned();
      const kit = buildBottleKit(QUALITY[level], owned, "premium");
      expect(kit.wallShadow !== null).toBe(QUALITY[level].shadows);
      expect(kit.wallShade !== null).toBe(QUALITY[level].shadows);
      owned.dispose();
      const classic = buildBottleKit(QUALITY[level], owned, "classic");
      expect(classic.wallShadow).toBeNull();
      expect(classic.wallShade).toBeNull();
      owned.dispose();
    }
  });
});

describe("the level of detail changes how it is drawn, never what is there", () => {
  it("the model has no level in it: one model, drawn at any level", () => {
    // buildModel takes no quality at all; the spots, parts and poses are decided before a level is chosen
    expect(buildModel.length).toBeLessThanOrEqual(2);
    for (const id of STORAGE_TEMPLATE_IDS) {
      const model = modelOf(id);
      const bottles = fixtureBottles(model.resolved.layout, "partial");
      const placed = placeBottles(model, bottles).placed;
      // every level draws the same number of surfaces of the same roles
      const roles = LEVELS.map((level) => {
        const owned = new Owned();
        const out = buildStructure(model, QUALITY[level], owned)
          .map((m) => m.role)
          .sort();
        owned.dispose();
        return out;
      });
      expect(roles[1]).toEqual(roles[0]);
      expect(roles[2]).toEqual(roles[0]);
      expect(placed.length).toBeGreaterThan(0);
    }
  });

  it("what a level may switch off is only how fine it looks", () => {
    const keys = Object.keys(QUALITY.high).sort();
    for (const level of LEVELS) expect(Object.keys(QUALITY[level]).sort()).toEqual(keys);
    // nothing in a level names a spot, a bottle or a pose
    for (const key of keys) expect(key).not.toMatch(/slot|spot|pose|pick|bottleId|row|col/i);
    expect(QUALITY.low).toMatchObject({ relief: false, glow: false, labels: false });
    expect(QUALITY.balanced).toMatchObject({ relief: false, glow: true, labels: true });
    expect(QUALITY.high).toMatchObject({ relief: false, glow: true, labels: true });
  });

  it("a place holds what its catalogue entry says, whichever way it is drawn", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      const most = t.rows.default * t.cols.default * t.cellCapacity.default;
      for (const fidelity of FIDELITIES) {
        const model = modelOf(id, fidelity);
        const { placed, stranded } = placeBottles(
          model,
          fixtureBottles(model.resolved.layout, "full"),
        );
        expect(placed.length, `${id}/${fidelity}`).toBe(most);
        expect(stranded.length).toBe(0);
      }
    }
  });
});
