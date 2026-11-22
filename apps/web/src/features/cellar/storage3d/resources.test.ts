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

import { fixtureBottles, fixturePlace } from "./fixtures";
import { QUALITY, buildModel, placeBottles, type Quality } from "./model";
import { MATERIAL_ROLES } from "./palette";
import { BOTTLE_L, BOTTLE_R } from "./parts";
import {
  Owned,
  bottleGroups,
  GHOST_BODY,
  GHOST_PLUS,
  buildBottleKit,
  buildGhostBottle,
  buildStructure,
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
  const front = (g: THREE.BufferGeometry, lie: "z" | "x") => {
    // where the placeholder is, posed as a bottle on a spot at the origin
    const posed = g.clone().applyMatrix4(poseMatrix({ position: [0, 0, 0], lie } as never));
    posed.computeBoundingBox();
    return posed.boundingBox!;
  };

  it("is one geometry with a colour and a see-through-ness per vertex: one draw call for every spot", () => {
    for (const lie of ["z", "x"] as const) {
      const g = buildGhostBottle(lie);
      const colour = g.getAttribute("color");
      expect(colour.itemSize).toBe(4);
      expect(colour.count).toBe(g.getAttribute("position").count);
      // a flat colour: no normals or texture coordinates are kept
      expect(g.getAttribute("normal")).toBeUndefined();
      expect(g.getAttribute("uv")).toBeUndefined();
      // pale glass, a nearly opaque plus, and nothing in between
      const alphas = new Set<number>();
      for (let i = 0; i < colour.count; i++) alphas.add(Math.round(colour.getW(i) * 100));
      expect([...alphas].sort()).toEqual(
        [Math.round(GHOST_BODY[3] * 100), Math.round(GHOST_PLUS[3] * 100)].sort(),
      );
      g.dispose();
    }
  });

  it("takes a bottle's place exactly: lying towards the viewer, its plus is in front of the neck", () => {
    const g = buildGhostBottle("z");
    const box = front(g, "z");
    // as long as a bottle, a little more for the plus just past its neck; as wide as a bottle at most
    expect(box.max.z).toBeGreaterThan(BOTTLE_L / 2);
    expect(box.max.z).toBeLessThan(BOTTLE_L / 2 + 0.1);
    expect(box.min.z).toBeCloseTo(-BOTTLE_L / 2, 1);
    expect(Math.max(box.max.x, -box.min.x)).toBeLessThanOrEqual(BOTTLE_R);
    g.dispose();
  });

  it("along a wall: its plus is on the front of its body, facing the viewer", () => {
    const g = buildGhostBottle("x");
    const box = front(g, "x");
    expect(box.max.z).toBeGreaterThan(0.42);
    expect(box.max.z).toBeLessThan(BOTTLE_R + 0.1);
    expect(box.max.x - box.min.x).toBeCloseTo(BOTTLE_L, 1);
    g.dispose();
  });

  it("is cheap: well under a thousand triangles, whatever the level of detail of the real bottles", () => {
    const g = buildGhostBottle("z");
    expect(g.getIndex()!.count / 3).toBeLessThan(1000);
    g.dispose();
  });
});
