import * as THREE from "three";
import { BOTTLE_LENGTH, slotPosition } from "./layout";

/** A tiny lift so bottles rest with their necks slightly up, like in a real rack. */
export const TILT = 0.04;

/** How every bottle lies in the rack: on its side, neck towards you. One value, shared by rack and showcase. */
export const RACK_ROTATION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(Math.PI / 2 - TILT, 0, 0),
);

/** The bottle meshes are built standing on y = 0; their pivot is the middle of the bottle. */
export const BOTTLE_PIVOT = new THREE.Matrix4().makeTranslation(0, -BOTTLE_LENGTH / 2, 0);

const ONE = new THREE.Vector3(1, 1, 1);
const at = new THREE.Vector3();

/**
 * The exact world matrix of a bottle lying in its slot (pivot included). The rack's instances are placed with it,
 * and the bottle on display goes home to it, so the hand-over between the two is the same matrix, not an estimate.
 */
export function rackMatrix(
  row: number,
  col: number,
  rows: number,
  cols: number,
  out = new THREE.Matrix4(),
): THREE.Matrix4 {
  const [x, y, z] = slotPosition(row, col, rows, cols);
  return out.compose(at.set(x, y, z), RACK_ROTATION, ONE).multiply(BOTTLE_PIVOT);
}
