import * as THREE from "three";
import { lathePoints } from "./layout";

/**
 * THE PLACEHOLDER BOTTLE OF A FREE SPOT IN THE EXISTING 3D VIEW (Smart Cellar 3D, sprint 7.2 completion: Quick Add on
 * places from before templates).
 *
 * THE ONE SOURCE of the see-through bottle on a free spot, for both views (since sprint 10): the template renderer
 * re-exports it (`storage3d/resources.ts`). It imports only three.js and this view's own profile (`./layout`), so the
 * existing view never downloads any of the new view's code (README rule 17: with the renderer gate closed nothing of
 * the new view is fetched). Keep it that way: nothing here may import from `../storage3d`. The outline of a Bordeaux
 * bottle and nothing else (no plus, no icon, no second part), normals for the scene's light, no texture coordinates.
 */

/** How much larger the chosen placeholder is drawn. */
export const GHOST_LIFT = 1.05;
/** How see-through a placeholder is: there, in the furniture, but never mistaken for a real bottle. */
export const GHOST_OPACITY = 0.3;
/** Resting, under a mouse or pen (never a finger), chosen. */
export const GHOST_TONES = { rest: "#efe7d6", hover: "#ffe6b3", chosen: "#e9b955" } as const;

/** Rounder with few spots on offer (each is large on screen), plainer with hundreds (together they are what costs). */
export function ghostRadial(spots: number): number {
  return spots <= 120 ? 16 : spots <= 400 ? 12 : 10;
}

/** Every `every`-th point of a profile, keeping its ends and the heel (where the outline turns fastest). */
function thin(points: Array<[number, number]>, every: number): Array<[number, number]> {
  if (every <= 1) return points;
  return points.filter((_, i) => i === 0 || i === points.length - 1 || i % every === 0 || i < 6);
}

/**
 * The outline of a Bordeaux bottle, modelled standing on y = 0 like every bottle of this view, so `rackMatrix` puts it
 * exactly where a bottle on that spot lies. One geometry for every placeholder of a place: one instanced mesh, one
 * draw call.
 */
export function buildGhostBottle(radial = ghostRadial(0)): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    thin(lathePoints("bordeaux"), 3).map(([r, y]) => new THREE.Vector2(r, y)),
    radial,
  );
  g.deleteAttribute("uv");
  g.computeBoundingSphere();
  return g;
}

/** Pale glass, lit by the scene, see-through and never writing depth; white, so each tone is an instance colour. */
export function buildGhostMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.18,
    metalness: 0,
    envMapIntensity: 1.1,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthWrite: false,
  });
}
