import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BOTTLE_LENGTH, SHAPES } from "./layout";
import { GHOST_OPACITY, buildGhostBottle, buildGhostMaterial, ghostRadial } from "./ghost-bottle";
import { rackMatrix } from "./pose";

/**
 * The placeholder of a free spot in the existing 3D view (sprint 7.2 completion): a see-through bottle and nothing
 * else. As the template renderer's (`storage3d/resources.test.ts`): no plus, no icon, no second part.
 */
describe("the existing view's placeholder bottle", () => {
  it("is a bottle's outline and nothing else: one lathe, lit (normals), no texture coordinates, no groups, no colours", () => {
    const g = buildGhostBottle(ghostRadial(10));
    expect(Object.keys(g.attributes).sort()).toEqual(["normal", "position"]);
    expect(g.groups).toHaveLength(0);
    expect(g.getAttribute("color")).toBeUndefined();
    g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new THREE.Vector3());
    // a bottle's length, standing on y = 0; no wider than a Bordeaux bottle anywhere (nothing beside or past it)
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(size.y).toBeCloseTo(BOTTLE_LENGTH, 6);
    expect(Math.max(size.x, size.z)).toBeLessThanOrEqual(2 * SHAPES.bordeaux.radius + 1e-6);
    const triangles = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
    expect(triangles).toBeLessThan(400);
    g.dispose();
  });

  it("plainer with hundreds on offer", () => {
    const tri = (n: number) => {
      const g = buildGhostBottle(ghostRadial(n));
      const t = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
      g.dispose();
      return t;
    };
    expect(tri(500)).toBeLessThan(tri(200));
    expect(tri(200)).toBeLessThan(tri(50));
  });

  it("see-through glass that writes no depth, white (each placeholder's tone is its instance colour)", () => {
    const m = buildGhostMaterial();
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBe(GHOST_OPACITY);
    expect(m.depthWrite).toBe(false);
    expect(m.color.getHexString()).toBe("ffffff");
    m.dispose();
  });

  it("posed by the bottles' own matrix, it lies on its spot: its middle on the spot's centre, its neck towards you", () => {
    const g = buildGhostBottle();
    g.computeBoundingBox();
    const m = rackMatrix(2, 3, 4, 5);
    const middle = new THREE.Vector3(0, BOTTLE_LENGTH / 2, 0).applyMatrix4(m);
    expect(middle.x).toBeCloseTo(3 - 3, 12);
    expect(middle.y).toBeCloseTo(2.5 - 2, 12);
    expect(middle.z).toBeCloseTo(0, 12);
    const neck = new THREE.Vector3(0, BOTTLE_LENGTH, 0).applyMatrix4(m);
    expect(neck.z).toBeGreaterThan(1.6);
    g.dispose();
  });
});
