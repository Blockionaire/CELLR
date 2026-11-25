import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { STORAGE_TEMPLATE_IDS } from "@cellr/domain";

// The grain and shadow pictures are drawn on a <canvas>, which Node does not have. They are shared by every scene
// and owned by none (see resources.ts), so a stand-in changes nothing that is tested here.
vi.mock("../three/materials", () => {
  const shared = new THREE.Texture();
  return {
    woodTexture: () => shared,
    brushedTexture: () => shared,
    contactShadowTexture: () => shared,
  };
});

import { BOTTLE_LENGTH, SHAPES, lathePoints } from "../three/layout";
import { fixtureBottles, fixturePlace } from "./fixtures";
import { QUALITY, buildModel, placeBottles, type Quality } from "./model";
import { MATERIAL_ROLES, PREMIUM_TONES, TONES, shade } from "./palette";
import { BOTTLE_L, BOTTLE_R } from "./parts";
import {
  Owned,
  bottleGroups,
  GHOST_OPACITY,
  buildBottleKit,
  buildGhostBottle,
  buildGhostMaterial,
  ghostRadial,
  buildStructure,
  RING,
  buildKeylineRing,
  buildRingPaint,
  markerMatrix,
  poseMatrix,
  type BottleKit,
  type StructureMesh,
} from "./resources";

const LEVELS: Quality[] = ["high", "balanced", "low"];
const modelOf = (id: (typeof STORAGE_TEMPLATE_IDS)[number]) =>
  buildModel(fixturePlace({ template: id }));

/** Counts what three.js is told to free. */
function watch(owned: Owned, items: Array<THREE.BufferGeometry | THREE.Material>) {
  let freed = 0;
  for (const item of items) item.addEventListener("dispose", () => (freed += 1));
  return () => {
    owned.dispose();
    return freed;
  };
}

/** Every geometry and material a place holds. */
function everything(
  meshes: StructureMesh[],
  kit: BottleKit,
): Array<THREE.BufferGeometry | THREE.Material> {
  return [
    ...meshes.flatMap((m) => [m.geometry, m.material]),
    ...Object.values(kit.body),
    ...Object.values(kit.label),
    ...Object.values(kit.cap),
    ...[kit.shadow, kit.token, kit.dot, kit.ring],
    ...[kit.glass, kit.paper, kit.foil, kit.shade, kit.counter, kit.marker, kit.target],
    // the rings with a keyline (sprint 10)
    ...[kit.targetRing, kit.markerRing, kit.ringPaint],
    // the shadow a bottle throws on a wall (sprint 2B.2): there where shadows are drawn
    ...(kit.wallShadow && kit.wallShade ? [kit.wallShadow, kit.wallShade] : []),
  ];
}

describe("the furniture as meshes", () => {
  for (const id of STORAGE_TEMPLATE_IDS)
    it(`${id}: one mesh per surface, however many parts`, () => {
      const model = modelOf(id);
      const owned = new Owned();
      const meshes = buildStructure(model, QUALITY.high, owned);
      const roles = new Set(model.parts.map((p) => p.role));
      expect(meshes.map((m) => m.role).sort()).toEqual([...roles].sort());
      expect(meshes.length).toBeLessThanOrEqual(MATERIAL_ROLES.length);
      for (const m of meshes) {
        expect(m.geometry.getAttribute("position").count).toBeGreaterThan(0);
        expect(m.transparent).toBe(m.role === "glass");
      }
      owned.dispose();
    });

  it("a place of 900 spots is no more meshes than a place of 6", () => {
    const small = buildStructure(
      buildModel(fixturePlace({ template: "rack_classic", rows: 2, cols: 3 })),
      QUALITY.low,
      new Owned(),
    );
    const large = buildStructure(
      buildModel(fixturePlace({ template: "rack_classic", rows: 30, cols: 30 })),
      QUALITY.low,
      new Owned(),
    );
    expect(large.length).toBe(small.length);
  });

  it("glass stays see-through and never writes depth, so what is behind it is still drawn", () => {
    const owned = new Owned();
    const glass = buildStructure(modelOf("cooler_single"), QUALITY.high, owned).find(
      (m) => m.role === "glass",
    )!;
    expect(glass.material.transparent).toBe(true);
    expect(glass.material.depthWrite).toBe(false);
    owned.dispose();
  });
});

describe("giving back what was taken", () => {
  it("every geometry and material of a place is freed when it closes", () => {
    for (const id of STORAGE_TEMPLATE_IDS)
      for (const level of LEVELS) {
        const owned = new Owned();
        const meshes = buildStructure(modelOf(id), QUALITY[level], owned);
        const kit = buildBottleKit(QUALITY[level], owned);
        const things = everything(meshes, kit);
        expect(owned.live).toBe(things.length);
        const close = watch(owned, things);
        expect(close(), `${id} ${level}`).toBe(things.length);
        expect(owned.live).toBe(0);
        // closing again is safe, and releases again whatever was taken up in between (see Owned.dispose)
        expect(close()).toBe(things.length * 2);
        expect(owned.live).toBe(0);
      }
  });

  it("opening and closing a place fifty times leaves nothing behind", () => {
    let made = 0;
    let freed = 0;
    for (let i = 0; i < 50; i++) {
      const id = STORAGE_TEMPLATE_IDS[i % STORAGE_TEMPLATE_IDS.length]!;
      const level = QUALITY[LEVELS[i % 3]!];
      const owned = new Owned();
      const things = everything(
        buildStructure(modelOf(id), level, owned),
        buildBottleKit(level, owned),
      );
      made += things.length;
      for (const thing of things) thing.addEventListener("dispose", () => (freed += 1));
      owned.dispose();
      expect(owned.live).toBe(0);
    }
    expect(made).toBeGreaterThan(50 * 15);
    expect(freed).toBe(made);
  });

  it("the shared grain pictures are not a place's to free", () => {
    const owned = new Owned();
    const meshes = buildStructure(modelOf("rack_classic"), QUALITY.high, owned);
    const wood = meshes.find((m) => m.role === "frame")!.material as THREE.MeshStandardMaterial;
    let freed = false;
    wood.map!.addEventListener("dispose", () => (freed = true));
    owned.dispose();
    expect(freed).toBe(false);
  });
});

describe("the level of detail", () => {
  it("lower levels draw rounder things with fewer triangles, and the same things", () => {
    const tris = (level: Quality) => {
      const owned = new Owned();
      const kit = buildBottleKit(QUALITY[level], owned);
      const n = kit.body.bordeaux.index!.count / 3;
      owned.dispose();
      return n;
    };
    expect(tris("high")).toBeGreaterThan(tris("balanced"));
    expect(tris("balanced")).toBeGreaterThan(tris("low"));
  });

  it("only the highest level pays for a clear coat on the glass", () => {
    for (const level of LEVELS) {
      const owned = new Owned();
      const kit = buildBottleKit(QUALITY[level], owned);
      expect(kit.glass instanceof THREE.MeshPhysicalMaterial).toBe(level === "high");
      owned.dispose();
    }
  });
});

describe("a bottle in its pose", () => {
  const ends = (m: THREE.Matrix4) =>
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, BOTTLE_L, 0)].map((v) =>
      v.applyMatrix4(m).toArray(),
    );
  const near = (got: number[], want: number[]) =>
    want.forEach((n, i) => expect(got[i]).toBeCloseTo(n, 6));

  it("in a rack it lies along z around its position, neck towards the viewer", () => {
    const [base, neck] = ends(poseMatrix({ position: [2, 3, -4], lie: "z" }));
    near(base!, [2, 3, -4 - BOTTLE_L / 2]);
    near(neck!, [2, 3, -4 + BOTTLE_L / 2]);
  });

  it("on a wall it lies along x around its position, neck to the right", () => {
    const [base, neck] = ends(poseMatrix({ position: [2, 3, 1], lie: "x" }));
    near(base!, [2 - BOTTLE_L / 2, 3, 1]);
    near(neck!, [2 + BOTTLE_L / 2, 3, 1]);
  });

  it("the ring that marks a chosen bottle sits at the end of it that faces the viewer", () => {
    const at = new THREE.Vector3().setFromMatrixPosition(
      markerMatrix({ position: [2, 3, -4], lie: "z" }),
    );
    expect(at.x).toBe(2);
    expect(at.y).toBe(3);
    expect(at.z).toBeGreaterThan(-4 + BOTTLE_L / 2);
  });
});

describe("picking: a tap chooses the bottle under it and no other", () => {
  /** The scene's own bottles, as three.js would hit-test them: one instanced mesh per shape. */
  function stage(id: (typeof STORAGE_TEMPLATE_IDS)[number], overrides = {}) {
    const model = buildModel(fixturePlace({ template: id, ...overrides }));
    const { placed } = placeBottles(model, fixtureBottles(model.resolved.layout, "full"));
    const owned = new Owned();
    const kit = buildBottleKit(QUALITY.low, owned);
    const groups = bottleGroups(placed);
    const meshes = groups.shapes.map(([shape, items]) => {
      const mesh = new THREE.InstancedMesh(kit.body[shape], kit.glass, items.length);
      items.forEach((item, i) => mesh.setMatrixAt(i, poseMatrix(item.pose)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.updateMatrixWorld();
      return { mesh, items };
    });
    const hit = (origin: THREE.Vector3, direction: THREE.Vector3) => {
      const ray = new THREE.Raycaster(origin, direction.normalize());
      const hits = meshes
        .flatMap(({ mesh, items }) =>
          ray
            .intersectObject(mesh)
            .map((h) => ({ distance: h.distance, id: items[h.instanceId!]!.id })),
        )
        .sort((a, b) => a.distance - b.distance);
      return hits[0]?.id ?? null;
    };
    return { placed, groups, hit, owned };
  }
  const TOWARDS = new THREE.Vector3(0, 0, -1);

  it("every bottle is in exactly one group, at the index it is drawn at", () => {
    const { placed, groups } = stage("rack_double_depth");
    const all = groups.shapes.flatMap(([, items]) => items);
    expect(all).toHaveLength(placed.length);
    expect(new Set(all.map((b) => b.id)).size).toBe(placed.length);
    for (const [shape, items] of groups.shapes)
      expect(items.every((b) => b.shape === shape)).toBe(true);
  });

  it("a rack: looking straight at a position hits the bottle on it", () => {
    const { placed, hit, owned } = stage("rack_classic");
    for (const b of placed) {
      const [x, y] = b.pose.position;
      expect(hit(new THREE.Vector3(x, y, 50), TOWARDS.clone())).toBe(b.id);
    }
    owned.dispose();
  });

  it("a double-depth rack: the tap takes the front bottle, never the one behind it", () => {
    const { placed, hit, owned } = stage("rack_double_depth");
    const front = placed.filter((b) => b.address.index === 1);
    expect(front.length).toBeGreaterThan(0);
    for (const b of front) {
      const [x, y] = b.pose.position;
      expect(hit(new THREE.Vector3(x, y, 50), TOWARDS.clone())).toBe(b.id);
    }
    // and with the front one gone, the same tap reaches the one behind
    const back = placed.find((b) => b.address.index === 2)!;
    const { hit: hitAlone, owned: o2 } = (() => {
      const model = buildModel(fixturePlace({ template: "rack_double_depth" }));
      const only = fixtureBottles(model.resolved.layout, "full").filter((x) => x.id === back.id);
      const { placed: p } = placeBottles(model, only);
      const owned = new Owned();
      const kit = buildBottleKit(QUALITY.low, owned);
      const mesh = new THREE.InstancedMesh(kit.body[p[0]!.shape], kit.glass, 1);
      mesh.setMatrixAt(0, poseMatrix(p[0]!.pose));
      mesh.computeBoundingSphere();
      mesh.updateMatrixWorld();
      return {
        owned,
        hit: (o: THREE.Vector3) =>
          new THREE.Raycaster(o, TOWARDS.clone()).intersectObject(mesh)[0] ? p[0]!.id : null,
      };
    })();
    expect(hitAlone(new THREE.Vector3(back.pose.position[0], back.pose.position[1], 50))).toBe(
      back.id,
    );
    owned.dispose();
    o2.dispose();
  });

  it("a wall: a tap on the body of a bottle hits that bottle", () => {
    for (const id of ["wall_pegs", "wall_rails"] as const) {
      const { placed, hit, owned } = stage(id);
      for (const b of placed) {
        // a third of the way along from the base: on the body, where it is widest
        const [x, y] = b.pose.position;
        const got = hit(new THREE.Vector3(x - BOTTLE_L / 4, y, 50), TOWARDS.clone());
        // rails hold bottles one before the other: the one nearest the viewer is what a tap reaches
        const nearest = placed
          .filter(
            (o) =>
              Math.abs(o.pose.position[0] - x) < 0.01 &&
              Math.abs(o.pose.position[1] - y) < BOTTLE_R,
          )
          .sort((a, c) => c.pose.position[2] - a.pose.position[2])[0]!;
        expect(got, `${id} ${b.id}`).toBe(nearest.id);
      }
      owned.dispose();
    }
  });

  it("bins: every bottle of a pile can be reached from the front", () => {
    for (const id of ["cube_modular", "diamond_bins", "crate_storage"] as const) {
      const { placed, hit, owned } = stage(id);
      for (const b of placed) {
        const [x, y] = b.pose.position;
        expect(hit(new THREE.Vector3(x, y, 50), TOWARDS.clone()), `${id} ${b.id}`).toBe(b.id);
      }
      owned.dispose();
    }
  });
});

describe("the placeholder bottle of a free spot (3D Quick Add, sprint 7.2)", () => {
  // a bottle lying towards the viewer, at the origin
  const posed = (g: THREE.BufferGeometry, lie: "z" | "x") => {
    const p = g.clone().applyMatrix4(poseMatrix({ position: [0, 0, 0], lie } as never));
    p.computeBoundingBox();
    return p.boundingBox!;
  };
  // the body of the real bottle at the same level of roundness: what a placeholder must be, and nothing more
  const bottleBody = (radial: number) =>
    new THREE.LatheGeometry(
      thinned(lathePoints("bordeaux")).map(([r, y]) => new THREE.Vector2(r, y)),
      radial,
    );
  const thinned = (points: Array<[number, number]>) =>
    points.filter((_, i) => i === 0 || i === points.length - 1 || i % 3 === 0 || i < 6);

  it("is the outline of a bottle and nothing else: no plus, no icon, no second part", () => {
    for (const radial of [16, 12, 10]) {
      const g = buildGhostBottle(radial);
      const body = bottleBody(radial);
      // exactly the lathe of a bottle: the same vertices and triangles, no boxes merged in front of it
      expect(g.getAttribute("position").count).toBe(body.getAttribute("position").count);
      expect(g.getIndex()!.count).toBe(body.getIndex()!.count);
      // one look for the whole placeholder: no per-vertex colours (the plus was painted that way), no groups
      expect(g.getAttribute("color")).toBeUndefined();
      expect(g.groups).toHaveLength(0);
      // lit like glass (normals kept); no textures (no uvs)
      expect(g.getAttribute("normal")).toBeDefined();
      expect(g.getAttribute("uv")).toBeUndefined();
      // nothing past its neck or beside its body
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y).toBeLessThanOrEqual(BOTTLE_LENGTH + 1e-6);
      expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.max(g.boundingBox!.max.x, -g.boundingBox!.min.x)).toBeLessThanOrEqual(
        SHAPES.bordeaux.radius + 0.02,
      );
      g.dispose();
      body.dispose();
    }
  });

  it("takes a bottle's place exactly, lying towards the viewer and along a wall", () => {
    const g = buildGhostBottle();
    const z = posed(g, "z");
    expect(z.max.z).toBeCloseTo(BOTTLE_L / 2, 2);
    expect(z.min.z).toBeCloseTo(-BOTTLE_L / 2, 1);
    expect(Math.max(z.max.x, -z.min.x)).toBeLessThanOrEqual(BOTTLE_R);
    const x = posed(g, "x");
    expect(x.max.x - x.min.x).toBeCloseTo(BOTTLE_L, 1);
    expect(x.max.z).toBeLessThanOrEqual(BOTTLE_R);
    g.dispose();
  });

  it("is plainer when hundreds are on offer, and never more than a few hundred triangles", () => {
    expect(ghostRadial(12)).toBe(16);
    expect(ghostRadial(200)).toBe(12);
    expect(ghostRadial(450)).toBe(10);
    const tris = (n: number) => {
      const g = buildGhostBottle(ghostRadial(n));
      const t = g.getIndex()!.count / 3;
      g.dispose();
      return t;
    };
    expect(tris(40)).toBeLessThan(400);
    expect(tris(450)).toBeLessThan(tris(40) * 0.7);
  });

  it("is see-through glass that never hides what is behind it, toned per placeholder", () => {
    const m = buildGhostMaterial();
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBe(GHOST_OPACITY);
    expect(m.opacity).toBeLessThan(0.5);
    expect(m.depthWrite).toBe(false);
    expect(m.map).toBeNull();
    // white: the tone (resting, warmer under a mouse, gold when chosen) is each instance's colour
    expect(m.color.getHexString()).toBe("ffffff");
    m.dispose();
  });
});

describe("the rings that mark a spot are seen on every finish (sprint 10)", () => {
  /** WCAG relative luminance and contrast ratio. */
  const luminance = (hex: string) => {
    const c = new THREE.Color(hex);
    // THREE.Color holds linear values once read from a hex string under colour management: exactly what WCAG wants
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  // every tone a place can have, in both looks, also as it is seen deep in a compartment (the vertex shading darkens
  // the back), and the two studios behind a place
  const surfaces = [
    ...new Set([
      ...Object.values(TONES),
      ...Object.values(PREMIUM_TONES),
      ...Object.values(PREMIUM_TONES).map((t) => shade(t, 0.5)),
      "#121010",
      "#f3efe7",
    ]),
  ];

  it("the core alone was not: on dark wood a wine-red ring all but vanished, on white lacquer a gold one did", () => {
    const weak = (core: string) => surfaces.filter((s) => contrast(core, s) < 3).length;
    expect(weak(RING.target.core)).toBeGreaterThan(0);
    expect(weak(RING.marker.core)).toBeGreaterThan(0);
  });

  it("with its keyline, each ring stands out at 3:1 or more against every one of them", () => {
    for (const ring of [RING.target, RING.marker])
      for (const s of surfaces)
        expect(
          Math.max(contrast(ring.core, s), contrast(ring.keyline, s)),
          `${ring.core} on ${s}`,
        ).toBeGreaterThanOrEqual(3);
  });

  it("the two rings differ in light and dark, not only in hue: pale round dark, and dark round light", () => {
    expect(luminance(RING.target.keyline)).toBeGreaterThan(luminance(RING.target.core) * 3);
    expect(luminance(RING.marker.core)).toBeGreaterThan(luminance(RING.marker.keyline) * 3);
  });

  it("is one geometry, keyline first and core over it, painted per vertex, one material that writes no depth", () => {
    const g = buildKeylineRing(RING.target);
    expect(Object.keys(g.attributes).sort()).toEqual(["color", "normal", "position"]);
    const plain = new THREE.TorusGeometry(BOTTLE_R + 0.07, 0.035, 8, 40);
    const half = plain.index!.count;
    expect(g.index!.count).toBe(half * 2);
    // the last half of the triangles (drawn last) is the core, in the core's colour
    const colours = g.getAttribute("color");
    const at = (i: number) => new THREE.Color(colours.getX(i), colours.getY(i), colours.getZ(i));
    const n = colours.count;
    expect(at(0).getHexString()).toBe(new THREE.Color(RING.target.keyline).getHexString());
    expect(at(n - 1).getHexString()).toBe(new THREE.Color(RING.target.core).getHexString());
    // the same circle as the ring always was, a little wider
    g.computeBoundingBox();
    expect(g.boundingBox!.max.x).toBeCloseTo(BOTTLE_R + 0.07 + 0.062, 6);
    const paint = buildRingPaint();
    expect(paint.vertexColors).toBe(true);
    expect(paint.depthWrite).toBe(false);
    expect(paint.toneMapped).toBe(false);
  });
});
